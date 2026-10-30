// Step 1.5 spike: can our Coworker hire a marketplace Agent from inside a Task on Preprod?
// Run with the worker STOPPED. Uses your login for Task creation and the Coworker key for everything else.
//   node --env-file=.env --env-file=.env.structured scripts/spike-hire.mjs --agent AGENT_ID \
//        [--brief "Return a CSV ..."] [--input-json '{"field":"value"}'] [--max-credits 20] [--refund]
// Output: .local/spike/<timestamp>/ (task.json, schema.json, hire.json, job.json, files.json, links.json, result.txt, findings.json)
import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {parseArgs} from 'node:util';
import {createLiveAdapter} from '../qa/live.mjs';

const {values:o}=parseArgs({options:{agent:{type:'string'},brief:{type:'string'},'input-json':{type:'string'},'max-credits':{type:'string'},refund:{type:'boolean'},'timeout-min':{type:'string'}}});
if(!o.agent){console.error('--agent AGENT_ID is required');process.exit(2);}
const dir=join('.local','spike',new Date().toISOString().replace(/[:.]/g,'-'));mkdirSync(dir,{recursive:true,mode:0o700});
const save=(name,v)=>writeFileSync(join(dir,name),typeof v==='string'?v:JSON.stringify(v,null,1),{mode:0o600});
const log=(...a)=>console.log(new Date().toISOString(),...a);
const timeline=[];const findings={agentId:o.agent,timeline,errors:[]};
const human=args=>JSON.parse(execFileSync('sokosumi',['--preprod',...args,'--json'],{encoding:'utf8',timeout:60000}));
const brief=o.brief??'Return a CSV with exactly 5 rows and the header "date,value". date uses the format yyyy-MM-dd, value is a number. Return only the CSV.';

const {api,target}=await createLiveAdapter({resultDir:()=>dir});
const scope=target.organizationId?['--organization-slug',process.env.SOKOSUMI_ORGANIZATION_SLUG]:['--personal'];
try{
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
 const task=created.task??created.data??created;save('task-created.json',task);
 findings.taskId=task.id;log('task',task.id);
 const started=await api.start(task.id);timeline.push({at:new Date().toISOString(),event:'task-started',status:started.status});
 // 3. Hire inside the Task.
 const t0=Date.now();
 const job=await api.hire(task.id,{agentId:o.agent,inputSchema:schema,inputData,maxCredits:Number(o['max-credits']??20),name:'QA attempt 1'});
 save('hire.json',job);findings.hire={ok:true,jobId:job.id,status:job.status,credits:job.credits??null};log('hired job',job.id,job.status);
 // 4. Poll.
 let last;const limit=Number(o['timeout-min']??30)*60000;
 for(;;){
  const j=await api.getJob(job.id);
  if(j.status!==last){timeline.push({at:new Date().toISOString(),sinceHireS:Math.round((Date.now()-t0)/1000),status:j.status});log('job status',j.status);last=j.status;}
  if(['completed','failed','refund_resolved','dispute_resolved','payment_failed'].includes(j.status)||j.status==='input_required'){save('job.json',j);findings.job={status:j.status,jobType:j.jobType??null,credits:j.credits??null,hasResult:!!j.result,resultLength:j.result?.length??0,hasResultHash:!!j.resultHash,hasIdentifierFromPurchaser:!!j.identifierFromPurchaser,keys:Object.keys(j)};if(j.result)save('result.txt',j.result);break;}
  if(Date.now()-t0>limit){findings.job={status:j.status,timedOut:true};break;}
  await new Promise(r=>setTimeout(r,12000));
 }
 const [files,links]=await Promise.all([api.getJobFiles(job.id).catch(e=>({error:e.message})),api.getJobLinks(job.id).catch(e=>({error:e.message}))]);
 save('files.json',files);save('links.json',links);
 findings.files=Array.isArray(files)?files.map(f=>({name:f.name??f.fileName,mimeType:f.mimeType??f.contentType,keys:Object.keys(f)})):files;
 findings.links=Array.isArray(links)?links.length:links;
 // 5. Optional refund probe.
 if(o.refund){const t=await api.getTask(task.id);findings.refund=await api.requestRefund(t,job.id);log('refund',JSON.stringify(findings.refund));}
 // 6. Complete the spike Task.
 await api.complete(task.id,`Spike finished. Job ${job.id} ended ${last}.`);log('task completed');
}catch(e){findings.errors.push({status:e.status,message:String(e.message).slice(0,800),body:e.body??null});log('SPIKE ERROR',e.status??'',e.message);process.exitCode=1;}
finally{save('findings.json',findings);log('findings written to',join(dir,'findings.json'));}
