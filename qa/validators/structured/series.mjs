import {DateTime} from 'luxon';

/*
 Coverage checks for panel / time-series contracts (contract.series, see qa/contract/series.mjs):
 coverage.grid (fail), dates.trading_days (fail, weekday calendars only), values.stale (warn).
*/

/**
 Which dates a calendar accepts. Add exchange calendars here later, e.g.
 xetra:{label:'Xetra trading days',isOpen:dt=>dt.weekday<=5&&!XETRA_HOLIDAYS.has(dt.toISODate())}
 and select them with contract.series.calendar.
*/
export const CALENDARS={
 any:{label:'any date',isOpen:()=>true},
 weekdays:{label:'Monday to Friday',isOpen:dt=>dt.weekday<=5},
};

const parseDate=(v,format)=>{
 const s=String(v??'').trim();
 const dt=format==='ISO'?DateTime.fromISO(s,{zone:'utc'}):DateTime.fromFormat(s,format,{zone:'utc'});
 return dt.isValid?dt:null;
};
const listed=(items,n=5)=>`${items.slice(0,n).join(', ')}${items.length>n?` (+${items.length-n} more)`:''}`;
const check=(id,criterion,status,expected,observed,evidence=[],fix)=>({id,criterion,status,expected:String(expected),observed:String(observed),evidence:evidence.slice(0,5),...(fix?{fix}:{})});

/** Ids and criteria of the series checks a contract produces (constant per contract). */
export function plannedSeriesChecks(contract){
 const s=contract.series;
 if(!s)return [];
 const out=[{id:'coverage.grid',criterion:s.entityField?`One row per ${s.entityField} per ${s.periodName}`:`One row per ${s.periodName}`}];
 if(s.calendar!=='any')out.push({id:'dates.trading_days',criterion:`Only ${CALENDARS[s.calendar].label} dates`});
 if(s.valueFields.length)out.push({id:'values.stale',criterion:'No value repeated on consecutive dates (forward-fill)'});
 return out;
}

export function seriesChecks({records,contract}){
 const s=contract.series;
 if(!s)return [];
 const fmt=contract.fields.find(f=>f.name===s.timeField)?.format??'ISO';
 const entities=s.entities??[''];
 const entityOf=r=>s.entityField?String(r[s.entityField]??'').trim():'';
 const n=s.periods,e=entities.length;
 const unit=s.entityField?`(date, ${s.entityField})`:'date';
 // Rows with a valid date; invalid dates already fail field.<time>.values.
 const rows=records.map(r=>({r,dt:parseDate(r[s.timeField],fmt),entity:entityOf(r)})).filter(x=>x.dt);
 const byDate=new Map();
 for(const x of rows){const d=x.dt.toISODate();if(!byDate.has(d))byDate.set(d,{dt:x.dt,counts:new Map()});const c=byDate.get(d).counts;c.set(x.entity,(c.get(x.entity)??0)+1);}
 const dates=[...byDate.keys()].sort().reverse(); // most recent first
 const missing=[],dups=[];
 for(const d of dates)for(const ent of entities){
  const k=byDate.get(d).counts.get(ent)??0;
  const label=s.entityField?`${d} ${ent}`:d;
  if(k===0)missing.push(label);else if(k>1)dups.push(`${label} ×${k}`);
 }
 const ok=dates.length===n&&!missing.length&&!dups.length&&records.length===n*e;
 const out=[check('coverage.grid',plannedSeriesChecks(contract)[0].criterion,ok?'pass':'fail',
  `${n} distinct dates × ${e} = ${n*e} rows, one per ${unit}`,
  `${dates.length} distinct dates, ${records.length} rows; ${missing.length} missing ${unit} pair${missing.length===1?'':'s'}${dups.length?`, ${dups.length} duplicated`:''}`,
  [...missing.slice(0,5).map(m=>`missing: ${m}`),...dups.slice(0,3).map(d=>`duplicate: ${d}`)],
  // Short on purpose: the full rule (seriesConstraint) is already in the hire's requirements, and Agent inputs are capped.
  ok?undefined:`Coverage: ${dates.length} dates instead of ${n}${missing.length?`; ${missing.length} ${unit} pair${missing.length===1?'':'s'} missing (e.g. ${missing.slice(0,2).join(', ')})`:''}${dups.length?`; duplicated: ${dups.slice(0,2).join(', ')}`:''}. Exactly one row per ${s.entityField?`${s.entityField} per `:''}${s.periodName}.`)];
 if(s.calendar!=='any'){
  const cal=CALENDARS[s.calendar];
  const closed=dates.filter(d=>!cal.isOpen(byDate.get(d).dt)).sort();
  out.push(check('dates.trading_days',`Only ${cal.label} dates`,closed.length?'fail':'pass',`no dates outside ${cal.label}`,closed.length?`${closed.length} date${closed.length===1?'':'s'} outside ${cal.label}: ${listed(closed)}`:'none',
   closed.map(d=>`${d} (${byDate.get(d).dt.toFormat('cccc')})`),
   closed.length?`No ${s.calendar==='weekdays'?'weekend':'non-trading'} dates (you sent ${closed.slice(0,2).join(', ')}${closed.length>2?` +${closed.length-2} more`:''}).`:undefined));
 }
 if(s.valueFields.length){
  // Runs of an identical value on consecutive dates of one entity's series: typical of forward-filled data.
  const runs=[];
  for(const ent of entities)for(const f of s.valueFields){
   const series=rows.filter(x=>x.entity===ent&&String(x.r[f]??'').trim()!=='').sort((a,b)=>a.dt-b.dt);
   let i=0;
   while(i<series.length){
    let j=i;const v=Number(series[i].r[f]);
    while(j+1<series.length&&Number(series[j+1].r[f])===v&&Number.isFinite(v))j++;
    if(j>i)runs.push(`${s.entityField?`${ent} `:''}${f} ${series[i].r[f]} on ${series.slice(i,j+1).map(x=>x.dt.toISODate()).join(', ')}`);
    i=j+1;
   }
  }
  out.push(check('values.stale','No value repeated on consecutive dates (forward-fill)',runs.length?'warn':'pass','no identical value on 2+ consecutive dates',runs.length?`${runs.length} repeated run${runs.length===1?'':'s'}: ${listed(runs,2)}`:'none',runs));
 }
 return out;
}
