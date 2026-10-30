// Slow suite (downloads ~155 MB on first run): npm run test:slow
import test from 'node:test';
import assert from 'node:assert/strict';
import {loadConfig} from '../../qa/config.mjs';
import {detect} from '../../qa/validators/image/detector.mjs';
import {objectChecks} from '../../qa/validators/image/objects.mjs';

const c=loadConfig({COWORKER_ID:'x'});
const dir=new URL('../fixtures/images/detect/',import.meta.url).pathname;
const cases=[
 ['coco-000000039769.jpg',[{label:'cat',minCount:2},{label:'remote control',minCount:1}],['dog','laptop']],
 ['coco-000000000285.jpg',[{label:'bear',minCount:1}],['dog','cat','person']],
 ['coco-000000000802.jpg',[{label:'refrigerator',minCount:1},{label:'oven',minCount:1}],['person','television','dog']],
];
for(const [img,present,absent] of cases)test(`detector with the chosen config: ${img}`,{timeout:300000},async()=>{
 const objects=[...present,...absent.map(label=>({label,minCount:1}))];
 const d=await detect(dir+img,objects.map(o=>o.label),{model:c.DETECTOR_MODEL,dtype:c.DETECTOR_DTYPE,threshold:0.01});
 const checks=objectChecks(d,objects,c.DETECTOR_THRESHOLD);
 for(const [i,o] of objects.entries())assert.equal(checks[i].status,i<present.length?'pass':'fail',`${o.label}: ${checks[i].observed}`);
});
