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
 if(!workerPromise){
  mkdirSync(CACHE,{recursive:true,mode:0o700});workerLang=lang;
  // tesseract.js defaults to PSM 6 (one uniform text block): next to a photo it reads only noise (seen on stand-in posters).
  // PSM 3 (automatic page segmentation) finds the text block; our PNGs carry no usable DPI, so state one.
  workerPromise=createWorker(lang,1,{cachePath:CACHE}).then(async w=>{await w.setParameters({tessedit_pageseg_mode:'3',user_defined_dpi:'300'});return w;});
 }
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

/**
 Put line fragments back in reading order: PSM 3 can split one visual line into blocks ("-50%" before "CAT TOYS"),
 so fragments whose vertical centre lies inside another row join that row, rows go top to bottom, words left to right.
*/
export function readingOrder(lines){
 const rows=[];
 for(const l of [...lines].sort((a,b)=>a.bbox.y0-b.bbox.y0)){
  const mid=(l.bbox.y0+l.bbox.y1)/2;
  const row=rows.find(r=>mid>=r.y0&&mid<=r.y1);
  if(row){row.words.push(...l.words);row.y0=Math.min(row.y0,l.bbox.y0);row.y1=Math.max(row.y1,l.bbox.y1);}
  else rows.push({y0:l.bbox.y0,y1:l.bbox.y1,words:[...l.words]});
 }
 return rows.map(r=>r.words.sort((a,b)=>a.bbox.x0-b.bbox.x0));
}

/** OCR one image. cleanText keeps only words with confidence >= minWordConfidence, in reading order; text is the raw output. */
export async function ocr(buf,{lang='eng',minWordConfidence=40}={}){
 const worker=await getOcrWorker(lang);
 const {data}=await worker.recognize(await preprocess(buf),{},{text:true,blocks:true});
 const lines=[];
 for(const b of data.blocks??[])for(const p of b.paragraphs??[])for(const l of p.lines??[])
  lines.push({bbox:l.bbox,words:(l.words??[]).map(w=>({text:w.text,confidence:w.confidence,bbox:w.bbox}))});
 const rows=readingOrder(lines);
 const words=rows.flat().map(({text,confidence})=>({text,confidence}));
 const cleanText=rows.map(r=>r.filter(w=>w.confidence>=minWordConfidence).map(w=>w.text).join(' ')).filter(Boolean).join('\n');
 return {text:String(data.text??'').trim(),confidence:data.confidence,cleanText,words};
}
