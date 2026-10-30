// Slow suite (real OCR + detector; downloads models on first run): npm run test:slow
import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {loadConfig} from '../../qa/config.mjs';
import {parseImageContract} from '../../qa/contract/image.mjs';
import {validateImages} from '../../qa/validators/image/index.mjs';
import {ocr,terminateOcr} from '../../qa/validators/image/ocr.mjs';
import {detect} from '../../qa/validators/image/detector.mjs';
import {buildReport,renderReportMarkdown} from '../../qa/report.mjs';

const c=loadConfig({COWORKER_ID:'x'});
const base=JSON.parse(readFileSync(new URL('../fixtures/contracts/image-valid.json',import.meta.url)));
const dataUrl=(p,mime)=>`data:${mime};base64,${readFileSync(new URL(p,import.meta.url)).toString('base64')}`;
const noLlm={generateJson:async()=>{throw new Error('LLM not expected');}};
after(()=>terminateOcr());
async function run(result,contract){
 const v=await validateImages({job:{id:'j',result},contract:parseImageContract(contract),workDir:mkdtempSync(join(tmpdir(),'qa-imgslow-')),
  ocrFn:ocr,detectFn:(p,l)=>detect(p,l,{model:c.DETECTOR_MODEL,dtype:c.DETECTOR_DTYPE,threshold:0.01}),llm:noLlm,threshold:c.DETECTOR_THRESHOLD});
 return buildReport({checks:v.checks,attempt:1,jobId:'j',agentId:'a',deliverable:null});
}
const status=r=>Object.fromEntries(r.checks.map(x=>[x.id,x.status]));

test('real OCR: exact text passes, the typo fails',{timeout:300000},async()=>{
 const contract={...base,objects:[]};
 const good=await run(`![p](${dataUrl('../fixtures/images/text-exact.png','image/png')})`,contract);
 assert.equal(good.verdict,'pass',renderReportMarkdown(good));
 const typo=await run(`![p](${dataUrl('../fixtures/images/text-typo.png','image/png')})`,contract);
 assert.equal(status(typo).text,'fail',renderReportMarkdown(typo));
});
test('real detector: two cats found, no dog',{timeout:300000},async()=>{
 const contract={...base,technical:{formats:['jpeg']},text:{mode:'none'},objects:[{label:'cat',minCount:2},{label:'dog',minCount:1}]};
 const r=await run(`![p](${dataUrl('../fixtures/images/detect/coco-000000039769.jpg','image/jpeg')})`,contract);
 assert.deepEqual(status(r),{'images.count':'pass','technical.format':'pass',text:'skip','objects.cat':'pass','objects.dog':'fail','integrity.hash':status(r)['integrity.hash']},renderReportMarkdown(r));
});
test('stand-in poster: real OCR + detector pass the rehire prompt, fail the sloppy first one',{timeout:300000},async()=>{
 const {renderStandinImage}=await import('../../qa/mock/image-standin.mjs');
 const contract={...base,brief:'Cat toy poster',technical:{formats:['png'],minWidth:1000},text:{mode:'exact',expected:'CAT TOYS -50%'},objects:[{label:'cat',minCount:2}]};
 const req='Cat toy poster\n\nHard requirements (checked automatically):\n1 image; png; at least 1000 px wide; text exactly "CAT TOYS -50%", clearly legible; clearly visible: 2 cats.';
 const png=async p=>`![p](data:image/png;base64,${(await renderStandinImage(p)).buffer.toString('base64')})`;
 const first=await run(await png(req),contract);
 assert.deepEqual(first.checks.filter(x=>x.status==='fail').map(x=>x.id),['text'],renderReportMarkdown(first));
 const second=await run(await png(`${req}\n\nYour previous attempt was rejected. Fix ALL of these issues:\n- Text must read exactly "CAT TOYS -50%"; found "CAT TOYS 50".`),contract);
 assert.equal(second.verdict,'pass',renderReportMarkdown(second));
});
