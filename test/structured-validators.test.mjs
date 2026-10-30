import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseStructuredContract} from '../qa/contract/structured.mjs';
import {extractStructured,sha256} from '../qa/extract.mjs';
import {validateStructured} from '../qa/validators/structured/index.mjs';
import {buildReport,renderReportMarkdown,fixInstructions} from '../qa/report.mjs';

const fx=n=>readFileSync(new URL(`./fixtures/structured/${n}`,import.meta.url),'utf8');
const base=JSON.parse(readFileSync(new URL('./fixtures/contracts/structured-valid.json',import.meta.url)));
const contract=(patch={})=>parseStructuredContract({...base,...patch});
const jsonContract=(patch={})=>contract({output:{format:'json'},...patch});
async function run(text,c=contract(),job={}){
 const d=await extractStructured({job:{result:text,...job},contract:c});
 const checks=validateStructured({deliverable:d,contract:c,job:{result:text,...job}});
 return {d,checks,report:buildReport({checks,attempt:1,jobId:'j1',agentId:'a1',deliverable:d}),by:id=>checks.find(x=>x.id===id)};
}
const failedIds=r=>r.checks.filter(c=>c.status==='fail').map(c=>c.id).sort();

test('good CSV passes every check',async()=>{
 const {report}=await run(fx('good.csv'));
 assert.equal(report.verdict,'pass',renderReportMarkdown(report));
});
test('bad dates are caught with row examples',async()=>{
 const {report,by}=await run(fx('bad-dates.csv'));
 assert.deepEqual(failedIds(report),['field.date.values']);
 assert.match(by('field.date.values').observed,/13 of 50 invalid/);
 assert.match(by('field.date.values').evidence[0],/row 2: 01\.10\.2026 \(not in format yyyy-MM-dd\)/);
});
test('short CSV fails the record count',async()=>{
 const {report,by}=await run(fx('short.csv'));
 assert.deepEqual(failedIds(report),['records.count']);
 assert.equal(by('records.count').observed,'38');
 assert.match(by('records.count').fix,/exactly 50 records \(you returned 38\)/);
});
test('duplicates are reported',async()=>{
 const {report,by}=await run(fx('dupes.csv'));
 assert.deepEqual(failedIds(report),['unique.date+country']);
 assert.match(by('unique.date+country').evidence[0],/rows 2 and 50/);
});
test('extra column fails unless allowed',async()=>{
 assert.deepEqual(failedIds((await run(fx('extra-col.csv'))).report),['fields.extra']);
 assert.equal((await run(fx('extra-col.csv'),contract({allowExtraFields:true}))).report.verdict,'pass');
});
test('wrong delimiter fails parse/fields; right delimiter passes',async()=>{
 const wrong=await run(fx('semicolon.csv'));
 assert.equal(wrong.report.verdict,'fail');
 const right=await run(fx('semicolon.csv'),contract({output:{format:'csv',csv:{delimiter:';'}}}));
 assert.equal(right.report.verdict,'pass',renderReportMarkdown(right.report));
});
test('decimal comma is named explicitly',async()=>{
 const {by}=await run(fx('decimal-comma.csv'),contract({output:{format:'csv',csv:{delimiter:';'}}}));
 assert.match(by('field.price_eur.values').evidence[0],/decimal comma instead of point/);
});
test('CSV in a markdown fence is extracted with a warning',async()=>{
 const {d,report,by}=await run(fx('wrapped-result.md'));
 assert.equal(d.origin,'result-fence');
 assert.equal(report.verdict,'pass');
 assert.equal(by('delivery.clean').status,'warn');
});
test('good JSON passes; bad types are caught',async()=>{
 assert.equal((await run(fx('good.json'),jsonContract())).report.verdict,'pass');
 const {report,by}=await run(fx('bad-types.json'),jsonContract());
 assert.deepEqual(failedIds(report),['field.country.values','field.price_eur.nulls','field.price_eur.values']);
 assert.match(by('field.price_eur.values').evidence[0],/number given as a string/);
});
test('nested JSON uses recordsPath',async()=>{
 assert.equal((await run(fx('nested.json'),jsonContract({output:{format:'json',json:{root:'object',recordsPath:'data.items'}}}))).report.verdict,'pass');
 const missing=await run(fx('nested.json'),jsonContract({output:{format:'json',json:{root:'object',recordsPath:'data.rows'}}}));
 assert.match(missing.by('parse').observed,/not found/);
});
test('nothing parseable fails with deliverable.found',async()=>{
 const {report}=await run('Sorry, I could not find this data.');
 assert.deepEqual(failedIds(report),['deliverable.found']);
});
test('file deliverable is preferred over the result text',async()=>{
 const fetchImpl=async()=>({ok:true,headers:{get:()=>null},arrayBuffer:async()=>Buffer.from(fx('good.csv'))});
 const d=await extractStructured({job:{result:'```csv\na,b\n1,2\n```'},files:[{name:'prices.csv',url:'https://files.example/prices.csv'}],contract:contract(),fetchImpl});
 assert.equal(d.origin,'file');assert.equal(d.name,'prices.csv');
});
test('integrity hash: match, scheme mismatch warns, absent skips',async()=>{
 const text=fx('good.csv');
 assert.equal((await run(text,contract(),{identifierFromPurchaser:'ab12',resultHash:sha256(`ab12;${text}`)})).by('integrity.hash').status,'pass');
 assert.equal((await run(text,contract(),{resultHash:'00'.repeat(32)})).by('integrity.hash').status,'warn');
 assert.equal((await run(text)).by('integrity.hash').status,'skip');
});
test('fix instructions cover every failed check; report markdown renders',async()=>{
 const {report}=await run(fx('bad-types.json'),jsonContract());
 const fixes=fixInstructions(report);
 assert.equal(fixes.length,report.checks.filter(c=>c.status==='fail').length);
 const md=renderReportMarkdown(report);
 assert.match(md,/\*\*QA verdict: FAIL\*\*/);
 assert.match(md,/\| FAIL \| field\.country\.values \|/);
});
test('performance: 10,000-row CSV validates in under 2 s',async()=>{
 const rows=['date,country,price_eur'];
 for(let i=0;i<10000;i++)rows.push(`2026-${String(1+i%12).padStart(2,'0')}-${String(1+i%28).padStart(2,'0')},${['DE','AT','CH'][i%3]},${(i/7).toFixed(2)}`);
 const t=Date.now();
 await run(rows.join('\n')+'\n',contract({records:{min:1},unique:undefined}));
 assert.ok(Date.now()-t<2000,`took ${Date.now()-t} ms`);
});

test('real Preprod output (Advanced Web Research, spike 2026-10-30): CSV fence inside a research report',async()=>{
 const text=readFileSync(new URL('./fixtures/structured/live/advanced-web-research-dax.md',import.meta.url),'utf8');
 const c=contract({records:{exact:5},fields:[{name:'date',type:'date',format:'yyyy-MM-dd'},{name:'value',type:'number'}],unique:[['date']]});
 const {d,report,by}=await run(text,c,{identifierFromPurchaser:'abc'});
 assert.equal(d.origin,'result-fence');
 assert.equal(d.text.split('\n')[0],'date,value');
 assert.equal(by('delivery.clean').status,'warn');
 assert.equal(report.verdict,'pass',renderReportMarkdown(report));
});
