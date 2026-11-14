// LOCAL SIMULATION ONLY. Node SQLite :memory:, fixed fixtures, no fetch/Cloudflare binding/cron.
import {testDB} from '../tests/runtime-fixture.js';
import {receivedRecord,researchPacket} from '../assets/research-data.js';
import {validateEvidence,validateIdeas,ideaPrompt} from '../lib/research-ideas.js';
import {buildPrompt} from '../assets/business.js';
import {aiConfig,initAI} from '../lib/ai-runtime.js';
import {reserveAI} from '../lib/ai-quota.js';
import {normalizeResult} from '../lib/generation.js';
import {defaultOutline,editorialReport} from '../lib/editorial.js';
import {saveRevision,latestDocument} from '../lib/documents.js';
import {monthlyReport} from '../lib/monthly-report.js';
import {usdMicro} from '../lib/ai-money.js';
import {STEPS,jstSlot} from '../lib/mock-business-plan.js';
export {STEPS,jstSlot};
class Stop extends Error{constructor(code,message,state='blocked'){super(message);this.code=code;this.state=state;}}
const fail=(code,message,state)=>{throw new Stop(code,message,state);};
const notices={sources:'資料内容・出典の確認を模擬操作で行ってください',theme:'採用企画の承認が必要です。後続へ自動で進みません'};
export async function createDaySimulation(options={}){
 const keys=['monthlyBudgetUSD','scenario','priorCalls'];if(Object.keys(options).some(k=>!keys.includes(k)))throw Error('実環境の設定・接続先・認証情報は受け付けません');
 const {monthlyBudgetUSD='1',scenario='normal',priorCalls=0}=options;
 if(usdMicro(monthlyBudgetUSD)>1000000||!Number.isInteger(priorCalls)||priorCalls<0||priorCalls>10||!['normal','timeout','invalid','max_tokens','save_conflict','collection_failure'].includes(scenario))throw Error('模擬設定が不正です');
 const db=testDB(); // Always newly-created in-memory SQLite; no path/env/binding input exists.
 const env={JARVIS_DB:db,AI_MONTHLY_BUDGET_USD:monthlyBudgetUSD,ANTHROPIC_API_KEY:'simulation-not-a-real-key',AI_PRICING_JSON:JSON.stringify({'anthropic/claude-sonnet-4-6':{input:3,output:15}})};
 db.db.exec(`CREATE TABLE b_sim_runs(day TEXT,step TEXT,state TEXT,diagnostic_id TEXT,code TEXT,reason TEXT,payload TEXT,PRIMARY KEY(day,step));
 CREATE TABLE b_sim_sources(day TEXT PRIMARY KEY,payload TEXT);
 CREATE TABLE b_sim_theme(day TEXT PRIMARY KEY,payload TEXT,approved INTEGER DEFAULT 0);
 CREATE TABLE b_sim_pending(day TEXT PRIMARY KEY,payload TEXT);
 CREATE TABLE b_sim_approvals(day TEXT,kind TEXT,at TEXT,PRIMARY KEY(day,kind));`);
 await initAI(db);await saveRevision(db,'protected-article',0,{department:'content',topic:'既存の模擬記事',output:'既存の模擬原稿：変更禁止',approved:false,simulation:true});
 let lastTime=-Infinity,priorSeeded=false,closed=false;
 const slot=value=>{if(closed)throw Error('模擬DBは終了しています');return jstSlot(value);};
 const advance=value=>{const s=slot(value);if(s.now<lastTime)throw Error('シミュレーション時刻を巻き戻せません');lastTime=s.now;return s;};
 const run=(day,step)=>db.db.prepare('SELECT * FROM b_sim_runs WHERE day=? AND step=?').get(day,step);
 const read=(table,day)=>{const row=db.db.prepare(`SELECT payload FROM ${table} WHERE day=?`).get(day);return row?JSON.parse(row.payload):null;};
 const sources=day=>read('b_sim_sources',day)||[];
 const requireCompleted=(day,step)=>{if(run(day,step)?.state!=='completed')fail('DEPENDENCY','前工程が未完了です。失敗・承認待ち・未実行を飛び越えません');};
 async function mockAI(purpose,prompt,maxOutput,value,text){
  const cfg=aiConfig(env,prompt,maxOutput,value.now),id=crypto.randomUUID(),month=new Date(value.now).toISOString().slice(0,7);
  const reservation=await db.prepare(`INSERT INTO ai_operations(id,purpose,provider,model,month,state,reserved_micro,charged_micro,input_rate,output_rate,started_at,expires_at)
   SELECT ?,?,'anthropic',?,?,'running',?,?,?,?,?,? WHERE (SELECT COALESCE(SUM(charged_micro),0) FROM ai_operations WHERE month=?) + ? <= ? AND NOT EXISTS(SELECT 1 FROM ai_operations WHERE state='uncertain' AND month<>?)`).bind(id,purpose,cfg.model,month,cfg.reserve,cfg.reserve,cfg.price.input,cfg.price.output,value.now,value.now+30000,month,cfg.reserve,cfg.budget,month).run();
  if(!reservation.meta.changes)fail('AI_BUDGET_EXCEEDED','模擬月額予算が不足しています');
  if(!priorSeeded){priorSeeded=true;for(let i=0;i<priorCalls;i++)await reserveAI(env,'chat',Math.floor(value.now/1000));}
  if(!await reserveAI(env,purpose,Math.floor(value.now/1000))){await db.prepare("UPDATE ai_operations SET state='cancelled',charged_micro=0,finished_at=? WHERE id=?").bind(value.now,id).run();fail('AI_QUOTA','既存のUTC日次利用回数上限に達しました');}
  const uncertain=async()=>db.prepare("UPDATE ai_operations SET state='uncertain',finished_at=? WHERE id=?").bind(value.now,id).run();
  if(purpose==='job'&&scenario==='timeout'){await uncertain();fail('AI_TIMEOUT','模擬AIの本文待ちで30秒タイムアウト。予約額を保持します','failed');}
  if(purpose==='job'&&scenario==='invalid'){await uncertain();fail('AI_RESPONSE_INVALID','模擬AI応答が不正です。原稿は置き換えません','failed');}
  const inputTokens=new TextEncoder().encode(prompt).length,outputTokens=new TextEncoder().encode(text).length;
  if(outputTokens>maxOutput){await uncertain();fail('MOCK_OUTPUT_LIMIT','模擬出力が既存の出力上限を超えました','failed');}
  const result=normalizeResult({stop_reason:purpose==='job'&&scenario==='max_tokens'?'max_tokens':'end_turn',content:[{type:'text',text}],usage:{input_tokens:inputTokens,output_tokens:outputTokens}},'anthropic',cfg.model);
  const estimated=Math.ceil(inputTokens*cfg.price.input+outputTokens*cfg.price.output);
  await db.prepare("UPDATE ai_operations SET state='completed',charged_micro=?,usage_json=?,finished_at=? WHERE id=?").bind(estimated,JSON.stringify(result.generation.usage),value.now,id).run();
  result.generation={...result.generation,operationId:id,simulation:true,cost:{microUSD:estimated,basis:'mock_tokens_configured_rates',invoiceVerified:false}};
  return result;
 }
 async function action(step,s){
  if(step==='collect'){
   if(scenario==='collection_failure')fail('COLLECTION_UNAVAILABLE','模擬情報源が取得不可です。出典を創作して補完しません','failed');
   const record=receivedRecord({id:'sim-source-'+s.day,title:'模擬資料：AI活用の確認手順',text:'これはシミュレーション用の架空資料です。実際の公式発表ではありません。',sourceUrl:'https://www.digital.go.jp/news/simulation-fixture',origin:'digital',kind:'fact',verification:'source_observed',status:'acquired',fetchedAt:new Date(s.now).toISOString()},[]);
   db.db.prepare('INSERT INTO b_sim_sources VALUES(?,?)').run(s.day,JSON.stringify([record]));return {count:1,simulation:true,notice:'未確認の模擬資料。URLはテスト値で実取得していません'};
  }
  if(step==='themes'){
   requireCompleted(s.day,'collect');const records=sources(s.day);
   if(!records.length||records.some(r=>!r.reviewedAt))fail('SOURCE_REVIEW_REQUIRED',notices.sources,'awaiting_approval');
   const evidence=validateEvidence(records),idea={title:'模擬：AI資料の確認ガイド',reader:'初心者というAI仮説',angle:'確認手順というAI仮説',format:'note_free',reason:'解説に適するというAI仮説',sourceIds:records.map(r=>r.id),scores:Object.fromEntries(['demand','differentiation','monetization','evidence'].map(k=>[k,{score:3,reason:'実測ではないAI仮説'}]))};
   const result=await mockAI('ideas',ideaPrompt('AI資料の確認',evidence),3200,s,JSON.stringify({ideas:[idea]}));
   const plan=validateIdeas(result.text,evidence)[0];plan.createdAt=new Date(s.now).toISOString();db.db.prepare('INSERT INTO b_sim_theme(day,payload) VALUES(?,?)').run(s.day,JSON.stringify(plan));return {themeId:plan.id,classification:'ai_hypothesis',approval:'pending'};
  }
  if(step==='content'){
   requireCompleted(s.day,'themes');const row=db.db.prepare('SELECT * FROM b_sim_theme WHERE day=?').get(s.day);
   if(!row?.approved)fail('THEME_APPROVAL_REQUIRED',notices.theme,'awaiting_approval');
   const plan=JSON.parse(row.payload),records=sources(s.day),checked=validateEvidence(records);
   if(JSON.stringify(plan.evidence)!==JSON.stringify(checked))fail('STALE_EVIDENCE','資料が更新されたため再確認が必要です','awaiting_approval');
   const evidence=researchPacket(records),note='# 模擬：AI資料の確認ガイド\n'+defaultOutline('note無料記事').map(x=>`## ${x}\n模擬教材です。資料の内容と出典を利用者が確認してください。[R1]`).join('\n');
   const sns='【模擬SNS下書き・未確認】AI資料を読むときの確認手順を整理する案です。公開URL・成果・価格は未取得です。';
   const prompt=buildPrompt('content',{topic:plan.title,audience:plan.reader,format:'note無料記事',notes:'noteとSNSの下書きのみ。公開しない。'},evidence)+'\n'+buildPrompt('marketing',{topic:plan.title,format:'X投稿',notes:'同じ根拠で集客文を作る。公開URLは未取得。'},'');
   const result=await mockAI('job',prompt,2500,s,JSON.stringify({note,sns}));const data=JSON.parse(result.text);
   if(typeof data.note!=='string'||typeof data.sns!=='string'||!data.note.trim()||!data.sns.trim())fail('AI_RESPONSE_INVALID','原稿の形式が不正です','failed');
   const pending={...data,evidence,sourceIds:plan.sourceIds,themeId:plan.id,title:plan.title,generation:result.generation,simulation:true};db.db.prepare('INSERT INTO b_sim_pending VALUES(?,?)').run(s.day,JSON.stringify(pending));return {draftsPrepared:2,generationStatus:result.generation.completionStatus,humanReview:'pending',saved:false};
  }
  if(step==='save'){
   requireCompleted(s.day,'content');const data=read('b_sim_pending',s.day);if(!data)fail('DRAFT_MISSING','保存する原稿は未取得です');
   const noteId='sim-note-'+s.day,snsId='sim-sns-'+s.day;
   const common={evidence:data.evidence,sourceIds:data.sourceIds,themeId:data.themeId,topic:data.title,generation:data.generation,approved:false,simulation:true,savedAt:new Date(s.now).toISOString()};
   const noteDoc={...common,department:'content',format:'note無料記事',audience:'模擬読者',notes:'架空の模擬運転',output:data.note,workflow:{idea:data.title,outline:defaultOutline('note無料記事'),noExternalFacts:false}};
   const snsDoc={...common,department:'marketing',format:'X投稿',output:data.sns};
   if(scenario==='save_conflict')await saveRevision(db,snsId,0,{...snsDoc,output:'同時保存された既存SNS模擬原稿'});
   try{await saveRevision(db,noteId,0,noteDoc,writeId=>[db.prepare(`INSERT INTO document_revisions(project_id,revision,write_id,payload) SELECT ?,1,?,? WHERE EXISTS(SELECT 1 FROM document_revisions WHERE write_id=?)`).bind(snsId,crypto.randomUUID(),JSON.stringify(snsDoc),writeId)]);}catch(error){if(await latestDocument(db,noteId)||await latestDocument(db,snsId))fail('SAVE_CONFLICT','模擬保存競合。元原稿と生成結果を保持し、2件の保存を取り消しました','failed');throw error;}
   return {draftIds:[noteId,snsId],saved:2,humanReview:'pending',articleCheck:editorialReport(noteDoc).notice};
  }
  if(step==='report'){const summary=await report(new Date(s.now).toISOString());summary.steps.find(x=>x.key==='report').state='completed';return {generatedAt:new Date(s.now).toISOString(),summary,notice:'日次の模擬結果。実成果・実請求は未取得。外部送信なし'};}
 }
 async function tick(value){
  const s=advance(value);if(s.minute<720||s.minute>=1200)return {state:'outside_window',notice:'日本時間12:00〜20:00以外は開始しません'};
  // Only the specified JST minute can start a step; missed slots are not backfilled.
  const step=STEPS.find(x=>s.minute===x.minute);
  if(!step)return {state:'not_due'};
  const claim=await db.prepare(`INSERT OR IGNORE INTO b_sim_runs(day,step,state,diagnostic_id,code,reason,payload) SELECT ?,?,'running',?,'','','{}' WHERE NOT EXISTS(SELECT 1 FROM b_sim_runs WHERE day=? AND state='running')`).bind(s.day,step.key,crypto.randomUUID(),s.day).run();
  if(!claim.meta.changes)return {state:'already_claimed',run:run(s.day,step.key)||null};
  try{const payload=await action(step.key,s);db.db.prepare("UPDATE b_sim_runs SET state='completed',payload=? WHERE day=? AND step=? AND state='running'").run(JSON.stringify(payload),s.day,step.key);}
  catch(error){const known=error instanceof Stop;db.db.prepare("UPDATE b_sim_runs SET state=?,code=?,reason=? WHERE day=? AND step=? AND state='running'").run(known?error.state:'failed',known?error.code:'SIMULATION_FAILED',known?error.message:'模擬処理の検証に失敗しました。自動再試行しません',s.day,step.key);}
  return run(s.day,step.key);
 }
 async function reviewSources(value,confirmed){
  const s=advance(value);if(confirmed!==true||s.minute<720||s.minute>=840||run(s.day,'themes'))throw Error('資料確認は12:00〜14:00より前の明示操作で行ってください');requireCompleted(s.day,'collect');
  const records=sources(s.day);for(const r of records)r.reviewedAt=new Date(s.now).toISOString();db.db.prepare('UPDATE b_sim_sources SET payload=? WHERE day=?').run(JSON.stringify(records),s.day);db.db.prepare("INSERT INTO b_sim_approvals VALUES(?,'sources',?)").run(s.day,value);
 }
 async function approveTheme(value,confirmed){
  const s=advance(value);if(confirmed!==true||s.minute<840||s.minute>=960||run(s.day,'content'))throw Error('企画承認は14:00〜16:00より前の明示操作で行ってください');requireCompleted(s.day,'themes');
  db.db.prepare('UPDATE b_sim_theme SET approved=1 WHERE day=?').run(s.day);db.db.prepare("INSERT INTO b_sim_approvals VALUES(?,'theme',?)").run(s.day,value);
 }
 async function report(value){
  const s=slot(value),save=run(s.day,'save'),saved=save?.state==='completed'?JSON.parse(save.payload).draftIds:[];
  const drafts=await Promise.all(saved.map(async id=>{const d=await latestDocument(db,id);return {projectId:id,revision:d.revision,format:d.format,humanReview:'pending',generationStatus:d.generation.completionStatus};}));
  const monthOperations=db.db.prepare('SELECT state,charged_micro,started_at FROM ai_operations WHERE month=?').all(new Date(s.now).toISOString().slice(0,7));
  const start=Date.parse(s.day+'T00:00:00+09:00'),operations=monthOperations.filter(x=>x.started_at>=start&&x.started_at<start+86400000);
  const monthReserved=monthOperations.reduce((n,x)=>n+x.charged_micro,0);
  const estimated=operations.filter(x=>x.state==='completed').reduce((n,x)=>n+x.charged_micro,0),uncertain=operations.filter(x=>x.state==='uncertain').reduce((n,x)=>n+x.charged_micro,0);
  return {mode:'local-in-memory-simulation',day:s.day,timezone:'Asia/Tokyo',scheduleWindow:'12:00–20:00 JST',externalRequests:0,cronEnabled:false,steps:STEPS.map(step=>{const row=run(s.day,step.key);return {time:step.time,key:step.key,state:row?.state||(s.minute>=step.minute?'not_run':'scheduled'),diagnosticId:row?.diagnostic_id||null,code:row?.code||null,reason:row?.reason||'',result:row?JSON.parse(row.payload):null};}),sources:sources(s.day),drafts,pending:!!read('b_sim_pending',s.day),counts:{sources:sources(s.day).length,mockAICalls:operations.filter(x=>['completed','uncertain'].includes(x.state)).length,savedDrafts:drafts.length},claimedRuns:db.db.prepare('SELECT COUNT(*) n FROM b_sim_runs WHERE day=?').get(s.day).n,cost:{currency:'USD',estimatedUSD:estimated/1e6,uncertainReservedUSD:uncertain/1e6,remainingReservedBudgetUSD:Math.max(0,(usdMicro(monthlyBudgetUSD)-monthReserved)/1e6),basis:'模擬トークンと設定単価による見積もり。実請求ではない',invoiceVerified:false,actualUSD:null},actualRevenue:null,actualResults:null,analytics:await monthlyReport(db,s.day.slice(0,7),null,s.now),approvals:db.db.prepare('SELECT kind,at FROM b_sim_approvals WHERE day=?').all(s.day)};
 }
 return {tick,reviewSources,approveTheme,report,dailyReport:value=>{const s=slot(value);const row=run(s.day,'report');return row?.state==='completed'?JSON.parse(row.payload).summary:null;},readDraft:id=>latestDocument(db,id),close(){if(!closed){db.db.close();closed=true;}}};
}
