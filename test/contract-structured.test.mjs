import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseStructuredContract} from '../qa/contract/structured.mjs';
import {renderStructuredContract} from '../qa/contract/render.mjs';
const valid=JSON.parse(readFileSync(new URL('./fixtures/contracts/structured-valid.json',import.meta.url)));
test('valid contract parses with defaults',()=>{
 const c=parseStructuredContract(valid);
 assert.equal(c.output.source,'auto');assert.equal(c.allowExtraFields,false);assert.equal(c.fields[0].required,true);assert.equal(c.fields[0].maxNullRate,0);
});
const bad=(patch,re)=>assert.throws(()=>parseStructuredContract({...valid,...patch}),re);
test('invalid contracts are rejected',()=>{
 bad({fields:[{name:'d',type:'date'}]},/needs a format/);
 bad({fields:[{name:'c',type:'enum'}]},/needs enum values/);
 bad({fields:[{name:'a',type:'string'},{name:'a',type:'string'}],unique:undefined},/duplicate field/);
 bad({unique:[['nope']]},/unknown field/);
 bad({records:{exact:5,min:1}},/exact or min\/max/);
 bad({retry:{maxAttempts:9,maxCreditsPerHire:1}},/maxAttempts|Too big|<=5/i);
 bad({extra:true},/Unrecognized|extra/i);
 bad({fields:[{name:'p',type:'string',pattern:'('}]},/invalid pattern/);
});
test('renderer snapshot',()=>{
 const md=renderStructuredContract(parseStructuredContract(valid));
 assert.equal(md,`**Deliverable:** CSV of 50 EU electricity prices

**Acceptance criteria**
1. Deliver CSV data with delimiter \`,\` and a header row.
2. Exactly 50 records.
3. Exactly these fields, no others:
   - \`date\`: date, format \`yyyy-MM-dd\`, never empty
   - \`country\`: enum, one of \`DE\`, \`AT\`, \`CH\`, never empty
   - \`price_eur\`: number, ≥ 0, never empty
4. No duplicate combinations of \`date\` + \`country\`.

Assumptions: assumed comma delimiter`);
});
