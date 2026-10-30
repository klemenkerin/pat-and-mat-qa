import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parseImageContract} from '../qa/contract/image.mjs';
import {validateImages} from '../qa/validators/image/index.mjs';
import {buildReport,renderReportMarkdown,fixInstructions} from '../qa/report.mjs';

const fx=n=>readFileSync(new URL(`./fixtures/images/${n}`,import.meta.url));
const dataUrl=n=>`data:image/png;base64,${fx(n).toString('base64')}`;
const base=JSON.parse(readFileSync(new URL('./fixtures/contracts/image-valid.json',import.meta.url)));
// Fake OCR keyed by file size, fake detector keyed by what we pretend is in the picture.
const ocrFor=map=>async buf=>{const t=map[buf.length]??'';return {text:t,cleanText:t};};
const sizes=Object.fromEntries(['text-exact.png','text-typo.png','no-text.png'].map(n=>[fx(n).length,{'text-exact.png':'SUMMER SALE -50%','text-typo.png':'SUMMER SAIE -50%','no-text.png':''}[n]]));
const detectWith=scores=>async(path,labels)=>labels.filter(l=>scores[l]!==undefined).map(l=>({label:l,score:scores[l],box:{xmin:0,ymin:0,xmax:10,ymax:10}}));
const noLlm={generateJson:async()=>{throw new Error('LLM not expected');}};
async function run(result,{contract=parseImageContract(base),scores={bicycle:0.4}}={}){
 const workDir=mkdtempSync(join(tmpdir(),'qa-imgval-'));
 const v=await validateImages({job:{id:'j1',result},contract,workDir,ocrFn:ocrFor(sizes),detectFn:detectWith(scores),llm:noLlm,threshold:0.15});
 const report=buildReport({checks:v.checks,attempt:1,jobId:'j1',agentId:'a',deliverable:null});
 return {v,report,ids:s=>report.checks.filter(c=>c.status===s).map(c=>c.id)};
}

test('good image passes every check (format, width, exact text, object)',async()=>{
 const {report,v}=await run(`![poster](${dataUrl('text-exact.png')})`);
 assert.equal(report.verdict,'pass',renderReportMarkdown(report));
 assert.deepEqual(report.checks.map(c=>c.id),['images.count','technical.format','technical.width','text','objects.bicycle','integrity.hash']);
 assert.equal(v.images[0].ocrText,'SUMMER SALE -50%');
});
test('typo, missing object and no image give the expected failures and fixes',async()=>{
 const typo=await run(`![p](${dataUrl('text-typo.png')})`,{scores:{bicycle:0.05}});
 assert.deepEqual(typo.ids('fail'),['text','objects.bicycle']);
 const fixes=fixInstructions(typo.report);
 assert.match(fixes[0],/found "SUMMER SAIE -50%" \(1 character differs\)/);
 assert.match(fixes[1],/"bicycle" not detected \(best score 0\.05 < 0\.15\)/);
 const none=await run('Sorry, I could not create the image.');
 assert.deepEqual(none.ids('fail'),['images.count']);
 assert.match(fixInstructions(none.report)[0],/Deliver exactly 1 image/);
});
test('several images: every image is checked with an img<k> prefix; too many images fail the count',async()=>{
 const c=parseImageContract({...base,images:{min:1,max:2}});
 const {report,ids}=await run(`![a](${dataUrl('text-exact.png')}) ![b](${dataUrl('no-text.png')})`,{contract:c});
 assert.ok(report.checks.some(x=>x.id==='img1.text'&&x.status==='pass'));
 assert.ok(report.checks.some(x=>x.id==='img2.text'&&x.status==='fail'));
 const one=parseImageContract(base);
 assert.ok((await run(`![a](${dataUrl('text-exact.png')}) ![b](${dataUrl('no-text.png')})`,{contract:one})).ids('fail').includes('images.count'));
});
test('text mode none skips OCR; small image fails the width check',async()=>{
 const c=parseImageContract({...base,text:{mode:'none'},objects:[]});
 const {report}=await run(`![s](${dataUrl('small.png')})`,{contract:c});
 assert.deepEqual(report.checks.filter(x=>x.status==='fail').map(x=>[x.id,x.fix]),[['technical.width','Image is 200×100; minimum width is 800 px.']]);
});
