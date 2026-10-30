const kb=b=>`${Math.round(b/1024)} KB`;

/** Technical checks for one image ({format,width,height,bytes} from acquire) against contract.technical. */
export function technicalChecks(img,technical={},prefix=''){
 const checks=[];
 const add=(id,criterion,ok,expected,observed,fix)=>checks.push({id:`${prefix}${id}`,criterion,status:ok?'pass':'fail',expected,observed,evidence:[],...(ok?{}:{fix})});
 const t=technical??{};
 if(t.formats)add('technical.format','Image format',t.formats.includes(img.format),t.formats.join(' or '),img.format,`Deliver the image as ${t.formats.map(f=>f.toUpperCase()).join(' or ')} (got ${String(img.format).toUpperCase()}).`);
 if(t.minWidth)add('technical.width','Minimum width',img.width>=t.minWidth,`≥ ${t.minWidth} px`,`${img.width} px`,`Image is ${img.width}×${img.height}; minimum width is ${t.minWidth} px.`);
 if(t.minHeight)add('technical.height','Minimum height',img.height>=t.minHeight,`≥ ${t.minHeight} px`,`${img.height} px`,`Image is ${img.width}×${img.height}; minimum height is ${t.minHeight} px.`);
 if(t.maxBytes)add('technical.bytes','Maximum file size',img.bytes<=t.maxBytes,`≤ ${kb(t.maxBytes)}`,kb(img.bytes),`Image is ${kb(img.bytes)}; maximum is ${kb(t.maxBytes)}.`);
 if(t.aspectRatio){
  const r=img.width/img.height,{value,tolerance=0.02}=t.aspectRatio;
  add('technical.aspect','Aspect ratio',Math.abs(r-value)<=tolerance,`${value} ± ${tolerance}`,r.toFixed(3),`Aspect ratio is ${r.toFixed(3)} (${img.width}×${img.height}); required ${value} ± ${tolerance}.`);
 }
 return checks;
}
