import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createStructuredMode,normalizeDateFormat,briefRecordCount,briefDateFormat,postProcess} from '../qa/modes/structured.mjs';
import {createLlm} from '../qa/llm.mjs';

const fx=n=>readFileSync(new URL(`./fixtures/structured/${n}`,import.meta.url),'utf8');
const scriptedLlm=answers=>{let i=0;const prompts=[];return {prompts,llm:createLlm({generate:async({prompt})=>{prompts.push(prompt);return {text:typeof answers[i]==='string'?answers[i++]:JSON.stringify(answers[i++])};}})};};
const request={agentId:'a1',brief:'CSV of 50 EU electricity day-ahead prices with columns date (YYYY-MM-DD), country (DE, AT or CH) and price_eur',autoApprove:false,maxAttempts:3,maxCreditsPerHire:40};
const agent={id:'a1',name:'Data Agent'};
const schema={input_data:[{id:'prompt',type:'textarea',name:'Prompt'}]};

test('date format normalisation and brief parsing',()=>{
 assert.equal(normalizeDateFormat('YYYY-MM-DD'),'yyyy-MM-dd');
 assert.equal(normalizeDateFormat('DD.MM.YYYY HH:mm'),'dd.MM.yyyy HH:mm');
 assert.equal(normalizeDateFormat('ISO 8601'),'ISO');
 assert.equal(briefDateFormat('dates as DD.MM.YYYY please'),'dd.MM.yyyy');
 assert.deepEqual(briefRecordCount(request.brief),{exact:50});
 assert.deepEqual(briefRecordCount('at least 20 rows'),{min:20});
 assert.deepEqual(briefRecordCount('up to 10 products'),{max:10});
 assert.deepEqual(briefRecordCount('the top 10 cities by population'),{exact:10});
 assert.equal(briefRecordCount('a CSV with 3 columns'),undefined);
});

test('postProcess enforces the brief row count and date format',()=>{
 const c=postProcess({fields:[{name:'date',type:'date',format:'MM/dd/yyyy'}],records:{min:10}},request.brief);
 assert.deepEqual(c.records,{exact:50});
 assert.equal(c.fields[0].format,'yyyy-MM-dd');
});

test('draftContract: LLM draft is completed, validated and post-processed',async()=>{
 const {llm,prompts}=scriptedLlm([{output:{format:'csv'},fields:[{name:'date',type:'date',format:'YYYY-MM-DD'},{name:'country',type:'enum',enum:['DE','AT','CH']},{name:'price_eur',type:'number',min:0}],unique:[['date','country']],notes:'comma delimiter assumed'}]);
 const c=await createStructuredMode({llm}).draftContract({request,agent,inputSchema:schema});
 assert.equal(c.agentId,'a1');assert.equal(c.retry.maxCreditsPerHire,40);assert.deepEqual(c.records,{exact:50});
 assert.equal(c.fields[0].format,'yyyy-MM-dd');
 assert.match(prompts[0],/Agent input fields: Prompt/);
});

test('draftContract: invalid draft is retried with the validation error',async()=>{
 const {llm,prompts}=scriptedLlm([{output:{format:'csv'},fields:[{name:'c',type:'enum'}]},{output:{format:'csv'},fields:[{name:'c',type:'enum',enum:['x']}]}]);
 const c=await createStructuredMode({llm}).draftContract({request:{...request,brief:'csv with a c column'},agent,inputSchema:schema});
 assert.deepEqual(c.fields[0].enum,['x']);
 assert.match(prompts[1],/needs enum values/);
});

test('reviseContract keeps fixed fields and applies changes',async()=>{
 const base=JSON.parse(readFileSync(new URL('./fixtures/contracts/structured-valid.json',import.meta.url)));
 const {llm}=scriptedLlm([{...base,agentId:'evil',records:{exact:60}}]);
 const c=await createStructuredMode({llm}).reviseContract({contract:base,comment:'60 rows please'});
 assert.equal(c.agentId,'a1');assert.deepEqual(c.records,{exact:60});
});

test('buildInputData puts brief + criteria (+ fixes on retry) into the prompt field',async()=>{
 const base=JSON.parse(readFileSync(new URL('./fixtures/contracts/structured-valid.json',import.meta.url)));
 const mode=createStructuredMode({llm:createLlm({generate:async()=>{throw new Error('no llm');}})});
 const d1=await mode.buildInputData({inputSchema:schema,contract:base,attempt:1,fixInstructions:[]});
 assert.match(d1.prompt,/exactly 50 rows/);
 const d2=await mode.buildInputData({inputSchema:schema,contract:base,attempt:2,fixInstructions:['Return exactly 50 records (you returned 38).']});
 assert.match(d2.prompt,/you returned 38/);
});

test('verify + renderResult on a passing wrapped CSV',async()=>{
 const base=JSON.parse(readFileSync(new URL('./fixtures/contracts/structured-valid.json',import.meta.url)));
 const mode=createStructuredMode({llm:null});
 const workDir=mkdtempSync(join(tmpdir(),'qa-mode-'));
 const report=await mode.verify({job:{id:'j1',result:fx('wrapped-result.md')},files:[],links:[],contract:base,attempt:1,workDir});
 assert.equal(report.verdict,'pass');
 const text=mode.renderResult({contract:base,attempts:[{n:1,jobId:'j1',report}],agent});
 assert.match(text,/^QA PASSED/);
 assert.match(text,/```csv\ndate,country,price_eur\n2026-10-01,DE,50\.00/);
 assert.ok(Buffer.byteLength(text)<1024*1024);
});

test('live Gate 3.4 contract fits the real Advanced Web Research form (500-char cap) on every attempt',async()=>{
 const contract=JSON.parse(readFileSync(new URL('./fixtures/contracts/live-dax-cac-ftse.json',import.meta.url),'utf8'));
 const agent=JSON.parse(readFileSync(new URL('../config/agents.json',import.meta.url),'utf8')).structured[0];
 const mode=createStructuredMode({llm:{generateJson:async()=>{throw new Error('LLM not expected');}}});
 const first=await mode.buildInputData({inputSchema:agent.inputSchema,contract,attempt:1,fixInstructions:[],agent});
 assert.deepEqual(Object.keys(first),['research_question']);
 assert.ok(first.research_question.length<=500,`${first.research_question.length} chars`);
 for(const s of ['exactly 15 rows','date (date, yyyy-MM-dd)','index (enum, one of DAX, CAC40, FTSE100)','close (number','date + index unique'])assert.ok(first.research_question.includes(s),s);
 const fixes=['Column `date`: 3 of 15 values are not in format yyyy-MM-dd, e.g. row 4: 28.10.2026.','Expected exactly 15 records; found 12.'];
 const retry=await mode.buildInputData({inputSchema:agent.inputSchema,contract,attempt:2,fixInstructions:fixes,agent});
 assert.ok(Object.values(retry).every(v=>v.length<=500));
 assert.ok(Object.values(retry).join('\n').includes(fixes[0])&&Object.values(retry).join('\n').includes(fixes[1]));
});
