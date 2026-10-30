import {z} from 'zod';
import {matchExact} from './textmatch.mjs';

export const IDEA_SYSTEM='You compare OCR text extracted from an image with a description of what the text should communicate. OCR may contain small recognition errors. Answer whether the text conveys the described idea.';
const ideaSchema=z.object({matches:z.boolean(),confidence:z.number().min(0).max(1),reason:z.string().max(400)});
const q=s=>JSON.stringify(s);

/** The text check for one image. exact: deterministic; idea: the only LLM judgement in the image verdict; none: skipped. */
export async function checkText({ocrResult,text,llm,id='text'}){
 const base={id,evidence:[]};
 if(text.mode==='none')return {...base,criterion:'Text',status:'skip',expected:'no requirement',observed:'not checked'};
 const raw=ocrResult.text,clean=ocrResult.cleanText;
 const evidence=raw?[`OCR text: ${q(raw.slice(0,300))}`]:[];
 if(text.mode==='exact'){
  const m=matchExact({expected:text.expected,ocrText:clean,caseSensitive:text.caseSensitive,maxEditRatio:text.maxEditRatio});
  const observed=clean?`${q(m.best)} (${m.distance} character${m.distance===1?'':'s'} differ, ${m.allowed} allowed)`:'no legible text found';
  const fix=clean?`Text must read exactly ${q(text.expected)}; found ${q(m.best)} (${m.distance} character${m.distance===1?'':'s'} differ${m.distance===1?'s':''}). Render the text large, high-contrast and spelled exactly.`
   :`Text must read exactly ${q(text.expected)}; no legible text was found. Render the text large and high-contrast.`;
  return {...base,criterion:'Exact text (OCR)',status:m.pass?'pass':'fail',expected:q(text.expected),observed,evidence,...(m.pass?{}:{fix})};
 }
 // idea
 if(!clean)return {...base,criterion:'Text conveys the idea (judged by LLM from OCR text)',status:'fail',expected:text.expected,observed:'no legible text found',evidence,fix:`Add clearly legible text that conveys: ${text.expected}.`};
 const j=await llm.generateJson({system:IDEA_SYSTEM,
  prompt:`OCR text:\n"""\n${clean}\n"""\n\nThe text should convey: ${text.expected}\n\nReturn {"matches": boolean, "confidence": 0..1 (how sure you are of your answer, not how well it matches), "reason": "<at most 200 characters>"}.`,
  schema:ideaSchema});
 const pass=j.matches&&j.confidence>=0.6;
 return {...base,criterion:'Text conveys the idea (judged by LLM from OCR text)',status:pass?'pass':'fail',expected:text.expected,
  observed:`${q(clean.replace(/\n/g,' ').slice(0,120))}: ${j.matches?'matches':'does not match'} (confidence ${j.confidence.toFixed(2)})`,
  evidence:[...evidence,`LLM reason: ${j.reason.slice(0,200)}`],...(pass?{}:{fix:`The text should convey: ${text.expected}. Found ${q(clean.replace(/\n/g,' ').slice(0,120))} (${j.reason.slice(0,120)}).`})};
}
