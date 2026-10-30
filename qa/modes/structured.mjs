import {z} from 'zod';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {structuredContractSchema} from '../contract/structured.mjs';
import {renderStructuredContract,compactCriteria} from '../contract/render.mjs';
import {parseQaRequest} from '../request.mjs';
import {composeServiceParts,buildInputData,schemaFields,withFieldLimits} from '../hire.mjs';
import {extractStructured} from '../extract.mjs';
import {validateStructured} from '../validators/structured/index.mjs';
import {buildReport,renderReportMarkdown,fixInstructions} from '../report.mjs';

const SYSTEM_DRAFT=`You convert a customer's data request into a strict acceptance contract (JSON) for a data-producing AI agent.
Encode only requirements the request states or clearly implies. When something is ambiguous, choose the most common convention and record the assumption in "notes".
Field types: string, integer, number, boolean, date, datetime, time, enum, email, url.
Date/time "format" uses Luxon tokens, e.g. "yyyy-MM-dd", "dd.MM.yyyy", "HH:mm", "yyyy-MM-dd'T'HH:mm:ssZZ", or "ISO" for ISO 8601.
Use "enum" with "enum": [...] when the request lists allowed values. Use "unique" for natural keys (e.g. one row per date and country).
Field names: use the exact names the customer gives; otherwise short snake_case names.`;

const SHAPE=`{
 "output": {"format": "csv"|"json", "csv": {"delimiter": ","|";"|"\\t", "header": true}, "json": {"root": "array"|"object", "recordsPath": "data.items"}},
 "records": {"exact": 50} | {"min": 10, "max": 100},
 "fields": [{"name": "date", "type": "date", "format": "yyyy-MM-dd", "required": true}, {"name": "country", "type": "enum", "enum": ["DE","AT"]}, {"name": "price_eur", "type": "number", "min": 0}],
 "unique": [["date","country"]],
 "allowExtraFields": false,
 "notes": "assumptions"
}`;

/** Luxon uses yyyy/dd; customers and LLMs often write YYYY/DD (moment style). */
export function normalizeDateFormat(fmt){
 if(!fmt||fmt==='ISO')return fmt;
 if(/^iso[ -]?8601$/i.test(fmt.trim()))return 'ISO';
 return fmt.replace(/YYYY/g,'yyyy').replace(/YY/g,'yy').replace(/DD/g,'dd').replace(/(?<![A-Za-z])D(?![A-Za-z])/g,'d');
}
const LITERAL_FORMATS=[[/\byyyy-mm-dd\b/i,'yyyy-MM-dd'],[/\bdd\.mm\.yyyy\b/i,'dd.MM.yyyy'],[/\bmm\/dd\/yyyy\b/i,'MM/dd/yyyy'],[/\bdd\/mm\/yyyy\b/i,'dd/MM/yyyy'],[/\bISO[ -]?8601\b/i,'ISO']];
export function briefDateFormat(brief){for(const [re,f] of LITERAL_FORMATS)if(re.test(brief))return f;return undefined;}
const NOUNS='rows|records|entries|items|lines|products|prices|results|objects|companies|cities|countries|people|users|transactions';
export function briefRecordCount(brief){
 const m=brief.match(new RegExp(`\\b(at least|minimum of|min\\.?|up to|at most|max(?:imum)?(?: of)?|exactly)?\\s*(\\d{1,6})\\s+(?:[a-z-]+\\s+){0,3}?(?:${NOUNS})\\b`,'i'));
 if(m){
  const n=Number(m[2]),q=(m[1]??'').toLowerCase();
  if(/least|min/.test(q))return {min:n};
  if(/up to|most|max/.test(q))return {max:n};
  return {exact:n};
 }
 const t=brief.match(/\btop\s+(\d{1,6})\b/i);
 return t?{exact:Number(t[1])}:undefined;
}

/** Deterministic fixes on top of the LLM draft. */
export function postProcess(contract,brief){
 const c=structuredClone(contract);
 const count=briefRecordCount(brief);
 if(count){
  const n=count.exact??count.min??count.max;
  const r=c.records??{};
  if(![r.exact,r.min,r.max].includes(n))c.records=count;
 }
 const fmt=briefDateFormat(brief);
 for(const f of c.fields){
  if(['date','datetime','time'].includes(f.type)){
   if(fmt&&f.type==='date')f.format=fmt;
   f.format=normalizeDateFormat(f.format)??(f.type==='date'?'yyyy-MM-dd':f.type==='time'?'HH:mm':'ISO');
  }
 }
 return c;
}

function contractSchemaWith(fixed){
 return z.any().transform((o,ctx)=>{
  const r=structuredContractSchema.safeParse({...(o&&typeof o==='object'?o:{}),...fixed});
  if(!r.success){for(const i of r.error.issues)ctx.addIssue({code:'custom',message:i.message,path:i.path});return z.NEVER;}
  return r.data;
 });
}

export function createStructuredMode({llm,fetchImpl=fetch}){
 const self={
  name:'structured',
  parseRequest:({description,config})=>parseQaRequest({description,config,llm}),

  async draftContract({request,agent,inputSchema}){
   const fixed={kind:'structured',version:1,agentId:agent.id,brief:request.brief,retry:{maxAttempts:request.maxAttempts,maxCreditsPerHire:request.maxCreditsPerHire}};
   const fields=schemaFields(inputSchema).map(f=>f.name??f.id).join(', ');
   const draft=await llm.generateJson({system:SYSTEM_DRAFT,
    prompt:`Return a JSON object with this shape (omit optional parts you do not need):\n${SHAPE}\n\nAgent: ${agent.name}${agent.notes?` (${agent.notes})`:''}. Agent input fields: ${fields||'unknown'}.\n\nCustomer request:\n"""\n${request.brief}\n"""`,
    schema:contractSchemaWith(fixed)});
   return structuredContractSchema.parse(postProcess(draft,request.brief));
  },

  async reviseContract({contract,comment}){
   const {kind,version,agentId,brief,retry}=contract;
   const revised=await llm.generateJson({system:`${SYSTEM_DRAFT}\nYou now revise an existing contract: apply the customer's requested changes and change nothing else.`,
    prompt:`Current contract:\n${JSON.stringify(contract,null,1)}\n\nCustomer's requested changes:\n"""\n${comment}\n"""\n\nReturn the full updated contract JSON.`,
    schema:contractSchemaWith({kind,version,agentId,brief,retry})});
   return structuredContractSchema.parse({...revised,fields:revised.fields.map(f=>['date','datetime','time'].includes(f.type)?{...f,format:normalizeDateFormat(f.format)}:f)});
  },

  renderContract:renderStructuredContract,

  async buildInputData({inputSchema,contract,attempt,fixInstructions:fixes,agent}){
   // Compact criteria: Agents may cap their input (see withFieldLimits). The customer still sees the numbered list.
   const parts=composeServiceParts({brief:contract.brief,criteriaText:compactCriteria(contract),attempt,fixInstructions:fixes});
   return buildInputData({inputSchema:withFieldLimits(inputSchema,agent?.fieldMaxLength),serviceBrief:`${parts.brief}\n\n${parts.requirements}`,parts,llm});
  },

  async verify({job,files,links,contract,attempt,workDir}){
   writeFileSync(join(workDir,'job.json'),JSON.stringify(job,null,1),{mode:0o600});
   const deliverable=await extractStructured({job,files,links,contract,fetchImpl});
   if(deliverable.kind!=='unknown'){
    deliverable.path=join(workDir,`deliverable.${deliverable.kind}`);
    writeFileSync(deliverable.path,deliverable.text,{mode:0o600});
   }
   const checks=validateStructured({deliverable,contract,job});
   const report=buildReport({checks,attempt,jobId:job.id,agentId:contract.agentId,deliverable});
   if(deliverable.path)report.deliverable.path=deliverable.path;
   writeFileSync(join(workDir,'report.json'),JSON.stringify(report,null,1),{mode:0o600});
   return report;
  },

  fixInstructions,
  renderReport:renderReportMarkdown,

  renderResult({contract,attempts,agent}){
   const last=attempts.at(-1);
   const path=last.report?.deliverable?.path;
   let data=path&&existsSync(path)?readFileSync(path,'utf8'):'';
   const LIMIT=200*1024;
   let note='';
   if(Buffer.byteLength(data)>LIMIT){const lines=data.split('\n');data=lines.slice(0,201).join('\n');note=`\n\n(Showing the first 200 of ${lines.length} lines. Full data: job ${last.jobId}.)`;}
   const history=attempts.length>1?`\n\nAttempts: ${attempts.map(a=>`#${a.n} ${a.report?.verdict??'n/a'}${a.refund?` (refund ${a.refund.status})`:''}`).join(', ')}.`:'';
   return `QA PASSED. ${agent.name} delivered data that meets every acceptance criterion (attempt ${last.n} of max ${contract.retry.maxAttempts}).${history}\n\n## Deliverable\n\n\`\`\`${contract.output.format}\n${data.trimEnd()}\n\`\`\`${note}\n\n## QA report\n\n${renderReportMarkdown(last.report)}\n\n## Acceptance contract\n\n${renderStructuredContract(contract)}\n`;
  },
 };
 return self;
}
