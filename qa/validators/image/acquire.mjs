import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import sharp from 'sharp';
import {download,sha256} from '../../extract.mjs';

const IMG_EXT=/\.(png|jpe?g|webp)(?:[?#]|$)/i;
const RASTER=new Set(['png','jpeg','webp','gif','tiff','avif','heif']);
const fileName=f=>f?.name??f?.fileName??f?.filename??f?.originalName??'';
const fileUrl=f=>f?.url??f?.signedUrl??f?.downloadUrl??f?.href??null;
const fileMime=f=>String(f?.mimeType??f?.contentType??f?.type??'').toLowerCase();

/** Where images may be in a finished Job, in priority order: files, markdown images, plain image URLs, links. */
export function imageCandidates({job,files=[],links=[]}){
 const out=[];
 const add=(url,origin,name)=>{if(url&&!out.some(c=>c.url===url))out.push({url,origin,name:name||undefined});};
 for(const f of files)if(/^image\//.test(fileMime(f))||IMG_EXT.test(fileName(f)))add(fileUrl(f),'file',fileName(f));
 const result=String(job?.result??'');
 for(const m of result.matchAll(/!\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g))add(m[1],'result-markdown');
 for(const m of result.matchAll(/\bhttps?:\/\/[^\s)<>"']+/g))if(IMG_EXT.test(m[0]))add(m[0],'result-url');
 for(const l of links){const url=l?.url??l?.href;if(url&&IMG_EXT.test(new URL(url,'https://x').pathname))add(url,'link',l?.title);}
 return out;
}

async function fetchBytes(url,{fetchImpl,maxBytes}){
 const data=/^data:image\/[a-z+.-]+;base64,(.+)$/i.exec(url);
 if(data){const buf=Buffer.from(data[1],'base64');if(buf.length>maxBytes)throw new Error(`image too large: ${buf.length} bytes`);return buf;}
 if(!/^https?:\/\//i.test(url))throw new Error('unsupported URL scheme');
 return (await download(url,{fetchImpl,maxBytes})).buf;
}

/**
 Download every candidate image, detect the real format with sharp (the declared MIME type is ignored),
 and save valid ones as ${workDir}/img-<k>.<ext>. Returns {images, rejected}.
*/
export async function acquireImages({job,files,links,workDir,fetchImpl=fetch,maxBytes=25*1024*1024,maxImages=10}){
 const images=[],rejected=[];
 for(const c of imageCandidates({job,files,links})){
  if(images.length>=maxImages){rejected.push({...c,url:short(c.url),reason:`more than ${maxImages} images`});continue;}
  try{
   const buf=await fetchBytes(c.url,{fetchImpl,maxBytes});
   let meta;
   try{meta=await sharp(buf).metadata();}catch{throw new Error('not an image');}
   if(!RASTER.has(meta.format))throw new Error(`unsupported image format ${meta.format}`);
   const k=images.length+1,ext=meta.format==='jpeg'?'jpg':meta.format;
   const path=join(workDir,`img-${k}.${ext}`);
   writeFileSync(path,buf,{mode:0o600});
   images.push({k,path,url:short(c.url),origin:c.origin,name:c.name,format:meta.format,width:meta.width,height:meta.height,bytes:buf.length,sha256:sha256(buf)});
  }catch(e){rejected.push({...c,url:short(c.url),reason:String(e.message).slice(0,200)});}
 }
 return {images,rejected};
}
// Signed URLs carry tokens in the query string; reports keep only origin + path.
function short(url){
 if(url.startsWith('data:'))return `${url.slice(0,url.indexOf(','))},…`;
 try{const u=new URL(url);return `${u.origin}${u.pathname}`;}catch{return url.slice(0,200);}
}
