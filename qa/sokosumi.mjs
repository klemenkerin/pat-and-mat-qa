import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {verifyRuntimeTask} from '../task-target.mjs';

export const PREPROD_API_URL='https://api.preprod.sokosumi.com';
const enc=encodeURIComponent;
const data=body=>(body&&typeof body==='object'&&'data' in body)?body.data:body;
const list=body=>{const d=data(body);return Array.isArray(d)?d:[];};

/** Runs the pinned Sokosumi CLI (1.0.4) in Preprod mode and parses its JSON output. */
export function runCli(args,{exec=execFileSync}={}){
 return JSON.parse(exec('sokosumi',['--preprod',...args,'--json'],{encoding:'utf8',timeout:60000,maxBuffer:8*1024*1024}));
}

/**
 Adapter between the QA pipeline and Sokosumi Core.
 - client: Coworker HTTP client from CLI 1.0.4 (createCoworkerHttpClient) — Preprod only, /v1 paths.
 - runtime: modules loaded by sokosumi-runtime.mjs ({fetchTaskEvents, createCoworkerHttpClient, readRuntimeCredential}).
 - target: taskTarget() from the template (coworkerId, organizationId, runtimeArgs).
 - cli: function(args) -> parsed JSON (defaults to runCli).
 - resultDir(taskId): directory for the result file handed to `runtime complete`.
*/
export function createSokosumiAdapter({client,runtime,target,cli=runCli,resultDir,fetchImpl=fetch}){
 const id=target.coworkerId;
 const guard=taskId=>verifyRuntimeTask(client,taskId,target);
 return {
  async start(taskId){
   const started=cli(['runtime','start',taskId,...target.runtimeArgs,'--coworker-id',id]);
   return {status:started.status??started.task?.status,description:started.description??started.task?.description};
  },
  async getTask(taskId){return data(await client.get(`/v1/tasks/${enc(taskId)}`));},
  async listEvents(taskId){return (await runtime.fetchTaskEvents(client,taskId,AbortSignal.timeout(30000))).events;},
  async postEvent(taskId,body){await guard(taskId);return data(await client.post(`/v1/tasks/${enc(taskId)}/events`,body));},
  async listTaskJobs(taskId){return list(await client.get(`/v1/tasks/${enc(taskId)}/jobs?limit=100`));},
  async getAgentInputSchema(agentId){return data(await client.get(`/v1/agents/${enc(agentId)}/input-schema`));},
  async hire(taskId,body){await guard(taskId);return data(await client.post(`/v1/tasks/${enc(taskId)}/jobs`,body));},
  async getJob(jobId){return data(await client.get(`/v1/jobs/${enc(jobId)}`));},
  async getJobFiles(jobId){return list(await client.get(`/v1/jobs/${enc(jobId)}/files`));},
  async getJobLinks(jobId){return list(await client.get(`/v1/jobs/${enc(jobId)}/links`));},
  async requestRefund(task,jobId){
   // Core's Task payload names the owner `userId` (verified on Preprod); `ownerId` is accepted for older shapes.
   const owner=task.ownerId??task.userId;
   if(!owner)return {status:'failed',detail:'Task has no owner id; cannot send X-Context-User-Id'};
   try{
    let body;
    if(task.organizationId){
     // CLI 1.0.4's client cannot send X-Context-Organization-Id, so call Core directly.
     const key=runtime.readRuntimeCredential(id);
     const res=await fetchImpl(`${PREPROD_API_URL}/v1/jobs/${enc(jobId)}/refund`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(30000),
      headers:{Accept:'application/json',Authorization:`Bearer ${key}`,'X-Context-User-Id':owner,'X-Context-Organization-Id':task.organizationId}});
     const text=await res.text();
     body=text?JSON.parse(text):undefined;
     if(!res.ok)throw Object.assign(new Error(`Core API request failed with status ${res.status}`),{status:res.status,body});
    }else{
     const ctx=runtime.createCoworkerHttpClient({apiKey:runtime.readRuntimeCredential(id),contextUserId:owner});
     body=await ctx.post(`/v1/jobs/${enc(jobId)}/refund`);
    }
    return {status:'requested',detail:data(body)?.status??'refund requested'};
   }catch(e){
    if(e?.status===422)return {status:'skipped',detail:'not refundable (not a paid job or no on-chain purchase yet)'};
    return {status:'failed',detail:`HTTP ${e?.status??'?'}: ${String(e?.message??e).replace(/coworker_[A-Za-z0-9_-]+/g,'coworker_***').slice(0,200)}`};
   }
  },
  async complete(taskId,text){
   await guard(taskId);
   const buf=Buffer.from(text,'utf8');
   if(buf.length>1024*1024)throw new Error('Result exceeds the 1 MiB runtime limit');
   const file=join(resultDir(taskId),'result.md');
   writeFileSync(file,buf,{mode:0o600});
   return cli(['runtime','complete',taskId,...target.runtimeArgs,'--coworker-id',id,'--result-file',file]);
  },
 };
}
