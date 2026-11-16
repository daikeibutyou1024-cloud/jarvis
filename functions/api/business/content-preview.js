import {previewArticle} from '../../../lib/content-preview.js';
import {liveAIPolicy} from '../../../lib/ai-runtime.js';
const json=(x,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{'content-type':'application/json','cache-control':'no-store'}});
export async function onRequestPost({request,env}){
 if(!env.JARVIS_ACCESS_PASSWORD||request.headers.get('x-jarvis-password')!==env.JARVIS_ACCESS_PASSWORD)return json({error:'認証が必要です'},401);
 const u=new URL(request.url);
 if(env.CF_PAGES_BRANCH!=='feature/ai-business-rebuild'||u.protocol!=='https:'||! /^(?:[a-f0-9]{8}|feature-ai-business-rebuild)\.asset-simulator-87y\.pages\.dev$/.test(u.hostname))return json({error:'対象Previewのみ利用できます'},403);
 if(!request.headers.get('content-type')?.startsWith('application/json')||(request.headers.get('origin')&&request.headers.get('origin')!==u.origin))return json({error:'同一オリジンのJSONが必要です'},403);
 try{const raw=await request.text();if(new TextEncoder().encode(raw).length>20000)return json({error:'入力が大きすぎます'},413);const b=JSON.parse(raw);return json({...previewArticle(b.generation),budget:liveAIPolicy()});}catch{return json({error:'note無料記事・記事全体を選び、RESEARCHから確認済み資料1〜5件を引き渡してください'},400);}
}
