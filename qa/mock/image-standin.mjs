import {readFileSync} from 'node:fs';
import sharp from 'sharp';

/*
 Local stand-in image Agent (backend A, HANDOFF §4.6): Preprod has no affordable image Agent, so this composes
 the image offline from the prompt: free-licensed COCO photos for the requested objects plus rendered text.
 Like many image models it renders text sloppily: symbols (anything but letters, digits and spaces) are dropped
 unless the prompt says a previous attempt was rejected. That is what makes the retry loop demonstrable.
 Its photo library is the detector benchmark set (test/fixtures/images/detect, COCO val2017, CC licences).
*/
export const LIBRARY_DIR=new URL('../../test/fixtures/images/detect/',import.meta.url).pathname;
export function loadLibrary(dir=LIBRARY_DIR){
 const labels=JSON.parse(readFileSync(dir+'labels.json','utf8'));
 return Object.entries(labels).filter(([k])=>!k.startsWith('_')).map(([file,l])=>({path:dir+file,file,present:l.present,counts:l.counts??{}}));
}
export const libraryLabels=lib=>[...new Set(lib.flatMap(p=>p.present))].sort();

const REJECTED=/previous attempt was rejected/i;
// Quotes in the requirements are JSON-escaped (JSON.stringify in compactImageCriteria and the fix templates).
const unq=s=>{try{return JSON.parse(`"${s}"`);}catch{return s;}};
const esc=s=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

/** Read what to draw from the prompt (brief + "Hard requirements" line + fix instructions). */
export function readPrompt(prompt){
 const p=String(prompt);
 const fixText=/Text must read exactly "((?:[^"\\]|\\.)*)"/.exec(p)?.[1];
 const exact=/text exactly "((?:[^"\\]|\\.)*)"/.exec(p)?.[1]??/"([^"]{2,80})"/.exec(p)?.[1];
 const idea=/legible text that conveys: ([^;\n]+?)(?:;|\.?\n|\.$)/.exec(p)?.[1];
 const retry=REJECTED.test(p);
 let text=null;
 if(fixText!==undefined)text=unq(fixText);
 else if(exact!==undefined)text=unq(exact);
 else if(idea&&!/no text required/i.test(p))text=idea.trim().toUpperCase();
 if(text!==null&&!retry)text=text.replace(/[^\p{L}\p{N} ]+/gu,'').replace(/\s+/g,' ').trim();
 const visible=/clearly visible: ([^;\n]+?)(?:;|\.?\n|\.$)/.exec(p)?.[1];
 const objects=visible?visible.split(/,\s*/).map(s=>{const n=/^(\d+) (.+?)s?$/.exec(s.trim());return n?{label:n[2],minCount:+n[1]}:{label:s.trim().replace(/^an? /,''),minCount:1};}):[];
 const size=/at least (\d+)x(\d+) px/.exec(p);
 const minW=size?+size[1]:+(/at least (\d+) px wide/.exec(p)?.[1]??0);
 const minH=size?+size[2]:+(/at least (\d+) px high/.exec(p)?.[1]??0);
 const aspect=+(/aspect ratio (\d+(?:\.\d+)?)/.exec(p)?.[1]??0);
 const format=/Hard requirements[^]*?\b(png|jpeg|webp)\b/i.exec(p)?.[1]?.toLowerCase()??'png';
 return {text,objects,minW,minH,aspect,format,retry};
}

function textSvg(w,h,text){
 const words=text.split(' ');const lines=[];
 for(const word of words){const last=lines.at(-1);if(last&&(last+' '+word).length<=28)lines[lines.length-1]=last+' '+word;else lines.push(word);}
 const longest=Math.max(...lines.map(l=>l.length));
 const size=Math.max(24,Math.min(140,Math.floor(w*0.9/(longest*0.62)),Math.floor(h*0.8/(lines.length*1.25))));
 return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#ffffff"/>${
  lines.map((l,i)=>`<text x="50%" y="${Math.round(h/2+(i-(lines.length-1)/2)*size*1.25+size*0.35)}" text-anchor="middle" font-family="Arial, Helvetica, DejaVu Sans, sans-serif" font-weight="bold" font-size="${size}" fill="#111111">${esc(l)}</text>`).join('')}</svg>`;
}

/** Compose one image. Returns {buffer, format, width, height, text, photos:[{label,file}], missing:[label]}. */
export async function renderStandinImage(prompt,{library=loadLibrary()}={}){
 const want=readPrompt(prompt);
 const W=Math.max(1200,want.minW);
 const H=want.aspect?Math.round(W/want.aspect):Math.max(800,want.minH);
 const photos=[],missing=[];
 for(const o of want.objects){
  const p=library.find(x=>x.present.includes(o.label)&&(x.counts[o.label]??1)>=o.minCount&&!photos.some(u=>u.file===x.file))
   ??library.find(x=>x.present.includes(o.label)&&(x.counts[o.label]??1)>=o.minCount);
  if(!p){missing.push(o.label);continue;}
  if(!photos.some(u=>u.file===p.file))photos.push({label:o.label,file:p.file,path:p.path});
 }
 const band=want.text?Math.round(H*(photos.length?0.3:1)):0;
 const layers=[];
 if(photos.length){
  const cellW=Math.floor(W/photos.length),cellH=H-band;
  for(const [i,ph] of photos.entries())
   layers.push({input:await sharp(ph.path).resize({width:cellW,height:cellH,fit:'contain',background:'#ffffff'}).toBuffer(),left:i*cellW,top:0});
 }
 if(want.text)layers.push({input:Buffer.from(textSvg(W,band,want.text)),left:0,top:H-band});
 const buffer=await sharp({create:{width:W,height:H,channels:3,background:'#ffffff'}}).composite(layers).toFormat(want.format).toBuffer();
 return {buffer,format:want.format,width:W,height:H,text:want.text,photos:photos.map(({label,file})=>({label,file})),missing};
}
