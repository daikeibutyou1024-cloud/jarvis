import {sourceCatalog,referenceUrl} from '../assets/research-data.js';
import {onRequestGet as collect} from '../functions/api/research/collect.js';
export const SCHEDULE_SCHEMA=[
 `CREATE TABLE IF NOT EXISTS collection_schedules (id TEXT PRIMARY KEY, name TEXT NOT NULL, source TEXT NOT NULL, query TEXT NOT NULL, interval_minutes INTEGER NOT NULL, enabled INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL, next_run_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
 `CREATE TABLE IF NOT EXISTS collection_runs (id TEXT PRIMARY KEY, schedule_id TEXT NOT NULL, schedule_version INTEGER NOT NULL, due_at INTEGER NOT NULL, state TEXT NOT NULL, started_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, finished_at INTEGER, result_json TEXT, UNIQUE(schedule_id,schedule_version,due_at))`,
 `CREATE INDEX IF NOT EXISTS idx_collection_runs_time ON collection_runs(started_at)`,
 `CREATE TABLE IF NOT EXISTS research_inbox (id TEXT PRIMARY KEY, source TEXT NOT NULL, source_url TEXT NOT NULL, fingerprint TEXT NOT NULL, record_json TEXT NOT NULL, run_id TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'new', created_at INTEGER NOT NULL, UNIQUE(source,source_url,fingerprint))`,
];
export class ScheduleError extends Error{constructor(message,status=400,code='SCHEDULE_INPUT'){super(message);this.status=status;this.code=code;}}
export async function initSchedules(db){for(const sql of SCHEDULE_SCHEMA)await db.prepare(sql).run();}
export function scheduleConfig(env){
 const limit=env.COLLECTION_DAILY_LIMIT===undefined?4:Number(env.COLLECTION_DAILY_LIMIT);
 if(!Number.isSafeInteger(limit)||limit<1||limit>10)throw new ScheduleError('定期収集の回数設定が不正です',503,'SCHEDULE_CONFIG');
 return {enabled:env.COLLECTION_AUTOMATION_ENABLED==='true',dailyLimit:limit,hasToken:typeof env.JARVIS_SCHEDULER_TOKEN==='string'&&env.JARVIS_SCHEDULER_TOKEN.length>=32&&env.JARVIS_SCHEDULER_TOKEN!==env.JARVIS_ACCESS_PASSWORD};
}
export function scheduleInput(b){
 if(!b||typeof b.name!=='string'||!b.name.trim()||b.name.length>80||!Object.hasOwn(sourceCatalog,b.source)||typeof b.query!=='string'||!b.query.trim()||b.query.length>80||/[\u0000-\u001f:<>"\\]/.test(b.query)||!Number.isSafeInteger(b.intervalMinutes)||b.intervalMinutes<60||b.intervalMinutes>1440||typeof b.enabled!=='boolean')throw new ScheduleError('名称・許可情報源・キーワード・間隔（60〜1440分）を確認してください');
 if(b.id!==undefined&&(typeof b.id!=='string'||!/^[-a-zA-Z0-9]{1,80}$/.test(b.id)))throw new ScheduleError('収集設定IDが不正です');
 if(!Number.isSafeInteger(b.expectedVersion)||b.expectedVersion<0)throw new ScheduleError('設定の版を指定してください');
 return {id:b.id||crypto.randomUUID(),name:b.name.trim(),source:b.source,query:b.query.trim(),interval:b.intervalMinutes,enabled:b.enabled?1:0,expected:b.expectedVersion};
}
export async function saveSchedule(db,b,now=Date.now()){
 const s=scheduleInput(b);await initSchedules(db);
 let result;
 if(s.expected===0)result=await db.prepare(`INSERT OR IGNORE INTO collection_schedules(id,name,source,query,interval_minutes,enabled,version,next_run_at,updated_at) SELECT ?,?,?,?,?,?,1,?,? WHERE (SELECT COUNT(*) FROM collection_schedules)<10`).bind(s.id,s.name,s.source,s.query,s.interval,s.enabled,now,now).run();
 else result=await db.prepare(`UPDATE collection_schedules SET name=?,source=?,query=?,interval_minutes=?,enabled=?,version=version+1,next_run_at=?,updated_at=? WHERE id=? AND version=?`).bind(s.name,s.source,s.query,s.interval,s.enabled,now,now,s.id,s.expected).run();
 if(!result.meta?.changes)throw new ScheduleError('別の更新が完了したか、設定数の上限10件です。再取得してください',409,'SCHEDULE_CONFLICT');
 return db.prepare('SELECT * FROM collection_schedules WHERE id=?').bind(s.id).first();
}
export async function recoverCollections(db,now=Date.now()){
 await initSchedules(db);
 await db.prepare("UPDATE collection_runs SET state='interrupted',finished_at=?,result_json=json_set(COALESCE(result_json,'{}'),'$.error',?) WHERE state='running' AND expires_at<=?").bind(now,'処理が中断しました。同じ実行は自動再試行しません',now).run();
}
async function active(db,run,now){
 return db.prepare("SELECT r.id FROM collection_runs r JOIN collection_schedules s ON s.id=r.schedule_id WHERE r.id=? AND r.state='running' AND r.expires_at>? AND s.enabled=1 AND s.version=r.schedule_version").bind(run.id,now).first();
}
async function collector(env,s){
 const url=new URL('https://jarvis.invalid/api/research/collect');url.search=new URLSearchParams({source:s.source,q:s.query});
 const r=await collect({env,request:new Request(url,{headers:{'x-jarvis-password':env.JARVIS_ACCESS_PASSWORD}})});
 const data=await r.json();if(!r.ok||data.status!=='acquired')throw new ScheduleError('情報源の取得制限・通信・解析により未取得です。自動再試行しません',503,'COLLECTION_UNAVAILABLE');
 return data;
}
async function hash(value){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return [...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('');}
function inboxRecord(r,source,now){
 if(!r||typeof r.title!=='string'||!r.title.trim()||r.title.length>160||typeof r.text!=='string'||!r.text.trim()||r.text.length>1000||!referenceUrl(r.sourceUrl)||r.origin!==source||typeof r.fetchedAt!=='string'||r.fetchedAt.length>80||!Number.isFinite(Date.parse(r.fetchedAt)))throw new ScheduleError('収集資料の形式が不正です',503,'COLLECTION_FORMAT');
 return {id:crypto.randomUUID(),title:r.title,text:r.text,sourceUrl:referenceUrl(r.sourceUrl),fetchedAt:r.fetchedAt,recordedAt:new Date(now).toISOString(),publishedAt:typeof r.publishedAt==='string'?r.publishedAt.slice(0,100):null,origin:source,kind:'fact',verification:'source_observed',status:'acquired',price:'',affiliate:'',reviewedAt:null};
}
export async function runDueCollection(env,{clock=()=>Date.now(),collectOnce=collector,timeoutMs=20000}={}){
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<10||timeoutMs>20000)throw new ScheduleError("収集タイムアウトが不正です",503);
 const config=scheduleConfig(env);
 if(!config.enabled)throw new ScheduleError('定期収集は全体停止中です',503,'SCHEDULE_DISABLED');
 if(!env.JARVIS_DB||!env.JARVIS_ACCESS_PASSWORD)throw new ScheduleError('D1・既存認証の設定が必要です',503,'SCHEDULE_CONFIG');
 const db=env.JARVIS_DB,now=clock();await recoverCollections(db,now);
 const count=await db.prepare('SELECT COUNT(*) AS n FROM research_inbox').first();
 if(count.n>=500)return {state:'blocked',reason:'資料の受信箱が上限500件です。新しい外部取得を停止しました'};
 const s=await db.prepare('SELECT * FROM collection_schedules WHERE enabled=1 AND next_run_at<=? ORDER BY next_run_at,id LIMIT 1').bind(now).first();
 if(!s)return {state:'idle'};
 const configSnapshot={name:s.name,source:s.source,query:s.query,intervalMinutes:s.interval_minutes,version:s.version};
 const id=crypto.randomUUID(),day=Math.floor(now/86400000)*86400000;
 const results=await db.batch([
  db.prepare(`INSERT OR IGNORE INTO collection_runs(id,schedule_id,schedule_version,due_at,state,started_at,expires_at,result_json) SELECT ?,id,version,next_run_at,'running',?,?,? FROM collection_schedules WHERE id=? AND version=? AND enabled=1 AND next_run_at=? AND next_run_at<=? AND NOT EXISTS(SELECT 1 FROM collection_runs WHERE state='running') AND (SELECT COUNT(*) FROM collection_runs WHERE started_at>=? AND started_at<?)<?`).bind(id,now,now+timeoutMs+10000,JSON.stringify({config:configSnapshot}),s.id,s.version,s.next_run_at,now,day,day+86400000,config.dailyLimit),
  db.prepare('UPDATE collection_schedules SET next_run_at=? WHERE id=? AND version=? AND EXISTS(SELECT 1 FROM collection_runs WHERE id=?)').bind(now+s.interval_minutes*60000,s.id,s.version,id),
 ]);
 if(!results[0].meta?.changes)return {state:'blocked',reason:'実行中・同時更新・本日の上限のいずれかにより開始しませんでした'};
 const run={id,scheduleId:s.id};let timer;
 try{
  if(!await active(db,run,clock()))throw new ScheduleError('実行設定が変更されました',409,'COLLECTION_CANCELLED');
  const result=await Promise.race([collectOnce(env,s),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new ScheduleError('収集処理がタイムアウトしました。自動再試行しません',504,'COLLECTION_TIMEOUT')),timeoutMs);})]);
  if(!Array.isArray(result.items)||result.items.length>10)throw new ScheduleError('収集結果の形式が不正です',503,'COLLECTION_FORMAT');
  const records=result.items.map(r=>inboxRecord(r,s.source,clock())),statements=[];
  const fingerprints=await Promise.all(records.map(record=>hash(JSON.stringify([record.title,record.text,record.sourceUrl,record.publishedAt]))));
  const finished=clock();
  // Inserts and run completion commit together, guarded against disable, edits and late responses.
  for(const [index,record] of records.entries()){const fingerprint=fingerprints[index];statements.push(db.prepare(`INSERT OR IGNORE INTO research_inbox(id,source,source_url,fingerprint,record_json,run_id,state,created_at) SELECT ?,?,?,?,?,?,'new',? WHERE (SELECT COUNT(*) FROM research_inbox)<500 AND EXISTS(SELECT 1 FROM collection_runs r JOIN collection_schedules s ON s.id=r.schedule_id WHERE r.id=? AND r.state='running' AND r.expires_at>? AND s.enabled=1 AND s.version=r.schedule_version)`).bind(record.id,s.source,record.sourceUrl,fingerprint,JSON.stringify(record),id,finished,id,finished));}
  statements.push(db.prepare(`UPDATE collection_runs SET state=CASE WHEN (SELECT COUNT(*) FROM research_inbox)>=500 THEN 'completed_capacity' ELSE 'completed' END,finished_at=?,result_json=json_set(?,'$.inserted',(SELECT COUNT(*) FROM research_inbox WHERE run_id=?)) WHERE id=? AND state='running' AND expires_at>? AND EXISTS(SELECT 1 FROM collection_schedules s WHERE s.id=schedule_id AND s.version=schedule_version AND s.enabled=1)`).bind(finished,JSON.stringify({config:configSnapshot,acquired:records.length,cached:result.cached===true,fetchedAt:result.fetchedAt||null,notice:'資料は未確認です。記事の完成・公開は行っていません'}),id,id,finished));
  const saved=await db.batch(statements);
  if(!saved.at(-1).meta?.changes)throw new ScheduleError('実行中に設定変更または中断があり、資料を採用しませんでした',409,'COLLECTION_CANCELLED');
  return {state:'completed',runId:id,acquired:records.length,inserted:saved.slice(0,-1).reduce((n,r)=>n+r.meta.changes,0)};
 }catch(error){
  const state=error.code==='COLLECTION_CANCELLED'?'cancelled':error.code==='COLLECTION_TIMEOUT'?'interrupted':'failed';
  await db.prepare("UPDATE collection_runs SET state=?,finished_at=?,result_json=? WHERE id=? AND state='running'").bind(state,clock(),JSON.stringify({config:configSnapshot,error:error instanceof ScheduleError?error.message:'収集または保存に失敗しました。自動再試行しません'}),id).run();
  return {state,runId:id,error:error instanceof ScheduleError?error.message:'収集または保存に失敗しました。自動再試行しません'};
 }finally{clearTimeout(timer);}
}
