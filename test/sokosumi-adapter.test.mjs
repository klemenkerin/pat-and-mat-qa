import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createSokosumiAdapter} from '../qa/sokosumi.mjs';

const target={coworkerId:'cw1',organizationId:null,taskArgs:[],runtimeArgs:['--personal']};
const task={id:'t1',coworkerId:'cw1',organizationId:null,ownerId:'u1',status:'RUNNING'};
function fakeClient(responses={}){
 const calls=[];
 const reply=(m,p,b)=>{calls.push([m,p,b]);const r=responses[`${m} ${p}`];if(r instanceof Error)throw r;return r??{data:p.startsWith('/v1/tasks/t1')&&m==='GET'?task:{}};};
 return {calls,get:async p=>reply('GET',p),post:async(p,b)=>reply('POST',p,b)};
}
function setup(responses,extra={}){
 const client=fakeClient(responses),cliCalls=[],ctxCalls=[];
 const runtime={
  fetchTaskEvents:async()=>({events:[{id:'e1'}]}),
  readRuntimeCredential:()=>'coworker_SECRETKEY',
  createCoworkerHttpClient:({apiKey,contextUserId})=>({
   post:async p=>{ctxCalls.push({p,apiKey,contextUserId});if(extra.refundError)throw extra.refundError;return {data:{status:'refund_pending'}};},
   get:async p=>{ctxCalls.push({m:'GET',p,contextUserId});const r=extra.ctxResponses?.[p];if(r instanceof Error)throw r;return r??{data:{}};},
  }),
 };
 const dir=mkdtempSync(join(tmpdir(),'qa-adapter-'));
 const api=createSokosumiAdapter({client,runtime,target,cli:a=>{cliCalls.push(a);return {status:'RUNNING',description:'brief'};},resultDir:()=>dir,fetchImpl:extra.fetchImpl});
 return {api,client,cliCalls,ctxCalls,dir};
}

test('hire posts to the task jobs route after verifying the task',async()=>{
 const {api,client}=setup({'POST /v1/tasks/t1/jobs':{data:{id:'job1'}}});
 const body={agentId:'a1',inputSchema:{input_data:[]},inputData:{prompt:'x'},maxCredits:10,name:'QA attempt 1'};
 const job=await api.hire('t1',body);
 assert.equal(job.id,'job1');
 assert.deepEqual(client.calls.map(c=>c.slice(0,2)),[['GET','/v1/tasks/t1'],['POST','/v1/tasks/t1/jobs']]);
 assert.deepEqual(client.calls[1][2],body);
});

test('read routes unwrap the data envelope',async()=>{
 const {api,client}=setup({'GET /v1/agents/a1/input-schema':{data:{input_data:[{id:'p'}]}},'GET /v1/tasks/t1/jobs?limit=100':{data:[{id:'j1'}]}});
 assert.equal((await api.getAgentInputSchema('a1')).input_data[0].id,'p');
 assert.equal((await api.listTaskJobs('t1'))[0].id,'j1');
 assert.deepEqual(await api.listEvents('t1'),[{id:'e1'}]);
 assert.ok(client.calls.every(c=>c[1].startsWith('/v1/')));
});

test('job reads carry the Task owner context (Preprod 403s without it)',async()=>{
 const ctxResponses={'/v1/jobs/j1':{data:{id:'j1',status:'completed'}},'/v1/jobs/j1/files':{data:[{name:'a.csv'}]},'/v1/jobs/j1/links':{data:[]}};
 const {api,client,ctxCalls}=setup({}, {ctxResponses});
 const {ownerId,...rest}=task;
 const owned={...rest,userId:'u9'};
 assert.equal((await api.getJob(owned,'j1')).status,'completed');
 assert.equal((await api.getJobFiles(owned,'j1'))[0].name,'a.csv');
 assert.deepEqual(await api.getJobLinks(owned,'j1'),[]);
 assert.deepEqual(ctxCalls.map(c=>[c.m,c.p,c.contextUserId]),[['GET','/v1/jobs/j1','u9'],['GET','/v1/jobs/j1/files','u9'],['GET','/v1/jobs/j1/links','u9']]);
 assert.equal(client.calls.length,0);
 await assert.rejects(api.getJob({id:'t1'},'j1'),/no owner id/);
});

test('organization job reads send both context headers',async()=>{
 const seen=[];
 const fetchImpl=async(url,init)=>{seen.push({url,init});return {ok:true,status:200,text:async()=>JSON.stringify({data:{id:'j1',status:'processing'}})};};
 const {api}=setup({}, {fetchImpl});
 assert.equal((await api.getJob({...task,organizationId:'org1'},'j1')).status,'processing');
 assert.equal(seen[0].url,'https://api.preprod.sokosumi.com/v1/jobs/j1');
 assert.equal(seen[0].init.method,'GET');
 assert.equal(seen[0].init.headers['X-Context-User-Id'],'u1');
 assert.equal(seen[0].init.headers['X-Context-Organization-Id'],'org1');
});

test('postEvent sends comment and status',async()=>{
 const {api,client}=setup({'POST /v1/tasks/t1/events':{data:{id:'e9'}}});
 const e=await api.postEvent('t1',{comment:'hi',status:'INPUT_REQUIRED'});
 assert.equal(e.id,'e9');
 assert.deepEqual(client.calls.at(-1)[2],{comment:'hi',status:'INPUT_REQUIRED'});
});

test('start and complete use the runtime CLI with the target args',async()=>{
 const {api,cliCalls,dir}=setup();
 const s=await api.start('t1');
 assert.equal(s.description,'brief');
 await api.complete('t1','# Result');
 assert.deepEqual(cliCalls[0],['runtime','start','t1','--personal','--coworker-id','cw1']);
 assert.deepEqual(cliCalls[1].slice(0,5),['runtime','complete','t1','--personal','--coworker-id']);
 assert.equal(readFileSync(join(dir,'result.md'),'utf8'),'# Result');
});

test('complete refuses results above 1 MiB',async()=>{
 const {api}=setup();
 await assert.rejects(api.complete('t1','x'.repeat(1024*1024+1)),/1 MiB/);
});

test('personal refund uses X-Context-User-Id via the CLI client',async()=>{
 const {api,ctxCalls}=setup();
 const r=await api.requestRefund(task,'j1');
 assert.deepEqual(r,{status:'requested',detail:'refund_pending'});
 assert.deepEqual(ctxCalls,[{p:'/v1/jobs/j1/refund',apiKey:'coworker_SECRETKEY',contextUserId:'u1'}]);
});

test('refund uses userId as owner (Preprod Task shape)',async()=>{
 const {api,ctxCalls}=setup();
 const {ownerId,...rest}=task;
 await api.requestRefund({...rest,userId:'u9'},'j1');
 assert.equal(ctxCalls[0].contextUserId,'u9');
 assert.equal((await setup().api.requestRefund({id:'t1'},'j1')).status,'failed');
});

test('organization refund sends both context headers',async()=>{
 const seen=[];
 const fetchImpl=async(url,init)=>{seen.push({url,init});return {ok:true,status:200,text:async()=>JSON.stringify({data:{status:'dispute_pending'}})};};
 const {api}=setup({}, {fetchImpl});
 const r=await api.requestRefund({...task,organizationId:'org1'},'j1');
 assert.equal(r.status,'requested');
 assert.equal(seen[0].url,'https://api.preprod.sokosumi.com/v1/jobs/j1/refund');
 assert.equal(seen[0].init.headers['X-Context-User-Id'],'u1');
 assert.equal(seen[0].init.headers['X-Context-Organization-Id'],'org1');
 assert.equal(seen[0].init.redirect,'error');
});

test('refund 422 is skipped, other errors are failed and redacted, never thrown',async()=>{
 let {api}=setup({}, {refundError:Object.assign(new Error('nope'),{status:422})});
 assert.equal((await api.requestRefund(task,'j1')).status,'skipped');
 ({api}=setup({}, {refundError:Object.assign(new Error('boom coworker_SECRETKEY'),{status:500})}));
 const r=await api.requestRefund(task,'j1');
 assert.equal(r.status,'failed');
 assert.ok(!r.detail.includes('SECRETKEY'));
});

test('writes refuse tasks not assigned to this coworker',async()=>{
 const {api}=setup({'GET /v1/tasks/t2':{data:{...task,id:'t2',coworkerId:'someone-else'}}});
 await assert.rejects(api.postEvent('t2',{comment:'x'}),/Coworker and Workspace/);
});
