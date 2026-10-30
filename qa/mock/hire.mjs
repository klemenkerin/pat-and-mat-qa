import {mkdirSync,readFileSync,writeFileSync,readdirSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {renderStandinImage} from './image-standin.mjs';

/*
 QA_HIRE_BACKEND=mock: hires go to the local stand-in image Agent instead of Sokosumi Core.
 The Task, its events, approval and completion stay on Sokosumi; only the Job is local (no payment, no refund).
 Jobs are journaled under ${dir} so a restarted worker finds them again (hire reconciliation by name).
*/
export function withMockHire(api,{dir,mockAgentIds,now=Date.now,delayMs=5000,render=renderStandinImage}){
 mkdirSync(dir,{recursive:true,mode:0o700});
 const file=id=>join(dir,`${id.replace(/[^\w-]/g,'')}.json`);
 const load=id=>{if(!existsSync(file(id)))throw Object.assign(new Error(`Unknown mock job ${id}`),{status:404});return JSON.parse(readFileSync(file(id),'utf8'));};
 const save=j=>{writeFileSync(file(j.id),JSON.stringify(j,null,1),{mode:0o600});return j;};
 const all=()=>readdirSync(dir).filter(f=>f.endsWith('.json')).map(f=>JSON.parse(readFileSync(join(dir,f),'utf8')));
 return {
  ...api,
  async listTaskJobs(taskId){return all().filter(j=>j.taskId===taskId).map(({id,name,status})=>({id,name,status}));},
  async hire(taskId,{agentId,inputData,name}){
   if(!mockAgentIds.has(agentId))throw new Error(`QA_HIRE_BACKEND=mock only hires local stand-in agents (${[...mockAgentIds].join(', ')}), not ${agentId}`);
   const prompt=Object.values(inputData).filter(v=>typeof v==='string').join('\n\n');
   const id=`mock-${randomUUID()}`;
   const img=await render(prompt);
   const imagePath=join(dir,`${id}.${img.format==='jpeg'?'jpg':img.format}`);
   writeFileSync(imagePath,img.buffer,{mode:0o600});
   const result=[`Local stand-in image Agent (mock hire, no payment): 1 image, ${img.width}×${img.height} ${img.format.toUpperCase()}.`,
    img.text?`Text: "${img.text}".`:'No text.',
    img.photos.length?`Photos: ${img.photos.map(p=>`${p.label} (COCO ${p.file})`).join(', ')}.`:'',
    img.missing.length?`Not in my photo library, so not shown: ${img.missing.join(', ')}.`:''].filter(Boolean).join('\n');
   return save({id,taskId,name,agentId,inputData,status:'running',createdAt:new Date(now()).toISOString(),readyAt:now()+delayMs,result,
    files:[{name:`image-1.${img.format==='jpeg'?'jpg':img.format}`,mimeType:`image/${img.format}`,path:imagePath}]});
  },
  async getJob(_task,jobId){
   const j=load(jobId);
   if(j.status==='running'&&now()>=j.readyAt){j.status='completed';j.completedAt=new Date(now()).toISOString();save(j);}
   const {files,readyAt,...job}=j;
   return j.status==='completed'?job:{...job,result:undefined};
  },
  async getJobFiles(_task,jobId){
   const j=load(jobId);
   if(j.status!=='completed')return [];
   return j.files.map(f=>({name:f.name,mimeType:f.mimeType,url:`data:${f.mimeType};base64,${readFileSync(f.path).toString('base64')}`}));
  },
  async getJobLinks(){return [];},
  async requestRefund(){return {status:'skipped',detail:'mock job: nothing was paid'};},
 };
}
