import {previewHost,validSession} from '../../../lib/preview-session.js';
import {prepaidPolicy} from '../../../lib/preview-prepaid.js';
import {conversationPayload} from '../../../lib/preview-conversation.js';
import {runPreviewConversation,aiFailure} from '../../../lib/ai-runtime.js';
const json=(body,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store'}});
export async function onRequest({request,env}){
 if(!previewHost(request,env))return json({error:'対象Previewのみ利用できます'},403);
 if(!await validSession(request,env))return json({error:'認証が必要です'},401);
 if(!['GET','POST'].includes(request.method))return json({error:'操作が不正です'},405);
 const policy=prepaidPolicy(request,env,'conversation');
 // No snapshot, key, grant or credential contents are exposed by the status API.
 if(request.method==='GET')return json({allowed:policy.allowed,reason:policy.reason,model:policy.model,maxOutput:policy.maxOutput,maxMicroUSD:policy.maxMicroUSD,maxCalls:policy.maxCalls??0,monthlyLimitApplied:false});
 if(request.headers.get('Origin')!==new URL(request.url).origin)return json({error:'同一オリジンから操作してください'},403);
 if(!policy.allowed)return json({error:policy.reason,code:'PREPAID_BLOCKED'},503);
 let payload;
 try{if(!request.headers.get('content-type')?.startsWith('application/json'))throw Error('JSONが必要です。');const raw=await request.text();if(new TextEncoder().encode(raw).length>80000)return json({error:'入力が長すぎます'},413);payload=conversationPayload(JSON.parse(raw),env);}catch{return json({error:'入力形式・長さ・履歴・認証情報の混入を確認してください。'},400);}
 try{
  const result=await runPreviewConversation(request,env,payload.prompt,payload.messages,payload.system,payload.requestId);
  return json({answer:result.text,mock:false,live:true,model:policy.model,usage:result.generation.usage,cost:result.generation.cost,operationId:result.generation.operationId,contextMessages:payload.contextMessages});
 }catch(error){return json(aiFailure(error)||{error:'会話を停止しました。自動再送しません。'},error.status||503);}
}
