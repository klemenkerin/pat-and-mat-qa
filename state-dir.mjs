import {mkdirSync} from 'node:fs';
import {join,isAbsolute,normalize} from 'node:path';
// Directory for one worker's journals, lock and session files. Default keeps template behaviour.
export function stateDir(env=process.env){
 const dir=(env.STATE_DIR??'').trim()||'.local';
 if(isAbsolute(dir)||normalize(dir).startsWith('..'))throw new Error('STATE_DIR must be a relative path inside the project');
 return normalize(dir);
}
export function statePath(name,env=process.env){
 if(typeof name!=='string'||!name||name.includes('..')||isAbsolute(name))throw new Error('Invalid state file name');
 return join(stateDir(env),name);
}
export function ensureStateDir(env=process.env){const dir=stateDir(env);mkdirSync(dir,{recursive:true,mode:0o700});return dir;}
