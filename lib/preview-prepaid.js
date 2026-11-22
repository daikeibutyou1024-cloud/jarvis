import {workspaceTarget} from './workspace-target.js';
import {previewHost} from './preview-session.js';
export const PREPAID={model:'claude-sonnet-4-6',previewDB:'5ec09d38-2ed8-4c7a-ba67-bfd9c2ed32d0',reportedBalanceMicroUSD:3040000,maxPromptBytes:2048,inputTokenBound:4096,threadsMaxOutput:256,voiceMaxOutput:128};
export const jstDay=(now=Date.now())=>new Date(now+9*3600000).toISOString().slice(0,10);
export const creditAmountSQL="CASE WHEN state IN ('running','interrupted','uncertain','overrun') THEN MAX(charged_micro,reserved_micro) ELSE charged_micro END";
export const creditFilterSQL="provider='anthropic' AND (finished_at IS NULL OR finished_at>? OR state IN ('running','interrupted','uncertain','overrun'))";
export function creditSnapshot(env,now=Date.now()){
 try{const s=JSON.parse(env.CF_PAGES_BRANCH==='main'?env.JARVIS_PRODUCTION_PREPAID_SNAPSHOT:env.JARVIS_PREPAID_SNAPSHOT);if(s.verified!==true||s.autoRechargeOff!==true||!Number.isSafeInteger(s.balanceMicroUSD)||s.balanceMicroUSD<0||!Number.isSafeInteger(s.observedAt)||s.observedAt>now||!Number.isSafeInteger(s.settledThrough)||s.settledThrough<0||s.settledThrough>s.observedAt)return null;return s;}catch{return null;}
}
export function prepaidPolicy(request,env,purpose,now=Date.now()){
 const maxOutput=purpose==='conversation'?512:purpose==='threads-draft'?PREPAID.threadsMaxOutput:PREPAID.voiceMaxOutput,maxMicroUSD=(purpose==='conversation'?8192:PREPAID.inputTokenBound)*3+maxOutput*15;
 const blocked=reason=>({allowed:false,mode:'prepaid',monthlyLimitApplied:false,reason,...PREPAID,maxOutput,maxMicroUSD});
 const target=workspaceTarget(request,env),production=target?.kind==='production'&&purpose==='conversation';
 if(!previewHost(request,env)&&!production)return blocked('対象環境を確認できません。');
 if(!['threads-draft','voice-live-once','conversation'].includes(purpose))return blocked('承認対象外の処理です。');
 // Old monthly-budget / one-shot flags cannot authorize the new prepaid mode.
 if((production?env.JARVIS_PRODUCTION_CONVERSATION_ENABLED:env.JARVIS_PREPAID_LIVE_ENABLED)!=='true')return blocked('実APIは未承認のため停止中です。月額上限ではなくプリペイド方式です。');
 const s=creditSnapshot(env,now);if(!s||now-s.observedAt>15*60000)return blocked('残高の基準時点と台帳の照合が必要です。');
 let a,rates;try{a=JSON.parse(production?env.JARVIS_PRODUCTION_PREPAID_APPROVAL:env.JARVIS_PREPAID_APPROVAL);rates=JSON.parse(env.AI_PRICING_JSON)['anthropic/'+PREPAID.model];}catch{return blocked('実APIの承認・料金を確認できません。');}
 if((purpose==='threads-draft'&&a.day!==jstDay(now))||a.purpose!==purpose||(production?(a.environment!=='production'||a.databaseId!==target.databaseId):a.previewDB!==PREPAID.previewDB)||a.model!==PREPAID.model||a.snapshotObservedAt!==s.observedAt||(purpose==='conversation'?(!Number.isInteger(a.maxCalls)||a.maxCalls<1||a.maxCalls>10||!/^chat-[a-zA-Z0-9-]{8,64}$/.test(a.id||'')):a.maxCalls!==1)||!Number.isSafeInteger(a.expiresAt)||a.expiresAt<=now||a.expiresAt>s.observedAt+15*60000)return blocked('この処理の実API承認を確認できません。');
 if(rates?.input!==3||rates?.output!==15||(env.AI_PROVIDER||'anthropic')!=='anthropic'||(env.ANTHROPIC_MODEL||PREPAID.model)!==PREPAID.model||!env.ANTHROPIC_API_KEY||!env.JARVIS_DB)return blocked('モデル・料金・認証設定を確認できません。');
 if(s.balanceMicroUSD<maxMicroUSD)return blocked('推定残高が不足しています。送信しません。');
 return {allowed:true,target:target||{kind:'preview',databaseId:PREPAID.previewDB,marker:'jarvis-preview'},day:jstDay(now),mode:'prepaid',monthlyLimitApplied:false,reason:'明示承認済み・プリペイド残高から事前予約',...PREPAID,maxOutput,maxMicroUSD,snapshot:s,...(purpose==='conversation'?{grantId:a.id,maxCalls:a.maxCalls,expiresAt:a.expiresAt}: {})};
}
export async function prepaidUsage(env,now=Date.now()){
 const s=creditSnapshot(env,now),db=env.JARVIS_DB;
 const total=await db.prepare(`SELECT COALESCE(SUM(CASE WHEN state IN ('running','interrupted','uncertain','overrun') THEN 0 ELSE charged_micro END),0) AS recordedCostMicroUSD,COALESCE(SUM(CASE WHEN state IN ('running','interrupted','uncertain','overrun') THEN MAX(charged_micro,reserved_micro) ELSE 0 END),0) AS pendingMicroUSD FROM ai_operations WHERE provider='anthropic'`).first();
 const committed=s?await db.prepare(`SELECT COALESCE(SUM(${creditAmountSQL}),0) AS amount FROM ai_operations WHERE ${creditFilterSQL}`).bind(s.settledThrough).first():null;
 const daily=await db.prepare('SELECT id FROM ai_operations WHERE id=?').bind('jarvis-preview-threads-'+jstDay(now)).first();
 const audit=await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='ai_reconciliations'").first();
 const rows=await db.prepare(audit?"SELECT o.id,o.purpose,o.provider,o.state,o.charged_micro,o.reserved_micro,o.started_at,o.finished_at,o.usage_json,a.prior_state AS reconciliation_prior_state,a.prior_charged_micro AS reconciliation_prior_charged_micro,a.charged_micro AS reconciliation_charged_micro,a.note AS reconciliation_note,a.recorded_at AS reconciliation_recorded_at FROM ai_operations o LEFT JOIN ai_reconciliations a ON a.operation_id=o.id ORDER BY o.started_at DESC,o.id LIMIT 100":"SELECT id,purpose,provider,state,charged_micro,reserved_micro,started_at,finished_at,usage_json FROM ai_operations ORDER BY started_at DESC,id LIMIT 100").all();
 return {mode:'prepaid',monthlyLimitApplied:false,budgetUSD:null,reportedBalanceMicroUSD:PREPAID.reportedBalanceMicroUSD,referenceEstimateMicroUSD:Math.max(0,PREPAID.reportedBalanceMicroUSD-total.pendingMicroUSD),snapshotBalanceMicroUSD:s?.balanceMicroUSD??null,snapshotObservedAt:s?.observedAt??null,estimatedBalanceMicroUSD:s?Math.max(0,s.balanceMicroUSD-committed.amount):null,...total,operations:rows.results,threadsDay:jstDay(now),threadsUsedToday:!!daily,threadsMaxOutput:256,liveEnabled:(env.CF_PAGES_BRANCH==='main'?env.JARVIS_PRODUCTION_CONVERSATION_ENABLED:env.JARVIS_PREPAID_LIVE_ENABLED)==='true',notice:'残高計算はAnthropic分だけです。推定残高はAnthropicの実残高ではありません。他アプリ利用・集計遅延は自動取得できません。確認済み残高に含まれる過去の確定費用は二重に控除せず、未確定予約は保持します。'};
}
