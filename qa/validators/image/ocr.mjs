import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import sharp from 'sharp';
import {createWorker} from 'tesseract.js';

// tesseract.js caches <lang>.traineddata in the working directory by default; keep it out of the repo root.
const CACHE=join('.local','tesseract');
let workerPromise,workerLang;

/** One OCR worker per process (the first call downloads the language data from jsDelivr). */
export function getOcrWorker(lang='eng'){
 if(workerPromise&&workerLang!==lang)throw new Error(`OCR worker already started for ${workerLang}`);
 if(!workerPromise){mkdirSync(CACHE,{recursive:true,mode:0o700});workerLang=lang;workerPromise=createWorker(lang,1,{cachePath:CACHE});}
 return workerPromise;
}
export async function terminateOcr(){
 if(!workerPromise)return;
 const w=await workerPromise;workerPromise=undefined;await w.terminate();
}

/** Upscale small images to width 1000, grayscale, normalise: tesseract reads large high-contrast text best. */
export async function preprocess(buf){
 const meta=await sharp(buf).metadata();
 let img=sharp(buf).flatten({background:'#ffffff'});
 if(meta.width<1000)img=img.resize({width:1000});
 return img.grayscale().normalise().png().toBuffer();
}

/** OCR one image. cleanText keeps only words with confidence >= minWordConfidence; text is the raw output. */
export async function ocr(buf,{lang='eng',minWordConfidence=40}={}){
 const worker=await getOcrWorker(lang);
 const {data}=await worker.recognize(await preprocess(buf),{},{text:true,blocks:true});
 const lines=[];
 for(const b of data.blocks??[])for(const p of b.paragraphs??[])for(const l of p.lines??[])
  lines.push((l.words??[]).map(w=>({text:w.text,confidence:w.confidence})));
 const words=lines.flat();
 const cleanText=lines.map(l=>l.filter(w=>w.confidence>=minWordConfidence).map(w=>w.text).join(' ')).filter(Boolean).join('\n');
 return {text:String(data.text??'').trim(),confidence:data.confidence,cleanText,words};
}
