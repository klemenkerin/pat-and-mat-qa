import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {parseQaRequest} from '../request.mjs';
import {draftImageContract,reviseImageContract} from '../contract/image-draft.mjs';
import {renderImageContract,compactImageCriteria} from '../contract/render.mjs';
import {composeServiceParts,buildInputData,withFieldLimits} from '../hire.mjs';
import {validateImages} from '../validators/image/index.mjs';
import {ocr,getOcrWorker} from '../validators/image/ocr.mjs';
import {detect,getDetector} from '../validators/image/detector.mjs';
import {buildReport,renderReportMarkdown,fixInstructions} from '../report.mjs';

/** Image QA mode (plan Step 4.8): same pipeline as structured, with the image contract and validator pack. */
export function createImageMode({llm,config,ocrFn,detectFn,fetchImpl=fetch}){
 const model=config.DETECTOR_MODEL,dtype=config.DETECTOR_DTYPE;
 // The detector runs with a low floor; objectChecks applies the contract threshold and reports the best score below it.
 detectFn??=(path,labels)=>detect(path,labels,{model,dtype,threshold:0.01});
 ocrFn??=buf=>ocr(buf,{lang:config.OCR_LANG});
 return {
  name:'image',
  parseRequest:({description})=>parseQaRequest({description,config,llm}),
  draftContract:({request,agent})=>draftImageContract({llm,request,agent}),
  reviseContract:({contract,comment})=>reviseImageContract({llm,contract,comment}),
  renderContract:renderImageContract,

  async buildInputData({inputSchema,contract,attempt,fixInstructions:fixes,agent}){
   const parts=composeServiceParts({brief:contract.brief,criteriaText:compactImageCriteria(contract),attempt,fixInstructions:fixes});
   return buildInputData({inputSchema:withFieldLimits(inputSchema,agent?.fieldMaxLength),serviceBrief:`${parts.brief}\n\n${parts.requirements}`,parts,llm});
  },

  async verify({job,files,links,contract,attempt,workDir}){
   writeFileSync(join(workDir,'job.json'),JSON.stringify(job,null,1),{mode:0o600});
   const v=await validateImages({job,files,links,contract,workDir,ocrFn,detectFn,llm,threshold:config.DETECTOR_THRESHOLD,fetchImpl});
   const report=buildReport({checks:v.checks,attempt,jobId:job.id,agentId:contract.agentId,deliverable:null});
   report.images=v.images.map(({k,url,origin,name,format,width,height,bytes,sha256,path,ocrText,detections})=>({k,url,origin,name,format,width,height,bytes,sha256,path,ocrText,detections}));
   writeFileSync(join(workDir,'report.json'),JSON.stringify(report,null,1),{mode:0o600});
   return report;
  },

  fixInstructions,
  renderReport:renderReportMarkdown,

  renderResult({contract,attempts,agent}){
   const last=attempts.at(-1);
   // Image links and hashes only: the result must stay small, so no image bytes.
   const imgs=(last.report.images??[]).map(i=>`- Image ${i.k}: ${i.width}×${i.height} ${String(i.format).toUpperCase()}, ${Math.round(i.bytes/1024)} KB, sha256 \`${i.sha256}\`, ${/^https?:/.test(i.url)?i.url:`${i.origin}${i.name?` ${i.name}`:''} of job ${last.jobId}`}`).join('\n');
   const history=attempts.length>1?`\n\nAttempts: ${attempts.map(a=>`#${a.n} ${a.report?.verdict??'n/a'}${a.refund?` (refund ${a.refund.status})`:''}`).join(', ')}.`:'';
   const mock=agent.mock?' (mock hire: no payment)':'';
   return `QA PASSED. ${agent.name}${mock} delivered images that meet every acceptance criterion (attempt ${last.n} of max ${contract.retry.maxAttempts}).${history}\n\n## Images\n\n${imgs}\n\n## QA report\n\n${renderReportMarkdown(last.report)}\n\n## Acceptance contract\n\n${renderImageContract(contract)}\n`;
  },

  /** Load the OCR worker and the detector before taking Tasks (the first run downloads models). */
  async warmUp(){await Promise.all([getOcrWorker(config.OCR_LANG),getDetector(model,dtype)]);},
 };
}
