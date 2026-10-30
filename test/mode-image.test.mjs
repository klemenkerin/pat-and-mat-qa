import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import sharp from 'sharp';
import {parseImageContract} from '../qa/contract/image.mjs';
import {createImageMode} from '../qa/modes/image.mjs';
import {withMockHire} from '../qa/mock/hire.mjs';
import {readPrompt,renderStandinImage} from '../qa/mock/image-standin.mjs';
import {terminateOcr} from '../qa/validators/image/ocr.mjs';
import {loadConfig} from '../qa/config.mjs';

const agent={id:'local-image-standin',name:'Local stand-in image Agent (mock)',mock:true,inputSchema:{input_data:[{id:'prompt',type:'textarea',name:'Image prompt',validations:[{validation:'max',value:'4000'}]}]}};
const contract=parseImageContract({kind:'image',version:1,agentId:agent.id,brief:'Cat toy shop poster with the text "CAT TOYS -50%" and two cats',
 technical:{formats:['png'],minWidth:1000},text:{mode:'exact',expected:'CAT TOYS -50%'},objects:[{label:'cat',minCount:2}],retry:{maxAttempts:3,maxCreditsPerHire:10}});
const tmp=p=>mkdtempSync(join(tmpdir(),p));

test('stand-in reads the prompt: exact text, objects, size, format; drops symbols until a rejection',async()=>{
 const p='Poster "SALE -50%"\n\nHard requirements (checked automatically):\n1 image; jpeg; at least 1600x900 px; text exactly "SALE -50%", clearly legible; clearly visible: 2 cats, a teddy bear.';
 assert.deepEqual(readPrompt(p),{text:'SALE 50',objects:[{label:'cat',minCount:2},{label:'teddy bear',minCount:1}],minW:1600,minH:900,aspect:0,format:'jpeg',retry:false});
 const retry=readPrompt(`${p}\n\nYour previous attempt was rejected. Fix ALL of these issues:\n- Text must read exactly "SALE \\"-50%\\""; found "SALE 50".`);
 assert.equal(retry.text,'SALE "-50%"');
 assert.equal(readPrompt('Banner\n\nHard requirements (checked automatically):\n1 image; legible text that conveys: a discount on coffee; clearly visible: a cup.').text,'A DISCOUNT ON COFFEE');
 const img=await renderStandinImage(p);
 assert.deepEqual([img.format,img.width,img.height,img.missing],['jpeg',1600,900,[]]);
 assert.deepEqual(img.photos.map(x=>x.label),['cat','teddy bear']);
 assert.equal((await sharp(img.buffer).metadata()).format,'jpeg');
 assert.deepEqual((await renderStandinImage('x\n\nHard requirements (checked automatically):\n1 image; no text required; clearly visible: a bicycle.')).missing,['bicycle']);
});

test('image mode + mock hire: attempt 1 fails on the text (real OCR), the rehire with fixes passes',{timeout:120000},async t=>{
 t.after(terminateOcr);
 let clock=1000;
 const api=withMockHire({},{dir:tmp('qa-mockjobs-'),mockAgentIds:new Set([agent.id]),now:()=>clock,delayMs:5000});
 // Fake detector: reports the labels of the COCO photos the stand-in says it used (the real detector is in the slow suite).
 let shown=[];
 const mode=createImageMode({llm:{generateJson:async()=>{throw new Error('LLM not expected');}},config:loadConfig({COWORKER_ID:'x'}),
  detectFn:async(_p,labels)=>labels.filter(l=>shown.includes(l)).map(label=>({label,score:0.5,box:{xmin:0,ymin:0,xmax:1,ymax:1}})).flatMap(d=>[d,{...d,box:{xmin:2,ymin:2,xmax:3,ymax:3}}])});
 async function attempt(n,fixes){
  const inputData=await mode.buildInputData({inputSchema:agent.inputSchema,contract,attempt:n,fixInstructions:fixes,agent});
  const hired=await api.hire('task-1',{agentId:agent.id,inputData,name:`QA attempt ${n}`});
  assert.equal((await api.getJob({},hired.id)).status,'running');
  assert.deepEqual(await api.getJobFiles({},hired.id),[]);
  clock+=6000;
  const job=await api.getJob({},hired.id);
  assert.equal(job.status,'completed');
  shown=/Photos: cat/.test(job.result)?['cat']:[];
  return mode.verify({job,files:await api.getJobFiles({},hired.id),links:[],contract,attempt:n,workDir:tmp('qa-imgattempt-')});
 }
 const r1=await attempt(1,[]);
 assert.deepEqual(r1.checks.filter(c=>c.status==='fail').map(c=>c.id),['text'],mode.renderReport(r1));
 const fixes=mode.fixInstructions(r1);
 assert.match(fixes[0],/Text must read exactly "CAT TOYS -50%"; found "CAT TOYS 50"/);
 const r2=await attempt(2,fixes);
 assert.equal(r2.verdict,'pass',mode.renderReport(r2));
 assert.equal(r2.images[0].width,1200);
 const result=mode.renderResult({contract,attempts:[{n:1,report:r1,refund:await api.requestRefund()},{n:2,report:r2,jobId:'mock-2'}],agent});
 assert.match(result,/^QA PASSED\. Local stand-in image Agent \(mock\) \(mock hire: no payment\)/);
 assert.match(result,/Attempts: #1 fail \(refund skipped\), #2 pass/);
 assert.doesNotMatch(result,/base64/);
 assert.deepEqual((await api.listTaskJobs('task-1')).map(j=>[j.name,j.status]).sort(),[['QA attempt 1','completed'],['QA attempt 2','completed']]);
 await assert.rejects(api.hire('task-1',{agentId:'real-agent',inputData:{prompt:'x'},name:'n'}),/only hires local stand-in agents/);
});
