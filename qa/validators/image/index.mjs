import {readFileSync} from 'node:fs';
import {acquireImages} from './acquire.mjs';
import {technicalChecks} from './metadata.mjs';
import {checkText} from './text.mjs';
import {objectChecks} from './objects.mjs';
import {hashCheck} from '../structured/index.mjs';

/**
 Run the image checks (plan Step 4.7), cheapest first: images.count, technical.*, text, objects.<label>, integrity.hash.
 MVP rule: every image must pass every check. When the contract allows several images, check ids get an `img<k>.` prefix
 per slot k = 1..images.max; a slot without an image reports its checks as skip, so N is the same on every attempt.
 ocrFn(buffer) -> {text, cleanText}; detectFn(path, labels) -> [{label, score, box}] (low threshold; objectChecks applies ours).
*/
export async function validateImages({job,files,links,contract,workDir,ocrFn,detectFn,llm,threshold,fetchImpl=fetch}){
 const {images,rejected}=await acquireImages({job,files,links,workDir,fetchImpl});
 const {min,max}=contract.images;
 const countOk=images.length>=min&&images.length<=max;
 const checks=[{id:'images.count',criterion:'Number of images',status:countOk?'pass':'fail',expected:min===max?`${min}`:`${min}–${max}`,observed:`${images.length}`,
  evidence:rejected.slice(0,5).map(r=>`rejected ${r.url}: ${r.reason}`),
  ...(countOk?{}:{fix:images.length<min?`Deliver ${min===max?'exactly':'at least'} ${min} image${min>1?'s':''} as PNG/JPEG/WebP files or image links (found ${images.length}${rejected.length?`; ${rejected.length} link(s) were not valid images`:''}).`:`Deliver at most ${max} image${max>1?'s':''} (found ${images.length}).`})}];
 const perImage=[];
 const labels=contract.objects.map(o=>o.label);
 const t=contract.detector?.threshold??threshold;
 // One slot per allowed image, so every attempt reports the same checks; extra images only fail images.count.
 const slots=Math.max(1,max);
 for(let k=1;k<=slots;k++){
  const img=images[k-1];
  const prefix=slots>1?`img${k}.`:'';
  if(!img){checks.push(...plannedForMissing(contract,t,prefix,k));continue;}
  checks.push(...technicalChecks(img,contract.technical,prefix));
  const ocrResult=contract.text.mode==='none'?{text:'',cleanText:''}:await ocrFn(readFileSync(img.path));
  checks.push(await checkText({ocrResult,text:contract.text,llm,id:`${prefix}text`}));
  const detections=labels.length?await detectFn(img.path,labels):[];
  checks.push(...objectChecks(detections,contract.objects,t,prefix));
  perImage.push({...img,ocrText:ocrResult.text,detections:detections.filter(d=>d.score>=t).map(d=>({label:d.label,score:+d.score.toFixed(3),box:d.box}))});
 }
 checks.push(hashCheck(job));
 return {checks,images:perImage,rejected};
}

/** The per-image checks of slot k, as skip (no image delivered for it). */
function plannedForMissing(contract,threshold,prefix,k){
 const skip=c=>({id:c.id,criterion:c.criterion,status:'skip',expected:c.expected,observed:`no image ${k}`,evidence:[]});
 const probe={format:'',width:0,height:0,bytes:0};
 return [...technicalChecks(probe,contract.technical,prefix).map(skip),
  skip({id:`${prefix}text`,criterion:'Text',expected:contract.text.mode==='none'?'no requirement':JSON.stringify(contract.text.expected??'')}),
  ...objectChecks([],contract.objects,threshold,prefix).map(skip)];
}
