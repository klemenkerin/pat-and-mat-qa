// Read-only live check (Gate 2.2). Usage:
//   node --env-file=.env --env-file=.env.structured scripts/live-sokosumi-check.mjs TASK_ID
import {createLiveAdapter} from '../qa/live.mjs';
const taskId=process.argv[2];
if(!taskId){console.error('Usage: scripts/live-sokosumi-check.mjs TASK_ID');process.exit(2);}
const {api}=await createLiveAdapter({resultDir:()=>{throw new Error('read-only check')}});
const task=await api.getTask(taskId);
const events=await api.listEvents(taskId);
const jobs=await api.listTaskJobs(taskId);
console.log(JSON.stringify({taskId,status:task.status,assignee:task.assigneeId??task.coworkerId,organizationId:task.organizationId,events:events.length,jobs:jobs.length,eventKeys:Object.keys(events[0]??{}),actorTypes:[...new Set(events.map(e=>e.actor?.type))]},null,1));
