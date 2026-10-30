import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseImageContract} from '../qa/contract/image.mjs';
import {renderImageContract,compactImageCriteria} from '../qa/contract/render.mjs';
const valid=JSON.parse(readFileSync(new URL('./fixtures/contracts/image-valid.json',import.meta.url)));
test('valid image contract parses with defaults',()=>{
 const c=parseImageContract(valid);
 assert.deepEqual(c.images,{min:1,max:1});
 assert.equal(c.text.caseSensitive,true);assert.equal(c.text.maxEditRatio,0.05);
 assert.equal(c.objects[0].minCount,1);
});
const bad=(patch,re)=>assert.throws(()=>parseImageContract({...valid,...patch}),re);
test('invalid image contracts are rejected',()=>{
 bad({text:{mode:'exact'}},/needs expected text/);
 bad({text:{mode:'none',expected:'x'}},/must not have expected/);
 bad({images:{min:3,max:1}},/min > max/);
 bad({objects:[{label:'dog'},{label:'dog'}]},/duplicate object/);
 bad({technical:{formats:['gif']}},/Invalid|gif/i);
 bad({extra:1},/Unrecognized|extra/i);
});
test('image renderer snapshot',()=>{
 assert.equal(renderImageContract(parseImageContract(valid)),`**Deliverable:** Poster with the text "SUMMER SALE -50%" and a bicycle

**Acceptance criteria**
1. Exactly 1 image.
2. Format PNG or JPEG.
3. At least 800 pixels wide.
4. The image shows exactly the text "SUMMER SALE -50%" (OCR tolerance 5% of characters).
5. Shows a \`bicycle\` (detected by the object detector).

Assumptions: colour unchecked`);
});
test('compact image criteria for the service brief',()=>{
 assert.equal(compactImageCriteria(parseImageContract(valid)),'1 image; png or jpeg; at least 800 px wide; text exactly "SUMMER SALE -50%", clearly legible; clearly visible: a bicycle.');
 const idea=parseImageContract({...valid,technical:undefined,text:{mode:'idea',expected:'a discount on coffee'},objects:[{label:'cup',minCount:2}]});
 assert.equal(compactImageCriteria(idea),'1 image; legible text that conveys: a discount on coffee; clearly visible: 2 cups.');
});
