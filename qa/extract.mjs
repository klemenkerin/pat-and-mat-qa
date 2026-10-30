import {createHash} from 'node:crypto';
import {parse as parseCsv} from 'csv-parse/sync';

export const sha256=s=>createHash('sha256').update(s).digest('hex');
const FENCE=/```([A-Za-z0-9_+-]*)[ \t]*\r?\n([\s\S]*?)```/g;
const fileName=f=>f?.name??f?.fileName??f?.filename??f?.originalName??'';
const fileUrl=f=>f?.url??f?.signedUrl??f?.downloadUrl??f?.href??null;
const fileMime=f=>String(f?.mimeType??f?.contentType??f?.type??'').toLowerCase();

export function fencedBlocks(text){return [...String(text??'').matchAll(FENCE)].map(m=>({lang:m[1].toLowerCase(),body:m[2]}));}

/** True when `text` parses as the requested format (cheap sanity check, not validation). */
export function looksLike(format,text,delimiter=',',{header=true,fieldNames=[]}={}){
 const t=String(text??'').replace(/^\uFEFF/,'').trim();
 if(!t)return false;
 if(format==='json'){try{const v=JSON.parse(t);return typeof v==='object'&&v!==null;}catch{return false;}}
 try{
  const rows=parseCsv(t,{delimiter,skip_empty_lines:true,relax_column_count:false,bom:true});
  if(rows.length<2||rows[0].length<2)return false;
  if(header&&fieldNames.length){const h=new Set(rows[0].map(x=>x.trim().toLowerCase()));return fieldNames.some(n=>h.has(n.toLowerCase()));}
  return true;
 }catch{return false;}
}

export async function download(url,{fetchImpl=fetch,maxBytes=20*1024*1024,timeoutMs=30000}={}){
 const res=await fetchImpl(url,{redirect:'follow',signal:AbortSignal.timeout(timeoutMs)});
 if(!res.ok)throw new Error(`download failed: HTTP ${res.status}`);
 const len=Number(res.headers?.get?.('content-length')??0);
 if(len>maxBytes)throw new Error(`download too large: ${len} bytes`);
 const buf=Buffer.from(await res.arrayBuffer());
 if(buf.length>maxBytes)throw new Error(`download too large: ${buf.length} bytes`);
 return {buf,contentType:String(res.headers?.get?.('content-type')??'')};
}

/**
 Find the structured deliverable in a finished Job.
 Order for source=auto: matching file → fenced block in result → whole result → link.
 Returns {kind, text, origin, name?, sha256, wrapped} or {kind:'unknown', tried:[...]}.
*/
export async function extractStructured({job,files=[],links=[],contract,fetchImpl=fetch}){
 const format=contract.output.format;
 const delimiter=contract.output.csv?.delimiter??',';
 const hint={header:contract.output.csv?.header??true,fieldNames:contract.fields.map(f=>f.name)};
 const ext=format==='csv'?/\.(csv|tsv|txt)$/i:/\.json$/i;
 const mime=format==='csv'?/csv|tab-separated|text\/plain/:/json/;
 const src=contract.output.source??'auto';
 const tried=[];
 const done=(text,origin,extra={})=>{const t=String(text).replace(/^\uFEFF/,'');return {kind:format,text:t,origin,sha256:sha256(t),...extra};};

 if(src==='auto'||src==='file'){
  for(const f of files){
   if(!(ext.test(fileName(f))||mime.test(fileMime(f))))continue;
   const url=fileUrl(f);if(!url){tried.push(`file ${fileName(f)}: no url`);continue;}
   try{const {buf}=await download(url,{fetchImpl});const text=buf.toString('utf8');
    if(looksLike(format,text,delimiter,hint))return done(text,'file',{name:fileName(f),wrapped:false});
    tried.push(`file ${fileName(f)}: not ${format}`);}
   catch(e){tried.push(`file ${fileName(f)}: ${e.message}`);}
  }
 }
 if(src==='auto'||src==='result'){
  const result=String(job?.result??'');
  const blocks=fencedBlocks(result);
  const preferred=blocks.filter(b=>b.lang===format||(format==='csv'&&b.lang==='tsv'));
  for(const b of [...preferred,...blocks.filter(b=>!preferred.includes(b))]){
   if(looksLike(format,b.body,delimiter,hint))return done(b.body.trim()+(format==='csv'?'\n':''),'result-fence',{wrapped:result.trim()!==`\`\`\`${b.lang}\n${b.body}\`\`\``.trim()});
  }
  if(looksLike(format,result,delimiter,hint))return done(result.trim()+(format==='csv'?'\n':''),'result-raw',{wrapped:false});
  if(result)tried.push('result: no parseable '+format);
 }
 if(src==='auto'){
  for(const l of links){
   const url=l?.url??l?.href;if(!url||!ext.test(new URL(url,'https://x').pathname))continue;
   try{const {buf}=await download(url,{fetchImpl});const text=buf.toString('utf8');if(looksLike(format,text,delimiter,hint))return done(text,'link',{name:url,wrapped:false});tried.push(`link ${url}: not ${format}`);}
   catch(e){tried.push(`link ${url}: ${e.message}`);}
  }
 }
 return {kind:'unknown',tried};
}
