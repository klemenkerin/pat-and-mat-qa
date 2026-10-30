import {z} from 'zod';

export const FIELD_TYPES=['string','integer','number','boolean','date','datetime','time','enum','email','url'];
const field=z.object({
 name:z.string().trim().min(1).max(200),
 type:z.enum(FIELD_TYPES),
 required:z.boolean().default(true),
 format:z.string().trim().min(1).max(100).optional(),
 enum:z.array(z.string()).min(1).max(500).optional(),
 min:z.number().optional(),
 max:z.number().optional(),
 pattern:z.string().max(500).optional(),
 maxNullRate:z.number().min(0).max(1).default(0),
}).strict().superRefine((f,ctx)=>{
 if(f.type==='enum'&&!f.enum)ctx.addIssue({code:'custom',message:`field ${f.name}: type enum needs enum values`});
 if(['date','datetime','time'].includes(f.type)&&!f.format)ctx.addIssue({code:'custom',message:`field ${f.name}: type ${f.type} needs a format`});
 if(f.min!==undefined&&f.max!==undefined&&f.min>f.max)ctx.addIssue({code:'custom',message:`field ${f.name}: min > max`});
 if(f.pattern!==undefined){try{new RegExp(f.pattern);}catch{ctx.addIssue({code:'custom',message:`field ${f.name}: invalid pattern`});}}
});
export const retrySchema=z.object({maxAttempts:z.number().int().min(1).max(5),maxCreditsPerHire:z.number().positive().max(100000)}).strict();

export const structuredContractSchema=z.object({
 kind:z.literal('structured'),
 version:z.literal(1),
 agentId:z.string().min(1),
 brief:z.string().trim().min(3).max(8000),
 output:z.object({
  format:z.enum(['csv','json']),
  source:z.enum(['auto','result','file']).default('auto'),
  csv:z.object({delimiter:z.enum([',',';','\t']).default(','),header:z.boolean().default(true)}).strict().optional(),
  json:z.object({root:z.enum(['array','object']).default('array'),recordsPath:z.string().trim().min(1).optional()}).strict().optional(),
 }).strict(),
 records:z.object({min:z.number().int().min(0).optional(),max:z.number().int().min(0).optional(),exact:z.number().int().min(0).optional()}).strict().optional(),
 fields:z.array(field).min(1).max(200),
 unique:z.array(z.array(z.string().min(1)).min(1)).optional(),
 allowExtraFields:z.boolean().default(false),
 retry:retrySchema,
 notes:z.string().max(4000).optional(),
}).strict().superRefine((c,ctx)=>{
 const names=new Set();
 for(const f of c.fields){if(names.has(f.name))ctx.addIssue({code:'custom',message:`duplicate field ${f.name}`});names.add(f.name);}
 for(const key of c.unique??[])for(const n of key)if(!names.has(n))ctx.addIssue({code:'custom',message:`unique key uses unknown field ${n}`});
 const r=c.records;
 if(r&&r.exact!==undefined&&(r.min!==undefined||r.max!==undefined))ctx.addIssue({code:'custom',message:'records: use exact or min/max, not both'});
 if(r&&r.min!==undefined&&r.max!==undefined&&r.min>r.max)ctx.addIssue({code:'custom',message:'records: min > max'});
});

export function parseStructuredContract(obj){return structuredContractSchema.parse(obj);}
