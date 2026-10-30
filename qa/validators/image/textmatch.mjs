/** NFKC; unify quotes and dashes; collapse whitespace; lowercase unless caseSensitive. */
export function normalise(s,{caseSensitive=true}={}){
 let t=String(s??'').normalize('NFKC')
  .replace(/[“”„‟″"]/g,'"').replace(/[‘’‚‛′']/g,"'")
  .replace(/[‐‑‒–—―−]/g,'-')
  .replace(/\s+/g,' ').trim();
 return caseSensitive?t:t.toLowerCase();
}

/**
 Minimum Levenshtein distance between `pattern` and any substring of `text` (Sellers' algorithm:
 row 0 is all zeros, the answer is the minimum of the last row). Returns the best-matching substring too.
*/
export function approxSubstring(pattern,text){
 const m=pattern.length,n=text.length;
 if(!m)return {distance:0,start:0,end:0,match:''};
 let prev=new Array(n+1).fill(0),prevStart=[...Array(n+1).keys()];
 for(let i=1;i<=m;i++){
  const cur=new Array(n+1),curStart=new Array(n+1);
  cur[0]=i;curStart[0]=0;
  for(let j=1;j<=n;j++){
   const sub=prev[j-1]+(pattern[i-1]===text[j-1]?0:1),del=prev[j]+1,ins=cur[j-1]+1;
   if(sub<=del&&sub<=ins){cur[j]=sub;curStart[j]=prevStart[j-1];}
   else if(del<=ins){cur[j]=del;curStart[j]=prevStart[j];}
   else{cur[j]=ins;curStart[j]=curStart[j-1];}
  }
  prev=cur;prevStart=curStart;
 }
 let end=0;for(let j=1;j<=n;j++)if(prev[j]<prev[end])end=j;
 return {distance:prev[end],start:prevStart[end],end,match:text.slice(prevStart[end],end)};
}

/** Exact-text check with OCR-noise tolerance: pass if distance / expected length <= maxEditRatio. */
export function matchExact({expected,ocrText,caseSensitive=true,maxEditRatio=0.05}){
 const e=normalise(expected,{caseSensitive}),t=normalise(ocrText,{caseSensitive});
 const best=approxSubstring(e,t);
 const ratio=e.length?best.distance/e.length:0;
 return {pass:ratio<=maxEditRatio,distance:best.distance,ratio,best:best.match,allowed:Math.floor(maxEditRatio*e.length+1e-9)};
}
