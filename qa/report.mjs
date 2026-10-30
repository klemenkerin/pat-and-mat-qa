const ICON={pass:'PASS',fail:'FAIL',warn:'WARN',skip:'SKIP'};
const cell=s=>String(s??'').replace(/\|/g,'\\|').replace(/\r?\n/g,' ').slice(0,160);

export function buildReport({checks,attempt,jobId,agentId,deliverable}){
 const failed=checks.filter(c=>c.status==='fail');
 const verdict=failed.length?'fail':'pass';
 const summary=failed.length?`${failed.length} of ${checks.length} checks failed: ${failed.map(c=>c.id).join(', ')}`:`all ${checks.filter(c=>c.status==='pass').length} checks passed${checks.some(c=>c.status==='warn')?' (with warnings)':''}`;
 return {verdict,summary,attempt,jobId,agentId,deliverable:deliverable?{origin:deliverable.origin,name:deliverable.name,sha256:deliverable.sha256}:null,checks};
}

export function renderReportMarkdown(r){
 const rows=r.checks.map(c=>`| ${ICON[c.status]} | ${cell(c.id)} | ${cell(c.expected)} | ${cell(c.observed)} |`).join('\n');
 const ev=r.checks.filter(c=>c.status!=='pass'&&c.evidence?.length).map(c=>`**${c.id}**\n${c.evidence.map(e=>`- ${e}`).join('\n')}`).join('\n\n');
 const src=r.deliverable?`\nDeliverable: ${r.deliverable.origin}${r.deliverable.name?` (${r.deliverable.name})`:''}, sha256 \`${r.deliverable.sha256?.slice(0,16)}…\``:'';
 return `**QA verdict: ${r.verdict.toUpperCase()}** (attempt ${r.attempt??'?'}, job ${r.jobId??'-'}): ${r.summary}${src}\n\n| Result | Check | Expected | Observed |\n|---|---|---|---|\n${rows}${ev?`\n\nExamples:\n\n${ev}`:''}`;
}

/** Deterministic fix instructions: one per failed check, never dropped. */
export function fixInstructions(r){
 return r.checks.filter(c=>c.status==='fail').map(c=>c.fix??`${c.criterion}: expected ${c.expected}, got ${c.observed}.`);
}
