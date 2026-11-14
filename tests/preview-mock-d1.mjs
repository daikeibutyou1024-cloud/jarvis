// Uses Miniflare/workerd's real LOCAL D1 binding and batch implementation.
// No account, remote DB, credentials, deployment, Cron or remote proxy is used.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {readFileSync} from 'node:fs';
import {manage,snapshot} from '../lib/preview-mock.js';
let runtime;
try{runtime=await import('miniflare');}
catch{if(!process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES)throw Error('Local Miniflare dependency is required');runtime=createRequire(import.meta.url)(resolve(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'miniflare'));}
const {Miniflare,convertV4MiniflareOptions}=runtime;
const cases=['normal','concurrent','expired','stop','epoch','token','version','item_noop','event_noop','release_noop','unique_conflict'];
let outbound=0;
const options={modules:true,script:'export default {fetch(){return new Response("Local D1 tests only",{status:405});}}',compatibilityDate:'2026-11-11',d1Persist:false,d1Databases:Object.fromEntries(cases.map(name=>[name,'local-mock-'+name])),outboundService:()=>{outbound++;throw Error('External network is forbidden');}};
const mf=new Miniflare(convertV4MiniflareOptions?convertV4MiniflareOptions(options):options);
const schema=readFileSync(new URL('../migrations/0011_preview_mock_automation.sql',import.meta.url),'utf8').split(';').filter(s=>s.trim());
async function dump(db){return Promise.all(['automation_control','automation_runs','automation_work_items','automation_events'].map(async t=>(await db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()).results));}
try{
 for(const name of cases){
  const base=await mf.getD1Database(name);await base.batch(schema.map(s=>base.prepare(s)));
  await manage(base,{action:'start',expectedVersion:0});
  if(name==='concurrent'){
   const version=(await snapshot(base)).control.version;
   const results=await Promise.allSettled([1,2].map(()=>manage(base,{action:'tick',expectedVersion:version,step:'collect',at:'2026-11-14T12:00:00+09:00'})));
   assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
   const s=await snapshot(base);assert.equal(s.runs.length,1);assert.equal(s.items.length,1);assert.equal(s.control.lease_run_id,null);
   console.log('PASS local workerd D1: concurrent claim serialization');continue;
  }
  if(name==='normal'){
   async function act(action,more={}){return manage(base,{action,expectedVersion:(await snapshot(base)).control.version,...more});}
   const tick=(step,hour)=>act('tick',{step,at:`2026-11-14T${hour}:00+09:00`});
   const approve=async kind=>{const i=(await snapshot(base)).items.find(x=>x.kind===kind);return act('approve',{day:i.day,kind,itemVersion:i.version,confirmed:true});};
   await tick('collect','12:00');await tick('themes','14:00');await approve('sources');await tick('themes','14:00');await tick('content','16:00');await approve('theme');await tick('content','16:00');await act('stop');await act('start');await tick('save','18:00');await tick('report','19:30');
   const s=await snapshot(base);assert.equal(s.runs.filter(r=>r.state==='completed').length,5);assert.equal(s.items.find(i=>i.kind==='daily_report').payload.savedDrafts,2);assert.equal(s.control.lease_run_id,null);
   console.log('PASS local workerd D1: normal + approvals + stop/resume + save/report');continue;
  }
  let batchNumber=0,before;
  const wrapped={prepare:sql=>base.prepare(sql),async batch(ss){
   if(++batchNumber===2){
    if(name==='expired')await base.prepare('UPDATE automation_runs SET deadline=0').run();
    if(name==='stop')await manage(base,{action:'stop',expectedVersion:(await snapshot(base)).control.version});
    if(name==='epoch')await base.prepare('UPDATE automation_runs SET epoch=epoch+1').run();
    if(name==='token')await base.prepare("UPDATE automation_runs SET write_token='stale-owner'").run();
    if(name==='version')await base.prepare('UPDATE automation_control SET version=version+1').run();
    if(name==='unique_conflict')await base.prepare("INSERT INTO automation_work_items VALUES('preview-mock-2026-11-14-sources','preview-mock','2026-11-14','sources',1,'protected','{}','prior','prior',0,0)").run();
    before=await dump(base);
    const skipped={item_noop:1,event_noop:2,release_noop:3}[name];
    if(skipped!==undefined)ss[skipped]=base.prepare('UPDATE automation_control SET version=version WHERE 0');
   }
   return base.batch(ss);
  }};
  await assert.rejects(manage(wrapped,{action:'tick',expectedVersion:(await snapshot(base)).control.version,step:'collect',at:'2026-11-14T12:00:00+09:00'}));
  assert.deepEqual(await dump(base),before);
  if(name==='expired'){
   const s=await snapshot(base);
   await manage(base,{action:'recover',expectedVersion:s.control.version},{now:s.control.lease_until+1});
   const after=await snapshot(base);assert.equal(after.control.state,'stopped');assert.equal(after.runs[0].state,'interrupted');assert.equal(after.items.length,0);
  }
  console.log('PASS local workerd D1: unchanged completion on '+name);
 }
 assert.equal(outbound,0);console.log(`PASS: ${cases.length} local workerd D1 cases; external requests 0`);
}finally{await mf.dispose();}
