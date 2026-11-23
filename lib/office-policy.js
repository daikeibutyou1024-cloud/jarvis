import {previewHost} from './preview-session.js';
import {creditSnapshot,PREPAID} from './preview-prepaid.js';
import {OFFICE_MAX_MICRO} from './virtual-office.js';
export function officePolicy(request,env,task,runId,now=Date.now()){
 const blocked=reason=>({allowed:false,reason});
 if(!previewHost(request,env)||env.JARVIS_VIRTUAL_OFFICE_ENABLED!=='true'||env.JARVIS_OFFICE_LIVE_ENABLED!=='true')return blocked('Previewオフィス実AIは停止中です。');
 const s=creditSnapshot(env,now);if(!s||now-s.observedAt>900000||s.balanceMicroUSD<OFFICE_MAX_MICRO)return blocked('最新の残高・自動チャージOFF・台帳照合を確認してください。');
 let a,rates;try{a=JSON.parse(env.JARVIS_OFFICE_APPROVAL);rates=JSON.parse(env.AI_PRICING_JSON)['anthropic/'+PREPAID.model];}catch{return blocked('オフィス専用の期限付き承認が必要です。');}
 if(a.purpose!=='office-draft'||a.previewDB!==PREPAID.previewDB||a.taskId!==task.id||a.taskVersion!==task.version||a.agentId!==task.agentId||a.runId!==runId||!/^office-[-a-zA-Z0-9]{8,64}$/.test(a.id||'')||a.maxCalls!==1||a.maxMicroUSD!==OFFICE_MAX_MICRO||a.maxOutput!==512||a.model!==PREPAID.model||a.snapshotObservedAt!==s.observedAt||!Number.isSafeInteger(a.expiresAt)||a.expiresAt<=now||a.expiresAt>s.observedAt+900000)return blocked('依頼・担当・版・費用に一致する1回限定承認がありません。');
 if(!env.ANTHROPIC_API_KEY||!env.JARVIS_DB||rates?.input!==3||rates?.output!==15||(env.AI_PROVIDER||'anthropic')!=='anthropic'||(env.ANTHROPIC_MODEL||PREPAID.model)!==PREPAID.model)return blocked('認証・モデル・料金を確認できません。');
 return {allowed:true,maxOutput:512,maxMicroUSD:OFFICE_MAX_MICRO,snapshot:s,grantId:a.id,maxCalls:1,agentId:task.agentId,expiresAt:a.expiresAt};
}
