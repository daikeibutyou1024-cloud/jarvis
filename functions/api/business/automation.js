// Intentionally does not import shared research/API helpers: those reach live clients.
import {manage,snapshot,MockError} from '../../../lib/preview-mock.js';
import {usdMicro} from '../../../lib/ai-money.js';
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
function denied(request,env,write=false){
 if(env.CF_PAGES_BRANCH!=='feature/ai-business-rebuild'||env.PREVIEW_MOCK_AUTOMATION_ENABLED!=='true')return json({error:'Preview専用モックは無効です'},503);
 // Require the known Preview project, not a caller-provided database or URL.
 let url;try{url=new URL(env.CF_PAGES_URL);}catch{return json({error:'Preview配備情報が必要です'},503);}
 if(url.protocol!=='https:'||!/^([a-f0-9]{8}|feature-ai-business-rebuild)\.asset-simulator-87y\.pages\.dev$/.test(url.hostname))return json({error:'対象Preview以外では実行できません'},503);
 try{if(usdMicro(env.AI_MONTHLY_BUDGET_USD)>1000000)throw Error();}catch{return json({error:'AI予算は0〜1 USDの設定が必要です'},503);}
 if(!env.JARVIS_ACCESS_PASSWORD||request.headers.get('x-jarvis-password')!==env.JARVIS_ACCESS_PASSWORD)return json({error:'認証が必要です'},401);
 if(!env.JARVIS_DB)return json({error:'Preview D1が必要です'},503);
 if(write&&(!request.headers.get('content-type')?.startsWith('application/json')||(request.headers.get('Origin')&&request.headers.get('Origin')!==new URL(request.url).origin)))return json({error:'同一オリジンのJSON要求が必要です'},403);
 return null;
}
export async function onRequestGet({request,env}){
 const error=denied(request,env);if(error)return error;
 try{return json(await snapshot(env.JARVIS_DB));}catch{return json({error:'読取に失敗しました。スキーマや初期行は自動作成しません'},503);}
}
export async function onRequestPost({request,env}){
 const error=denied(request,env,true);if(error)return error;
 try{
  if(Number(request.headers.get('content-length'))>2048)return json({error:'要求が大きすぎます'},413);
  const raw=await request.text();if(new TextEncoder().encode(raw).length>2048)return json({error:'要求が大きすぎます'},413);
  let body;try{body=JSON.parse(raw);}catch{return json({error:'JSON形式が不正です'},400);}
  return json(await manage(env.JARVIS_DB,body,{budgetUSD:env.AI_MONTHLY_BUDGET_USD}));
 }catch(e){return json({error:e instanceof MockError?e.message:'モック処理に失敗しました。自動再試行しません'},e instanceof MockError?e.status:503);}
}
