import {z} from 'zod';
import {stateDir} from '../state-dir.mjs';
const int=(d,min=1,max=10000)=>z.coerce.number().int().min(min).max(max).default(d);
const num=(d,min=0,max=1)=>z.coerce.number().min(min).max(max).default(d);
const schema=z.object({
 QA_MODE:z.enum(['template','structured','image']).default('template'),
 COWORKER_ID:z.string().trim().min(1,'COWORKER_ID is required').regex(/^\S+$/,'COWORKER_ID must not contain whitespace'),
 QA_MAX_ATTEMPTS_DEFAULT:int(3,1,5),
 QA_MAX_CREDITS_PER_HIRE_DEFAULT:int(50,1,100000),
 QA_JOB_POLL_SECONDS:int(12,10,600),
 QA_JOB_TIMEOUT_MINUTES:int(30,1,1440),
 QA_APPROVAL_TIMEOUT_MINUTES:int(60,1,10080),
 QA_MAX_REVISION_ROUNDS:int(3,0,10),
 QA_STOP_AFTER:z.string().trim().optional().transform(v=>v||undefined),
 QA_HIRE_BACKEND:z.enum(['sokosumi','mock']).default('sokosumi'),
 DETECTOR_MODEL:z.string().trim().min(1).default('Xenova/owlv2-base-patch16'),   // chosen by the Step 4.6 benchmark (docs/detector-choice.md)
 DETECTOR_DTYPE:z.enum(['fp32','fp16','q8','int8','uint8','q4','q4f16','bnb4']).default('q8'),
 DETECTOR_THRESHOLD:num(0.15),
 OCR_LANG:z.string().trim().min(1).default('eng'),
 OCR_EXACT_MAX_EDIT_RATIO:num(0.05,0,0.5),
});
// Treat empty strings as unset so blank lines in .env files fall back to defaults.
function clean(env){return Object.fromEntries(Object.entries(env).filter(([,v])=>v!==undefined&&String(v).trim()!==''));}
export function loadConfig(env=process.env){
 const parsed=schema.safeParse(clean(env));
 if(!parsed.success)throw new Error('Invalid QA configuration: '+parsed.error.issues.map(i=>`${i.path.join('.')||'env'}: ${i.message}`).join('; '));
 return Object.freeze({...parsed.data,STATE_DIR:stateDir(env)});
}
