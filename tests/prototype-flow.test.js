import test from 'node:test';
import assert from 'node:assert/strict';
import {testDB,budgetEnv} from './runtime-fixture.js';
import {onRequestGet as collect} from '../functions/api/research/collect.js';
import {onRequestPost as ideas} from '../functions/api/research/ideas.js';
import {onRequestPost as jobs} from '../functions/api/business/jobs.js';
import * as editorial from '../functions/api/business/editorial.js';
import {researchPacket} from '../assets/research-data.js';
import {prototypeProgress} from '../assets/prototype-flow.js';
const request=(path,body)=>new Request('http://localhost'+path,{method:body?'POST':'GET',headers:{'x-jarvis-password':'test'},...(body?{body:JSON.stringify(body)}:{})});
const article='# AI資料の読み方\n## 確認\n公式資料の内容を確認します。[R1]\n## 活用\n用途を整理し、人間が内容を確認してください。';
const response=text=>Response.json({stop_reason:'end_turn',usage:{input_tokens:50,output_tokens:50},content:[{type:'text',text}]});
async function flow(scenario){
 const db=testDB(),old=fetch;let paidCalls=0;
 const env={...budgetEnv,JARVIS_DB:db,JARVIS_ACCESS_PASSWORD:'test',ANTHROPIC_API_KEY:'mock-only',AI_TIMEOUT_MS:scenario==='timeout'?'15':'30000'};
 const initial={action:'save',projectId:'existing-case',expectedRevision:0,topic:'保持する既存記事',notes:'ローカル試験',audience:'初心者',format:'note無料記事',text:article.replace('[R1]',''),evidence:'',manualComplete:true,workflow:{idea:'以前の企画',outline:['確認','活用'],noExternalFacts:true}};
 try{
  const initialResponse=await editorial.onRequestPost({env,request:request('/api/business/editorial',initial)});assert.equal(initialResponse.status,201,await initialResponse.text());
  globalThis.fetch=async(url,init)=>{
   if(String(url)==='https://www.digital.go.jp/rss/news.xml')return new Response('<?xml version="1.0"?><rss version="2.0"><channel><title>公式</title><item><title>AI資料</title><link>https://www.digital.go.jp/news/test</link><description>AIの資料を確認するための公式案内</description></item></channel></rss>',{headers:{'content-type':'application/rss+xml'}});
   assert.equal(String(url),'https://api.anthropic.com/v1/messages');paidCalls++;
   if(paidCalls===1){if(scenario==='invalid_idea')return response('不正な企画JSON');const prompt=JSON.parse(init.body).messages[0].content;const match=prompt.match(/"id":"([^"]+)"/);assert(match);return response(JSON.stringify({ideas:[{title:'AI資料の読み方',reader:'初心者という仮説',angle:'確認手順という仮説',format:'note_free',reason:'無料記事の仮説',sourceIds:[match[1]],scores:Object.fromEntries(['demand','differentiation','monetization','evidence'].map(k=>[k,{score:3,reason:'実測ではないAI仮説'}]))}]}));}
   if(scenario==='timeout')return new Promise(()=>{});
   if(scenario==='invalid')return new Response('not json');
   return response(article);
  };
  let r=await collect({env,request:request('/api/research/collect?source=digital&q=AI')});assert.equal(r.status,200);const acquired=(await r.json()).items;assert(acquired.length);const row=acquired[0];assert(!row.reviewedAt);
  r=await ideas({env,request:request('/api/research/ideas',{topic:'AI',records:[row]})});assert.equal(r.status,400);assert.equal(paidCalls,0);
  row.reviewedAt=new Date().toISOString();r=await ideas({env,request:request('/api/research/ideas',{topic:'AI',records:[row]})});if(scenario==='invalid_idea'){const failure=await r.json();assert.equal(r.status,503);assert.equal(failure.diagnostic.stage,'idea_validation');assert.equal(paidCalls,1);assert.equal(db.db.prepare("SELECT COUNT(*) n FROM document_revisions WHERE project_id='existing-case'").get().n,1);return;}assert.equal(r.status,200);const plan=(await r.json()).ideas[0];assert.equal(plan.classification,'ai_hypothesis');
  const evidence=researchPacket([row]);
  if(scenario==='budget')env.AI_MONTHLY_BUDGET_USD='0.000001';
  const b={department:'content',topic:plan.title,audience:'初心者',format:'note無料記事',notes:'架空の実績を作らない',context:evidence,projectId:scenario==='conflict'?'existing-case':'new-case',expectedRevision:0};
  r=await jobs({env,request:request('/api/business/jobs',b)});const result=await r.json();
  if(scenario==='success'){
   assert.equal(r.status,201);assert(result.generation.diagnostic.id);
   r=await editorial.onRequestGet({env,request:request('/api/business/editorial?projectId=new-case')});const loaded=(await r.json()).document;assert.equal(loaded.output,result.output);assert.match(loaded.evidence,/https:\/\/www.digital.go.jp\/news\/test/);assert(loaded.evidence.includes(row.id));assert(loaded.evidence.includes(row.fetchedAt));
   const save={...initial,projectId:'new-case',expectedRevision:1,text:loaded.output+'\n補足',evidence:loaded.evidence};assert.equal((await editorial.onRequestPost({env,request:request('/api/business/editorial',save)})).status,201);assert.equal(db.db.prepare("SELECT COUNT(*) n FROM document_revisions WHERE project_id='new-case'").get().n,2);
  }else{assert(r.status>=400);if(scenario==='timeout')assert.equal(result.code,'AI_TIMEOUT');if(scenario==='invalid')assert.equal(result.code,'AI_RESPONSE_INVALID');if(scenario==='budget')assert.equal(result.code,'AI_BUDGET_EXCEEDED');if(scenario==='conflict')assert.equal(result.code,'SAVE_CONFLICT');assert.equal(db.db.prepare("SELECT COUNT(*) n FROM document_revisions WHERE project_id='new-case'").get().n,0);}
  assert.equal(paidCalls,['budget','conflict'].includes(scenario)?1:2);const before=JSON.parse(db.db.prepare("SELECT payload FROM document_revisions WHERE project_id='existing-case'").get().payload);assert.equal(before.output,article.replace('[R1]',''));
 }finally{globalThis.fetch=old;db.db.close();}
}
for(const scenario of ['success','timeout','budget','conflict','invalid','invalid_idea'])test('A offline actual handlers: '+scenario,()=>flow(scenario));
test('progress never equates generation or saving with reload or human approval',()=>{
 assert.equal(prototypeProgress({}).next,'情報取得');
 const p=prototypeProgress({records:1,reviewed:1,plan:true,handoff:true,text:true,saved:true,reloaded:false});assert.equal(p.next,'再読込・照合');assert.equal(p.complete,false);
 assert.equal(prototypeProgress({records:1,reviewed:1,plan:true,handoff:true,text:true,saved:true,reloaded:true}).complete,true);
});
