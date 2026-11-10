import {denied,responseJSON as json} from '../../../lib/research-network.js';
import {initSchedules,recoverCollections,saveSchedule,scheduleConfig,ScheduleError} from '../../../lib/schedules.js';
export async function onRequestGet({request,env}){
 const auth=denied(request,env);if(auth)return auth;
 try{
  const config=scheduleConfig(env),db=env.JARVIS_DB;await recoverCollections(db);
  const url=new URL(request.url),before=url.searchParams.get('before');
  if(before!==null&&(!/^\d+$/.test(before)||!Number.isSafeInteger(Number(before))))return json({error:'ページ指定が不正です'},400);
  const schedules=(await db.prepare('SELECT * FROM collection_schedules ORDER BY updated_at DESC,id').all()).results;
  const runs=(await db.prepare('SELECT r.*,s.name FROM collection_runs r LEFT JOIN collection_schedules s ON s.id=r.schedule_id ORDER BY started_at DESC,r.rowid DESC LIMIT 20').all()).results.map(({result_json,...r})=>({...r,result:result_json?JSON.parse(result_json):null}));
  const rows=(await db.prepare("SELECT *,rowid AS cursor FROM research_inbox WHERE state='new' AND rowid<? ORDER BY rowid DESC LIMIT 51").bind(before===null?Number.MAX_SAFE_INTEGER:Number(before)).all()).results;
  const inbox=rows.slice(0,50).map(({record_json,...r})=>({...r,record:JSON.parse(record_json)}));
  const total=await db.prepare("SELECT COUNT(*) AS total,SUM(CASE WHEN state='new' THEN 1 ELSE 0 END) AS pending FROM research_inbox").first();
  return json({config,schedules,runs,inbox,nextInboxCursor:rows.length>50?inbox.at(-1).cursor:null,storage:{total:total.total,pending:total.pending||0,limit:500},notice:'定期収集はAIを呼びません。取得した資料は未確認です。実行開始には別途サーバー側の有効化と起動元の設定が必要です'});
 }catch{return json({error:'定期収集の設定・履歴を読み込めませんでした'},503);}
}
export async function onRequestPost({request,env}){
 const auth=denied(request,env);if(auth)return auth;
 try{
  const raw=await request.text();if(raw.length>10000)return json({error:'設定が大きすぎます'},400);
  const b=JSON.parse(raw);
  if(b.action==='save')return json({schedule:await saveSchedule(env.JARVIS_DB,b)},201);
  if(b.action==='ack'){
   if(!Array.isArray(b.ids)||!b.ids.length||b.ids.length>10||b.ids.some(id=>typeof id!=='string'||!/^[-a-zA-Z0-9]{1,80}$/.test(id)))return json({error:'資料IDを1〜10件指定してください'},400);
   await initSchedules(env.JARVIS_DB);
   const results=await env.JARVIS_DB.batch(b.ids.map(id=>env.JARVIS_DB.prepare("UPDATE research_inbox SET state='imported' WHERE id=? AND state='new'").bind(id)));
   return json({imported:results.reduce((n,r)=>n+r.meta.changes,0),notice:'取り込み済みの記録です。事実の確認済み状態には変更していません'});
  }
  return json({error:'操作が不正です'},400);
 }catch(e){return json({error:e instanceof ScheduleError?e.message:'設定を保存できませんでした',code:e instanceof ScheduleError?e.code:undefined},e instanceof ScheduleError?e.status:400);}
}
