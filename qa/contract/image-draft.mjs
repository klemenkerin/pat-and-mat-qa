import {z} from 'zod';
import {imageContractSchema} from './image.mjs';

export const SYSTEM_DRAFT_IMAGE=`You convert a customer's image request into an acceptance contract (JSON).
Text: if the request quotes text or demands exact wording, use mode "exact" with the literal text. If it only describes the text's meaning, use "idea" with a one-sentence description; a banner, poster, flyer, sign, ad or label that announces, advertises or says something always carries text, so use "idea" for it. Use "none" only when no text is asked for or text is excluded.
Objects: list only concrete, visible, detectable nouns the request explicitly names, as singular lowercase English noun phrases, with counts from number words ("two dogs" -> {"label":"dog","minCount":2}).
Do not list places, scenery or backgrounds (beach, sky, street, room) as objects; mention them in "notes".
Ignore style, mood and colour (record them in "notes"). Technical limits (format, size) only when the request states them.`;

export const SHAPE_IMAGE=`{
 "images": {"min": 1, "max": 1},
 "technical": {"formats": ["png","jpeg","webp"], "minWidth": 1024, "minHeight": 768, "maxBytes": 5000000, "aspectRatio": {"value": 1.7778, "tolerance": 0.02}},
 "text": {"mode": "exact"|"idea"|"none", "expected": "SUMMER SALE -50%"},
 "objects": [{"label": "bicycle", "minCount": 1}],
 "notes": "<your assumptions; omit if none>"
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

// Scenery the detector cannot confirm as an object; dropped from objects and named in notes.
const SCENERY=new Set(['beach','sky','background','scene','landscape','sea','ocean','water','street','city','room','ground','floor','wall','field','forest','park']);
const FORMAT_WORDS={png:/\bpng\b/i,jpeg:/\bjpe?g\b/i,webp:/\bwebp\b/i};
const NEGATIONS=[['maxBytes',/\bno\s+(?:max(?:imum)?\s+)?(?:file\s+)?size\s+(?:limit|cap|restriction)/i],['minHeight',/\bno\s+min(?:imum)?\s+height/i],
 ['minWidth',/\bno\s+min(?:imum)?\s+width/i],['aspectRatio',/\bno\s+(?:fixed\s+)?aspect\s+ratio/i],['formats',/\b(?:any|no\s+(?:specific\s+)?)\s*format\b/i]];
/**
 (d) Technical limits must be grounded: live drafts copied the example values from SHAPE_IMAGE (1024×768, 5 MB)
 into a brief that only said "at least 1000 px wide" (Task 01a18ed2, 2026-10-30). A limit stays only when `source`
 states it (or `previous` already had it); "no file size limit" in a revision comment removes one.
*/
export function groundTechnical(technical,source,{previous={},comment=''}={}){
 const t={...(technical??{})};
 const text=String(source);
 const said=n=>new RegExp(`(?<![\\d.])${n}(?![\\d])`).test(text);
 const kept=(k,v)=>JSON.stringify(previous[k])===JSON.stringify(v);
 if(t.formats){const named=Object.keys(FORMAT_WORDS).filter(f=>FORMAT_WORDS[f].test(text));t.formats=named.length?t.formats.filter(f=>named.includes(f)):kept('formats',t.formats)?t.formats:[];if(!t.formats.length)delete t.formats;}
 for(const k of ['minWidth','minHeight'])if(t[k]!==undefined&&!said(t[k])&&!kept(k,t[k]))delete t[k];
 if(t.maxBytes!==undefined&&!/\b\d+(?:[.,]\d+)?\s*(?:kb|mb|kib|mib|bytes)\b/i.test(text)&&!kept('maxBytes',t.maxBytes))delete t.maxBytes;
 if(t.aspectRatio&&!/aspect|\b\d+\s*:\s*\d+\b|square|landscape|portrait/i.test(text)&&!kept('aspectRatio',t.aspectRatio))delete t.aspectRatio;
 for(const [k,re] of NEGATIONS)if(re.test(comment))delete t[k];
 return t;
}

/** Deterministic rules on top of the LLM draft (plan Step 4.3 a–d). */
export function postProcessImage(contract,brief,{techSource=brief,previous,comment}={}){
 const c=structuredClone(contract);
 c.technical=groundTechnical(c.technical,techSource,{previous,comment});
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
  if(SCENERY.has(label)){notes.push(`"${label}" is scenery, not checked as an object.`);continue;}
  byLabel.set(label,Math.max(byLabel.get(label)??0,o.minCount??1));
 }
 c.objects=[...byLabel].map(([label,minCount])=>({label,minCount}));
 if(/^<.*>$/.test(notes[0]??''))notes.shift();
 if(notes.length)c.notes=notes.join(' ');else delete c.notes;
 return c;
}

function imageContractWith(fixed,quoteSource=fixed.brief,tech={}){
 return z.any().transform((o,ctx)=>{
  const base=o&&typeof o==='object'?o:{};
  const r=imageContractSchema.safeParse(postProcessImage({...base,...fixed,text:base.text??{mode:'none'}},quoteSource,{techSource:fixed.brief,...tech}));
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
  schema:imageContractWith({kind,version,agentId,brief,retry},quotedTexts(comment).length?comment:brief,{techSource:`${brief}\n${comment}`,previous:contract.technical??{},comment})});
}
