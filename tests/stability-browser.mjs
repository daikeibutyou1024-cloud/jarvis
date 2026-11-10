// Run with a local static server. Every API request is routed to local handlers; no provider is contacted.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {testDB,budgetEnv} from './runtime-fixture.js';
import * as paid from '../functions/api/business/paid-drafts.js';
import * as docs from '../functions/api/business/drafts.js';
import * as jobs from '../functions/api/business/jobs.js';
import * as usage from '../functions/api/business/usage.js';
let playwright;try{playwright=await import('playwright');}catch{playwright=createRequire('/workspace/jarvis-tools/package.json')('playwright');}
const db=testDB(),env={...budgetEnv,JARVIS_DB:db,JARVIS_ACCESS_PASSWORD:'test',ANTHROPIC_API_KEY:'fake'};
const original=fetch;globalThis.fetch=()=>{throw Error('Real API is forbidden');};
const browser=await playwright.chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
try{
 const context=await browser.newContext(),page=await context.newPage(),errors=[];
 context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
 page.on('pageerror',e=>errors.push(e.message));
 await context.route('**/api/**',async route=>{
  const r=route.request(),path=new URL(r.url()).pathname;
  const api=path.endsWith('paid-drafts')?paid:path.endsWith('drafts')?docs:path.endsWith('usage')?usage:jobs;
  const response=await api[r.method()==='POST'?'onRequestPost':'onRequestGet']({env,request:new Request(r.url(),{method:r.method(),headers:r.headers(),...(r.method()==='POST'?{body:r.postData()}: {})})});
  await route.fulfill({status:response.status,contentType:'application/json',body:await response.text()});
 });
 const base=process.env.BASE_URL||'http://localhost:8080';
 await page.goto(base+'/#content');await page.locator('#topic').fill('保存テスト');await page.locator('#format').selectOption('note無料記事');await page.locator('#output').fill('原稿一版');
 await page.locator('#save-paid-cloud').click();await page.locator('#password').fill('test');await page.locator('#auth-form button.primary').click();await page.waitForFunction(()=>document.querySelector('#document-state').textContent.includes('クラウド版 1'));
 await page.locator('#output').fill('原稿二版');await page.locator('#save-paid-cloud').click();await page.waitForFunction(()=>document.querySelector('#document-state').textContent.includes('クラウド版 2'));
 await page.locator('#revision-refresh').click();await page.locator('#revision-list button').last().click();assert.equal(await page.locator('#output').inputValue(),'原稿一版');
 await page.locator('#output').fill('古い版から編集');await page.locator('#save-paid-cloud').click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('別の保存'));
 assert.equal(await page.locator('#output').inputValue(),'古い版から編集');assert.equal(db.db.prepare('SELECT MAX(revision) n FROM document_revisions').get().n,2);
 await page.locator('#save-draft').click();await page.waitForFunction(()=>document.querySelector('#drafts').textContent.includes('端末版 1'));
 await page.locator('#usage-refresh').click();await page.waitForFunction(()=>document.querySelector('#usage-summary').textContent.includes('月額予算'));
 assert.deepEqual(errors,[]);console.log('stability browser: passed');
}finally{await browser.close();db.db.close();globalThis.fetch=original;}
