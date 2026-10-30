import {z} from 'zod';
import {imageContractSchema} from './image.mjs';

export const SYSTEM_DRAFT_IMAGE=`You convert a customer's image request into an acceptance contract (JSON).
Text: if the request quotes text or demands exact wording, use mode "exact" with the literal text; if it only describes the text's meaning, use "idea" with a one-sentence description; otherwise "none".
Objects: list only concrete, visible, detectable nouns the request explicitly names, as singular lowercase English noun phrases, with counts from number words ("two dogs" -> {"label":"dog","minCount":2}).
Ignore style, mood and colour (record them in "notes"). Technical limits (format, size) only when the request states them.`;

export const SHAPE_IMAGE=`{
 "images": {"min": 1, "max": 1},
 "technical": {"formats": ["png","jpeg","webp"], "minWidth": 1024, "minHeight": 768, "maxBytes": 5000000, "aspectRatio": {"value": 1.7778, "tolerance": 0.02}},
 "text": {"mode": "exact"|"idea"|"none", "expected": "SUMMER SALE -50%"},
 "objects": [{"label": "bicycle", "minCount": 1}],
 "notes": "assumptions; colours and style are not checked"
}`;

// "…", “…”, „…“, «…» and '…' (single quotes only at word boundaries, so "don't" is not a quote).
const QUOTES=[/"([^"\n]+)"/g,/“([^”\n]+)”/g,/„([^“”\n]+)[“”]/g,/«([^»\n]+)»/g,/(?<![\p{L}\p{N}])'([^'\n]+)'(?![\p{L}\p{N}])/gu,/‘([^’\n]+)’/g];
/** Literal texts quoted in the brief, in order of appearance. */
export function quotedTexts(brief){
 const found=[];
 for(const re of QUOTES)for(const m of String(brief).matchAll(re)){const t=m[1].trim();if(t)found.push({t,i:m.index});}
 return found.sort((a,b)=>a.i-b.i).map(x=>x.t).filter((t,i,a)=>a.indexOf(t)===i);
}

const IRREGULAR={people:'person',children:'child',men:'man',women:'woman',mice:'mouse',geese:'goose',feet:'foot',teeth:'tooth',knives:'knife',leaves:'leaf',wolves:'wolf',loaves:'loaf',shelves:'shelf'};
const KEEP=new Set(['glass','bus','gas','grass','dress','class','boss','cross','chess','compass','lens','canvas','series','species','news','glasses','scissors','jeans','trousers','pants','headphones']);
/** Singular form of the last word of a noun phrase ("two coffee cups" is handled by the caller; "coffee cups" -> "coffee cup"). */
export function singularize(phrase){
 const words=String(phrase).trim().toLowerCase().replace(/\s+/g,' ').split(' ');
 let w=words.pop()??'';
 if(IRREGULAR[w])w=IRREGULAR[w];
 else if(!KEEP.has(w)&&w.length>3){
  if(/ies$/.test(w))w=w.replace(/ies$/,'y');
  else if(/(ss|x|ch|sh)es$/.test(w))w=w.replace(/es$/,'');
  else if(/[^su]s$/.test(w))w=w.replace(/s$/,'');
 }
 return [...words,w].join(' ');
}

/** Deterministic rules on top of the LLM draft (plan Step 4.3 a–c). */
export function postProcessImage(contract,brief){
 const c=structuredClone(contract);
 const quotes=quotedTexts(brief);
 const notes=c.notes?[c.notes]:[];
 if(quotes.length){
  // (a) Quoted text is exact text; code overrides the LLM.
  c.text={...(c.text??{}),mode:'exact',expected:quotes.join(' ')};
  if(quotes.length>1)notes.push(`Several quoted texts; all must appear in this order: ${quotes.map(q=>JSON.stringify(q)).join(', ')}.`);
 }else if(c.text?.mode==='exact'){
  // (b) No quotes: we cannot know the literal text, so judge the idea instead.
  c.text={mode:'idea',expected:c.text.expected};
  notes.push('No quoted text in the brief, so the text is judged by meaning, not exact wording.');
 }
 if(c.text?.mode==='none')delete c.text.expected;
 // (c) Labels: lowercase, singular, de-duplicated (keep the highest count).
 const byLabel=new Map();
 for(const o of c.objects??[]){
  const label=singularize(o.label);if(!label)continue;
  byLabel.set(label,Math.max(byLabel.get(label)??0,o.minCount??1));
 }
 c.objects=[...byLabel].map(([label,minCount])=>({label,minCount}));
 if(notes.length)c.notes=notes.join(' ');
 return c;
}

function imageContractWith(fixed,quoteSource=fixed.brief){
 return z.any().transform((o,ctx)=>{
  const base=o&&typeof o==='object'?o:{};
  const r=imageContractSchema.safeParse(postProcessImage({...base,...fixed,text:base.text??{mode:'none'}},quoteSource));
  if(!r.success){for(const i of r.error.issues)ctx.addIssue({code:'custom',message:i.message,path:i.path});return z.NEVER;}
  return r.data;
 });
}

export async function draftImageContract({llm,request,agent}){
 const fixed={kind:'image',version:1,agentId:agent.id,brief:request.brief,retry:{maxAttempts:request.maxAttempts,maxCreditsPerHire:request.maxCreditsPerHire}};
 return llm.generateJson({system:SYSTEM_DRAFT_IMAGE,
  prompt:`Return a JSON object with this shape (omit optional parts you do not need):\n${SHAPE_IMAGE}\n\nAgent: ${agent.name}${agent.notes?` (${agent.notes})`:''}.\n\nCustomer request:\n"""\n${request.brief}\n"""`,
  schema:imageContractWith(fixed)});
}

export async function reviseImageContract({llm,contract,comment}){
 const {kind,version,agentId,brief,retry}=contract;
 return llm.generateJson({system:`${SYSTEM_DRAFT_IMAGE}\nYou now revise an existing contract: apply the customer's requested changes and change nothing else.`,
  prompt:`Current contract:\n${JSON.stringify(contract,null,1)}\n\nCustomer's requested changes:\n"""\n${comment}\n"""\n\nReturn the full updated contract JSON.`,
  // Quotes in the change request replace the text; otherwise the brief's quotes still apply.
  schema:imageContractWith({kind,version,agentId,brief,retry},quotedTexts(comment).length?comment:brief)});
}
