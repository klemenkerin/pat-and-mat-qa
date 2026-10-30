import {newState,transition,updateAttempt,currentAttempt} from './journal.mjs';

/*
 QA Task state machine (docs/IMPLEMENTATION_PLAN.md §0.6).
 One call to advance() runs transitions until the Task waits on something external
 (customer reply, running Job, poll interval) or reaches a terminal phase.
 Every side effect goes through `deps`, so tests inject fakes.

 deps = {
  now(): number,
  journal: {load, save, taskDir},
  sokosumi: {
   start(taskId) -> {status, description}           // runtime start (READY -> RUNNING)
   getTask(taskId) -> task
   listEvents(taskId) -> event[]                      // {id, actor:{type}, comment, status?}
   postEvent(taskId, {comment, status?}) -> event
   listTaskJobs(taskId) -> job[]                      // {id, name, status}
   getAgentInputSchema(agentId) -> inputSchema
   hire(taskId, {agentId,inputSchema,inputData,maxCredits,name}) -> job
   getJob(task, jobId) -> job                         // sent with the Task owner's context headers
   getJobFiles(task, jobId) -> file[]
   getJobLinks(task, jobId) -> link[]
   requestRefund(task, jobId) -> {status:'requested'|'skipped'|'failed', detail}
   complete(taskId, resultText) -> any                // runtime complete --result-file
  },
  catalog: {resolve(modeName, agentId?) -> agent|null, list(modeName) -> agent[]},
  mode: see qa/modes/*.mjs
 }
*/

export const WAITING=new Set(['awaiting-approval','job-polling']);
export const TERMINAL=new Set(['completed','failed']);
export const JOB_TERMINAL=new Set(['completed','failed','refund_resolved','dispute_resolved','payment_failed']);
/**
 Preprod (spike 2026-10-30): the Agent can finish (completedAt set, result present, last job event COMPLETED)
 while `status` stays payment_pending because the on-chain purchase never settles. Treat that as completed.
*/
export function effectiveJobStatus(job){
 if(job?.status==='payment_pending'&&job.completedAt&&job.result)return 'completed';
 return job?.status;
}
const APPROVE=/^\s*approve\b/i;

export const marker=key=>`[qa:${key}]`;
const withMarker=(text,key)=>`${String(text??'').trim()}\n\n${marker(key)}`;
const short=(e,max=300)=>String(e?.message??e).replace(/coworker_[A-Za-z0-9_-]+/g,'coworker_***').slice(0,max);

export function createPipeline({deps,config}){
 const {sokosumi:api,journal,mode,catalog}=deps;
 const now=()=>deps.now();

 async function postOnce(taskId,key,body){
  const events=await api.listEvents(taskId);
  const existing=events.find(e=>typeof e.comment==='string'&&e.comment.includes(marker(key)));
  if(existing)return existing;
  return api.postEvent(taskId,{...body,comment:withMarker(body.comment,key)});
 }

 function fail(state,reason){return transition(state,'failing',{failure:{reason:String(reason).slice(0,2000)}},now(),reason);}

 function stopRequested(state){return config.QA_STOP_AFTER&&state.phase===config.QA_STOP_AFTER;}

 /** One transition. Returns the next state (same object when waiting). */
 async function step(task,state){
  let s=state;
  switch(s.phase){
   case 'received':
    return transition(s,'start-pending',{},now());

   case 'start-pending':{
    const remote=await api.getTask(s.taskId);
    if(remote.status==='READY'){
     const started=await api.start(s.taskId);
     return transition(s,'started',{input:started.description??remote.description??''},now());
    }
    if(remote.status==='RUNNING')return transition(s,'started',{input:remote.description??''},now(),'already running');
    return transition(s,'failed',{failure:{reason:`Task status ${remote.status} cannot be started`}},now());
   }

   case 'started':{
    try{
     const request=await mode.parseRequest({description:s.input,config,catalog});
     const agent=catalog.resolve(mode.name,request.agentId);
     if(!agent){
      const supported=catalog.list(mode.name).map(a=>`${a.name} (${a.id})`).join(', ')||'none configured';
      return fail(s,`Agent ${request.agentId??'(none)'} is not in the ${mode.name} QA group. Supported: ${supported}.`);
     }
     return transition(s,'request-parsed',{request:{...request,agentId:agent.id},agent},now());
    }catch(e){return fail(s,`Could not understand the QA request: ${short(e)}`);}
   }

   case 'request-parsed':{
    let inputSchema=s.agent.inputSchema;
    if(!inputSchema){
     try{inputSchema=await api.getAgentInputSchema(s.agent.id);}catch(e){return fail(s,`Could not read the input schema of agent ${s.agent.id}: ${short(e)}`);}
    }
    const contract=await mode.draftContract({request:s.request,agent:s.agent,inputSchema});
    return transition(s,'contract-drafted',{inputSchema,contract,contractVersion:s.contractVersion+1},now());
   }

   case 'contract-drafted':{
    const md=mode.renderContract(s.contract);
    const head=`Proposed acceptance contract v${s.contractVersion} for ${s.agent.name} (attempt budget ${s.contract.retry.maxAttempts}, max ${s.contract.retry.maxCreditsPerHire} credits per hire).`;
    if(s.request.autoApprove){
     await postOnce(s.taskId,`contract:v${s.contractVersion}`,{comment:`${head}\n\n${md}\n\nAuto-approved by the customer request.`});
     return transition(s,'approved',{approvedVersion:s.contractVersion},now(),'auto-approved');
    }
    return transition(s,'approval-posting',{},now());
   }

   case 'approval-posting':{
    const md=mode.renderContract(s.contract);
    const comment=`Proposed acceptance contract v${s.contractVersion} for ${s.agent.name} (attempt budget ${s.contract.retry.maxAttempts}, max ${s.contract.retry.maxCreditsPerHire} credits per hire).\n\n${md}\n\n\`\`\`json\n${JSON.stringify(s.contract,null,1)}\n\`\`\`\n\nReply APPROVE to start, or reply with the changes you want.`;
    await postOnce(s.taskId,`contract:v${s.contractVersion}`,{comment,status:'INPUT_REQUIRED'});
    const seen=(await api.listEvents(s.taskId)).map(e=>e.id);
    return transition(s,'awaiting-approval',{approvalSince:now(),seenEventIds:seen},now());
   }

   case 'awaiting-approval':{
    const events=await api.listEvents(s.taskId);
    const seen=new Set(s.seenEventIds??[]);
    const reply=events.find(e=>!seen.has(e.id)&&e.actor?.type==='user'&&typeof e.comment==='string'&&e.comment.trim());
    if(!reply){
     if(now()-s.approvalSince>config.QA_APPROVAL_TIMEOUT_MINUTES*60000)return fail(s,`No approval within ${config.QA_APPROVAL_TIMEOUT_MINUTES} minutes.`);
     return s;
    }
    if(APPROVE.test(reply.comment)){
     await postOnce(s.taskId,`approved:v${s.contractVersion}`,{status:'RUNNING',comment:`Contract v${s.contractVersion} approved. Hiring ${s.agent.name} (attempt 1/${s.contract.retry.maxAttempts}).`});
     return transition(s,'approved',{approvedVersion:s.contractVersion},now());
    }
    if(s.revisionRounds>=config.QA_MAX_REVISION_ROUNDS)return fail(s,`Contract not approved after ${s.revisionRounds} revision rounds.`);
    await postOnce(s.taskId,`revising:v${s.contractVersion}`,{status:'RUNNING',comment:'Revising the contract with your changes.'});
    const contract=await mode.reviseContract({contract:s.contract,comment:reply.comment,request:s.request,agent:s.agent});
    return transition(s,'contract-drafted',{contract,contractVersion:s.contractVersion+1,revisionRounds:s.revisionRounds+1},now(),'revision requested');
   }

   case 'approved':
    return transition({...s,attempts:[...s.attempts,{n:s.attempts.length+1,fixInstructions:s.pendingFixInstructions??[]}]},'hire-pending',{pendingFixInstructions:undefined},now());

   case 'hire-pending':{
    const a=currentAttempt(s);
    const name=`QA attempt ${a.n}`;
    // Reconcile: a previous run may have hired before the journal recorded it.
    const known=new Set(s.attempts.map(x=>x.jobId).filter(Boolean));
    const orphan=(await api.listTaskJobs(s.taskId)).find(j=>j.name===name&&!known.has(j.id));
    if(orphan)return transition(updateAttempt(s,a.n,{jobId:orphan.id,hiredAt:now(),reconciled:true}),'job-polling',{},now(),'adopted existing job');
    let inputData;
    try{inputData=await mode.buildInputData({inputSchema:s.inputSchema,contract:s.contract,attempt:a.n,fixInstructions:a.fixInstructions,agent:s.agent});}
    catch(e){return fail(s,`Cannot build input for agent ${s.agent.name}: ${short(e)}`);}
    s=updateAttempt(s,a.n,{inputData});journal.save(s);
    let job;
    try{job=await api.hire(s.taskId,{agentId:s.agent.id,inputSchema:s.inputSchema,inputData,maxCredits:s.contract.retry.maxCreditsPerHire,name});}
    catch(e){
     if(e?.status===402||/insufficient credits/i.test(String(e?.message)))return fail(s,'Out of credits: the workspace cannot pay for another hire.');
     return fail(s,`Hiring ${s.agent.name} failed: ${short(e,1000)}`);
    }
    return transition(updateAttempt(s,a.n,{jobId:job.id,hiredAt:now()}),'job-polling',{},now());
   }

   case 'job-polling':{
    const a=currentAttempt(s);
    if(a.lastPolledAt&&now()-a.lastPolledAt<config.QA_JOB_POLL_SECONDS*1000)return s;
    const job=await api.getJob(task,a.jobId);
    const status=effectiveJobStatus(job);
    s=updateAttempt(s,a.n,{lastPolledAt:now(),jobStatus:status,...(status!==job.status?{rawJobStatus:job.status}:{})});
    if(status==='input_required')return transition(updateAttempt(s,a.n,{report:jobFailureReport(a,job,'The agent asked for interactive input, which the QA flow does not support.')}),'verified',{},now());
    if(!JOB_TERMINAL.has(status)){
     if(now()-a.hiredAt>config.QA_JOB_TIMEOUT_MINUTES*60000)return transition(updateAttempt(s,a.n,{report:jobFailureReport(a,job,`No result within ${config.QA_JOB_TIMEOUT_MINUTES} minutes.`),timedOut:true}),'verified',{},now());
     return s;
    }
    if(status!=='completed')return transition(updateAttempt(s,a.n,{report:jobFailureReport(a,job,`The job ended with status ${status}.`)}),'verified',{},now());
    return transition(s,'verifying',{},now());
   }

   case 'verifying':{
    const a=currentAttempt(s);
    const [job,files,links]=await Promise.all([api.getJob(task,a.jobId),api.getJobFiles(task,a.jobId).catch(()=>[]),api.getJobLinks(task,a.jobId).catch(()=>[])]);
    let report;
    try{report=await mode.verify({job,files,links,contract:s.contract,attempt:a.n,workDir:journal.taskDir(s.taskId,`attempt-${a.n}`)});}
    catch(e){report={verdict:'fail',checks:[{id:'verify.error',criterion:'QA verification ran',status:'fail',expected:'no error',observed:short(e),evidence:[]}],summary:`Verification error: ${short(e)}`};}
    return transition(updateAttempt(s,a.n,{report,jobStatus:effectiveJobStatus(job)}),'verified',{},now());
   }

   case 'verified':{
    const a=currentAttempt(s);
    if(a.report.verdict==='pass')return transition(s,'completing',{},now());
    if(a.n>=s.contract.retry.maxAttempts)return transition(s,'failing',{failure:{reason:'Retry budget used up.'}},now());
    return transition(s,'refund-pending',{},now());
   }

   case 'refund-pending':{
    const a=currentAttempt(s);
    let refund;
    if(a.jobStatus!=='completed')refund={status:'skipped',detail:`job ${a.jobStatus??'unknown'}: nothing to refund via dispute`};
    else{
     try{refund=await api.requestRefund(task,a.jobId);}catch(e){refund={status:'failed',detail:short(e)};}
    }
    return transition(updateAttempt(s,a.n,{refund}),'rebrief',{},now());
   }

   case 'rebrief':{
    const a=currentAttempt(s);
    const fixes=mode.fixInstructions(a.report);
    const total=s.contract.retry.maxAttempts;
    await postOnce(s.taskId,`attempt:${a.n}:failed`,{comment:`Attempt ${a.n}/${total} failed: ${a.report.summary??'see report'}\nRefund: ${a.refund?.status}${a.refund?.detail?` (${a.refund.detail})`:''}.\nRehiring with a corrected brief.\n\n${mode.renderReport(a.report)}`});
    return transition(s,'approved',{pendingFixInstructions:fixes},now(),`rehire after attempt ${a.n}`);
   }

   case 'completing':{
    const remote=await api.getTask(s.taskId);
    if(remote.status!=='COMPLETED'){
     const text=mode.renderResult({contract:s.contract,attempts:s.attempts,agent:s.agent});
     await api.complete(s.taskId,text);
    }
    return transition(s,'completed',{},now());
   }

   case 'failing':{
    const remote=await api.getTask(s.taskId);
    if(remote.status!=='FAILED'){
     const last=currentAttempt(s);
     const attempts=s.attempts.length?`\n\nAttempts:\n${s.attempts.map(x=>`- ${x.n}: job ${x.jobId??'-'} ${x.jobStatus??''} → ${x.report?.verdict??'n/a'}${x.refund?`, refund ${x.refund.status}`:''}`).join('\n')}`:'';
     const report=last?.report?`\n\nLast report:\n\n${mode.renderReport(last.report)}`:'';
     await postOnce(s.taskId,'final:failed',{status:'FAILED',comment:`QA failed: ${s.failure?.reason??'unknown reason'}${attempts}${report}`});
    }
    return transition(s,'failed',{},now());
   }

   default:
    throw new Error(`Unknown QA phase ${s.phase}`);
  }
 }

 /** Run transitions until waiting/terminal. Journals after every transition. */
 async function advance(task){
  let state=journal.load(task.id)??newState(task.id,mode.name,now());
  if(state.phase==='received')journal.save(state);
  for(let i=0;i<50;i++){
   if(TERMINAL.has(state.phase)||stopRequested(state))return state;
   const next=await step(task,state);
   if(next===state)return state; // waiting
   state=journal.save(next);
  }
  return state;
 }

 return {advance,step};
}

export function jobFailureReport(attempt,job,reason){
 return {verdict:'fail',summary:reason,checks:[{id:'job.status',criterion:'The hired job completes with a result',status:'fail',expected:'completed',observed:job?.status??'unknown',evidence:[],fix:'Complete the job and return the deliverable.'}]};
}
