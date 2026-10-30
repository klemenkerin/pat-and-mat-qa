import test from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {createLlm,extractJsonObject,LlmJsonError} from '../qa/llm.mjs';
const schema=z.object({answer:z.number()});
const scripted=answers=>{const prompts=[];let i=0;return {prompts,generate:async({prompt})=>{prompts.push(prompt);return {text:answers[i++]};}};};
test('extracts JSON from prose and fences',()=>{
 assert.deepEqual(extractJsonObject('Sure! ```json\n{"a":{"b":"}"}}\n```'),{a:{b:'}'}});
 assert.equal(extractJsonObject('no json here'),undefined);
 assert.deepEqual(extractJsonObject('{bad} then {"ok":1}'),{ok:1});
});
test('valid JSON on first try',async()=>{const g=scripted(['{"answer":5}']);assert.deepEqual(await createLlm(g).generateJson({system:'s',prompt:'p',schema}),{answer:5});});
test('JSON wrapped in prose',async()=>{const g=scripted(['Here you go: {"answer": 5}. Done']);assert.equal((await createLlm(g).generateJson({system:'s',prompt:'p',schema})).answer,5);});
test('invalid then valid retries with the error appended',async()=>{
 const g=scripted(['{"answer":"five"}','{"answer":5}']);
 assert.equal((await createLlm(g).generateJson({system:'s',prompt:'p',schema})).answer,5);
 assert.match(g.prompts[1],/rejected \(answer:/);
});
test('invalid twice throws a typed error',async()=>{
 const g=scripted(['nothing','still nothing']);
 await assert.rejects(createLlm(g).generateJson({system:'s',prompt:'p',schema}),e=>e instanceof LlmJsonError);
});
test('usage is reported',async()=>{const seen=[];const llm=createLlm({generate:async()=>({text:'{"answer":1}',usage:{totalTokens:9}}),onUsage:u=>seen.push(u)});await llm.generateJson({system:'s',prompt:'p',schema});assert.deepEqual(seen,[{totalTokens:9}]);});
