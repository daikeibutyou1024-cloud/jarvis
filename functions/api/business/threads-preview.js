import {previewHost,validSession} from '../../../lib/preview-session.js';
import {prepaidPolicy,prepaidUsage} from '../../../lib/preview-prepaid.js';
import {runPreviewThreads,aiFailure} from '../../../lib/ai-runtime.js';
const json=(body,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store'}});
export async function onRequest({request,env}){
 if(!previewHost(request,env))return json({error:'対象Previewのみ利用できます'},403);
 if(!await validSession(request,env))return json({error:'認証が必要です'},401);
 if(request.method==='GET'){try{return json(await prepaidUsage(env));}catch{return json({error:'台帳を確認できません。残高をゼロとも利用可能とも判断しません。'},503);}}
 if(request.method!=='POST')return json({error:'操作が不正です'},405);
 if(request.headers.get('Origin')!==new URL(request.url).origin)return json({error:'同一オリジンから操作してください'},403);
 const policy=prepaidPolicy(request,env,'threads-draft');if(!policy.allowed)return json({error:policy.reason},503);
 try{
  if(!request.headers.get('content-type')?.startsWith('application/json'))return json({error:'JSONが必要です'},400);
  const raw=await request.text();if(raw.length>2000)return json({error:'入力が長すぎます'},413);
  const b=JSON.parse(raw);if(!b||Object.keys(b).some(k=>k!=='topic')||typeof b.topic!=='string'||!b.topic.trim()||b.topic.length>256)return json({error:'テーマを256文字以内で入力してください'},400);
  if(b.topic.includes(env.JARVIS_ACCESS_PASSWORD)||/\bsk-(?:ant-)?[\w-]{12,}/.test(b.topic))return json({error:'認証情報は送信できません'},400);
  const prompt='日本語でThreads投稿の下書きを1件、500字以内で作成してください。根拠のない事実・収益保証は書かず、公開前の確認が必要な下書きとして返してください。外部投稿や検索は行いません。\nテーマ：'+b.topic;
  const result=await runPreviewThreads(request,env,prompt);
  return json({answer:result.text,complete:result.generation.completionStatus==='complete',model:policy.model,usage:result.generation.usage,cost:result.generation.cost,posted:false});
 }catch(error){return json(aiFailure(error)||{error:'生成を停止しました。自動再試行はしません。'},error.status||503);}
}
