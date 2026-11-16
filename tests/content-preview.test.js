import test from 'node:test';
import assert from 'node:assert/strict';
import {previewArticle} from '../lib/content-preview.js';
import {runAI,liveAIPolicy} from '../lib/ai-runtime.js';
import {onRequestPost as mock} from '../functions/api/business/content-preview.js';
import {onRequestPost as chat} from '../functions/api/chat.js';
import {onRequestPost as jobs} from '../functions/api/business/jobs.js';
import {onRequestPost as ideas} from '../functions/api/research/ideas.js';
const evidence='【RESEARCH 3.0 引き継ぎ資料】\n[R1] 公式AI更新\nRSS要約・資料メモ：対応環境が更新されました\n利用者確認日時：2026-11-16T00:00:00Z\n出典：https://github.com/ollama/ollama/releases/tag/v1';
const generation={mode:'full',format:'note無料記事',title:'初心者のAI活用',evidence};
const env={CF_PAGES_BRANCH:'feature/ai-business-rebuild',JARVIS_ACCESS_PASSWORD:'test',JARVIS_DB:{prepare(){throw Error('DB forbidden');}}};
const req=(path='content-preview',url='https://abcd1234.asset-simulator-87y.pages.dev',password='test')=>new Request(url+'/api/business/'+path,{method:'POST',headers:{'content-type':'application/json','x-jarvis-password':password},body:JSON.stringify({generation})});
test('mock uses real supplied evidence and Claude envelope composition without DB or network',async()=>{
 const res=await mock({env,request:req()});assert.equal(res.status,200);const data=await res.json();assert.match(data.answer,/公式AI更新/);assert.match(data.answer,/対応環境が更新/);assert.match(data.answer,/https:\/\/github.com/);assert.match(data.answer,/Previewモック/);assert.equal(data.generation.provider,'preview-mock');assert.equal(data.generation.realCostUSD,0);assert.equal(data.budget.budgetUSD,5);assert.equal(data.budget.verified,false);
});
test('mock rejects unreviewed or absent sources, unsupported generation and wrong environments',async()=>{
 assert.throws(()=>previewArticle({...generation,evidence:''}));assert.throws(()=>previewArticle({...generation,evidence:evidence.replace('2026-11-16T00:00:00Z','未確認')}));assert.throws(()=>previewArticle({...generation,mode:'chapter',section:'x'}));
 assert.equal((await mock({env,request:req('content-preview',undefined,'wrong')})).status,401);
 assert.equal((await mock({env:{...env,CF_PAGES_BRANCH:'main'},request:req()})).status,403);
 assert.equal((await mock({env,request:req('content-preview','https://asset-simulator-87y.pages.dev')})).status,403);
});
test('all real generation routes fail closed before DB writes or outbound calls despite claimed budget flags',async()=>{
 const e={...env,ANTHROPIC_API_KEY:'not-real',OPENAI_API_KEY:'not-real',AI_MONTHLY_BUDGET_USD:'5',AI_BUDGET_VERIFIED:'true',AI_ALLOW_LIVE:'true'};
 for(const handler of [chat,jobs,ideas]){const res=await handler({env:e,request:req()});assert.equal(res.status,503);assert.equal((await res.json()).code,'AI_BUDGET_UNVERIFIED');}
 await assert.rejects(runAI(e,'chat','test',4000),x=>x.code==='AI_BUDGET_UNVERIFIED');assert.equal(liveAIPolicy().allowed,false);
});
