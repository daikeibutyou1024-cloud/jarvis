import assert from 'node:assert/strict';
import {browserRuntime} from './browser-runtime.mjs';
import {startRehearsal} from './rehearsal-server.mjs';
import {budgetEnv} from './runtime-fixture.js';
import * as collect from '../functions/api/research/collect.js';
import * as ideas from '../functions/api/research/ideas.js';
import * as jobs from '../functions/api/business/jobs.js';
const rt=await browserRuntime(),r=await startRehearsal({apiHandlers:{'/api/research/collect':collect,'/api/research/ideas':ideas,'/api/business/jobs':jobs}});let browser;let calls=0;
Object.assign(r.env,budgetEnv,{ANTHROPIC_API_KEY:'mock-only'});
const provider=text=>Response.json({stop_reason:'end_turn',usage:{input_tokens:50,output_tokens:50},content:[{type:'text',text}]});
const article='# AI資料の読み方\n## 確認\n公式資料を確認する手順です。[R1]\n## 活用\n用途を整理し、人間が確認します。';
globalThis.fetch=async(url,init)=>{
 if(String(url)==='https://www.digital.go.jp/rss/news.xml')return new Response('<rss version="2.0"><channel><title>公式</title><item><title>AI資料</title><link>https://www.digital.go.jp/news/test</link><description>AIの公式案内</description></item></channel></rss>',{headers:{'content-type':'application/rss+xml'}});
 assert.equal(String(url),'https://api.anthropic.com/v1/messages');calls++;
 if(calls===1){const id=JSON.parse(init.body).messages[0].content.match(/"id":"([^"]+)"/)[1];return provider(JSON.stringify({ideas:[{title:'AI資料の読み方',reader:'初心者の仮説',angle:'確認する仮説',format:'note_free',reason:'無料の解説に適する仮説',sourceIds:[id],scores:Object.fromEntries(['demand','differentiation','monetization','evidence'].map(k=>[k,{score:3,reason:'実測ではないAI仮説'}]))}]}));}
 return provider(article);
};
try{
 browser=await rt.playwright.chromium.launch({headless:true,executablePath:rt.executable});const context=await browser.newContext();await context.route('**/*',route=>new URL(route.request().url()).origin===r.baseURL?route.continue():route.abort());
 const p=await context.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));await p.goto(r.baseURL+'/#research');
 assert.match(await p.locator('#prototype-next').textContent(),/情報取得/);await p.locator('#research-query').fill('AI');await p.locator('#research-collect').click();await p.locator('#password').fill('rehearsal-only');await p.locator('#auth-form button.primary').click();await p.locator('#research-records input[type=checkbox]').check();
 await p.locator('#topic').fill('AI');await p.locator('#research-propose').click();await p.waitForFunction(()=>document.querySelector('#status').textContent.includes('確認済み'));assert.equal(calls,0);
 await p.getByRole('button',{name:'内容・出典を確認済みにする'}).click();await p.locator('#research-propose').click();await p.getByRole('button',{name:'この企画と確認済み資料でCONTENTへ'}).click();
 await p.locator('#editorial-research').click();await p.locator('#editorial-outline').fill('確認\n活用');await p.locator('#cloud-generate').click();await p.waitForFunction(()=>document.querySelector('#output').value.includes('公式資料を確認する'));const saved=await p.locator('#output').inputValue();assert(saved.includes('https://www.digital.go.jp/news/test'));
 await p.locator('#editorial-load').click();await p.waitForFunction(()=>document.querySelector('#prototype-flow').dataset.complete==='true');assert.equal(await p.locator('#output').inputValue(),saved);
 // A late save conflict must not overwrite the active editor with its recovery payload.
 await context.route('**/api/business/jobs',route=>route.fulfill({status:409,json:{code:'SAVE_CONFLICT',error:'模擬保存競合',diagnostic:{id:'mock-id',stage:'article_save'},recovery:{output:'救出用の別原稿',generation:{}}}}));
 await p.locator('#cloud-generate').click();await p.waitForFunction(()=>document.querySelector('#prototype-result').textContent.includes('mock-id'));assert.equal(await p.locator('#output').inputValue(),saved);assert.equal(await p.locator('#generation-recovery-text').inputValue(),'救出用の別原稿');
 await p.locator('#output').fill(saved+'\n未保存の編集');await p.evaluate(()=>location.hash='research');await p.getByRole('button',{name:'この企画と確認済み資料でCONTENTへ'}).click();assert.equal(await p.locator('#workspace').isVisible(),true);assert.equal(await p.locator('#output').inputValue(),saved+'\n未保存の編集');assert.equal(new URL(p.url()).hash,'#research');
 assert.equal(calls,2);assert.deepEqual(errors,[]);assert.equal(r.stats().outboundAttempts,0);console.log(JSON.stringify({result:'passed',scope:'actual research/ideas/jobs/editorial handlers + local DB + browser; fixtures only',flow:'collect,unreviewed blocked,review,plan,handoff,generate,save,reload,conflict recovery,unsaved protection',externalRequests:0}));
}finally{await browser?.close();await r.close();}
