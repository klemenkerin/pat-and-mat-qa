import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalise,approxSubstring,matchExact} from '../qa/validators/image/textmatch.mjs';
import {technicalChecks} from '../qa/validators/image/metadata.mjs';
import {ocr,terminateOcr} from '../qa/validators/image/ocr.mjs';
import {checkText} from '../qa/validators/image/text.mjs';

const fx=n=>readFileSync(new URL(`./fixtures/images/${n}`,import.meta.url));
const exact={mode:'exact',expected:'SUMMER SALE -50%',caseSensitive:true,maxEditRatio:0.05};

test('normalise unifies quotes, dashes, whitespace and optional case',()=>{
 assert.equal(normalise('  “Big”  sale – now\n'),'"Big" sale - now');
 assert.equal(normalise('ＡＢＣ',{caseSensitive:false}),'abc');
 assert.equal(normalise("it’s"),"it's");
});
test('approximate substring distance (hand-computed)',()=>{
 assert.deepEqual(approxSubstring('SALE','BIG SALE NOW'),{distance:0,start:4,end:8,match:'SALE'});
 assert.equal(approxSubstring('SALE','BIG SAIE NOW').distance,1);
 assert.equal(approxSubstring('SALE','BIG SLE NOW').distance,1);
 assert.equal(approxSubstring('abc','').distance,3);
 assert.equal(approxSubstring('kitten','sitting').distance,2);
});
test('exact matching: tolerance is 5% of characters, so short strings allow none',()=>{
 assert.equal(matchExact({expected:'SUMMER SALE -50%',ocrText:'Big\nSUMMER SALE —50%\nnow'}).pass,true);
 const typo=matchExact({expected:'SUMMER SALE -50%',ocrText:'SUMMER SAIE -50%'});
 assert.deepEqual([typo.pass,typo.distance,typo.ratio,typo.allowed],[false,1,1/16,0]);
 const long='The quick brown fox jumps over the lazy dog!';
 assert.equal(matchExact({expected:long,ocrText:long.replace('quick','qu1ck').replace('lazy','1azy')}).pass,true);
 assert.equal(matchExact({expected:'Sale',ocrText:'SALE',caseSensitive:false}).pass,true);
 assert.equal(matchExact({expected:'Sale',ocrText:'SALE'}).pass,false);
});
test('technical checks with deterministic fix instructions',()=>{
 const c=technicalChecks({format:'png',width:800,height:600,bytes:2*1024*1024},{formats:['jpeg'],minWidth:1200,maxBytes:1024*1024,aspectRatio:{value:4/3,tolerance:0.02}});
 assert.deepEqual(c.map(x=>[x.id,x.status]),[['technical.format','fail'],['technical.width','fail'],['technical.bytes','fail'],['technical.aspect','pass']]);
 assert.equal(c[1].fix,'Image is 800×600; minimum width is 1200 px.');
 assert.deepEqual(technicalChecks({format:'png',width:1,height:1,bytes:1},undefined),[]);
});

test('OCR on rendered fixtures (real tesseract)',{timeout:120000},async t=>{
 t.after(terminateOcr);
 const pass=await checkText({ocrResult:await ocr(fx('text-exact.png')),text:exact});
 assert.equal(pass.status,'pass',pass.observed);
 const typo=await checkText({ocrResult:await ocr(fx('text-typo.png')),text:exact});
 assert.equal(typo.status,'fail');
 assert.match(typo.fix,/found "SUMMER SAIE -50%" \(1 character differs\)/);
 assert.equal((await checkText({ocrResult:await ocr(fx('text-other.png')),text:exact})).status,'fail');
 const none=await checkText({ocrResult:await ocr(fx('no-text.png')),text:{mode:'idea',expected:'a discount on coffee'},llm:{generateJson:async()=>{throw new Error('LLM must not be called without text');}}});
 assert.deepEqual([none.status,none.observed],['fail','no legible text found']);
 const coffee=await ocr(fx('text-coffee.png'));
 assert.equal(coffee.cleanText,'Coffee 20% off\ntoday');
});
test('idea mode passes only when the LLM says it matches with confidence >= 0.6',async()=>{
 const ocrResult={text:'Coffee 20% off today',cleanText:'Coffee 20% off today'};
 const judge=r=>({generateJson:async()=>r});
 const idea={mode:'idea',expected:'a discount on coffee'};
 assert.equal((await checkText({ocrResult,text:idea,llm:judge({matches:true,confidence:0.9,reason:'coffee discount'})})).status,'pass');
 assert.equal((await checkText({ocrResult,text:idea,llm:judge({matches:true,confidence:0.5,reason:'unsure'})})).status,'fail');
 const no=await checkText({ocrResult,text:{mode:'idea',expected:'a shoe sale'},llm:judge({matches:false,confidence:0.95,reason:'about coffee'})});
 assert.equal(no.status,'fail');assert.match(no.evidence.at(-1),/LLM reason: about coffee/);
 assert.equal((await checkText({ocrResult,text:{mode:'none'}})).status,'skip');
});
