import {readFileSync,existsSync} from 'node:fs';
import {z} from 'zod';
const agent=z.object({id:z.string().min(1),name:z.string().min(1),credits:z.number().optional(),notes:z.string().optional(),inputSchema:z.any().optional()}).passthrough();
const file=z.object({structured:z.array(agent).default([]),image:z.array(agent).default([])});

/** Service-agent groups per QA mode, from config/agents.json. */
export function createCatalog(data){
 const groups=file.parse(data??{});
 return {
  list:mode=>groups[mode]??[],
  /** No agentId → the first agent of the group; unknown agentId → null. */
  resolve(mode,agentId){const g=groups[mode]??[];return agentId?g.find(a=>a.id===agentId)??null:g[0]??null;},
 };
}
export function loadCatalog(path='config/agents.json'){
 return createCatalog(existsSync(path)?JSON.parse(readFileSync(path,'utf8')):{});
}
