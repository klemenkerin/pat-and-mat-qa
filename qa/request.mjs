import {z} from 'zod';

const FENCE=/```qa-request\s*\n([\s\S]*?)```/i;
const base=z.object({
 agentId:z.string().trim().min(1).optional(),
 brief:z.string().trim().min(3).max(8000),
 autoApprove:z.boolean().optional(),
 maxAttempts:z.number().int().min(1).max(5).optional(),
 maxCreditsPerHire:z.number().positive().max(100000).optional(),
}).strict();
const extracted=z.object({agentId:z.string().trim().min(1).nullable().optional(),brief:z.string().trim().min(3).max(8000)});

/**
 Parse the customer's Task description into a QaRequest.
 Preferred: a ```qa-request fenced JSON block (agent customers). Fallback: free text, via the LLM.
*/
export async function parseQaRequest({description,config,llm}){
 const text=String(description??'').trim();
 if(!text)throw new Error('The Task description is empty');
 let req;
 const m=text.match(FENCE);
 if(m){
  let obj;
  try{obj=JSON.parse(m[1]);}catch(e){throw new Error(`qa-request block is not valid JSON: ${e.message}`);}
  const r=base.safeParse(obj);
  if(!r.success)throw new Error(`qa-request block is invalid: ${r.error.issues.map(i=>`${i.path.join('.')}: ${i.message}`).join('; ')}`);
  req=r.data;
 }else{
  const r=await llm.generateJson({
   system:'You extract a quality-assured job request from a customer message. The customer wants another AI agent to produce a deliverable. Return {"agentId": string|null, "brief": string}. agentId only if the message contains an explicit agent id; brief = the complete description of the deliverable with every requirement the customer stated, in their words.',
   prompt:`Customer message:\n"""\n${text.slice(0,8000)}\n"""`,schema:extracted});
  req={brief:r.brief,...(r.agentId?{agentId:r.agentId}:{})};
 }
 return {
  agentId:req.agentId,
  brief:req.brief,
  autoApprove:req.autoApprove??false,
  maxAttempts:req.maxAttempts??config.QA_MAX_ATTEMPTS_DEFAULT,
  maxCreditsPerHire:req.maxCreditsPerHire??config.QA_MAX_CREDITS_PER_HIRE_DEFAULT,
 };
}

/** Build a customer Task description with a qa-request block (used by scripts/customer.mjs). */
export function formatQaRequest(req,intro='Quality-assured request. Please verify the result before accepting it.'){
 return `${intro}\n\n\`\`\`qa-request\n${JSON.stringify(req,null,1)}\n\`\`\``;
}
