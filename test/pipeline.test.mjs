import test from 'node:test';
import assert from 'node:assert/strict';
import {createPipeline} from '../qa/pipeline.mjs';
import {tempJournal,fakeClock,fakeSokosumi,fakeMode,fakeCatalog,baseConfig} from './helpers/fakes.mjs';

function setup({task,jobPlan,config}={}){
 const clock=fakeClock(),journal=tempJournal(),sokosumi=fakeSokosumi({task,jobPlan});
 const p=createPipeline({deps:{now:clock.now,journal,sokosumi,mode:fakeMode(),catalog:fakeCatalog},config:{...baseConfig,...config}});
 return {clock,journal,sokosumi,p,run:()=>p.advance(sokosumi.task)};
}
/** Drive until terminal, approving contracts and advancing time past poll intervals. */
async function drive(ctx,{approve=true,max=40}={}){
 let s;
 for(let i=0;i<max;i++){
  s=await ctx.run();
  if(s.phase==='completed'||s.phase==='failed')return s;
  if(s.phase==='awaiting-approval'&&approve&&!ctx.sokosumi.events.some(e=>e.actor.type==='user'&&!(s.seenEventIds??[]).includes(e.id)))ctx.sokosumi.userComment('APPROVE');
  ctx.clock.advance(13000);
 }
 return s;
}
const count=(calls,name)=>calls.filter(c=>c[0]===name).length;

test('happy path: approve, one hire, pass, complete',async()=>{
 const ctx=setup({jobPlan:[{status:'completed',result:'good'}]});
 const s=await drive(ctx);
 assert.equal(s.phase,'completed');
 assert.equal(count(ctx.sokosumi.calls,'hire'),1);
 assert.equal(ctx.sokosumi.task.status,'COMPLETED');
 assert.match(ctx.sokosumi.task.result,/1 attempt/);
 assert.ok(ctx.sokosumi.events.some(e=>e.status==='INPUT_REQUIRED'&&e.comment.includes('[qa:contract:v1]')));
 assert.ok(ctx.sokosumi.events.some(e=>e.status==='RUNNING'&&e.comment.includes('[qa:approved:v1]')));
});

test('fail then rehire with fix instructions then pass',async()=>{
 const ctx=setup({jobPlan:[{status:'completed',result:'bad'},{status:'completed',result:'good'}]});
 const s=await drive(ctx);
 assert.equal(s.phase,'completed');
 assert.equal(count(ctx.sokosumi.calls,'hire'),2);
 assert.equal(count(ctx.sokosumi.calls,'refund'),1);
 assert.match(ctx.sokosumi.jobs[1].input.inputData.prompt,/#2 fix result\.good/);
 assert.equal(s.attempts[0].refund.status,'requested');
 assert.ok(ctx.sokosumi.events.some(e=>e.comment.includes('[qa:attempt:1:failed]')));
});

test('three failures exhaust the budget and fail the task',async()=>{
 const ctx=setup({jobPlan:[{status:'completed',result:'bad'},{status:'completed',result:'bad'},{status:'completed',result:'bad'}]});
 const s=await drive(ctx);
 assert.equal(s.phase,'failed');
 assert.equal(count(ctx.sokosumi.calls,'hire'),3);
 assert.equal(count(ctx.sokosumi.calls,'refund'),2,'no refund+rehire after the last attempt');
 assert.equal(ctx.sokosumi.task.status,'FAILED');
 assert.ok(ctx.sokosumi.events.at(-1).comment.includes('Retry budget used up'));
});

test('failed job (no result) is not refunded but is retried',async()=>{
 const ctx=setup({jobPlan:[{status:'failed'},{status:'completed',result:'good'}]});
 const s=await drive(ctx);
 assert.equal(s.phase,'completed');
 assert.equal(count(ctx.sokosumi.calls,'refund'),0);
 assert.equal(s.attempts[0].refund.status,'skipped');
});

test('customer edit round revises the contract, then approve',async()=>{
 const ctx=setup({jobPlan:[{status:'completed',result:'good'}]});
 let s=await ctx.run();
 assert.equal(s.phase,'awaiting-approval');
 ctx.sokosumi.userComment('Please require 60 rows');
 s=await ctx.run();
 assert.equal(s.phase,'awaiting-approval');
 assert.equal(s.contractVersion,2);
 assert.match(s.contract.brief,/60 rows/);
 assert.ok(ctx.sokosumi.events.some(e=>e.comment?.includes('[qa:contract:v2]')));
 s=await drive(ctx);
 assert.equal(s.phase,'completed');
});

test('too many revision rounds fail the task',async()=>{
 const ctx=setup({config:{QA_MAX_REVISION_ROUNDS:1}});
 await ctx.run();ctx.sokosumi.userComment('change A');
 await ctx.run();ctx.sokosumi.userComment('change B');
 const s=await drive(ctx,{approve:false,max:3});
 assert.equal(s.phase,'failed');
 assert.match(ctx.sokosumi.events.at(-1).comment,/revision rounds/);
});

test('approval timeout fails the task',async()=>{
 const ctx=setup();
 let s=await ctx.run();
 assert.equal(s.phase,'awaiting-approval');
 ctx.clock.advance(61*60000);
 s=await ctx.run();
 assert.equal(s.phase,'failed');
 assert.match(ctx.sokosumi.events.at(-1).comment,/No approval/);
});

test('coworker own comments never count as approval',async()=>{
 const ctx=setup();
 await ctx.run();
 await ctx.sokosumi.postEvent('task1',{comment:'APPROVE'});
 const s=await ctx.run();
 assert.equal(s.phase,'awaiting-approval');
});

test('auto-approve skips INPUT_REQUIRED',async()=>{
 const ctx=setup({task:{description:'auto please'},jobPlan:[{status:'completed',result:'good'}]});
 const s=await drive(ctx,{approve:false});
 assert.equal(s.phase,'completed');
 assert.ok(!ctx.sokosumi.events.some(e=>e.status==='INPUT_REQUIRED'));
});

test('restart in hire-pending adopts the already-hired job (no double hire)',async()=>{
 const ctx=setup({task:{description:'auto'},jobPlan:[{status:'processing'}]});
 let s=await ctx.run(); // runs through to job-polling
 assert.equal(s.phase,'job-polling');
 // Simulate a crash right after the hire call, before the journal recorded the job id.
 const st=ctx.journal.load('task1');
 ctx.journal.save({...st,phase:'hire-pending',attempts:st.attempts.map(a=>({...a,jobId:undefined}))});
 Object.assign(ctx.sokosumi.jobs[0],{status:'completed',result:'good'});
 ctx.clock.advance(13000);
 s=await drive(ctx);
 assert.equal(s.phase,'completed');
 assert.equal(count(ctx.sokosumi.calls,'hire'),1);
 assert.equal(s.attempts[0].reconciled,true);
});

test('restart in approval-posting does not post the contract twice',async()=>{
 const ctx=setup();
 await ctx.run();
 const st=ctx.journal.load('task1');
 ctx.journal.save({...st,phase:'approval-posting'});
 await ctx.run();
 assert.equal(ctx.sokosumi.events.filter(e=>e.comment?.includes('[qa:contract:v1]')).length,1);
});

test('out of credits on hire fails cleanly',async()=>{
 const err=Object.assign(new Error('Insufficient credits'),{status:402});
 const ctx=setup({task:{description:'auto'},jobPlan:[{throw:err}]});
 const s=await drive(ctx);
 assert.equal(s.phase,'failed');
 assert.match(ctx.sokosumi.events.at(-1).comment,/Out of credits/);
});

test('job timeout counts as a failed attempt',async()=>{
 const ctx=setup({task:{description:'auto'},jobPlan:[{status:'processing'},{status:'completed',result:'good'}],config:{QA_JOB_TIMEOUT_MINUTES:1}});
 let s=await ctx.run();
 ctx.clock.advance(2*60000);
 s=await drive(ctx);
 assert.equal(s.phase,'completed');
 assert.equal(s.attempts[0].timedOut,true);
 assert.equal(count(ctx.sokosumi.calls,'hire'),2);
});

test('poll interval is respected',async()=>{
 const ctx=setup({task:{description:'auto'},jobPlan:[{status:'processing'}]});
 let s=await ctx.run();
 const polled=s.attempts[0].lastPolledAt;
 ctx.clock.advance(5000);
 s=await ctx.run();
 assert.equal(s.attempts[0].lastPolledAt,polled);
});

test('unknown agent and unparseable requests fail with a reason',async()=>{
 const ctx=setup({task:{description:'bad'}});
 const s=await drive(ctx);
 assert.equal(s.phase,'failed');
 assert.match(ctx.sokosumi.events.at(-1).comment,/Could not understand/);
});

test('QA_STOP_AFTER halts at the requested phase',async()=>{
 const ctx=setup({config:{QA_STOP_AFTER:'approved'},jobPlan:[{status:'completed',result:'good'}]});
 const s=await drive(ctx,{max:5});
 assert.equal(s.phase,'approved');
 assert.equal(count(ctx.sokosumi.calls,'hire'),0);
});
