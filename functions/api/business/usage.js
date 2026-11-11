import {openingMicro} from '../../../lib/ai-money.js';
import {initReconciliations,reconcileAI,ReconciliationError,validateReconciliation} from '../../../lib/ai-reconciliation.js';
import { denied, responseJSON as json } from '../../../lib/research-network.js';
import { recoverAI } from '../../../lib/ai-runtime.js';
export async function onRequestGet({request,env}) {
 const auth=denied(request,env); if(auth)return auth;
 try {
  const month=new Date().toISOString().slice(0,7),openingUSD=(openingMicro(env,month)/1e6).toFixed(6);
  await recoverAI(env.JARVIS_DB);await initReconciliations(env.JARVIS_DB);
  const total=await env.JARVIS_DB.prepare('SELECT COALESCE(SUM(charged_micro),0) AS committedMicroUSD FROM ai_operations WHERE month=?').bind(month).first();
  const rows=await env.JARVIS_DB.prepare('SELECT o.id,o.purpose,o.job_id,o.provider,o.model,o.month,o.state,o.reserved_micro,o.charged_micro,o.started_at,o.finished_at,o.usage_json,a.prior_state AS reconciliation_prior_state,a.prior_charged_micro AS reconciliation_prior_charged_micro,a.charged_micro AS reconciliation_charged_micro,a.note AS reconciliation_note,a.recorded_at AS reconciliation_recorded_at FROM ai_operations o LEFT JOIN ai_reconciliations a ON a.operation_id=o.id ORDER BY o.started_at DESC,o.id LIMIT 100').all();
  return json({month,openingUSD,currency:'USD',budgetUSD:env.AI_MONTHLY_BUDGET_USD||null,...total,operations:rows.results,notice:'設定料金に基づく管理値です。請求実額との照合は別途必要です。未確定分は予約額を保持します'});
 }catch{return json({error:'AI利用履歴を取得できませんでした'},503);}
}
// Explicit human reconciliation only. No request is retried and the quota is never refunded.
export async function onRequestPost({request,env}) {
 const auth=denied(request,env); if(auth)return auth;
 try {
  const raw=await request.text();if(raw.length>4000)return json({error:'照合内容が大きすぎます'},400);
  const b=JSON.parse(raw);validateReconciliation(b);
  // Retain the old endpoint shape for existing clients; new clients bind the displayed snapshot.
  await recoverAI(env.JARVIS_DB);
  return json(await reconcileAI(env.JARVIS_DB,b));
 }catch(e){return json({error:e instanceof ReconciliationError?e.message:e instanceof SyntaxError?'照合内容の形式が不正です':'照合記録を保存できませんでした'},e instanceof ReconciliationError?e.status:e instanceof SyntaxError?400:503);}
}
