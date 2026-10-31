import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseStructuredContract} from '../qa/contract/structured.mjs';
import {deriveSeries,briefPeriods,seriesConstraint} from '../qa/contract/series.mjs';
import {postProcess,createStructuredMode} from '../qa/modes/structured.mjs';
import {validateStructured} from '../qa/validators/structured/index.mjs';
import {buildReport,fixInstructions} from '../qa/report.mjs';
import {createLlm} from '../qa/llm.mjs';

// Contract of live Task 01a18ea9 (2026-10-30) as drafted then, before the series block existed.
const BRIEF='CSV of the daily closing prices of the DAX, CAC 40 and FTSE 100 indices for the last 20 trading days, with columns date (YYYY-MM-DD), index (DAX, CAC40 or FTSE100) and close (number). 60 rows.';
const drafted={kind:'structured',version:1,agentId:'cmmdca97d000304icco9htf5n',brief:BRIEF,output:{format:'csv',csv:{delimiter:',',header:true}},records:{exact:60},
 fields:[{name:'date',type:'date',format:'yyyy-MM-dd'},{name:'index',type:'enum',enum:['DAX','CAC40','FTSE100']},{name:'close',type:'number',min:0}],
 unique:[['date','index']],retry:{maxAttempts:2,maxCreditsPerHire:20}};
const contract=parseStructuredContract(postProcess(drafted,BRIEF));
const agent=JSON.parse(readFileSync(new URL('../config/agents.json',import.meta.url))).structured[0];
const fx=n=>readFileSync(new URL(`./fixtures/structured/panel/${n}`,import.meta.url),'utf8');
function run(text,c=contract){
 const checks=validateStructured({deliverable:{kind:'csv',text,origin:'file'},contract:c,job:{}});
 const report=buildReport({checks,attempt:1,jobId:'j',agentId:c.agentId,deliverable:null});
 return {report,by:id=>checks.find(x=>x.id===id),status:s=>checks.filter(x=>x.status===s).map(x=>x.id)};
}

test('the live brief gets a series block; the grid rule is in the contract and the service brief',()=>{
 assert.deepEqual(contract.series,{timeField:'date',entityField:'index',entities:['DAX','CAC40','FTSE100'],periods:20,periodName:'trading day',calendar:'weekdays',valueFields:['close']});
 assert.equal(seriesConstraint(contract.series),'Exactly one row per index per trading day: 20 distinct weekday dates x 3 index values (DAX, CAC40, FTSE100) = 60 rows. No weekend dates. Do not forward-fill missing days; use the most recent 20 trading days on which all 3 have data.');
 assert.deepEqual(briefPeriods('last 30 calendar days'),{periods:30,calendar:'any',periodName:'day'});
 assert.deepEqual(briefPeriods('the past 10 business days'),{periods:10,calendar:'weekdays',periodName:'business day'});
});

test('Fixture A (live attempt 1, 9 rows) fails records.count and coverage.grid',()=>{
 const {status,by}=run(fx('A-9-rows.csv'));
 assert.deepEqual(status('fail'),['records.count','coverage.grid']);
 assert.match(by('coverage.grid').observed,/^4 distinct dates, 9 rows; 3 missing \(date, index\) pairs/);
});

test('Fixture B (live attempt 2, 60 weekend-padded rows) now fails coverage and trading days, warns stale values',()=>{
 const {status,by,report}=run(fx('B-60-rows-weekend-padded.csv'));
 assert.equal(by('records.count').status,'pass');
 assert.deepEqual(status('fail'),['coverage.grid','dates.trading_days']);
 assert.deepEqual(status('warn'),['values.stale']);
 assert.match(by('coverage.grid').observed,/^26 distinct dates, 60 rows; 18 missing \(date, index\) pairs/);
 assert.ok(by('coverage.grid').evidence.includes('missing: 2026-10-30 DAX'));
 assert.equal(by('dates.trading_days').observed,'5 dates outside Monday to Friday: 2026-10-11, 2026-10-17, 2026-10-18, 2026-10-24, 2026-10-25');
 assert.ok(by('values.stale').evidence.includes('FTSE100 close 10839.2 on 2026-10-16, 2026-10-17, 2026-10-18'));
 assert.ok(by('values.stale').evidence.includes('FTSE100 close 10724.7 on 2026-10-23, 2026-10-24, 2026-10-25'));
 assert.equal(report.summary,'13 passed, 1 warning, 1 skipped, 2 failed of 17 checks: coverage.grid, dates.trading_days');
});

test('Fixture C (20 weekdays × 3 indices, no repeats) passes every check',()=>{
 const {report,status}=run(fx('C-60-rows-correct.csv'));
 assert.equal(report.verdict,'pass');
 assert.deepEqual(status('skip'),['integrity.hash']);
 assert.equal(report.summary,'16 passed, 0 warnings, 1 skipped, 0 failed of 17 checks');
});

test('non-panel CSVs get no series checks',()=>{
 const contacts={...drafted,brief:'CSV contact list of 20 Munich startups with columns name, email, city.',records:{exact:20},
  fields:[{name:'name',type:'string'},{name:'email',type:'email'},{name:'city',type:'string'}],unique:[['email']]};
 const c=parseStructuredContract(postProcess(contacts,contacts.brief));
 assert.equal(c.series,undefined);
 const {report}=run('name,email,city\nA,a@x.de,Munich\n',c);
 assert.ok(!report.checks.some(x=>/^(coverage|dates|values)\./.test(x.id)));
 // A date column alone (no period count in the brief) is not a series either.
 const events={...drafted,brief:'CSV of 15 upcoming tech events with columns date (YYYY-MM-DD), index (DAX, CAC40 or FTSE100) and close.',records:{exact:15}};
 assert.equal(deriveSeries(parseStructuredContract(events),events.brief),undefined);
});

test('single time series: one row per date, no entity field',()=>{
 const one={...drafted,brief:'CSV of the DAX closing price for the last 5 trading days, columns date (YYYY-MM-DD) and close.',records:{exact:5},
  fields:[{name:'date',type:'date',format:'yyyy-MM-dd'},{name:'close',type:'number'}],unique:[['date']]};
 const c=parseStructuredContract(postProcess(one,one.brief));
 assert.deepEqual(c.series,{timeField:'date',periods:5,periodName:'trading day',calendar:'weekdays',valueFields:['close']});
 const ok=run('date,close\n2026-10-26,1\n2026-10-27,2\n2026-10-28,3\n2026-10-29,4\n2026-10-30,5\n',c);
 assert.equal(ok.report.verdict,'pass');
 const bad=run('date,close\n2026-10-24,1\n2026-10-27,2\n2026-10-28,2\n2026-10-29,4\n2026-10-30,5\n',c);
 assert.deepEqual(bad.status('fail'),['dates.trading_days']);
 assert.deepEqual(bad.status('warn'),['values.stale']);
});

test('rehire after Fixture B: the corrected brief states the rule and fits the Agent\'s 500-char fields',async()=>{
 const {report}=run(fx('B-60-rows-weekend-padded.csv'));
 const fixes=fixInstructions(report);
 assert.deepEqual(fixes,['Coverage: 26 dates instead of 20; 18 (date, index) pairs missing (e.g. 2026-10-30 DAX, 2026-10-25 DAX). Exactly one row per index per trading day.','No weekend dates (you sent 2026-10-11, 2026-10-17 +3 more).']);
 const data=await createStructuredMode({llm:null}).buildInputData({inputSchema:agent.inputSchema,contract,attempt:2,fixInstructions:fixes,agent});
 assert.ok(data.research_question.length<=500&&data.additional_context.length<=500);
 const all=Object.values(data).join('\n');
 assert.ok(all.includes(seriesConstraint(contract.series)));
 for(const f of fixes)assert.ok(all.includes(f));
});

test('same check set on every attempt: nothing found, parse error and a good file all report N=17',()=>{
 const n=text=>validateStructured({deliverable:text===null?{kind:'unknown'}:{kind:'csv',text},contract,job:{}});
 const ids=c=>c.map(x=>x.id);
 const good=n(fx('C-60-rows-correct.csv'));
 for(const other of [n(null),n('a,b\n"unclosed,1\n')]){assert.equal(other.length,17);assert.deepEqual(ids(other),ids(good));}
 // deliverable.found fails; the other 16 (incl. integrity.hash) are skipped.
 assert.equal(n(null).filter(x=>x.status==='skip').length,16);
});

test('revision: "30 trading days" in the comment re-derives the series',async()=>{
 const llm=createLlm({generate:async()=>({text:JSON.stringify({...drafted,records:{exact:90}})})});
 const c=await createStructuredMode({llm}).reviseContract({contract,comment:'Please make it the last 30 trading days (90 rows).'});
 assert.equal(c.series.periods,30);assert.equal(c.records.exact,90);
});
