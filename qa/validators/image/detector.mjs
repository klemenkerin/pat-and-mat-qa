import {pipeline,RawImage} from '@huggingface/transformers';

const detectors=new Map();
const isGroundingDino=model=>/grounding-dino/i.test(model);

/** One pipeline per (model, dtype). The first call downloads the weights to the Hugging Face cache. */
export function getDetector(model,dtype){
 const key=`${model}|${dtype}`;
 if(!detectors.has(key))detectors.set(key,pipeline('zero-shot-object-detection',model,{dtype}));
 return detectors.get(key);
}

/** Grounding DINO wants lowercase phrases ending in "."; OWL models score best with "a photo of a …". */
export function promptFor(model,label){return isGroundingDino(model)?`${label}.`:`a photo of a ${label}`;}

const esc=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
/**
 Map a detector output label back to the contract label.
 OWL: the output is our prompt. Grounding DINO in transformers.js 4.3.2 returns phrases glued from the whole
 prompt (seen live: "cat remote. dog." for the cat box), so take the label that appears earliest in the phrase.
*/
export function backToLabel(outLabel,labels,model){
 const byPrompt=labels.find(l=>promptFor(model,l)===outLabel);
 if(byPrompt)return byPrompt;
 if(isGroundingDino(model)){
  const p=String(outLabel).toLowerCase();let best=null,at=Infinity;
  for(const l of labels){const m=new RegExp(`(^|[^a-z])${esc(l)}(?![a-z])`).exec(p);if(m&&(m.index<at||(m.index===at&&l.length>best.length))){best=l;at=m.index;}}
  return best;
 }
 const bare=String(outLabel).toLowerCase().replace(/^a photo of (an?|the) /,'').replace(/^(an?|the) /,'').replace(/[.\s]+$/,'').trim();
 return labels.find(l=>l===bare)??labels.find(l=>bare.includes(l))??labels.find(l=>l.includes(bare)&&bare.length>2)??null;
}

/**
 Detect `labels` in one image. Returns [{label, score, box}] above `threshold`.
 Grounding DINO gets one joint prompt (alone, a phrase always finds a best match: "dog" scored 0.54 on a
 photo of cats); OWL models get one candidate per label.
*/
export async function detect(imagePathOrUrl,labels,{model,dtype='q8',threshold=0.05}){
 if(!labels.length)return [];
 const det=await getDetector(model,dtype);
 const image=await RawImage.read(imagePathOrUrl);
 const candidates=isGroundingDino(model)?[labels.map(l=>promptFor(model,l)).join(' ')]:labels.map(l=>promptFor(model,l));
 const out=[];
 for(const o of await det(image,candidates,{threshold})){
  const label=backToLabel(o.label,labels,model);
  if(label)out.push({label,score:o.score,box:o.box});
 }
 return out;
}
