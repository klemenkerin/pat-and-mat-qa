// Renders the deterministic OCR fixtures (Step 4.5) from SVG with sharp. The PNGs are committed,
// so tests do not depend on the fonts of the machine that runs them.
// Usage: node scripts/make-image-fixtures.mjs
import {mkdirSync} from 'node:fs';
import sharp from 'sharp';
const dir=new URL('../test/fixtures/images/',import.meta.url).pathname;mkdirSync(dir,{recursive:true});
const esc=s=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;');
const svg=(w,h,lines,size=96)=>`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#ffffff"/>${
 lines.map((l,i)=>`<text x="50%" y="${Math.round(h/2+(i-(lines.length-1)/2)*size*1.25+size*0.35)}" text-anchor="middle" font-family="Arial, Helvetica, DejaVu Sans, sans-serif" font-weight="bold" font-size="${size}" fill="#111111">${esc(l)}</text>`).join('')}</svg>`;
const fixtures={
 'text-exact.png':[1200,400,['SUMMER SALE -50%']],
 'text-typo.png':[1200,400,['SUMMER SAIE -50%']],
 'text-other.png':[1200,400,['WINTER DEALS']],
 'text-coffee.png':[1200,500,['Coffee 20% off','today'],88],
 'no-text.png':[1200,400,[]],
 'small.png':[200,100,[]],
};
for(const [name,[w,h,lines,size]] of Object.entries(fixtures)){
 await sharp(Buffer.from(svg(w,h,lines,size))).png().toFile(dir+name);
 console.log('wrote',name,`${w}x${h}`);
}
