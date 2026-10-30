const area=b=>Math.max(0,b.xmax-b.xmin)*Math.max(0,b.ymax-b.ymin);
export function iou(a,b){
 const i=area({xmin:Math.max(a.xmin,b.xmin),ymin:Math.max(a.ymin,b.ymin),xmax:Math.min(a.xmax,b.xmax),ymax:Math.min(a.ymax,b.ymax)});
 const u=area(a)+area(b)-i;return u?i/u:0;
}
/** Detections of one label at or above threshold, overlapping boxes (IoU > 0.5) merged, best first. */
export function instances(detections,label,threshold){
 const kept=[];
 for(const d of detections.filter(d=>d.label===label&&d.score>=threshold).sort((a,b)=>b.score-a.score))
  if(!kept.some(k=>iou(k.box,d.box)>0.5))kept.push(d);
 return kept;
}
/** One check per contract object: pass if at least minCount instances are detected. */
export function objectChecks(detections,objects,threshold,prefix=''){
 return objects.map(o=>{
  const found=instances(detections,o.label,threshold);
  const top=detections.filter(d=>d.label===o.label).map(d=>d.score).sort((a,b)=>b-a).slice(0,3);
  const best=top[0]??0;
  const ok=found.length>=o.minCount;
  const fix=found.length?`Required ${o.minCount} × "${o.label}"; only ${found.length} detected. Show ${o.minCount} clearly visible, separate ${o.label}s.`
   :`Required object "${o.label}" not detected (best score ${best.toFixed(2)} < ${threshold.toFixed(2)}). Make the ${o.label} clearly visible.`;
  return {id:`${prefix}objects.${o.label.replace(/\s+/g,'-')}`,criterion:`Shows ${o.minCount>1?`at least ${o.minCount} × `:''}${o.label}`,status:ok?'pass':'fail',
   expected:`≥ ${o.minCount} with score ≥ ${threshold.toFixed(2)}`,observed:`${found.length} detected (top scores ${top.map(s=>s.toFixed(2)).join(', ')||'none'})`,evidence:[],...(ok?{}:{fix})};
 });
}
