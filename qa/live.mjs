import {loadSokosumiRuntime} from '../sokosumi-runtime.mjs';
import {taskTarget} from '../task-target.mjs';
import {createSokosumiAdapter} from './sokosumi.mjs';

/** Builds the real Sokosumi adapter from the Coworker runtime key in the CLI vault. */
export async function createLiveAdapter({resultDir}){
 const target=taskTarget();
 const runtime=await loadSokosumiRuntime();
 const client=runtime.createCoworkerHttpClient({apiKey:runtime.readRuntimeCredential(target.coworkerId)});
 return {target,runtime,client,api:createSokosumiAdapter({client,runtime,target,resultDir})};
}
