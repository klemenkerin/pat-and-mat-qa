import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildInputData,validateInputData,composeServiceBrief,composeServiceParts,schemaFields,withFieldLimits} from '../qa/hire.mjs';
const single={input_data:[{id:'prompt',type:'textarea',name:'Prompt'}]};
const withOption={input_data:[{id:'query',type:'string',name:'Query'},{id:'format',type:'option',name:'Format',data:{values:['csv','json']}}]};
const noLlm={generateJson:async()=>{throw new Error('LLM not expected');}};
test('single text field gets the full service brief',async()=>{
 assert.deepEqual(await buildInputData({inputSchema:single,serviceBrief:'B',llm:noLlm}),{prompt:'B'});
});
test('optional extra fields do not need the LLM',async()=>{
 const s={input_data:[{id:'prompt',type:'text'},{id:'tone',type:'option',data:{values:['a','b']},validations:[{validation:'optional',value:'true'}]}]};
 assert.deepEqual(await buildInputData({inputSchema:s,serviceBrief:'B',llm:noLlm}),{prompt:'B'});
});
test('text + required option uses the LLM and validates its answer',async()=>{
 const llm={generateJson:async()=>({inputData:{query:'B',format:'csv'}})};
 assert.deepEqual(await buildInputData({inputSchema:withOption,serviceBrief:'B',llm}),{query:'B',format:'csv'});
 const bad={generateJson:async()=>({inputData:{query:'B',format:'xml'}})};
 await assert.rejects(buildInputData({inputSchema:withOption,serviceBrief:'B',llm:bad}),/format must be one of csv, json/);
});
test('missing required field is an error',()=>{
 assert.deepEqual(validateInputData(withOption,{query:'x'}),['missing required field format']);
 assert.deepEqual(validateInputData(single,{prompt:'x',other:1}),['unknown field other']);
});
test('input_groups are flattened; hidden values are passed through',async()=>{
 const s={input_groups:[{input_data:[{id:'q',type:'string'}]},{input_data:[{id:'v',type:'hidden',data:{value:'2'}}]}]};
 assert.equal(schemaFields(s).length,2);
 assert.deepEqual(await buildInputData({inputSchema:s,serviceBrief:'B',llm:noLlm}),{v:'2',q:'B'});
});
test('max length on the text field is enforced',async()=>{
 const s={input_data:[{id:'prompt',type:'string',validations:[{validation:'max',value:'5'}]}]};
 await assert.rejects(buildInputData({inputSchema:s,serviceBrief:'too long brief',llm:noLlm}),/limit of 5/);
});
test('service brief includes requirements and fixes only on retries',()=>{
 const a=composeServiceBrief({brief:'Get X',criteriaText:'1. c',attempt:1,fixInstructions:['f']});
 assert.ok(!a.includes('rejected'));
 const b=composeServiceBrief({brief:'Get X',criteriaText:'1. c',attempt:2,fixInstructions:['fix dates']});
 assert.match(b,/Hard requirements[\s\S]*1\. c[\s\S]*rejected[\s\S]*- fix dates/);
});
test('real Preprod form (Advanced Web Research): question field is the main field, optional context left out',async()=>{
 const {structured}=JSON.parse(readFileSync(new URL('../config/agents.json',import.meta.url),'utf8'));
 const data=await buildInputData({inputSchema:structured[0].inputSchema,serviceBrief:'B',llm:noLlm});
 assert.deepEqual(data,{research_question:'B'});
});
test('LLM mapping never sends empty optional values',async()=>{
 const s={input_data:[{id:'q',type:'string'},{id:'mode',type:'option',data:{values:['a','b']}},{id:'extra',type:'textarea',validations:[{validation:'optional',value:'true'}]}]};
 const llm={generateJson:async()=>({inputData:{q:'B',mode:'a',extra:''}})};
 assert.deepEqual(await buildInputData({inputSchema:s,serviceBrief:'B',llm}),{q:'B',mode:'a'});
});
test('withFieldLimits adds max lengths to a copy only',()=>{
 const s={input_data:[{id:'q',type:'textarea'},{id:'x',type:'textarea',validations:[{validation:'optional',value:'true'}]}]};
 const limited=withFieldLimits(s,{q:10});
 assert.deepEqual(limited.input_data[0].validations,[{validation:'max',value:'10'}]);
 assert.equal(s.input_data[0].validations,undefined);
 assert.equal(withFieldLimits(s,undefined),s);
});
test('too long for the main field: brief and requirements are split over two text fields',async()=>{
 const s=withFieldLimits({input_data:[{id:'research_question',type:'textarea'},{id:'additional_context',type:'textarea',validations:[{validation:'optional',value:'true'}]}]},{research_question:40,additional_context:120});
 const parts=composeServiceParts({brief:'Short brief',criteriaText:'a; b; c.',attempt:1});
 const data=await buildInputData({inputSchema:s,serviceBrief:`${parts.brief}\n\n${parts.requirements}`,parts,llm:noLlm});
 assert.deepEqual(data,{research_question:'Short brief',additional_context:parts.requirements});
 const long=composeServiceParts({brief:'Short brief',criteriaText:'x'.repeat(100),attempt:1});
 await assert.rejects(buildInputData({inputSchema:s,serviceBrief:`${long.brief}\n\n${long.requirements}`,parts:long,llm:noLlm}),/do not fit research_question \(40\) and additional_context \(120\)/);
 // Rehire: brief + fixes in the main field when the criteria alone fill the second field.
 const s2=withFieldLimits(s,{research_question:120,additional_context:120});
 const re=composeServiceParts({brief:'Short brief',criteriaText:'x'.repeat(60),attempt:2,fixInstructions:['Return 60 rows.']});
 assert.ok(re.requirements.length>120);
 const d2=await buildInputData({inputSchema:s2,serviceBrief:`${re.brief}\n\n${re.requirements}`,parts:re,llm:noLlm});
 assert.deepEqual(d2,{research_question:`Short brief\n\n${re.fixes}`,additional_context:re.criteria});
});
