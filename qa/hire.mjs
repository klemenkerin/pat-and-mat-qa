import {z} from 'zod';

const TEXT=new Set(['string','text','textarea']);
const SKIP=new Set(['none']);
// Matches whole words in ids like `research_question` and names like "Research Question".
const PREFERRED=/(^|[\s_-])(prompt|query|brief|request|task|instructions?|description|input|text|message|topic|question)($|[\s_-])/i;

/** Flatten MIP-003 input schemas: {input_data:[...]}, {input_groups:[{input_data:[...]}]} or a bare array. */
export function schemaFields(inputSchema){
 if(Array.isArray(inputSchema))return inputSchema;
 const direct=inputSchema?.input_data??inputSchema?.inputData;
 if(Array.isArray(direct))return direct;
 const groups=inputSchema?.input_groups??inputSchema?.inputGroups;
 if(Array.isArray(groups))return groups.flatMap(g=>g?.input_data??g?.inputData??[]);
 return [];
}
const isOptional=f=>(f.validations??[]).some(v=>v?.validation==='optional'&&String(v.value)!=='false');
const optionValues=f=>(f.data?.values??f.data?.options??[]).map(v=>typeof v==='object'&&v!==null?String(v.value??v.id??v.label):String(v));
const maxLen=f=>{const v=(f.validations??[]).find(x=>x?.validation==='max');return v?Number(v.value):undefined;};

/** Brief sent to the service agent: original brief + hard requirements + fixes from failed attempts. */
export function composeServiceParts({brief,criteriaText,attempt,fixInstructions=[]}){
 let requirements=`Hard requirements (checked automatically):\n${criteriaText.trim()}`;
 if(attempt>1&&fixInstructions.length)requirements+=`\n\nYour previous attempt was rejected. Fix ALL of these issues:\n${fixInstructions.map(f=>`- ${f}`).join('\n')}`;
 return {brief:brief.trim(),requirements};
}
export function composeServiceBrief(o){const p=composeServiceParts(o);return `${p.brief}\n\n${p.requirements}`;}

/**
 Copy of the schema with extra per-field length limits (from config/agents.json `fieldMaxLength`).
 Some Agents enforce limits their form does not declare (Advanced Web Research: start_job fails above 500 chars).
 Only used to build and check inputData; the hire still sends the Agent's schema unchanged.
*/
export function withFieldLimits(inputSchema,limits){
 if(!limits||!Object.keys(limits).length)return inputSchema;
 const copy=structuredClone(inputSchema);
 for(const f of schemaFields(copy))if(limits[f.id]!==undefined)f.validations=[...(f.validations??[]).filter(v=>v?.validation!=='max'),{validation:'max',value:String(limits[f.id])}];
 return copy;
}

/** Check inputData against the agent's schema; returns a list of problems (empty = ok). */
export function validateInputData(inputSchema,inputData){
 const problems=[];
 for(const f of schemaFields(inputSchema)){
  if(SKIP.has(f.type))continue;
  const v=inputData[f.id];
  if(v===undefined||v===null||v===''){if(!isOptional(f)&&f.type!=='hidden')problems.push(`missing required field ${f.id}`);continue;}
  switch(f.type){
   case 'number':case 'range':if(typeof v!=='number'||!Number.isFinite(v))problems.push(`${f.id} must be a number`);break;
   case 'boolean':case 'checkbox':if(typeof v!=='boolean')problems.push(`${f.id} must be a boolean`);break;
   case 'option':case 'radio':{const vals=optionValues(f);if(vals.length&&!vals.includes(String(v)))problems.push(`${f.id} must be one of ${vals.join(', ')}`);break;}
   case 'multiselect':{const vals=optionValues(f);if(!Array.isArray(v)||v.some(x=>vals.length&&!vals.includes(String(x))))problems.push(`${f.id} must be a list of ${vals.join(', ')}`);break;}
   default:if(typeof v!=='string')problems.push(`${f.id} must be a string`);else if(maxLen(f)&&v.length>maxLen(f))problems.push(`${f.id} is longer than ${maxLen(f)} characters`);
  }
 }
 const known=new Set(schemaFields(inputSchema).map(f=>f.id));
 for(const k of Object.keys(inputData))if(!known.has(k))problems.push(`unknown field ${k}`);
 return problems;
}

/**
 Map the service brief onto the agent's input form.
 Deterministic when the form has one obvious free-text field; otherwise the LLM maps it and code validates.
*/
export async function buildInputData({inputSchema,serviceBrief,parts,llm}){
 const fields=schemaFields(inputSchema).filter(f=>!SKIP.has(f.type));
 if(!fields.length)throw new Error('The agent input schema has no fields');
 const texts=fields.filter(f=>TEXT.has(f.type));
 const hidden=Object.fromEntries(fields.filter(f=>f.type==='hidden'&&f.data?.value!==undefined).map(f=>[f.id,f.data.value]));
 const otherRequired=fields.filter(f=>!TEXT.has(f.type)&&f.type!=='hidden'&&!isOptional(f));
 const main=texts.length===1?texts[0]:texts.find(f=>PREFERRED.test(f.id)||PREFERRED.test(f.name??''));
 if(main&&!otherRequired.length&&texts.filter(f=>f!==main&&!isOptional(f)).length===0){
  let data={...hidden,[main.id]:serviceBrief};
  const m=maxLen(main);
  if(m&&serviceBrief.length>m){
   // Too long for one field: brief in the main field, requirements and fixes in an optional second text field.
   const extra=parts&&texts.find(f=>f!==main&&isOptional(f));
   if(!extra)throw new Error(`The brief (${serviceBrief.length} chars) exceeds the ${main.id} limit of ${m} characters`);
   data={...hidden,[main.id]:parts.brief,[extra.id]:parts.requirements};
  }
  const p=validateInputData(inputSchema,data);if(p.length)throw new Error(p.join('; '));
  return data;
 }
 if(!llm)throw new Error('The agent form needs more than one field and no LLM is available to map it');
 const describe=fields.map(f=>({id:f.id,type:f.type,name:f.name,required:!isOptional(f),description:f.data?.description,values:optionValues(f).length?optionValues(f):undefined,default:f.data?.default}));
 const out=await llm.generateJson({
  system:'You fill an AI agent\'s input form so that it produces exactly the requested deliverable. Put every requirement into the most suitable free-text field verbatim. Use only the listed field ids and allowed values.',
  prompt:`Form fields:\n${JSON.stringify(describe,null,1)}\n\nRequest to encode:\n"""\n${serviceBrief}\n"""\n\nReturn {"inputData": {<fieldId>: value}}.`,
  schema:z.object({inputData:z.record(z.string(),z.union([z.string(),z.number(),z.boolean(),z.array(z.string()),z.array(z.number())]))})});
 // Never send empty optional values: Preprod's Advanced Web Research failed start_job on additional_context:"" (2026-10-30).
 const optional=new Set(fields.filter(isOptional).map(f=>f.id));
 const filled=Object.fromEntries(Object.entries(out.inputData).filter(([k,v])=>!(optional.has(k)&&(v===''||(Array.isArray(v)&&!v.length)))));
 const data={...hidden,...filled};
 const p=validateInputData(inputSchema,data);
 if(p.length)throw new Error(`Could not fill the agent form: ${p.join('; ')}`);
 return data;
}
