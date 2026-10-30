import test from 'node:test';
import assert from 'node:assert/strict';
import {buildInputData,validateInputData,composeServiceBrief,schemaFields} from '../qa/hire.mjs';
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
