// Live check for Gate 4.5 idea mode: real OCR + the real model judge.
// Usage: node --env-file=.env scripts/live-ocr-idea.mjs
import {readFileSync} from 'node:fs';
import {createLlm} from '../qa/llm.mjs';
import {ocr,terminateOcr} from '../qa/validators/image/ocr.mjs';
import {checkText} from '../qa/validators/image/text.mjs';
const llm=createLlm({onUsage:u=>console.error('usage',u.totalTokens)});
const ocrResult=await ocr(readFileSync(new URL('../test/fixtures/images/text-coffee.png',import.meta.url)));
let ok=true;
for(const [idea,want] of [['a discount on coffee','pass'],['a shoe sale','fail']]){
 const c=await checkText({ocrResult,text:{mode:'idea',expected:idea},llm});
 ok&&=c.status===want;
 console.log(`${c.status===want?'OK  ':'BAD '} "${idea}" -> ${c.status} (want ${want}) | ${c.observed} | ${c.evidence.at(-1)}`);
}
await terminateOcr();
if(!ok)process.exitCode=1;
