import { denied, responseJSON as json } from '../../../lib/research-network.js';
import { recoverAI } from '../../../lib/ai-runtime.js';
export async function onRequestGet({request,env}) {
 const auth=denied(request,env); if(auth)return auth;
 try {
  await recoverAI(env.JARVIS_DB);
  const month=new Date().toISOString().slice(0,7);
  const total=await env.JARVIS_DB.prepare('SELECT COALESCE(SUM(charged_micro),0) AS committedMicroUSD FROM ai_operations WHERE month=?').bind(month).first();
  const rows=await env.JARVIS_DB.prepare('SELECT id,purpose,job_id,provider,model,month,state,reserved_micro,charged_micro,started_at,finished_at,usage_json FROM ai_operations ORDER BY started_at DESC LIMIT 100').all();
  const openingUSD=JSON.parse(env.AI_OPENING_SPEND_USD_JSON||"{}")[month]||"0";
  return json({month,openingUSD,currency:'USD',budgetUSD:env.AI_MONTHLY_BUDGET_USD||null,...total,operations:rows.results,notice:'設定料金に基づく管理値です。請求実額との照合は別途必要です。未確定分は予約額を保持します'});
 }catch{return json({error:'AI利用履歴を取得できませんでした'},503);}
}
// Explicit human reconciliation only. No request is retried and the quota is never refunded.
export async function onRequestPost({request,env}) {
 const auth=denied(request,env); if(auth)return auth;
 try {
  const b=await request.json();
  if(b.confirmed!==true||typeof b.id!=='string'||!Number.isSafeInteger(b.chargedMicroUSD)||b.chargedMicroUSD<0||b.chargedMicroUSD>1e12||typeof b.note!=='string'||!b.note.trim()||b.note.length>500)return json({error:'請求を確認した金額と照合メモが必要です'},400);
  await recoverAI(env.JARVIS_DB);
  const r=await env.JARVIS_DB.prepare("UPDATE ai_operations SET state='reconciled',charged_micro=?,usage_json=?,finished_at=? WHERE id=? AND state IN ('uncertain','interrupted','overrun')").bind(b.chargedMicroUSD,JSON.stringify({humanReconciliation:true,note:b.note,at:new Date().toISOString()}),Date.now(),b.id).run();
  return r.meta?.changes?json({reconciled:true}):json({error:'照合対象が変更されたか、処理中です'},409);
 }catch{return json({error:'照合記録を保存できませんでした'},503);}
}
