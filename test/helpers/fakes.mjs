import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createJournal} from '../../qa/journal.mjs';

export function tempJournal(){return createJournal(mkdtempSync(join(tmpdir(),'qa-journal-')));}

export function fakeClock(start=Date.parse('2026-10-31T09:00:00Z')){let t=start;return {now:()=>t,advance:ms=>{t+=ms;}};}

/** In-memory Sokosumi: one task, its events and jobs. `jobPlan` decides each hired job's outcome. */
export function fakeSokosumi({task,jobPlan=[]}={}){
 const t={id:'task1',status:'READY',description:'brief',ownerId:'user1',organizationId:null,...task};
 const events=[],jobs=[],calls=[];
 let ev=0;
 const api={
  task:t,events,jobs,calls,
  async start(id){calls.push(['start',id]);t.status='RUNNING';return {status:'RUNNING',description:t.description};},
  async getTask(){return {...t};},
  async listEvents(){return events.map(e=>({...e}));},
  async postEvent(id,body){calls.push(['postEvent',body.status??null]);const e={id:`e${++ev}`,actor:{type:'coworker'},...body};events.push(e);if(body.status)t.status=body.status;return e;},
  userComment(comment){events.push({id:`e${++ev}`,actor:{type:'user'},comment});},
  async listTaskJobs(){return jobs.map(j=>({...j}));},
  async getAgentInputSchema(){return {input_data:[{id:'prompt',type:'textarea',name:'Prompt'}]};},
  async hire(id,body){calls.push(['hire',body.name]);const plan=jobPlan[jobs.length]??{status:'completed',result:'ok'};if(plan.throw)throw plan.throw;const j={id:`job${jobs.length+1}`,name:body.name,input:body,...plan};jobs.push(j);return {...j};},
  async getJob(task,id){return {...jobs.find(j=>j.id===id)};},
  async getJobFiles(){return [];},
  async getJobLinks(){return [];},
  async requestRefund(task,jobId){calls.push(['refund',jobId]);return {status:'requested',detail:'refund_pending'};},
  async complete(id,text){calls.push(['complete']);t.status='COMPLETED';t.result=text;},
 };
 return api;
}

/** Minimal QA mode: a job passes when its result equals 'good'. */
export function fakeMode(){
 return {
  name:'structured',
  async parseRequest({description}){if(description==='bad')throw new Error('unparseable');return {agentId:'agent1',brief:description,autoApprove:description.includes('auto'),maxAttempts:3,maxCreditsPerHire:10};},
  async draftContract({request}){return {kind:'fake',brief:request.brief,retry:{maxAttempts:request.maxAttempts,maxCreditsPerHire:request.maxCreditsPerHire}};},
  async reviseContract({contract,comment}){return {...contract,brief:`${contract.brief} + ${comment}`};},
  renderContract:c=>`1. ${c.brief}`,
  async buildInputData({contract,attempt,fixInstructions}){return {prompt:`${contract.brief} #${attempt} ${fixInstructions.join(';')}`};},
  async verify({job}){const ok=job.result==='good';return {verdict:ok?'pass':'fail',summary:ok?'all good':'result was not good',checks:[{id:'result.good',criterion:'result is good',status:ok?'pass':'fail',expected:'good',observed:job.result,evidence:[]}]};},
  fixInstructions:r=>r.checks.filter(c=>c.status==='fail').map(c=>`fix ${c.id}`),
  renderReport:r=>`report: ${r.verdict}`,
  renderResult:({attempts})=>`RESULT after ${attempts.length} attempt(s)`,
 };
}

export const fakeCatalog={resolve:(m,id)=>id==='agent1'?{id:'agent1',name:'Agent One'}:null,list:()=>[{id:'agent1',name:'Agent One'}]};

export const baseConfig={QA_MAX_ATTEMPTS_DEFAULT:3,QA_MAX_CREDITS_PER_HIRE_DEFAULT:10,QA_JOB_POLL_SECONDS:12,QA_JOB_TIMEOUT_MINUTES:30,QA_APPROVAL_TIMEOUT_MINUTES:60,QA_MAX_REVISION_ROUNDS:3};
