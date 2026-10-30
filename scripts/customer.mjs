// Demo customer for QA Coworkers. Uses YOUR Sokosumi login (sokosumi --preprod auth login), never a Coworker key.
//   node scripts/customer.mjs create --coworker CW_ID --brief "..." [--agent AGENT_ID] [--auto-approve] [--max-attempts 3] [--max-credits 50] [--org-slug SLUG] [--raw]
//   node scripts/customer.mjs approve TASK_ID [--changes "..."] [--org-slug SLUG]
//   node scripts/customer.mjs watch TASK_ID [--org-slug SLUG]
import {execFileSync} from 'node:child_process';
import {parseArgs} from 'node:util';
import {formatQaRequest} from '../qa/request.mjs';

const [cmd,...rest]=process.argv.slice(2);
const {values:o,positionals:pos}=parseArgs({args:rest,allowPositionals:true,options:{
 coworker:{type:'string'},agent:{type:'string'},brief:{type:'string'},'auto-approve':{type:'boolean'},
 'max-attempts':{type:'string'},'max-credits':{type:'string'},'org-slug':{type:'string'},changes:{type:'string'},raw:{type:'boolean'},name:{type:'string'},
}});
const scope=()=>o['org-slug']?['--organization-slug',o['org-slug']]:['--personal'];
const scopeRead=()=>o['org-slug']?['--organization-slug',o['org-slug']]:[];
function cli(args){return JSON.parse(execFileSync('sokosumi',['--preprod',...args,'--json'],{encoding:'utf8',timeout:60000,maxBuffer:8*1024*1024}));}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

if(cmd==='create'){
 if(!o.coworker||!o.brief)throw new Error('create needs --coworker and --brief');
 const req={brief:o.brief};
 if(o.agent)req.agentId=o.agent;
 if(o['auto-approve'])req.autoApprove=true;
 if(o['max-attempts'])req.maxAttempts=Number(o['max-attempts']);
 if(o['max-credits'])req.maxCreditsPerHire=Number(o['max-credits']);
 const description=o.raw?o.brief:formatQaRequest(req);
 const r=cli(['tasks','create',...scope(),'--coworker-id',o.coworker,'--name',o.name??`QA: ${o.brief.slice(0,60)}`,'--description',description,'--status','READY']);
 const task=r.task??r.data??r;
 console.log(JSON.stringify({taskId:task.id,status:task.status},null,1));
}else if(cmd==='approve'){
 const id=pos[0];if(!id)throw new Error('approve needs TASK_ID');
 const r=cli(['tasks','comment',id,...scopeRead(),'--comment',o.changes??'APPROVE']);
 console.log(JSON.stringify({ok:true,event:r.event?.id??r.id??null}));
}else if(cmd==='watch'){
 const id=pos[0];if(!id)throw new Error('watch needs TASK_ID');
 const seen=new Set();let hinted=false;
 for(;;){
  const t=cli(['tasks','get',id,...scopeRead()]);const task=t.task??t.data??t;
  const ev=cli(['tasks','events',id,...scopeRead()]);const events=ev.events??ev.data??[];
  for(const e of events){if(seen.has(e.id))continue;seen.add(e.id);
   const who=e.actor?.type??'?';const st=e.status?` [${e.status}]`:'';
   console.log(`\n--- ${e.createdAt??''} ${who}${st}\n${(e.comment??'').slice(0,4000)}`);}
  if(['COMPLETED','FAILED','CANCELED'].includes(task.status)){console.log(`\n=== Task ${task.status}`);if(task.result)console.log(String(task.result).slice(0,20000));break;}
  if(task.status==='INPUT_REQUIRED'&&!hinted){hinted=true;console.log(`\n(waiting for you: node scripts/customer.mjs approve ${id} [--changes "..."])`);}
  if(task.status!=='INPUT_REQUIRED')hinted=false;
  await sleep(10000);
 }
}else{
 console.error('Usage: customer.mjs create|approve|watch (see header)');process.exit(2);
}
