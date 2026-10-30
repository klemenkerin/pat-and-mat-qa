import {readFileSync,writeFileSync,existsSync,renameSync,openSync,fsyncSync,closeSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';

const ID=/^[A-Za-z0-9_-]{1,128}$/;

/** Per-worker store of QA Task journals: `${dir}/qa-<taskId>.json`, written atomically. */
export function createJournal(dir){
 mkdirSync(dir,{recursive:true,mode:0o700});
 const file=taskId=>{if(!ID.test(String(taskId)))throw new Error('Invalid task id for journal');return join(dir,`qa-${taskId}.json`);};
 return {
  dir,
  path:file,
  exists:taskId=>existsSync(file(taskId)),
  load(taskId){const p=file(taskId);return existsSync(p)?JSON.parse(readFileSync(p,'utf8')):null;},
  save(state){
   const p=file(state.taskId),tmp=`${p}.tmp`;
   const fd=openSync(tmp,'w',0o600);
   try{writeFileSync(fd,JSON.stringify(state,null,1));fsyncSync(fd);}finally{closeSync(fd);}
   renameSync(tmp,p);
   return state;
  },
  /** Directory for one task's artefacts (deliverables, reports, result file). */
  taskDir(taskId,...parts){const d=join(dir,`qa-${taskId}`,...parts.map(String));mkdirSync(d,{recursive:true,mode:0o700});return d;},
 };
}

export function newState(taskId,mode,now){
 return {taskId,mode,phase:'received',history:[{phase:'received',at:new Date(now).toISOString()}],attempts:[],revisionRounds:0,contractVersion:0};
}

/** Returns a new state object moved to `phase`, with `patch` merged and the change recorded in history. */
export function transition(state,phase,patch={},now=Date.now(),note){
 const entry={phase,at:new Date(now).toISOString()};
 if(note)entry.note=String(note).slice(0,500);
 return {...state,...patch,phase,history:[...state.history,entry]};
}

export function updateAttempt(state,n,patch){
 return {...state,attempts:state.attempts.map(a=>a.n===n?{...a,...patch}:a)};
}

export const currentAttempt=state=>state.attempts.at(-1);
