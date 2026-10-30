import {z} from 'zod';
import {retrySchema} from './structured.mjs';

export const IMAGE_FORMATS=['png','jpeg','webp'];
const object=z.object({
 label:z.string().trim().min(1).max(80),   // simple English noun phrase, singular, lowercase
 minCount:z.number().int().min(1).max(50).default(1),
}).strict();

export const imageContractSchema=z.object({
 kind:z.literal('image'),
 version:z.literal(1),
 agentId:z.string().min(1),
 brief:z.string().trim().min(3).max(8000),
 images:z.object({min:z.number().int().min(1).default(1),max:z.number().int().min(1).default(1)}).strict().default({min:1,max:1}),
 technical:z.object({
  formats:z.array(z.enum(IMAGE_FORMATS)).min(1).optional(),
  minWidth:z.number().int().min(1).optional(),
  minHeight:z.number().int().min(1).optional(),
  maxBytes:z.number().int().min(1).optional(),
  aspectRatio:z.object({value:z.number().positive(),tolerance:z.number().min(0).max(1).default(0.02)}).strict().optional(),
 }).strict().optional(),
 text:z.object({
  mode:z.enum(['exact','idea','none']),
  expected:z.string().trim().min(1).max(500).optional(),   // exact: the literal text; idea: what the text should say
  caseSensitive:z.boolean().default(true),
  maxEditRatio:z.number().min(0).max(0.5).default(0.05),
 }).strict(),
 objects:z.array(object).max(10).default([]),
 detector:z.object({threshold:z.number().min(0).max(1).optional()}).strict().optional(),
 retry:retrySchema,
 notes:z.string().max(4000).optional(),
}).strict().superRefine((c,ctx)=>{
 if(c.images.min>c.images.max)ctx.addIssue({code:'custom',message:'images: min > max'});
 if(c.text.mode!=='none'&&!c.text.expected)ctx.addIssue({code:'custom',message:`text mode ${c.text.mode} needs expected text`});
 if(c.text.mode==='none'&&c.text.expected)ctx.addIssue({code:'custom',message:'text mode none must not have expected text'});
 const seen=new Set();
 for(const o of c.objects){if(seen.has(o.label))ctx.addIssue({code:'custom',message:`duplicate object ${o.label}`});seen.add(o.label);}
});

export function parseImageContract(obj){return imageContractSchema.parse(obj);}
