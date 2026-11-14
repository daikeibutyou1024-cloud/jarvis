// No provider, RSS, Pages business handlers or dynamic imports are reachable here.
// Only D1 statements and fixed fixtures. Never writes existing document/AI tables.
import {STEPS,jstSlot} from './mock-business-plan.js';
import {usdMicro} from './ai-money.js';
export const SCOPE='preview-mock';
export class MockError extends Error {
 constructor(message,status=409){super(message);this.status=status;}
}
const fail=message=>{throw new MockError(message);};
const uuid=()=>crypto.randomUUID();
const LEASE_MS=30000;
const itemId=(day,kind)=>`${SCOPE}-${day}-${kind}`;
const parse=row=>row?{...row,payload:JSON.parse(row.payload_json)}:null;
const statement=(db,sql,args=[])=>db.prepare(sql).bind(...args);
async function control(db){
 const row=await statement(db,'SELECT * FROM automation_control WHERE scope=?',[SCOPE]).first();
 if(!row)throw new MockError('Preview専用スキーマ・初期制御行が必要です',503);
 return row;
}
async function item(db,day,kind){return parse(await statement(db,'SELECT * FROM automation_work_items WHERE id=? AND scope=?',[itemId(day,kind),SCOPE]).first());}
export async function snapshot(db){
 const c=await control(db);
 const runs=(await statement(db,'SELECT * FROM automation_runs WHERE scope=? ORDER BY started_at DESC,rowid DESC LIMIT 50',[SCOPE]).all()).results;
 const items=(await statement(db,'SELECT * FROM automation_work_items WHERE scope=? ORDER BY updated_at DESC,rowid DESC LIMIT 100',[SCOPE]).all()).results.map(parse);
 const events=(await statement(db,'SELECT * FROM automation_events WHERE scope=? ORDER BY at DESC,rowid DESC LIMIT 50',[SCOPE]).all()).results;
 return {mode:'persistent-preview-mock',control:c,runs,items,events,limits:{runs:50,items:100,events:50},externalRequests:0,realCostUSD:0,automatic:false};
}
function event(db,kind,now,reason,guard,args,runId=null,diagnostic=null){
 return statement(db,`INSERT INTO automation_events(id,scope,run_id,kind,at,diagnostic_id,reason) SELECT ?,?,?,?,?,?,? WHERE ${guard}`,[uuid(),SCOPE,runId,kind,now,diagnostic,reason,...args]);
}
// All mutations compare the persisted version. GET never repairs or creates data.
async function transition(db,c,state,now,kind){
 const write=uuid();
 const guard='EXISTS(SELECT 1 FROM automation_control WHERE scope=? AND last_write_id=?)';
 const results=await db.batch([
  statement(db,`UPDATE automation_control SET state=?,epoch=epoch+1,version=version+1,lease_run_id=NULL,lease_until=NULL,last_write_id=?,updated_at=? WHERE scope=? AND version=?`,[state,write,now,SCOPE,c.version]),
  statement(db,`UPDATE automation_runs SET state='interrupted',finished_at=?,reason=? WHERE scope=? AND state='running' AND ${guard}`,[now,kind,SCOPE,SCOPE,write]),
  event(db,kind,now,'模擬実行のみ。実通信なし',guard,[SCOPE,write]),
 ]);
 if(!results[0].meta?.changes)fail('状態が変わりました。再読込してください');
 return control(db);
}
function validateBody(b){
 if(!b||typeof b!=='object'||Array.isArray(b))throw new MockError('JSON形式が不正です',400);
 const allowed={start:['action','expectedVersion'],stop:['action','expectedVersion'],recover:['action','expectedVersion'],approve:['action','expectedVersion','day','kind','itemVersion','confirmed'],tick:['action','expectedVersion','at','step']};
 if(!allowed[b.action]||Object.keys(b).some(k=>!allowed[b.action].includes(k))||!Number.isSafeInteger(b.expectedVersion)||b.expectedVersion<0)throw new MockError('操作・版・入力項目を確認してください',400);
}
export async function manage(db,b,{budgetUSD='1',now=Date.now()}={}){
 validateBody(b);
 const budget=usdMicro(budgetUSD);
 if(budget>1000000)throw new MockError('モック予算上限は月額1 USDです',503);
 const c=await control(db);
 if(c.version!==b.expectedVersion)fail('状態が変わりました。再読込してください');
 if(b.action==='stop')return transition(db,c,'stopped',now,'manual_stop');
 if(b.action==='recover'){
  if(!c.lease_run_id||c.lease_until>now)fail('回復対象の期限切れ実行はありません');
  return transition(db,c,'stopped',now,'lease_expired');
 }
 if(b.action==='start'){
  if(c.state!=='stopped'||c.lease_run_id)fail('停止・回復後に再開してください');
  return transition(db,c,'running',now,'manual_start');
 }
 if(c.state!=='running'||c.lease_run_id)fail('停止中または実行中です。必要なら停止・中断回復を行ってください');
 if(b.action==='approve')return approve(db,c,b,now);
 return tick(db,c,b,now,budget);
}
async function approve(db,c,b,now){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(b.day)||!['sources','theme'].includes(b.kind)||b.confirmed!==true||!Number.isSafeInteger(b.itemVersion))throw new MockError('対象と明示確認が必要です',400);
 const row=await item(db,b.day,b.kind);
 if(!row||row.version!==b.itemVersion||row.state!=='awaiting_approval')fail('確認対象の版が変わりました');
 const write=uuid(),guard='EXISTS(SELECT 1 FROM automation_control WHERE scope=? AND last_write_id=?)';
 const r=await db.batch([
  statement(db,`UPDATE automation_control SET version=version+1,last_write_id=?,updated_at=? WHERE scope=? AND version=? AND state='running' AND lease_run_id IS NULL`,[write,now,SCOPE,c.version]),
  statement(db,`UPDATE automation_work_items SET state='approved',version=version+1,last_write_id=?,updated_at=? WHERE id=? AND version=? AND state='awaiting_approval' AND ${guard}`,[write,now,row.id,row.version,SCOPE,write]),
  event(db,'mock_approval',now,`${b.day} ${b.kind}: 模擬資料・企画の確認。実記事の全文承認ではありません`,guard,[SCOPE,write]),
 ]);
 if(!r[0].meta?.changes||!r[1].meta?.changes)fail('確認が競合しました');
 return {state:'approved'};
}
async function tick(db,c,b,now,budget){
 let slot;try{slot=jstSlot(b.at);}catch{throw new MockError('タイムゾーン付き模擬時刻が必要です',400);}
 const step=STEPS.find(s=>s.key===b.step);
 if(!step||slot.minute<step.minute||slot.minute>=1200)fail('工程の開始時刻から20:00までの模擬時刻を指定してください');
 if(c.clock_ms!==null&&slot.now<c.clock_ms)fail('模擬時刻は巻き戻せません');
 const previous=await statement(db,'SELECT * FROM automation_runs WHERE scope=? AND day=? AND step=?',[SCOPE,slot.day,step.key]).first();
 if(previous){
  // Only an unclaimed approval wait can be resumed. Interrupted/failed/completed slots stay immutable.
  if(previous.state!=='awaiting_approval')fail('同日同工程は実行済みです。自動再試行しません');
 }
 const requires={themes:['sources'],content:['theme'],save:['drafts']}[step.key]||[];
 const inputs={};
 for(const kind of requires){
  inputs[kind]=await item(db,slot.day,kind);
  if(!inputs[kind])fail('前工程が未完了です');
 }
 const waiting=requires.some(k=>['sources','theme'].includes(k)&&inputs[k].state!=='approved');
 if(step.key==='save'&&inputs.drafts.state!=='prepared')fail('保存可能な原稿がありません');
 if(previous&&!waiting&&previous.input_json!==JSON.stringify(Object.fromEntries(Object.entries(inputs).map(([k,v])=>[k,{id:v.id}]))))fail('確認対象が変わりました');
 const id=previous?.id||uuid(),token=uuid(),diagnostic=uuid(),write=uuid();
 const inputJSON=JSON.stringify(Object.fromEntries(Object.entries(inputs).map(([k,v])=>[k,{id:v.id}])));
 const calls=!waiting&&['themes','content'].includes(step.key)?1:0;
 const reserve=calls*2000;
 const month=slot.day.slice(0,7);
 // Atomic global lease + version/epoch fencing. Budget is mock-only, never the real AI ledger.
 const claimGuard=`scope=? AND version=? AND state='running' AND lease_run_id IS NULL
 AND (?=0 OR (SELECT COALESCE(SUM(CASE WHEN state IN ('running','interrupted') THEN reserved_micro ELSE mock_cost_micro END),0) FROM automation_runs WHERE scope=? AND substr(day,1,7)=?)+?<=?)
 AND (SELECT COALESCE(SUM(mock_calls),0) FROM automation_runs WHERE scope=? AND day=?) + ? <= 10`;
 const claim=await db.batch([
  statement(db,`UPDATE automation_control SET version=version+1,clock_ms=?,lease_run_id=?,lease_until=?,last_write_id=?,updated_at=? WHERE ${claimGuard}`,[slot.now,id,now+LEASE_MS,write,now,SCOPE,c.version,calls,SCOPE,month,reserve,budget,SCOPE,slot.day,calls]),
  statement(db,`INSERT INTO automation_runs(id,scope,day,step,project_id,state,epoch,started_at,deadline,diagnostic_id,reason,input_json,write_token,mock_calls,reserved_micro)
 SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM automation_control WHERE scope=? AND last_write_id=?)
 ON CONFLICT(scope,day,step) DO UPDATE SET state=excluded.state,epoch=excluded.epoch,started_at=excluded.started_at,deadline=excluded.deadline,diagnostic_id=excluded.diagnostic_id,write_token=excluded.write_token,mock_calls=excluded.mock_calls,reserved_micro=excluded.reserved_micro,finished_at=NULL,reason='' WHERE automation_runs.state='awaiting_approval'`,[id,SCOPE,slot.day,step.key,`${SCOPE}-${slot.day}`, 'running',c.epoch,now,now+LEASE_MS,diagnostic,'',inputJSON,token,calls,reserve,SCOPE,write]),
  event(db,'claimed',now,step.key,'EXISTS(SELECT 1 FROM automation_control WHERE scope=? AND last_write_id=?)',[SCOPE,write],id,diagnostic),
 ]);
 if(!claim[0].meta?.changes||!claim[1].meta?.changes)fail('同時実行・状態変更・モック予算上限により開始しませんでした');
 try{
  const output=waiting?null:await produce(db,slot,step.key,inputs);
  const state=waiting?'awaiting_approval':'completed';
  const completedAt=Date.now();
  // D1 batch is one transaction: statements run sequentially, SQL errors roll it
  // back, but a WHERE matching zero rows does NOT cause rollback. Linearize the
  // result once, in the first UPDATE, at D1's clock. Stop/claim transactions are
  // serialized before or after this entire batch, never between its statements.
  const guard=`EXISTS(SELECT 1 FROM automation_control c JOIN automation_runs r ON r.id=c.lease_run_id WHERE c.scope=? AND c.state='running' AND c.epoch=? AND r.epoch=c.epoch AND r.id=? AND r.write_token=? AND r.state='running' AND c.version=? AND c.last_write_id=? AND c.lease_until>? AND r.deadline>? AND MIN(c.lease_until,r.deadline)>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER))`;
  const args=[SCOPE,c.epoch,id,token,c.version+1,write,completedAt,completedAt];
  // This token/state pair can exist only if THIS batch's acceptance UPDATE won.
  // Later statements must not re-evaluate wall time (which can cross deadline).
  const accepted=`EXISTS(SELECT 1 FROM automation_runs WHERE scope=? AND id=? AND epoch=? AND write_token=? AND state=?)`;
  const acceptedArgs=[SCOPE,id,c.epoch,token,state];
  const completionEvent=uuid(),items=output?.items||[];
  const ss=[statement(db,`UPDATE automation_runs SET state=?,finished_at=?,reason=?,result_json=?,mock_cost_micro=? WHERE id=? AND ${guard}`,[state,completedAt,waiting?'approval_required':'',JSON.stringify(output?.result||{approval:'required'}),calls*1000,id,...args])];
  for(const row of items)ss.push(statement(db,`INSERT INTO automation_work_items(id,scope,day,kind,version,state,payload_json,origin_run_id,last_write_id,created_at,updated_at) SELECT ?,?,?,?,1,?,?,?,?,?,? WHERE ${accepted}`,[itemId(slot.day,row.kind),SCOPE,slot.day,row.kind,row.state,JSON.stringify(row.payload),id,token,completedAt,completedAt,...acceptedArgs]));
  ss.push(statement(db,`INSERT INTO automation_events(id,scope,run_id,kind,at,diagnostic_id,reason) SELECT ?,?,?,?,?,?,? WHERE ${accepted}`,[completionEvent,SCOPE,id,state,completedAt,diagnostic,waiting?'模擬資料・企画の明示確認が必要です':step.key,...acceptedArgs]));
  ss.push(statement(db,`UPDATE automation_control SET lease_run_id=NULL,lease_until=NULL,version=version+1,updated_at=?,last_write_id=? WHERE scope=? AND lease_run_id=? AND epoch=? AND state='running' AND ${accepted}`,[completedAt,token,SCOPE,id,c.epoch,...acceptedArgs]));
  // Assert the postcondition INSIDE the transaction, not after batch commits.
  // The existing NOT NULL on events.reason deliberately raises a SQL error if
  // acceptance succeeded but a subsequent write/release silently affected 0 rows.
  // D1 then rolls back the acceptance and every result write together. No new
  // table, trigger, schema change, BEGIN/COMMIT or unsupported transaction API.
  ss.push(statement(db,`INSERT INTO automation_events(id,scope,kind,at,reason)
 SELECT ?,?,'atomicity_assertion',?,NULL WHERE ${accepted} AND NOT (
 EXISTS(SELECT 1 FROM automation_control WHERE scope=? AND epoch=? AND state='running' AND lease_run_id IS NULL AND lease_until IS NULL AND last_write_id=?)
 AND EXISTS(SELECT 1 FROM automation_events WHERE id=? AND scope=? AND run_id=? AND kind=?)
 AND (SELECT COUNT(*) FROM automation_work_items WHERE scope=? AND origin_run_id=? AND last_write_id=?)=?)`,[uuid(),SCOPE,completedAt,...acceptedArgs,SCOPE,c.epoch,token,completionEvent,SCOPE,id,state,SCOPE,id,token,items.length]));
  const saved=await db.batch(ss);
  if(!saved[0].meta?.changes)fail('停止・期限切れ・競合の結果は保存しません。必要なら中断回復してください');
  return {state,runId:id,diagnosticId:diagnostic};
 }catch(error){
  // Preserve the durable claim. Explicit stop/recover fences it; never retry implicitly.
  throw error instanceof MockError?error:new MockError('保存に失敗しました。原稿は上書きせず、停止または期限後の中断回復を待ちます',503);
 }
}
async function produce(db,slot,step,inputs){
 const result={simulation:true,externalRequests:0,realCostUSD:0};
 if(step==='collect')return {result,items:[{kind:'sources',state:'awaiting_approval',payload:{simulation:true,text:'架空の資料：AIで下書きを作成し、人間が出典と内容を確認する。',source:'fixture-only'}}]};
 if(step==='themes')return {result,items:[{kind:'theme',state:'awaiting_approval',payload:{simulation:true,title:'模擬：AI下書きの確認手順',sourceId:inputs.sources.id,sourceVersion:inputs.sources.version}}]};
 if(step==='content')return {result,items:[{kind:'drafts',state:'prepared',payload:{simulation:true,themeId:inputs.theme.id,themeVersion:inputs.theme.version,note:'# 模擬：AI下書きの確認手順\n\n## 手順\n資料と原稿を人間が確認します。架空の教材です。',sns:'【模擬・未確認】AI下書きの確認手順を紹介する案。外部公開なし。',humanReview:'pending'}}]};
 if(step==='save')return {result:{...result,saved:2},items:[{kind:'saved_drafts',state:'saved',payload:{...inputs.drafts.payload,sourceDraftId:inputs.drafts.id,humanReview:'pending'}}]};
 const runs=(await statement(db,'SELECT step,state,diagnostic_id,reason,mock_calls,mock_cost_micro FROM automation_runs WHERE scope=? AND day=? ORDER BY started_at,rowid',[SCOPE,slot.day]).all()).results;
 const saved=await item(db,slot.day,'saved_drafts');
 return {result,items:[{kind:'daily_report',state:'saved',payload:{...result,day:slot.day,timezone:'Asia/Tokyo',steps:STEPS.map(s=>s.key==='report'?{step:s.key,state:'completed'}:runs.find(r=>r.step===s.key)||{step:s.key,state:'not_run'}),savedDrafts:saved?2:0,mockCalls:runs.reduce((n,r)=>n+r.mock_calls,0),mockCostMicroUSD:runs.reduce((n,r)=>n+r.mock_cost_micro,0),actualRevenue:null,actualInvoiceUSD:null}}]};
}
