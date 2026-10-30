import {generateText} from 'ai';
import {createOpenAICompatible} from '@ai-sdk/openai-compatible';

export class LlmJsonError extends Error{constructor(message,{raw,issues}={}){super(message);this.name='LlmJsonError';this.raw=raw;this.issues=issues;}}

/** Default text generator: the template's OpenAI-compatible provider (ZAI_* env). */
export function defaultGenerate(env=process.env){
 let model;
 return async({system,prompt})=>{
  if(!env.ZAI_API_KEY||!env.ZAI_BASE_URL||!env.ZAI_MODEL)throw new Error('ZAI_API_KEY, ZAI_BASE_URL and ZAI_MODEL must be set');
  model??=createOpenAICompatible({name:'zai',baseURL:env.ZAI_BASE_URL,apiKey:env.ZAI_API_KEY}).chatModel(env.ZAI_MODEL);
  // LLM_TEMPERATURE is optional: reasoning models (e.g. OpenAI GPT-5.x) reject a custom temperature.
  const t=env.LLM_TEMPERATURE?.trim();
  const r=await generateText({model,system,prompt,...(t?{temperature:Number(t)}:{}),abortSignal:AbortSignal.timeout(120000)});
  return {text:r.text,usage:r.usage};
 };
}

/** Returns the first balanced top-level JSON object in `text` (ignores prose and code fences). */
export function extractJsonObject(text){
 const s=String(text??'');
 for(let start=s.indexOf('{');start!==-1;start=s.indexOf('{',start+1)){
  let depth=0,inStr=false,esc=false;
  for(let i=start;i<s.length;i++){
   const c=s[i];
   if(inStr){if(esc)esc=false;else if(c==='\\')esc=true;else if(c==='"')inStr=false;continue;}
   if(c==='"')inStr=true;else if(c==='{')depth++;else if(c==='}'&&--depth===0){
    try{return JSON.parse(s.slice(start,i+1));}catch{break;}
   }
  }
 }
 return undefined;
}

/**
 Ask the model for a JSON object and validate it with a Zod schema.
 Retries `maxRetries` times, feeding the validation error back. Never relies on provider JSON mode.
*/
export function createLlm({generate=defaultGenerate(),onUsage=()=>{}}={}){
 return {
  async generateJson({system,prompt,schema,maxRetries=1}){
   const sys=`${system}\n\nRespond with exactly one JSON object and nothing else. No markdown, no commentary.`;
   let p=prompt,last;
   for(let attempt=0;attempt<=maxRetries;attempt++){
    const {text,usage}=await generate({system:sys,prompt:p});
    if(usage)onUsage(usage);
    const obj=extractJsonObject(text);
    if(obj===undefined){last=new LlmJsonError('Model did not return a JSON object',{raw:text});}
    else{
     const parsed=schema.safeParse(obj);
     if(parsed.success)return parsed.data;
     last=new LlmJsonError('Model JSON failed validation',{raw:text,issues:parsed.error.issues});
    }
    const why=last.issues?last.issues.slice(0,10).map(i=>`${i.path.join('.')||'(root)'}: ${i.message}`).join('; '):'no parseable JSON object';
    p=`${prompt}\n\nYour previous answer was rejected (${why}). Return a corrected JSON object only.`;
   }
   throw last;
  },
 };
}
