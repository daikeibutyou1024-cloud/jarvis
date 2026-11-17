// Tests for retained provider/ledger code predate the unconditional live-AI stop.
// Instrument only these isolated test processes, never application source on disk.
// Current production gates are exercised unmodified by content-preview.test.js.
import {registerHooks} from 'node:module';
import {basename} from 'node:path';
import assert from 'node:assert/strict';
const legacy=new Set(['ai-diagnostics.test.js','ai-reconciliation.test.js','business.test.js','chapter-repair.test.js','content-fixes.test.js','continuation.test.js','editorial.test.js','prototype-flow.test.js','research-jobs.test.js','research3.test.js','stability.test.js']);
if(legacy.has(basename(process.argv[1]||''))){
 assert.ok(process.env.NODE_TEST_CONTEXT,'Fixture must run in an isolated Node test worker');
 const runtime=new URL('../lib/ai-runtime.js',import.meta.url).href;
 const routes=new Set(['../functions/api/chat.js','../functions/api/business/jobs.js','../functions/api/research/ideas.js'].map(p=>new URL(p,import.meta.url).href));
 const gate="return new Response(JSON.stringify({error:liveAIPolicy().reason,code:'AI_BUDGET_UNVERIFIED',budget:liveAIPolicy()}),{status:503,headers:{'content-type':'application/json','cache-control':'no-store'}});";
 registerHooks({load(url,context,nextLoad){const result=nextLoad(url,context);if(url!==runtime&&!routes.has(url))return result;let source=String(result.source);
  const target=url===runtime?"export function requireVerifiedLiveBudget(){throw new AIError(liveAIPolicy().reason,'AI_BUDGET_UNVERIFIED',503);}":gate;
  assert.equal(source.split(target).length,2,'Live policy changed: review the historical offline fixture');
  source=source.replace(target,url===runtime?'export function requireVerifiedLiveBudget(){}':'/* Historical provider-core fixture; all HTTP is mocked by this test. */');
  return {...result,source};
 }});
}
