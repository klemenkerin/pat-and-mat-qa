import test from 'node:test';
import assert from 'node:assert/strict';
import {parseQaRequest,formatQaRequest} from '../qa/request.mjs';
import {createCatalog} from '../qa/catalog.mjs';
const config={QA_MAX_ATTEMPTS_DEFAULT:3,QA_MAX_CREDITS_PER_HIRE_DEFAULT:50};
const noLlm={generateJson:async()=>{throw new Error('LLM must not be called');}};
test('fenced qa-request block',async()=>{
 const d=formatQaRequest({agentId:'a1',brief:'CSV of 50 rows',autoApprove:true,maxAttempts:2});
 const r=await parseQaRequest({description:d,config,llm:noLlm});
 assert.deepEqual(r,{agentId:'a1',brief:'CSV of 50 rows',autoApprove:true,maxAttempts:2,maxCreditsPerHire:50});
});
test('invalid block fields are rejected with a reason',async()=>{
 await assert.rejects(parseQaRequest({description:'```qa-request\n{"brief":"x"}\n```',config,llm:noLlm}),/brief/);
 await assert.rejects(parseQaRequest({description:'```qa-request\n{"brief":"valid brief","maxAttempts":9}\n```',config,llm:noLlm}),/maxAttempts/);
 await assert.rejects(parseQaRequest({description:'```qa-request\n{not json}\n```',config,llm:noLlm}),/not valid JSON/);
});
test('free text goes through the LLM and gets defaults',async()=>{
 const llm={generateJson:async({prompt})=>{assert.match(prompt,/electricity/);return {agentId:null,brief:'CSV of electricity prices'};}};
 const r=await parseQaRequest({description:'Please get me a CSV of electricity prices',config,llm});
 assert.deepEqual(r,{agentId:undefined,brief:'CSV of electricity prices',autoApprove:false,maxAttempts:3,maxCreditsPerHire:50});
});
test('empty description fails',async()=>{await assert.rejects(parseQaRequest({description:'  ',config,llm:noLlm}),/empty/);});
test('catalog: default agent, known agent, foreign agent',()=>{
 const c=createCatalog({structured:[{id:'s1',name:'CSV bot'},{id:'s2',name:'JSON bot'}],image:[{id:'i1',name:'Img'}]});
 assert.equal(c.resolve('structured').id,'s1');
 assert.equal(c.resolve('structured','s2').name,'JSON bot');
 assert.equal(c.resolve('structured','i1'),null);
 assert.equal(createCatalog({}).resolve('image'),null);
});
