// Step 1.5 spike: can our Coworker hire a marketplace Agent from inside a Task on Preprod?
// Run with the worker STOPPED. Uses your login for Task creation and the Coworker key for everything else.
//   node --env-file=.env --env-file=.env.structured scripts/spike-hire.mjs --agent AGENT_ID \
//        [--brief "Return a CSV ..."] [--input-json '{"field":"value"}'] [--max-credits 20] [--refund]
// Resume an earlier spike without hiring again: add --task TASK_ID --job JOB_ID (polls, optional refund, completes the Task).
// Output: .local/spike/<timestamp>/ (task.json, schema.json, hire.json, job.json, files.json, links.json, result.txt, findings.json)
import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {parseArgs} from 'node:util';
import {createLiveAdapter} from '../qa/live.mjs';
import {JOB_TERMINAL,effectiveJobStatus} from '../qa/pipeline.mjs';
import {acquireWorkerLock} from '../worker-lock.mjs';
import {statePath} from '../state-dir.mjs';

const {values:o}=parseArgs({options:{agent:{type:'string'},brief:{type:'string'},'input-json':{type:'string'},'max-credits':{type:'string'},refund:{type:'boolean'},'timeout-min':{type:'string'},task:{type:'string'},job:{type:'string'}}});
if(!o.agent){console.error('--agent AGENT_ID is required');process.exit(2);}
if(!o.task!==!o.job){console.error('--task and --job must be given together');process.exit(2);}
// Hold the Coworker's worker lock: a running worker would adopt the READY spike Task as a QA request.
let releaseLock;
try{releaseLock=acquireWorkerLock(statePath('worker.lock'));}catch(e){console.error(`${e.message}. Stop the worker for this Coworker before running the spike.`);process.exit(2);}
process.once('exit',releaseLock);
const dir=join('.local','spike',new Date().toISOString().replace(/[:.]/g,'-'));mkdirSync(dir,{recursive:true,mode:0o700});
const save=(name,v)=>writeFileSync(join(dir,name),typeof v==='string'?v:JSON.stringify(v,null,1),{mode:0o600});
const log=(...a)=>console.log(new Date().toISOString(),...a);
const timeline=[];const findings={agentId:o.agent,timeline,errors:[]};
const human=args=>JSON.parse(execFileSync('sokosumi',['--preprod',...args,'--json'],{encoding:'utf8',timeout:60000}));
const brief=o.brief??'Return a CSV with exactly 5 rows and the header "date,value". date uses the format yyyy-MM-dd, value is a number. Return only the CSV.';

const {api,target}=await createLiveAdapter({resultDir:()=>dir});
const scope=target.organizationId?['--organization-slug',process.env.SOKOSUMI_ORGANIZATION_SLUG]:['--personal'];
try{
 let task,job,t0=Date.now();
 if(o.task){
  task={id:o.task};job={id:o.job};findings.taskId=task.id;findings.resumed=true;log('resuming task',task.id,'job',job.id);
 }else{
 // 1. Input schema, read with the Coworker key.
 let schema;
 try{schema=await api.getAgentInputSchema(o.agent);findings.inputSchemaReadable=true;save('schema.json',schema);log('input schema OK');}
 catch(e){findings.inputSchemaReadable=false;findings.errors.push({step:'input-schema',status:e.status,message:String(e.message).slice(0,500)});log('input schema FAILED',e.status,e.message);throw e;}
 const fields=schema?.input_data??schema?.inputData??[];
 findings.inputFields=fields.map(f=>({id:f.id,type:f.type,name:f.name,required:!(f.validations??[]).some(v=>v.validation==='optional')}));
 let inputData;
 if(o['input-json'])inputData=JSON.parse(o['input-json']);
 else{
  const text=fields.find(f=>['string','text','textarea'].includes(f.type));
  if(!text)throw new Error(`No text field in the agent's input schema; pass --input-json. Fields: ${JSON.stringify(findings.inputFields)}`);
  inputData={[text.id]:brief};
 }
 // 2. Task created by you (human login), started by the Coworker.
 const created=human(['tasks','create',...scope,'--coworker-id',target.coworkerId,'--name','QA spike','--description',`Spike: hire ${o.agent}`,'--status','READY']);
 task=created.task??created.data??created;save('task-created.json',task);
 findings.taskId=task.id;log('task',task.id);
 const started=await api.start(task.id);timeline.push({at:new Date().toISOString(),event:'task-started',status:started.status});
 // 3. Hire inside the Task.
 t0=Date.now();
 job=await api.hire(task.id,{agentId:o.agent,inputSchema:schema,inputData,maxCredits:Number(o['max-credits']??20),name:'QA attempt 1'});
 save('hire.json',job);findings.hire={ok:true,jobId:job.id,status:job.status,credits:job.credits??null};log('hired job',job.id,job.status);
 }
 // Job routes need the Task owner as context, so read the Task as the Coworker.
 const owner=await api.getTask(task.id);save('task.json',owner);
 // 4. Poll.
 let last;const limit=Number(o['timeout-min']??30)*60000;
 for(;;){
  const j=await api.getJob(owner,job.id);const st=effectiveJobStatus(j);
  if(st!==last){timeline.push({at:new Date().toISOString(),sinceHireS:Math.round((Date.now()-t0)/1000),status:st,rawStatus:j.status,jobEvents:(j.events??[]).map(e=>({status:e.status,at:e.createdAt}))});log('job status',st,st!==j.status?`(raw ${j.status})`:'');last=st;}
  if(JOB_TERMINAL.has(st)||st==='input_required'){save('job.json',j);findings.job={status:j.status,effectiveStatus:st,completedAt:j.completedAt??null,onChainStatus:j.onChainStatus??null,jobType:j.jobType??null,credits:j.credits??null,hasResult:!!j.result,resultLength:j.result?.length??0,hasResultHash:!!j.resultHash,hasIdentifierFromPurchaser:!!j.identifierFromPurchaser,keys:Object.keys(j)};if(j.result)save('result.txt',j.result);break;}
  if(Date.now()-t0>limit){findings.job={status:j.status,effectiveStatus:st,completedAt:j.completedAt??null,onChainStatus:j.onChainStatus??null,timedOut:true};break;}
  await new Promise(r=>setTimeout(r,12000));
 }
 const [files,links]=await Promise.all([api.getJobFiles(owner,job.id).catch(e=>({error:e.message})),api.getJobLinks(owner,job.id).catch(e=>({error:e.message}))]);
 save('files.json',files);save('links.json',links);
 findings.files=Array.isArray(files)?files.map(f=>({name:f.name??f.fileName,mimeType:f.mimeType??f.contentType,keys:Object.keys(f)})):files;
 findings.links=Array.isArray(links)?links.length:links;
 // 5. Optional refund probe.
 if(o.refund){findings.refund=await api.requestRefund(owner,job.id);log('refund',JSON.stringify(findings.refund));}
 // 6. Complete the spike Task.
 await api.complete(task.id,`Spike finished. Job ${job.id} ended ${last}.`);log('task completed');
}catch(e){findings.errors.push({status:e.status,message:String(e.message).slice(0,800),body:e.body??null});log('SPIKE ERROR',e.status??'',e.message);process.exitCode=1;}
finally{save('findings.json',findings);log('findings written to',join(dir,'findings.json'));}
