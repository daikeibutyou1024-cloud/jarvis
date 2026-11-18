import {previewHost} from './preview-session.js';
export const LIVE_TEST={id:'jarvis-preview-claude-once-v1',model:'claude-sonnet-4-6',maxOutput:128,maxPromptBytes:2048,inputTokenBound:4096,inputRate:3,outputRate:15,maxMicroUSD:14208,previewDB:'5ec09d38-2ed8-4c7a-ba67-bfd9c2ed32d0'};
export function previewLivePolicy(request,env,now=Date.now()){
 const blocked=reason=>({allowed:false,reason,...LIVE_TEST});
 if(!previewHost(request,env))return blocked('実AIテストは対象Previewのみです。');
 if(env.JARVIS_PREVIEW_LIVE_ONCE_ENABLED!=='true')return blocked('実AIテストは停止中です。残高・予算の確認とサーバー側の1回限定許可が必要です。');
 let a;try{a=JSON.parse(env.JARVIS_PREVIEW_LIVE_APPROVAL);}catch{return blocked('残高・料金の確認記録がありません。');}
 if(a.id!==LIVE_TEST.id||a.previewDB!==LIVE_TEST.previewDB||a.model!==LIVE_TEST.model||a.autoRechargeOff!==true||a.otherClientsStopped!==true||a.maxCalls!==1||a.maxMicroUSD!==LIVE_TEST.maxMicroUSD)return blocked('1回限定の承認条件を確認できません。');
 if(!Number.isSafeInteger(a.verifiedAt)||a.verifiedAt>now||now-a.verifiedAt>15*60000||!Number.isSafeInteger(a.expiresAt)||a.expiresAt<=now||a.expiresAt>a.verifiedAt+15*60000)return blocked('残高確認の有効期限が切れています。');
 if(!Number.isSafeInteger(a.balanceMicroUSD)||a.balanceMicroUSD<LIVE_TEST.maxMicroUSD||!Number.isSafeInteger(a.providerMonthlyMicroUSD)||a.providerMonthlyMicroUSD<0)return blocked('利用可能な残高・既利用額を確認できません。');
 const budget=Number(env.AI_MONTHLY_BUDGET_USD);if(!Number.isFinite(budget)||budget<=0||budget>5||a.providerMonthlyMicroUSD+LIVE_TEST.maxMicroUSD>Math.floor(budget*1e6))return blocked('既存の月次予算に収まることを確認できません。');
 let rates,opening;const month=new Date(now).toISOString().slice(0,7);
 try{rates=JSON.parse(env.AI_PRICING_JSON)['anthropic/'+LIVE_TEST.model];opening=JSON.parse(env.AI_OPENING_SPEND_USD_JSON)[month];}catch{return blocked('料金または開始利用額の設定を確認できません。');}
 if(rates?.input!==3||rates?.output!==15||opening===undefined||Math.round(Number(opening)*1e6)!==a.providerMonthlyMicroUSD)return blocked('確認済み料金・既利用額とサーバー設定が一致しません。');
 if((env.AI_PROVIDER||'anthropic')!=='anthropic'||(env.ANTHROPIC_MODEL||LIVE_TEST.model)!==LIVE_TEST.model||!env.ANTHROPIC_API_KEY||!env.JARVIS_DB)return blocked('Anthropicモデル・認証・DB設定が不正です。');
 return {allowed:true,reason:'Claude実AI・今回1回のみ',...LIVE_TEST};
}
