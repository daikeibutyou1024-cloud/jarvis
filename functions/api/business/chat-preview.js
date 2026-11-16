// Authenticated Preview-only responses. No DB, provider clients or background work.
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
export async function onRequestPost({request,env}){
 if(!env.JARVIS_ACCESS_PASSWORD||request.headers.get('x-jarvis-password')!==env.JARVIS_ACCESS_PASSWORD)return json({error:'認証が必要です'},401);
 const u=new URL(request.url);
 if(env.CF_PAGES_BRANCH!=='feature/ai-business-rebuild'||u.protocol!=='https:'||! /^(?:[a-f0-9]{8}|feature-ai-business-rebuild)\.asset-simulator-87y\.pages\.dev$/.test(u.hostname)||(request.headers.get('Origin')&&request.headers.get('Origin')!==u.origin))return json({error:'対象Previewのみ利用できます'},403);
 if(!request.headers.get('content-type')?.startsWith('application/json'))return json({error:'JSONが必要です'},400);
 try{
  const raw=await request.text();if(new TextEncoder().encode(raw).length>30000)return json({error:'入力が長すぎます'},413);
  const b=JSON.parse(raw),text=b.message,history=b.conversation;
  if(typeof text!=='string'||!text.trim()||text.length>2000||!Array.isArray(history)||history.length>8||history.some(r=>!['user','assistant'].includes(r?.role)||typeof r.text!=='string'||r.text.length>2000))return json({error:'会話の形式を確認してください'},400);
  if([text,...history.map(r=>r.text)].some(t=>t.includes(env.JARVIS_ACCESS_PASSWORD)))return json({error:'認証情報を会話に含めないでください'},400);
  const previous=history.filter(r=>r.role==='user').at(-1)?.text;
  const answer='【Previewモック】'+(/こんにちは|おはよう|こんばんは/.test(text)?'こんにちは。J.A.R.V.I.S.です。':'「'+text.slice(0,100)+'」ですね。')+(previous?' 前の「'+previous.slice(0,60)+'」という相談を引き継いでいます。':'')+' 次は何を相談しますか。実AIは使用していません。';
  return json({answer,mock:true,realCostUSD:0});
 }catch{return json({error:'会話データを読み取れませんでした'},400);}
}
