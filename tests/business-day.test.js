import test from 'node:test';
import assert from 'node:assert/strict';
import {renderSimulationReports} from '../simulations/report-html.mjs';
import {createDaySimulation,jstSlot,STEPS} from '../simulations/business-day.mjs';
const t=(time,day='2026-11-13')=>`${day}T${time}:00+09:00`;
async function prepared(options={}){const s=await createDaySimulation(options);await s.tick(t('12:00'));await s.reviewSources(t('13:00'),true);await s.tick(t('14:00'));await s.approveTheme(t('15:00'),true);return s;}
test('JST slots are independent of host timezone and UTC date',()=>{
 assert.equal(jstSlot('2026-11-13T03:00:00Z').minute,720);assert.equal(jstSlot('2026-11-12T15:00:00Z').day,'2026-11-13');assert.throws(()=>jstSlot('2026-02-30T12:00:00+09:00'));
 assert.deepEqual(STEPS.map(x=>x.time),['12:00','14:00','16:00','18:00','19:30']);
});
test('all five slots, two manual approvals, immutable drafts and daily report',async()=>{
 const s=await prepared();try{
  await s.tick(t('16:00'));assert.equal((await s.report(t('16:01'))).drafts.length,0);
  await s.tick(t('18:00'));await s.tick(t('19:30'));const r=await s.report(t('19:31'));
  assert.deepEqual(r.steps.map(x=>x.state),Array(5).fill('completed'));assert.equal(r.drafts.length,2);assert.equal(r.counts.sources,1);assert.equal(r.counts.mockAICalls,2);assert.equal(r.externalRequests,0);assert.equal(s.dailyReport(t('19:31')).steps[4].state,'completed');assert.equal(r.cost.invoiceVerified,false);assert.equal(r.actualRevenue,null);
  for(const d of r.drafts){const loaded=await s.readDraft(d.projectId);assert.equal(loaded.approved,false);assert.match(loaded.evidence,/資料ID/);assert.match(loaded.output,/模擬/);assert.equal(loaded.revision,1);}
  assert.equal((await s.readDraft('protected-article')).output,'既存の模擬原稿：変更禁止');
 }finally{s.close();}
});
test('before noon and at/after 20:00 never claim a run',async()=>{
 const s=await createDaySimulation();try{for(const x of ['00:00','11:59','20:00','23:59'])assert.equal((await s.tick(t(x))).state,'outside_window');assert.equal((await s.report(t('20:01'))).claimedRuns,0);}finally{s.close();}
});
test('missed slots are not backfilled and later steps cannot bypass dependencies',async()=>{
 const s=await createDaySimulation();try{await s.tick(t('16:00'));await s.tick(t('19:30'));const r=await s.report(t('19:31'));assert.equal(r.steps[0].state,'not_run');assert.equal(r.steps[2].state,'blocked');assert.equal(r.steps[4].state,'completed');assert.equal(r.counts.mockAICalls,0);}finally{s.close();}
});
test('concurrent and repeated calls cannot duplicate execution or saving',async()=>{
 const s=await prepared();try{await Promise.all(Array.from({length:8},()=>s.tick(t('16:00'))));await Promise.all(Array.from({length:8},()=>s.tick(t('18:00'))));const r=await s.report(t('18:01'));assert.equal(r.counts.mockAICalls,2);assert.equal(r.drafts.length,2);assert.equal(r.claimedRuns,4);for(const d of r.drafts)assert.equal((await s.readDraft(d.projectId)).revision,1);}finally{s.close();}
});
test('unreviewed sources block themes and generation, report still runs',async()=>{
 const s=await createDaySimulation();try{await s.tick(t('12:00'));await s.tick(t('14:00'));await s.tick(t('16:00'));await s.tick(t('18:00'));await s.tick(t('19:30'));const r=await s.report(t('19:31'));assert.equal(r.steps[1].state,'awaiting_approval');assert.equal(r.sources[0].reviewedAt,null);assert.equal(r.counts.mockAICalls,0);assert.equal(r.drafts.length,0);assert.equal(r.steps[4].state,'completed');assert(r.steps[1].diagnosticId);}finally{s.close();}
});
test('theme selection requires a separate explicit manual approval',async()=>{
 const s=await createDaySimulation();try{await s.tick(t('12:00'));await assert.rejects(s.reviewSources(t('13:00'),false));await s.reviewSources(t('13:00'),true);await s.tick(t('14:00'));await s.tick(t('16:00'));const r=await s.report(t('16:01'));assert.equal(r.steps[2].state,'awaiting_approval');assert.equal(r.counts.mockAICalls,1);assert.equal(r.drafts.length,0);}finally{s.close();}
});
for(const scenario of ['timeout','budget','quota','invalid','max_tokens','save_conflict','collection_failure'])test('safe stop: '+scenario,async()=>{
 const opts=scenario==='budget'?{monthlyBudgetUSD:'0.000001'}:scenario==='quota'?{priorCalls:10}:{scenario};
 const s=await createDaySimulation(opts);try{
  await s.tick(t('12:00'));if(scenario!=='collection_failure')await s.reviewSources(t('13:00'),true);await s.tick(t('14:00'));
  if(!['budget','quota','collection_failure'].includes(scenario))await s.approveTheme(t('15:00'),true);
  await s.tick(t('16:00'));await s.tick(t('18:00'));await s.tick(t('19:30'));const before=await s.report(t('19:31'));await assert.rejects(s.tick(t('16:00')));const after=await s.report(t('19:32'));
  if(scenario!=='max_tokens')assert(before.steps.some(x=>['failed','blocked','awaiting_approval'].includes(x.state)));assert.equal(before.counts.mockAICalls,after.counts.mockAICalls);assert.equal((await s.readDraft('protected-article')).output,'既存の模擬原稿：変更禁止');assert.equal(before.steps[4].state,'completed');
  if(scenario==='timeout')assert(before.cost.uncertainReservedUSD>0);
  if(scenario==='save_conflict'){assert.equal(await s.readDraft('sim-note-2026-11-13'),null);assert.equal((await s.readDraft('sim-sns-2026-11-13')).output,'同時保存された既存SNS模擬原稿');assert.equal(before.steps[3].code,'SAVE_CONFLICT');assert.equal(before.pending,true);}
  if(scenario==='budget'||scenario==='quota')assert.equal(before.counts.mockAICalls,0);
  if(scenario==='max_tokens'){assert.equal(before.drafts.length,2);assert.equal((await s.readDraft(before.drafts[0].projectId)).generation.completionStatus,'incomplete');}
  else assert.equal(before.drafts.length,0);
 }finally{s.close();}
});
test('simulation rejects live bindings, credentials, invalid options and non-monotonic clocks',async()=>{
 await assert.rejects(createDaySimulation({JARVIS_DB:{}}));await assert.rejects(createDaySimulation({monthlyBudgetUSD:'2'}));const s=await createDaySimulation();try{await s.tick(t('14:00'));await assert.rejects(s.tick(t('12:00')));}finally{s.close();}
});

test('daily report is saved once and per-day usage does not include the previous day',async()=>{
 const s=await prepared();try{await s.tick(t('16:00'));await s.tick(t('18:00'));await s.tick(t('19:30'));const original=JSON.stringify(s.dailyReport(t('19:31')));
 const day='2026-11-14';await s.tick(t('12:00',day));await s.reviewSources(t('13:00',day),true);await s.tick(t('14:00',day));await s.approveTheme(t('15:00',day),true);await s.tick(t('16:00',day));await s.tick(t('18:00',day));await s.tick(t('19:30',day));
 const r=await s.report(t('19:31',day));assert.equal(r.counts.mockAICalls,2);assert.equal(r.drafts.length,2);assert.equal(JSON.stringify(s.dailyReport(t('19:31'))),original);
 }finally{s.close();}
});

test('report HTML escapes data and has no script or remote asset references',async()=>{
 const s=await createDaySimulation();try{const r=await s.report(t('19:31'));const html=renderSimulationReports([{name:'<script>alert(1)</script>',report:r}]);assert(!html.includes('<script>'));assert(html.includes('&lt;script&gt;'));assert(!/<(?:script|link|iframe|img)\b/i.test(html));}finally{s.close();}
});
