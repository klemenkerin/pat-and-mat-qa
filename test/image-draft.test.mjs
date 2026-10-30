import test from 'node:test';
import assert from 'node:assert/strict';
import {quotedTexts,singularize,postProcessImage,draftImageContract,reviseImageContract} from '../qa/contract/image-draft.mjs';
import {createLlm} from '../qa/llm.mjs';

const scripted=answers=>{let i=0;return createLlm({generate:async()=>({text:JSON.stringify(answers[i++])})});};
const request={brief:'',maxAttempts:3,maxCreditsPerHire:10};
const agent={id:'img1',name:'Image Agent'};

test('quoted texts: straight, curly, German, guillemets and single quotes; apostrophes ignored',()=>{
 assert.deepEqual(quotedTexts('Poster with the text "SUMMER SALE -50%" and a bicycle'),['SUMMER SALE -50%']);
 assert.deepEqual(quotedTexts('Sign saying “Open late” and „Willkommen“'),['Open late','Willkommen']);
 assert.deepEqual(quotedTexts("A banner that says 'Hello World', don't add a logo"),['Hello World']);
 assert.deepEqual(quotedTexts('No quotes here, it\'s fine'),[]);
});
test('singularize the last word of a noun phrase',()=>{
 for(const [a,b] of [['bicycles','bicycle'],['coffee cups','coffee cup'],['puppies','puppy'],['boxes','box'],['benches','bench'],['people','person'],['glass','glass'],['bus','bus'],['Dogs','dog'],['cat','cat'],['knives','knife']])assert.equal(singularize(a),b);
});
test('(a) quoted text overrides the LLM to exact mode',()=>{
 const c=postProcessImage({text:{mode:'idea',expected:'a sale'},objects:[]},'Poster with the text "SUMMER SALE -50%"');
 assert.deepEqual(c.text,{mode:'exact',expected:'SUMMER SALE -50%'});
});
test('(b) exact without quotes is downgraded to idea',()=>{
 const c=postProcessImage({text:{mode:'exact',expected:'a coffee discount'},objects:[]},'Banner announcing a coffee discount');
 assert.deepEqual(c.text,{mode:'idea',expected:'a coffee discount'});
 assert.match(c.notes,/judged by meaning/);
});
test('(c) object labels are normalised and de-duplicated with the highest count',()=>{
 const c=postProcessImage({text:{mode:'none'},objects:[{label:' Dogs ',minCount:2},{label:'dog'},{label:'Bicycles'}]},'two dogs and a bicycle');
 assert.deepEqual(c.objects,[{label:'dog',minCount:2},{label:'bicycle',minCount:1}]);
});
test('draft uses the LLM, then code rules, then the strict schema',async()=>{
 const llm=scripted([{text:{mode:'idea',expected:'a sale'},objects:[{label:'bicycles'}],technical:{formats:['png']}}]);
 const c=await draftImageContract({llm,request:{...request,brief:'Poster with the text "SUMMER SALE -50%" and a bicycle'},agent});
 assert.equal(c.kind,'image');assert.equal(c.agentId,'img1');
 assert.deepEqual(c.text,{mode:'exact',expected:'SUMMER SALE -50%',caseSensitive:true,maxEditRatio:0.05});
 assert.deepEqual(c.objects,[{label:'bicycle',minCount:1}]);
 assert.deepEqual(c.retry,{maxAttempts:3,maxCreditsPerHire:10});
});
test('draft without text in the brief gives mode none',async()=>{
 const c=await draftImageContract({llm:scripted([{objects:[{label:'dog',minCount:2}]}]),request:{...request,brief:'Photo of two dogs on a beach, no text'},agent});
 assert.deepEqual(c.text,{mode:'none',caseSensitive:true,maxEditRatio:0.05});
});
test('revision: quotes in the comment replace the text; the brief is unchanged',async()=>{
 const base=await draftImageContract({llm:scripted([{objects:[]}]),request:{...request,brief:'Poster with the text "SUMMER SALE"'},agent});
 const r=await reviseImageContract({llm:scripted([{...base,text:{mode:'exact',expected:'SUMMER SALE'}}]),contract:base,comment:'Change the text to "WINTER SALE"'});
 assert.equal(r.text.expected,'WINTER SALE');
 assert.equal(r.brief,'Poster with the text "SUMMER SALE"');
 const r2=await reviseImageContract({llm:scripted([{...base,objects:[{label:'cats'}]}]),contract:base,comment:'also add a cat'});
 assert.equal(r2.text.expected,'SUMMER SALE');
 assert.deepEqual(r2.objects,[{label:'cat',minCount:1}]);
});
