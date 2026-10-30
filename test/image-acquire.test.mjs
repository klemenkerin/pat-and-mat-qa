import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtempSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import sharp from 'sharp';
import {imageCandidates,acquireImages} from '../qa/validators/image/acquire.mjs';

const png=await sharp({create:{width:40,height:20,channels:3,background:'#c00'}}).png().toBuffer();
const jpg=await sharp({create:{width:30,height:30,channels:3,background:'#0c0'}}).jpeg().toBuffer();
const big=Buffer.alloc(2048,1);
async function server(){
 const routes={'/a.png':['image/png',png],'/photo.jpg':['image/jpeg',jpg],'/fake.png':['text/html',Buffer.from('<html>nope</html>')],'/big.png':['image/png',big],'/mislabelled.png':['image/png',jpg]};
 const s=createServer((req,res)=>{const r=routes[req.url.split('?')[0]];if(!r){res.writeHead(404);res.end();return;}res.writeHead(200,{'content-type':r[0]});res.end(r[1]);});
 await new Promise(r=>s.listen(0,'127.0.0.1',r));
 return {base:`http://127.0.0.1:${s.address().port}`,close:()=>s.close()};
}
const dir=()=>mkdtempSync(join(tmpdir(),'qa-img-'));

test('candidates come from files, markdown images, plain URLs and links, de-duplicated',()=>{
 const job={result:'Here: ![poster](https://x.test/p.png "t")\nalso https://x.test/q.jpg?sig=1 and https://x.test/page.html'};
 const c=imageCandidates({job,files:[{name:'out.webp',url:'https://f.test/out.webp'},{name:'notes.txt',url:'https://f.test/n.txt'}],links:[{url:'https://x.test/p.png'},{url:'https://x.test/r.jpeg',title:'r'}]});
 assert.deepEqual(c.map(x=>[x.origin,x.url]),[['file','https://f.test/out.webp'],['result-markdown','https://x.test/p.png'],['result-url','https://x.test/q.jpg?sig=1'],['link','https://x.test/r.jpeg']]);
});
test('downloads a PNG file and a JPEG markdown link; real format wins over the extension',async()=>{
 const s=await server();
 try{
  const d=dir();
  const {images,rejected}=await acquireImages({job:{result:`![x](${s.base}/photo.jpg) and ![y](${s.base}/mislabelled.png?token=secret)`},files:[{name:'a.png',mimeType:'image/png',url:`${s.base}/a.png`}],workDir:d});
  assert.deepEqual(rejected,[]);
  assert.deepEqual(images.map(i=>[i.origin,i.format,i.width,i.height]),[['file','png',40,20],['result-markdown','jpeg',30,30],['result-markdown','jpeg',30,30]]);
  assert.ok(readFileSync(images[0].path).equals(png));
  assert.match(images[2].path,/img-3\.jpg$/);
  assert.ok(!images[2].url.includes('secret'),'signed URL query is not kept');
 }finally{s.close();}
});
test('HTML posing as an image and oversize images are rejected',async()=>{
 const s=await server();
 try{
  const {images,rejected}=await acquireImages({job:{result:`![a](${s.base}/fake.png) ![b](${s.base}/big.png) ![c](${s.base}/missing.png)`},workDir:dir(),maxBytes:1024});
  assert.equal(images.length,0);
  assert.deepEqual(rejected.map(r=>r.reason.replace(/:.*/,'')),['not an image','download too large','download failed']);
 }finally{s.close();}
});
test('data URLs are accepted (local stand-in Agent)',async()=>{
 const {images}=await acquireImages({job:{result:`![p](data:image/png;base64,${png.toString('base64')})`},workDir:dir()});
 assert.equal(images[0].format,'png');
 assert.equal(images[0].url,'data:image/png;base64,…');
});
