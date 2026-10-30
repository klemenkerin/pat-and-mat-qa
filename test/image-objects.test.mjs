import test from 'node:test';
import assert from 'node:assert/strict';
import {backToLabel,promptFor} from '../qa/validators/image/detector.mjs';
import {iou,instances,objectChecks} from '../qa/validators/image/objects.mjs';

const DINO='onnx-community/grounding-dino-tiny-ONNX',OWL='Xenova/owlv2-base-patch16';
test('OWL labels map back by prompt',()=>{
 assert.equal(promptFor(OWL,'remote control'),'a photo of a remote control');
 assert.equal(backToLabel('a photo of a remote control',['cat','remote control'],OWL),'remote control');
});
test('Grounding DINO glued phrases (recorded live) map to the earliest label',()=>{
 const L=['cat','remote control','dog'];
 assert.equal(backToLabel('cat remote. dog.',L,DINO),'cat');
 assert.equal(backToLabel('remote control. dog.',L,DINO),'remote control');
 assert.equal(backToLabel('bear dog...',['bear','dog','cat','person'],DINO),'bear');
 assert.equal(backToLabel('.. television. dog.',['refrigerator','oven','person','television','dog'],DINO),'television');
 assert.equal(backToLabel('....',L,DINO),null);
 assert.equal(backToLabel('catalog',L,DINO),null,'whole words only');
});
const box=(x,y,w=10,h=10)=>({xmin:x,ymin:y,xmax:x+w,ymax:y+h});
test('overlapping boxes are merged before counting',()=>{
 assert.equal(iou(box(0,0),box(0,0)),1);
 assert.equal(iou(box(0,0),box(20,20)),0);
 const d=[{label:'dog',score:0.9,box:box(0,0)},{label:'dog',score:0.8,box:box(1,1)},{label:'dog',score:0.7,box:box(50,50)},{label:'dog',score:0.1,box:box(90,90)}];
 assert.equal(instances(d,'dog',0.15).length,2);
});
test('object checks: counts, best scores and deterministic fixes',()=>{
 const d=[{label:'dog',score:0.6,box:box(0,0)},{label:'bicycle',score:0.12,box:box(0,0)}];
 const [dogs,bike]=objectChecks(d,[{label:'dog',minCount:2},{label:'bicycle',minCount:1}],0.15);
 assert.deepEqual([dogs.id,dogs.status,dogs.observed],['objects.dog','fail','1 detected (top scores 0.60)']);
 assert.match(dogs.fix,/Required 2 × "dog"; only 1 detected/);
 assert.equal(bike.fix,'Required object "bicycle" not detected (best score 0.12 < 0.15). Make the bicycle clearly visible.');
});
