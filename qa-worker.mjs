// QA worker: polls Sokosumi for Tasks assigned to this Coworker and advances each through the QA pipeline.
// Started by worker.mjs when QA_MODE is "structured" or "image".
import {execFileSync} from 'node:child_process';
import {acquireWorkerLock} from './worker-lock.mjs';
import {taskTarget,isTaskForTarget} from './task-target.mjs';
import {statePath} from './state-dir.mjs';
import {loadConfig} from './qa/config.mjs';
import {createJournal} from './qa/journal.mjs';
import {createLiveAdapter} from './qa/live.mjs';
import {createLlm} from './qa/llm.mjs';
import {loadCatalog} from './qa/catalog.mjs';
import {createPipeline,TERMINAL} from './qa/pipeline.mjs';
import {withMockHire} from './qa/mock/hire.mjs';

const config=loadConfig();
const target=taskTarget();
const releaseLock=acquireWorkerLock(statePath('worker.lock'));
process.once('exit',releaseLock);
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{releaseLock();process.exit(0)});

const journal=createJournal(config.STATE_DIR);
const {api:liveApi}=await createLiveAdapter({resultDir:id=>journal.taskDir(id)});
const llm=createLlm();
const catalog=loadCatalog();
// QA_HIRE_BACKEND=mock: Jobs go to the local stand-in image Agent; the Task itself stays on Sokosumi.
const mockAgentIds=new Set([...catalog.list('structured'),...catalog.list('image')].filter(a=>a.mock).map(a=>a.id));
const api=config.QA_HIRE_BACKEND==='mock'?withMockHire(liveApi,{dir:statePath('mock-jobs'),mockAgentIds}):liveApi;
if(config.QA_HIRE_BACKEND==='mock')console.log(`Mock hire backend: Jobs for ${[...mockAgentIds].join(', ')||'(no mock agents)'} run locally`);
let mode;
if(config.QA_MODE==='structured')mode=(await import('./qa/modes/structured.mjs')).createStructuredMode({llm});
else if(config.QA_MODE==='image')mode=(await import('./qa/modes/image.mjs')).createImageMode({llm,config});
else throw new Error(`Unsupported QA_MODE ${config.QA_MODE}`);
if(!catalog.list(mode.name).length)console.warn(`WARNING: config/agents.json has no "${mode.name}" agents; every QA Task will fail until you add them.`);
if(mode.warmUp){const t=Date.now();await mode.warmUp();console.log(`Warm-up done in ${Date.now()-t} ms`);}
const pipeline=createPipeline({deps:{now:Date.now,journal,sokosumi:api,mode,catalog},config});

function listTasks(){return JSON.parse(execFileSync('sokosumi',['--preprod','tasks','list','--coworker-id',target.coworkerId,...target.taskArgs,'--json'],{encoding:'utf8',timeout:60000,maxBuffer:8*1024*1024})).tasks??[];}
const ACTIVE=new Set(['READY','RUNNING','INPUT_REQUIRED']);
console.log(`QA worker running (${config.QA_MODE}) pid ${process.pid}${config.QA_STOP_AFTER?`, stopping after ${config.QA_STOP_AFTER}`:''}`);
const lastPhase=new Map();
while(true){
 try{
  for(const t of listTasks().filter(t=>isTaskForTarget(t,target))){
   const st=journal.load(t.id);
   if(st&&TERMINAL.has(st.phase))continue;
   if(!st&&t.status!=='READY')continue;          // only pick up new work from READY
   if(st&&!ACTIVE.has(t.status)&&!['failing','completing'].includes(st.phase))continue;
   try{
    const s=await pipeline.advance(t);
    if(lastPhase.get(t.id)!==s.phase){console.log(new Date().toISOString(),t.id,'→',s.phase,s.attempts?.length?`(attempt ${s.attempts.length})`:'');lastPhase.set(t.id,s.phase);}
   }catch(e){console.error('Task blocked',t.id,String(e?.message??e).replace(/coworker_[A-Za-z0-9_-]+/g,'coworker_***').slice(0,300));}
  }
 }catch(e){console.error('Polling failed',String(e?.message??e).slice(0,200));}
 await new Promise(r=>setTimeout(r,5000));
}
