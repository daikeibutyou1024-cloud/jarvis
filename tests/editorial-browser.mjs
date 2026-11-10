// Local app + real SQLite handlers. No provider requests or live deployment required.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {testDB} from './runtime-fixture.js';
import * as editorial from '../functions/api/business/editorial.js';
let playwright;try{playwright=await import('playwright');}catch{playwright=createRequire('/workspace/jarvis-tools/package.json')('playwright');}
const db=testDB(),env={JARVIS_DB:db,JARVIS_ACCESS_PASSWORD:'test'},original=fetch;
globalThis.fetch=()=>{throw Error('No provider requests allowed');};
const browser=await playwright.chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
try{
 const page=await browser.newPage({acceptDownloads:true}),errors=[];let exports=0;
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/**',async route=>{
  const r=route.request();if(!new URL(r.url()).pathname.endsWith('/editorial'))throw Error('Unexpected API route');
  if(r.method()==='POST'&&r.postDataJSON().action==='export')exports++;
  const response=await editorial[r.method()==='POST'?'onRequestPost':'onRequestGet']({env,request:new Request(r.url(),{method:r.method(),headers:r.headers(),...(r.method()==='POST'?{body:r.postData()}: {})})});
  await route.fulfill({status:response.status,contentType:'application/json',body:await response.text()});
 });
 await page.goto((process.env.BASE_URL||'http://localhost:8080')+'/#content');
 await page.locator('#format').selectOption('note無料記事');await page.locator('#topic').fill('体験の考察');await page.locator('#audience').fill('初心者');await page.locator('#editorial-idea').fill('実体験を使える考察へ整理');await page.locator('#editorial-outline').fill('悩み\n対策');await page.locator('#editorial-no-facts').check();await page.locator('#output').fill('# 考察\n## 悩み\n困りごと。\n## 対策\n考えた対策。');
 await page.locator('#manual-complete').click();await page.locator('#editorial-save').click();await page.locator('#password').fill('test');await page.locator('#auth-form button.primary').click();await page.waitForFunction(()=>document.querySelector('#editorial-status').textContent.includes('全文確認待ち'));
 for(const key of ['facts','usefulness','rights','privacy','advertising'])await page.locator('#review-'+key).check();await page.locator('#editorial-approve').click();await page.waitForFunction(()=>document.querySelector('#editorial-status').textContent.includes('全文確認済み'));
 const download=page.waitForEvent('download');await page.locator('#editorial-download').click();assert.match((await download).suggestedFilename(),/\.md$/);assert.equal(exports,1);assert.match(await page.locator('#editorial-export').inputValue(),/## 対策/);
 await page.locator('#output').fill('# 考察\n## 悩み\n修正した本文。\n## 対策\n次の対策。');await page.locator('#editorial-download').click();await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('先に「制作案件を保存」'));assert.equal(exports,1);
 await page.locator('#editorial-save').click();await page.waitForFunction(()=>document.querySelector('#editorial-status').textContent.includes('全文確認待ち'));assert.equal(db.db.prepare('SELECT MAX(revision) n FROM document_revisions').get().n,2);assert.equal(db.db.prepare('SELECT COUNT(*) n FROM editorial_reviews').get().n,1);assert.deepEqual(errors,[]);console.log('editorial browser: passed');
}finally{await browser.close();db.db.close();globalThis.fetch=original;}
