// Cloudflare Pages Function: authorized job execution and read-only status.
// Requires existing JARVIS_DB and JARVIS_ACCESS_PASSWORD bindings.
// Explicit request only; scheduled execution is NOT enabled by this file.
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});
const valid=(request,env)=>!!env.JARVIS_ACCESS_PASSWORD && request.headers.get("x-jarvis-password")===env.JARVIS_ACCESS_PASSWORD;
const instruction=(topic)=>[
"あなたはJ.A.R.V.I.S.のAI副業リサーチ担当です。日本語でnote向けの記事下書きを作成してください。",
"テーマ："+topic,
"出力：読者の悩み、記事タイトル、本文、実用例、注意点、要検証の事実、参考にすべき公式情報の種類。",
"このAIにはリアルタイム検索が接続されていません。最新の情報を調査したふりをしないこと。",
"収益保証、架空の体験談、未検証の価格・報酬額、誇大広告は禁止。広告リンクを掲載する場合はPR表記を促すこと。",
"外部サービスへの投稿や購入は行わないこと。"
].join("\n");
async function createDraft(env,topic){
 const provider=String(env.AI_PROVIDER||"anthropic").toLowerCase();
 if(provider==="openai"){
  if(!env.OPENAI_API_KEY)throw new Error("OpenAI API未設定");
  const response=await fetch("https://api.openai.com/v1/chat/completions",{
   method:"POST",headers:{"Authorization":"Bearer "+env.OPENAI_API_KEY,"Content-Type":"application/json"},
   body:JSON.stringify({model:env.OPENAI_MODEL||"gpt-4.1-mini",messages:[{role:"user",content:instruction(topic)}]})
  });
  const data=await response.json();
  if(!response.ok)throw new Error("OpenAI API HTTP "+response.status);
  return data.choices?.[0]?.message?.content||"";
 }
 if(provider!=="anthropic")throw new Error("AI_PROVIDERが不正です");
 const response=await fetch("https://api.anthropic.com/v1/messages",{
  method:"POST",headers:{"x-api-key":env.ANTHROPIC_API_KEY,"anthropic-version":"2023-06-01","content-type":"application/json"},
  body:JSON.stringify({model:env.ANTHROPIC_MODEL||"claude-sonnet-4-6",max_tokens:2500,messages:[{role:"user",content:instruction(topic)}]})
 });
 const data=await response.json();
 if(!response.ok)throw new Error("AI provider HTTP "+response.status);
 return (data.content||[]).filter(x=>x.type==="text").map(x=>x.text).join("\n");
}
export async function onRequestGet({request,env}){
 if(!valid(request,env))return json({error:"認証できません"},401);
 if(!env.JARVIS_DB)return json({error:"D1未接続"},503);
 try{
  const result=await env.JARVIS_DB.prepare("SELECT id,job_type,topic,status,output,error,created_at,updated_at FROM business_jobs ORDER BY created_at DESC LIMIT 20").all();
  return json({jobs:result.results||[]});
 }catch{return json({error:"D1テーブル未作成、または読み込みに失敗しました"},503)}
}
export async function onRequestPost({request,env}){
 if(!valid(request,env))return json({error:"認証できません"},401);
 if(!env.JARVIS_DB)return json({error:"D1未接続"},503);
 const provider=String(env.AI_PROVIDER||"anthropic").toLowerCase();
 if(!["anthropic","openai"].includes(provider))return json({error:"AI_PROVIDER設定が不正です"},503);
 if(provider==="anthropic"&&!env.ANTHROPIC_API_KEY)return json({error:"Claude API未設定"},503);
 if(provider==="openai"&&!env.OPENAI_API_KEY)return json({error:"OpenAI API未設定"},503);
 let id=null;
 try{
  const body=await request.json();
  const topic=String(body.topic||"初心者向けAI活用").trim();
  if(!topic||topic.length>160)return json({error:"テーマは1〜160文字で入力してください"},400);
  // Daily cost guardrail (UTC): maximum five attempted generations.
  const daily=await env.JARVIS_DB.prepare("SELECT COUNT(*) AS total FROM business_jobs WHERE created_at >= date('now') AND created_at < date('now','+1 day')").first();
  if(Number(daily?.total||0)>=5)return json({error:"本日の生成上限（5件）に達しました"},429);
  id=crypto.randomUUID();
  await env.JARVIS_DB.prepare("INSERT INTO business_jobs(id,job_type,topic,status) VALUES(?,?,?,'running')").bind(id,"note_draft",topic).run();
  const output=await createDraft(env,topic);
  if(!output)throw new Error("empty response");
  await env.JARVIS_DB.prepare("UPDATE business_jobs SET status='draft',output=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(output,id).run();
  return json({id,status:"draft",output},201);
 }catch(error){
  if(id){try{await env.JARVIS_DB.prepare("UPDATE business_jobs SET status='failed',error=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind("生成に失敗しました。API設定や残高を確認してください。",id).run()}catch{}}
  return json({error:"処理に失敗しました。D1の設定やClaude APIの残高を確認してください。"},503);
 }
}
