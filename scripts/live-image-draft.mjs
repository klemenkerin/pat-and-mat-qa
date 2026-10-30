// Live check for Gate 4.3: the model drafts image contracts for the plan's three briefs.
// Usage: node --env-file=.env scripts/live-image-draft.mjs
import {createLlm} from '../qa/llm.mjs';
import {draftImageContract} from '../qa/contract/image-draft.mjs';
const llm=createLlm({onUsage:u=>console.error('usage',u.totalTokens)});
const cases=[
 {brief:'Poster with the text "SUMMER SALE -50%" and a bicycle',text:'exact',expected:'SUMMER SALE -50%',objects:['bicycle']},
 {brief:'Banner announcing a coffee discount, show a cup of coffee and a croissant',text:'idea',objects:['cup','croissant']},
 {brief:'Photo of two dogs on a beach, no text',text:'none',objects:['dog']},
];
let ok=true;
for(const c of cases){
 const k=await draftImageContract({llm,request:{brief:c.brief,maxAttempts:3,maxCreditsPerHire:10},agent:{id:'local-image',name:'Local image Agent'}});
 const labels=k.objects.map(o=>o.label);
 const pass=k.text.mode===c.text&&(!c.expected||k.text.expected===c.expected)&&c.objects.every(o=>labels.some(l=>l===o||l.endsWith(` ${o}`)||l.startsWith(`${o} `)));
 ok&&=pass;
 console.log(`${pass?'PASS':'FAIL'}  ${c.brief}\n      text=${k.text.mode}${k.text.expected?` "${k.text.expected}"`:''} objects=${JSON.stringify(k.objects)}${k.notes?`\n      notes: ${k.notes}`:''}`);
}
if(!ok)process.exitCode=1;
