import {parse as parseCsv} from 'csv-parse/sync';
import {DateTime} from 'luxon';
import {sha256} from '../../extract.mjs';
import {seriesChecks,plannedSeriesChecks} from './series.mjs';

const NULLS=new Set(['','null','na','n/a','none','nan']);
const isNull=v=>v===null||v===undefined||(typeof v==='string'&&NULLS.has(v.trim().toLowerCase()));
const show=v=>{const s=typeof v==='string'?v:JSON.stringify(v);return s.length>60?`${s.slice(0,57)}...`:s;};
const INT=/^[+-]?\d+$/,NUM=/^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;
const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const check=(id,criterion,status,expected,observed,evidence=[],fix)=>({id,criterion,status,expected:String(expected),observed:String(observed),evidence:evidence.slice(0,5),...(fix?{fix}:{})});

/** Parse into {records:[{...}], header:[names]|null, error?}. */
export function parseDeliverable(text,contract){
 const fields=contract.fields.map(f=>f.name);
 if(contract.output.format==='csv'){
  const header=contract.output.csv?.header??true;
  const delimiter=contract.output.csv?.delimiter??',';
  try{
   const rows=parseCsv(text,{delimiter,skip_empty_lines:true,bom:true,relax_column_count:false,relax_quotes:false});
   if(!rows.length)return {error:'no rows'};
   if(header){const [h,...data]=rows;const names=h.map(x=>x.trim());return {header:names,records:data.map(r=>Object.fromEntries(names.map((n,i)=>[n,r[i]]))),rowOffset:2};}
   return {header:null,records:rows.map(r=>Object.fromEntries(fields.map((n,i)=>[n,r[i]]))),rowOffset:1,columnCount:rows[0].length};
  }catch(e){return {error:e.message.replace(/\s+/g,' ').slice(0,300)};}
 }
 let v;
 try{v=JSON.parse(text);}catch(e){return {error:`invalid JSON: ${e.message}`};}
 const path=contract.output.json?.recordsPath;
 if(path){for(const k of path.split('.')){if(v&&typeof v==='object'&&k in v)v=v[k];else return {error:`recordsPath ${path} not found`};}}
 else if(!Array.isArray(v)&&contract.output.json?.root==='object')v=[v];
 if(!Array.isArray(v))return {error:path?`${path} is not an array`:'expected a JSON array of records'};
 const bad=v.findIndex(r=>!r||typeof r!=='object'||Array.isArray(r));
 if(bad!==-1)return {error:`record ${bad+1} is not an object`};
 return {header:null,records:v,rowOffset:1};
}

function valueProblem(f,v,isCsv){
 switch(f.type){
  case 'string':break;
  case 'integer':{
   if(isCsv?!INT.test(String(v).trim()):!Number.isInteger(v))return isCsv?'not an integer':typeof v==='string'?'integer given as a string':'not an integer';
   break;}
  case 'number':{
   if(isCsv){if(!NUM.test(String(v).trim()))return /^\s*[+-]?\d+,\d+\s*$/.test(String(v))?'decimal comma instead of point':'not a number';}
   else if(typeof v!=='number'||!Number.isFinite(v))return typeof v==='string'&&NUM.test(v)?'number given as a string':'not a number';
   break;}
  case 'boolean':{
   if(isCsv?!/^(true|false)$/i.test(String(v).trim()):typeof v!=='boolean')return 'not a boolean';
   break;}
  case 'enum':{if(!f.enum.includes(String(v)))return `not one of ${f.enum.join('|')}`;break;}
  case 'email':{if(!EMAIL.test(String(v)))return 'not an email address';break;}
  case 'url':{try{const u=new URL(String(v));if(!/^https?:$/.test(u.protocol))return 'not an http(s) URL';}catch{return 'not a URL';}break;}
  case 'date':case 'datetime':case 'time':{
   const s=String(v);
   if(f.format==='ISO'){if(!DateTime.fromISO(s,{setZone:true}).isValid)return 'not ISO 8601';break;}
   const dt=DateTime.fromFormat(s,f.format,{zone:'utc',setZone:true});
   if(!dt.isValid||dt.toFormat(f.format)!==s)return `not in format ${f.format}`;
   break;}
 }
 if(f.min!==undefined||f.max!==undefined){
  const n=typeof v==='number'?v:Number(String(v).trim());
  if(['integer','number'].includes(f.type)&&Number.isFinite(n)){
   if(f.min!==undefined&&n<f.min)return `below minimum ${f.min}`;
   if(f.max!==undefined&&n>f.max)return `above maximum ${f.max}`;
  }else if(f.type==='string'){
   const len=String(v).length;
   if(f.min!==undefined&&len<f.min)return `shorter than ${f.min} characters`;
   if(f.max!==undefined&&len>f.max)return `longer than ${f.max} characters`;
  }
 }
 if(f.pattern&&!new RegExp(f.pattern).test(String(v)))return `does not match ${f.pattern}`;
 return null;
}

/** Integrity of the delivered result vs the on-chain/Job result hash (MIP-004). Informational only. */
export function hashCheck(job){
 if(!job?.resultHash||typeof job.result!=='string')return check('integrity.hash','Delivered result matches the committed result hash','skip','resultHash present','not available');
 const h=String(job.resultHash).toLowerCase();
 const candidates=[sha256(job.result),...(job.identifierFromPurchaser?[sha256(`${job.identifierFromPurchaser};${job.result}`)]:[])];
 const ok=candidates.some(c=>h===c||h.endsWith(c));
 return check('integrity.hash','Delivered result matches the committed result hash',ok?'pass':'warn',job.resultHash,ok?'match':'unverifiable (hash scheme differs)');
}

/**
 Every check a contract produces, in report order. The set depends only on the contract, so every attempt
 reports the same N checks; checks that could not run are reported as skip.
*/
export function plannedChecks(contract){
 const fmt=contract.output.format.toUpperCase();
 const out=[{id:'deliverable.found',criterion:`A ${fmt} deliverable is present`},{id:'delivery.clean',criterion:'Data delivered on its own'},{id:'parse',criterion:`Valid ${fmt}`},{id:'fields.present',criterion:'All contract fields present'}];
 if(!contract.allowExtraFields)out.push({id:'fields.extra',criterion:'No undeclared fields'});
 if(contract.records)out.push({id:'records.count',criterion:'Number of records'});
 for(const f of contract.fields)out.push({id:`field.${f.name}.values`,criterion:fieldCriterion(f)},{id:`field.${f.name}.nulls`,criterion:`Field ${f.name}: empty values`});
 for(const key of contract.unique??[])out.push({id:`unique.${key.join('+')}`,criterion:`No duplicate ${key.join(' + ')}`});
 out.push(...plannedSeriesChecks(contract),{id:'integrity.hash',criterion:'Delivered result matches the committed result hash'});
 return out;
}
const fieldCriterion=f=>`Field ${f.name}: ${f.type}${f.format?` (${f.format})`:''}${f.enum?` in ${f.enum.join('|')}`:''}`;
function complete(contract,checks,reason){
 const byId=new Map(checks.map(c=>[c.id,c]));
 return plannedChecks(contract).map(p=>byId.get(p.id)??check(p.id,p.criterion,'skip','—',`not evaluated: ${reason}`));
}

export function validateStructured({deliverable,contract,job}){
 const checks=[];
 if(!deliverable||deliverable.kind==='unknown'){
  checks.push(check('deliverable.found',`A ${contract.output.format.toUpperCase()} deliverable is present`,'fail','parseable data',`none found${deliverable?.tried?.length?` (${deliverable.tried.join('; ')})`:''}`,[],`Return the data as ${contract.output.format.toUpperCase()} in a fenced \`\`\`${contract.output.format} block or as a file.`));
  checks.push(hashCheck(job));
  return complete(contract,checks,'no deliverable found');
 }
 checks.push(check('deliverable.found',`A ${contract.output.format.toUpperCase()} deliverable is present`,'pass','parseable data',deliverable.origin??'found'));
 checks.push(deliverable.wrapped?check('delivery.clean','Data delivered on its own','warn','data only','data embedded in prose/markdown'):check('delivery.clean','Data delivered on its own','pass','data only','data only'));
 const isCsv=contract.output.format==='csv';
 const p=parseDeliverable(deliverable.text,contract);
 if(p.error){checks.push(check('parse',`Valid ${contract.output.format.toUpperCase()}`,'fail','parses',p.error,[],`Return strictly valid ${contract.output.format.toUpperCase()}${isCsv?` using the delimiter "${contract.output.csv?.delimiter??','}"`:''}.`));checks.push(hashCheck(job));return complete(contract,checks,'the data does not parse');}
 checks.push(check('parse',`Valid ${contract.output.format.toUpperCase()}`,'pass','parses','ok'));
 const {records,header}=p;
 const names=contract.fields.map(f=>f.name);
 // Columns / keys
 const present=header?new Set(header):new Set(records.flatMap(r=>Object.keys(r)));
 if(!header&&isCsv&&p.columnCount!==names.length)checks.push(check('fields.present','All contract fields present','fail',`${names.length} columns`,`${p.columnCount} columns`,[],`Return exactly ${names.length} columns in this order: ${names.join(', ')}.`));
 else{
  const missing=contract.fields.filter(f=>f.required&&(header?!present.has(f.name):records.some(r=>!(f.name in r)))).map(f=>f.name);
  checks.push(check('fields.present','All contract fields present',missing.length?'fail':'pass',names.join(', '),missing.length?`missing: ${missing.join(', ')}`:'all present',[],missing.length?`Include the field(s) ${missing.join(', ')}${header?' in the header row':' in every record'}.`:undefined));
 }
 if(!contract.allowExtraFields){
  const extra=[...present].filter(n=>!names.includes(n));
  checks.push(check('fields.extra','No undeclared fields',extra.length?'fail':'pass','none',extra.length?extra.join(', '):'none',[],extra.length?`Remove the field(s) ${extra.join(', ')}.`:undefined));
 }
 // Count
 const r=contract.records;
 if(r){
  const n=records.length;
  const ok=(r.exact===undefined||n===r.exact)&&(r.min===undefined||n>=r.min)&&(r.max===undefined||n<=r.max);
  const exp=r.exact!==undefined?`exactly ${r.exact}`:[r.min!==undefined?`≥ ${r.min}`:null,r.max!==undefined?`≤ ${r.max}`:null].filter(Boolean).join(' and ');
  checks.push(check('records.count','Number of records',ok?'pass':'fail',exp,n,[],ok?undefined:`Return ${exp} records (you returned ${n}).`));
 }
 // Per-field values and nulls
 for(const f of contract.fields){
  const crit=fieldCriterion(f);
  if(!present.has(f.name)&&!header&&!isCsv&&!f.required){checks.push(check(`field.${f.name}.values`,crit,'skip','all non-empty values valid','optional field absent'),check(`field.${f.name}.nulls`,`Field ${f.name}: empty values`,'pass','optional','absent'));continue;}
  const bad=[],nulls=[];
  records.forEach((rec,i)=>{const v=rec[f.name];const row=i+p.rowOffset;
   if(isNull(v)){nulls.push(row);return;}
   const why=valueProblem(f,v,isCsv);if(why)bad.push(`row ${row}: ${show(v)} (${why})`);});
  checks.push(check(`field.${f.name}.values`,crit,bad.length?'fail':'pass','all non-empty values valid',bad.length?`${bad.length} of ${records.length-nulls.length} invalid`:'all valid',bad,bad.length?`Field ${f.name}: ${bad.length} value(s) are invalid, e.g. ${bad[0]}. Every value must be ${f.type}${f.format?` in the format ${f.format}`:''}${f.enum?` and one of ${f.enum.join(', ')}`:''}.`:undefined));
  const allowed=f.required?f.maxNullRate:1;
  const rate=records.length?nulls.length/records.length:0;
  const ok=rate<=allowed+1e-9;
  checks.push(check(`field.${f.name}.nulls`,`Field ${f.name}: empty values`,ok?'pass':'fail',!f.required?'optional':allowed===0?'none':`≤ ${Math.round(allowed*100)}%`,`${nulls.length} (${Math.round(rate*100)}%)`,nulls.map(n=>`row ${n}`),ok?undefined:`Fill field ${f.name} in every record (${nulls.length} empty).`));
 }
 // Uniqueness
 (contract.unique??[]).forEach((key,k)=>{
  const seen=new Map(),dups=[];
  records.forEach((rec,i)=>{const v=JSON.stringify(key.map(n=>rec[n]));const row=i+p.rowOffset;if(seen.has(v))dups.push(`rows ${seen.get(v)} and ${row}: ${key.map(n=>show(rec[n])).join(' + ')}`);else seen.set(v,row);});
  checks.push(check(`unique.${key.join('+')}`,`No duplicate ${key.join(' + ')}`,dups.length?'fail':'pass','no duplicates',dups.length?`${dups.length} duplicate(s)`:'none',dups,dups.length?`Remove duplicate ${key.join(' + ')} combinations (${dups.length}).`:undefined));
 });
 checks.push(...seriesChecks({records,contract}));
 checks.push(hashCheck(job));
 return complete(contract,checks,'not applicable');
}
