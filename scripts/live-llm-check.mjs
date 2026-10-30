// Live model check (Gate 2.3). Usage: node --env-file=.env scripts/live-llm-check.mjs
import {z} from 'zod';
import {createLlm} from '../qa/llm.mjs';
const llm=createLlm({onUsage:u=>console.error('usage',JSON.stringify(u))});
const r=await llm.generateJson({system:'You are a calculator.',prompt:'What is 2+3? Return {"answer": <number>}.',schema:z.object({answer:z.number()})});
console.log(JSON.stringify(r));
if(r.answer!==5){console.error('Unexpected answer');process.exit(1);}
console.log('LLM check OK');
