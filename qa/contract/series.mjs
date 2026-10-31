/*
 Panel / time-series contracts: one row per (time key × entity) over N periods.
 Derived in code from the brief and the drafted fields, never by the LLM: Task 01a18ea9 (2026-10-30) passed a
 60-row CSV with FTSE100 weekend rows (forward-filled) and missing DAX/CAC40 dates, because only the row count
 was checked. The series block adds the coverage, trading-day and stale-value checks.
*/

// "last 20 trading days", "past 30 days", "20 business days", "10 weekdays", "5 trading sessions"
const PERIODS=/\b(\d{1,4})\s+(?:(trading|business|calendar|consecutive|working)\s+)?(days?|dates|weekdays|sessions)\b/gi;
const WEEKDAY_WORDS=/\b(trading|business|working)\s+(days?|sessions)\b|\bweekdays\b/i;
const squash=s=>String(s).toLowerCase().replace(/[\s_-]+/g,'');

/** The last period phrase in `text` (a revision comment comes after the brief, so it wins). */
export function briefPeriods(text){
 const all=[...String(text).matchAll(PERIODS)];
 if(!all.length)return undefined;
 const m=all.at(-1);
 const kind=(m[2]??'').toLowerCase(),unit=m[3].toLowerCase();
 const weekdays=['trading','business','working'].includes(kind)||unit==='weekdays'||unit==='sessions'||WEEKDAY_WORDS.test(text);
 const periodName=kind==='trading'||unit==='sessions'?'trading day':kind==='business'||kind==='working'?'business day':unit==='weekdays'?'weekday':'day';
 return {periods:Number(m[1]),calendar:weekdays?'weekdays':'any',periodName};
}

/**
 Series block for a structured contract, or undefined when the brief does not describe a panel/time series.
 Needs: exactly one date field, a period count in the text, and (for panels) an enum entity field that is either
 in the unique key with the date, consistent with the row count, or whose values the brief names.
*/
export function deriveSeries(contract,text){
 const p=briefPeriods(text);
 if(!p)return undefined;
 const dates=contract.fields.filter(f=>f.type==='date');
 if(dates.length!==1)return undefined;
 const time=dates[0].name;
 const exact=contract.records?.exact;
 const keyed=(contract.unique??[]).find(k=>k.includes(time));
 const enums=contract.fields.filter(f=>f.type==='enum'&&f.required!==false&&f.name!==time);
 let entity;
 if(keyed?.length===2)entity=enums.find(f=>f.name===keyed.find(n=>n!==time));
 else if(!keyed&&enums.length===1){
  const e=enums[0];
  const named=e.enum.every(v=>squash(text).includes(squash(v)));
  if(exact===p.periods*e.enum.length||named)entity=e;
 }
 if(!entity){
  // Single series: one row per date.
  const single=(keyed?.length===1)||exact===p.periods||(!keyed&&!enums.length);
  if(!single)return undefined;
 }
 const valueFields=contract.fields.filter(f=>['number','integer'].includes(f.type)&&f.name!==time).map(f=>f.name);
 return {timeField:time,...(entity?{entityField:entity.name,entities:[...entity.enum]}:{}),periods:p.periods,periodName:p.periodName,calendar:p.calendar,valueFields};
}

/** Add (or refresh) contract.series from `text`; fills a missing row count and notes an inconsistent one. */
export function applySeries(contract,text){
 const c=structuredClone(contract);
 const s=deriveSeries(c,text);
 if(!s){delete c.series;return c;}
 c.series=s;
 const rows=s.periods*(s.entities?.length??1);
 if(!c.records)c.records={exact:rows};
 else if(c.records.exact!==undefined&&c.records.exact!==rows){
  const note=`The brief's ${s.periods} ${s.periodName}s × ${s.entities?.length??1} give ${rows} rows, but the row count is ${c.records.exact}; both are checked.`;
  if(!(c.notes??'').includes(note))c.notes=[c.notes,note].filter(Boolean).join(' ');
 }
 return c;
}

const plural=w=>/(s|x|ch|sh)$/.test(w)?`${w}es`:/[^aeiou]y$/.test(w)?`${w.slice(0,-1)}ies`:`${w}s`;
/** The series rule in plain words (contract criteria, the service brief and rebriefs use this sentence). */
export function seriesConstraint(s){
 const n=s.periods,e=s.entities?.length??1;
 const wd=s.calendar==='weekdays'?'weekday ':'';
 const grid=s.entityField
  ?`Exactly one row per ${s.entityField} per ${s.periodName}: ${n} distinct ${wd}dates x ${e} ${s.entityField} values (${s.entities.join(', ')}) = ${n*e} rows.`
  :`Exactly one row per ${s.periodName}: ${n} distinct ${wd}dates = ${n} rows.`;
 const weekend=s.calendar==='weekdays'?' No weekend dates.':'';
 const fill=s.entityField?`use the most recent ${n} ${plural(s.periodName)} on which all ${e} have data`:`use the most recent ${n} ${plural(s.periodName)} with data`;
 return `${grid}${weekend} Do not forward-fill missing days; ${fill}.`;
}
