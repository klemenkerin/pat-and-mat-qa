// Step 4.6 benchmark: which detector and threshold separate present from absent labels on the labelled photos.
// Usage: npm run bench:detector   (writes .local/bench-detector.json; results go into docs/detector-choice.md)
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {cpus,totalmem} from 'node:os';
import {getDetector,detect} from '../qa/validators/image/detector.mjs';

const dir=new URL('../test/fixtures/images/detect/',import.meta.url).pathname;
const {_source,...labels}=JSON.parse(readFileSync(dir+'labels.json','utf8'));
const MODELS=[['onnx-community/grounding-dino-tiny-ONNX','q8'],['Xenova/owlv2-base-patch16','q8']];
const results=[];
for(const [model,dtype] of MODELS){
 let t=Date.now();await getDetector(model,dtype);const loadMs=Date.now()-t;
 await detect(dir+Object.keys(labels)[0],['cat'],{model,dtype,threshold:0.01});   // warm-up
 const rows=[],lat=[];
 for(const [img,{present,absent}] of Object.entries(labels)){
  t=Date.now();const d=await detect(dir+img,[...present,...absent],{model,dtype,threshold:0.01});lat.push(Date.now()-t);
  const max=l=>Math.max(0,...d.filter(x=>x.label===l).map(x=>x.score));
  for(const l of present)rows.push({img,label:l,present:true,score:max(l)});
  for(const l of absent)rows.push({img,label:l,present:false,score:max(l)});
 }
 let best={t:0,acc:0};
 for(let t=0.01;t<0.95;t+=0.01){const acc=rows.filter(r=>(r.score>=t)===r.present).length/rows.length;if(acc>best.acc+1e-9)best={t:+t.toFixed(2),acc};}
 const wrong=rows.filter(r=>(r.score>=best.t)!==r.present);
 const r={model,dtype,loadMs,warmMsPerImage:Math.round(lat.reduce((a,b)=>a+b,0)/lat.length),maxMsPerImage:Math.max(...lat),threshold:best.t,accuracy:best.acc,n:rows.length,wrong,rows};
 results.push(r);
 console.log(`${model} (${dtype}): load ${loadMs} ms, warm ${r.warmMsPerImage} ms/image (max ${r.maxMsPerImage}), best threshold ${best.t} → accuracy ${(best.acc*100).toFixed(1)}% of ${rows.length}`);
 for(const w of wrong)console.log(`   wrong: ${w.img} ${w.present?'present':'absent'} "${w.label}" score ${w.score.toFixed(3)}`);
}
mkdirSync('.local',{recursive:true});
writeFileSync('.local/bench-detector.json',JSON.stringify({at:new Date().toISOString(),hardware:{cpu:cpus()[0]?.model,cores:cpus().length,ramGB:Math.round(totalmem()/2**30)},results},null,1));
console.log('rss MB',Math.round(process.memoryUsage().rss/1e6),'→ .local/bench-detector.json');
