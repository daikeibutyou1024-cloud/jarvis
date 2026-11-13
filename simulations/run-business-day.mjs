// CLI simulation. No process.env credentials, timer, server, cron or remote bindings are used.
import {mkdir,writeFile} from 'node:fs/promises';
import {createDaySimulation} from './business-day.mjs';
import {renderSimulationReports} from './report-html.mjs';
const previousFetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('実APIは禁止です');};
try{
 const reports=[];
 for(const scenario of ['normal','unreviewed','timeout','budget']){
  const sim=await createDaySimulation(scenario==='budget'?{monthlyBudgetUSD:'0.000001'}:{scenario:scenario==='timeout'?'timeout':'normal'});
  const at=time=>'2026-11-13T'+time+':00+09:00';
  try{
   await sim.tick(at('12:00'));
   if(scenario!=='unreviewed')await sim.reviewSources(at('13:00'),true);
   await sim.tick(at('14:00'));
   if(['normal','timeout'].includes(scenario))await sim.approveTheme(at('15:00'),true);
   for(const time of ['16:00','18:00','19:30'])await sim.tick(at(time));
   const report=await sim.report(at('19:31'));reports.push({name:{normal:'正常例：明示的な模擬承認あり',unreviewed:'資料未確認で停止',timeout:'AIタイムアウト',budget:'予算不足'}[scenario],report});
   console.log(JSON.stringify({scenario,steps:report.steps.map(x=>({time:x.time,state:x.state,code:x.code})),drafts:report.drafts.length,mockCalls:report.counts.mockAICalls,cost:report.cost,externalRequests:report.externalRequests}));
  }finally{sim.close();}
 }
 await mkdir(new URL('../work/',import.meta.url),{recursive:true});
 await writeFile(new URL('../work/b-simulation-report.html',import.meta.url),renderSimulationReports(reports));
 await writeFile(new URL('../work/b-simulation-report.json',import.meta.url),JSON.stringify(reports,null,2));
 console.log('ローカル表示用：work/b-simulation-report.html / 詳細：work/b-simulation-report.json');
}finally{globalThis.fetch=previousFetch;}
