const q=v=>`\`${v}\``;
function fieldLine(f){
 const parts=[`${q(f.name)}: ${f.type}`];
 if(f.format)parts.push(`format ${q(f.format)}`);
 if(f.enum)parts.push(`one of ${f.enum.map(q).join(', ')}`);
 if(f.min!==undefined)parts.push(`≥ ${f.min}`);
 if(f.max!==undefined)parts.push(`≤ ${f.max}`);
 if(f.pattern)parts.push(`matches ${q(f.pattern)}`);
 parts.push(f.required?(f.maxNullRate>0?`at most ${Math.round(f.maxNullRate*100)}% empty`:'never empty'):'optional');
 return parts.join(', ');
}
/** Numbered acceptance criteria for a structured contract. Stable order (used in comments and rebriefs). */
export function structuredCriteria(c){
 const out=[];
 const fmt=c.output.format.toUpperCase();
 if(c.output.format==='csv'){const d=c.output.csv?.delimiter??',';out.push(`Deliver ${fmt} data with delimiter ${q(d==='\t'?'\\t':d)}${(c.output.csv?.header??true)?' and a header row':' without a header row'}.`);}
 else out.push(`Deliver valid JSON${c.output.json?.recordsPath?` with the records array at ${q(c.output.json.recordsPath)}`:c.output.json?.root==='object'?' (an object)':' (an array of records)'}.`);
 const r=c.records;
 if(r?.exact!==undefined)out.push(`Exactly ${r.exact} records.`);
 else if(r?.min!==undefined&&r?.max!==undefined)out.push(`Between ${r.min} and ${r.max} records.`);
 else if(r?.min!==undefined)out.push(`At least ${r.min} records.`);
 else if(r?.max!==undefined)out.push(`At most ${r.max} records.`);
 out.push(`${c.allowExtraFields?'Fields (extra fields allowed)':'Exactly these fields, no others'}:`);
 for(const f of c.fields)out.push(`  - ${fieldLine(f)}`);
 for(const key of c.unique??[])out.push(`No duplicate ${key.length>1?'combinations of ':''}${key.map(q).join(' + ')}.`);
 return out;
}
/** One-paragraph criteria for the service Agent's input, where space is limited. Same requirements as structuredCriteria. */
export function compactCriteria(c){
 const parts=[];
 const unit=c.output.format==='csv'?'rows':'records';
 if(c.output.format==='csv'){const d=c.output.csv?.delimiter??',';parts.push(`CSV, delimiter ${d==='\t'?'tab':`"${d}"`}, ${(c.output.csv?.header??true)?'with header row':'no header row'}`);}
 else parts.push(`valid JSON${c.output.json?.recordsPath?`, records array at ${c.output.json.recordsPath}`:c.output.json?.root==='object'?' object':' array of records'}`);
 const r=c.records;
 if(r?.exact!==undefined)parts.push(`exactly ${r.exact} ${unit}`);
 else if(r?.min!==undefined&&r?.max!==undefined)parts.push(`${r.min} to ${r.max} ${unit}`);
 else if(r?.min!==undefined)parts.push(`at least ${r.min} ${unit}`);
 else if(r?.max!==undefined)parts.push(`at most ${r.max} ${unit}`);
 const field=f=>{
  const x=[f.type];
  if(f.format)x.push(f.format);
  if(f.enum)x.push(`one of ${f.enum.join(', ')}`);
  if(f.min!==undefined)x.push(`>= ${f.min}`);
  if(f.max!==undefined)x.push(`<= ${f.max}`);
  if(f.pattern)x.push(`matches /${f.pattern}/`);
  if(!f.required)x.push('optional');else if(f.maxNullRate>0)x.push(`max ${Math.round(f.maxNullRate*100)}% empty`);
  return `${f.name} (${x.join(', ')})`;
 };
 parts.push(`${c.allowExtraFields?'columns':'only columns'}: ${c.fields.map(field).join('; ')}`);
 if(c.fields.some(f=>f.required&&!(f.maxNullRate>0)))parts.push('no empty values except where marked');
 for(const key of c.unique??[])parts.push(`${key.join(' + ')} unique`);
 return `${parts.join('; ')}.`;
}
export function renderCriteria(lines){let n=0;return lines.map(l=>l.startsWith('  - ')?`   ${l.trim()}`:`${++n}. ${l}`).join('\n');}
export function renderStructuredContract(c){
 const notes=c.notes?`\n\nAssumptions: ${c.notes}`:'';
 return `**Deliverable:** ${c.brief}\n\n**Acceptance criteria**\n${renderCriteria(structuredCriteria(c))}${notes}`;
}
