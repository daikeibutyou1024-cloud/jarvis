import {previewHost,validSession} from '../../../lib/preview-session.js';
import {LIVE_TEST,previewLivePolicy} from '../../../lib/preview-live-policy.js';
import {runPreviewLiveOnce,aiFailure} from '../../../lib/ai-runtime.js';
const json=(body,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store'}});
export async function onRequest({request,env}){
 if(!previewHost(request,env))return json({error:'対象Previewのみ利用できます'},403);
 if(!await validSession(request,env))return json({error:'認証が必要です'},401);
 if(!['GET','POST'].includes(request.method))return json({error:'操作が不正です'},405);
 const policy=previewLivePolicy(request,env);
 if(!policy.allowed)return request.method==='GET'?json(policy):json({error:policy.reason,code:'PREVIEW_LIVE_BLOCKED'},503);
 let existing;try{existing=await env.JARVIS_DB.prepare('SELECT id FROM ai_operations WHERE id=?').bind(LIVE_TEST.id).first();}catch{return json({error:'既存の予算台帳を確認できません。送信しません。'},503);}
 if(existing)return request.method==='GET'?json({...policy,allowed:false,reason:'1回限定テストは使用済みです。再送は禁止しています。'}):json({error:'使用済みです。再送しません。'},409);
 if(request.method==='GET')return json(policy);
 if(request.headers.get('Origin')!==new URL(request.url).origin)return json({error:'同一オリジンから操作してください'},403);
 try{
  if(!request.headers.get('content-type')?.startsWith('application/json'))return json({error:'JSONが必要です'},400);
  const raw=await request.text();if(new TextEncoder().encode(raw).length>6000)return json({error:'入力が長すぎます'},413);
  const body=JSON.parse(raw);if(Object.keys(body).some(k=>!['message','conversation'].includes(k))||typeof body.message!=='string'||!body.message.trim()||body.message.length>256||!Array.isArray(body.conversation)||body.conversation.length>4||body.conversation.some(r=>!['user','assistant'].includes(r?.role)||typeof r.text!=='string'||r.text.length>256))return json({error:'テスト用の短い会話のみ利用できます'},400);
  const prompt='日本語で短く答えてください。音声会話の接続テストです。\n'+body.conversation.map(r=>r.role+': '+r.text).join('\n')+'\nuser: '+body.message;
  if(prompt.includes(env.JARVIS_ACCESS_PASSWORD)||/\bsk-(?:ant-)?[\w-]{12,}/.test(prompt))return json({error:'認証情報は送信できません'},400);
  const result=await runPreviewLiveOnce(request,env,prompt);
  return json({answer:result.text,mock:false,live:true,model:LIVE_TEST.model,usage:result.generation.usage,cost:result.generation.cost,oneShotConsumed:true});
 }catch(error){return json(aiFailure(error)||{error:'テストを停止しました。自動再送しません。'},error.status||503);}
}
