// Actual browser + actual local HTTP handlers + disposable SQLite. Never point this at a deployment.
import assert from 'node:assert/strict';
import {browserRuntime} from './browser-runtime.mjs';
import {startRehearsal} from './rehearsal-server.mjs';
import {localRequest} from './local-http.mjs';
import {article,evidence} from './paid-fixture.js';
import {defaultOutline,REVIEW_CHECKS} from '../lib/editorial.js';
let rehearsal,browser;
try{
 const runtime=await browserRuntime();rehearsal=await startRehearsal();
 browser=await runtime.playwright.chromium.launch({headless:true,executablePath:runtime.executable});const context=await browser.newContext({acceptDownloads:true});
 await context.route('**/*',route=>{const url=new URL(route.request().url());return url.origin===rehearsal.baseURL?route.continue():route.abort('blockedbyclient');});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));const text='# 体験の考察\n## 悩み\n困りごとの架空の例。\n## 対策\nメモに書き出して整理する。';
 const auth=async()=>{await page.locator('#password').fill('rehearsal-only');await page.locator('#auth-form button.primary').click();};
 const approve=async()=>{for(const key of REVIEW_CHECKS)await page.locator('#review-'+key).check();await page.locator('#editorial-approve').click();await page.waitForFunction(()=>document.querySelector('#editorial-status').textContent.includes('全文確認済み'));};
 await page.goto(rehearsal.baseURL+'/#content');await page.locator('#format').selectOption('note無料記事');await page.locator('#topic').fill('体験の考察');await page.locator('#audience').fill('初心者');await page.locator('#editorial-idea').fill('架空の体験を整理');await page.locator('#editorial-outline').fill('悩み\n対策');await page.locator('#editorial-no-facts').check();await page.locator('#output').fill(text);await page.locator('#manual-complete').click();await page.locator('#editorial-save').click();await auth();await page.waitForFunction(()=>document.querySelector('#editorial-status').textContent.includes('全文確認待ち'));
 await page.reload();await page.locator('#editorial-queue-refresh').click();await auth();await page.locator('#editorial-queue button').click();assert.equal(await page.locator('#output').inputValue(),text);await approve();
 let download=page.waitForEvent('download');await page.locator('#editorial-download').click();assert.match((await download).suggestedFilename(),/\.md$/);assert.match(await page.locator('#editorial-export').inputValue(),/## 対策/);
 await page.locator('#output').fill(text+'\n修正した検証用の本文。');await page.locator('#editorial-save').click();await page.waitForFunction(()=>document.querySelector('#editorial-status').textContent.includes('全文確認待ち'));assert.equal(rehearsal.db.db.prepare('SELECT MAX(revision) n FROM document_revisions').get().n,2);
 const paid={action:'save',projectId:'browser-paid-fixture',expectedRevision:0,topic:'業務整理ガイド',audience:'初心者',notes:'ローカル模擬データ',format:'note有料記事',text:article,evidence,manualComplete:true,workflow:{idea:'架空の教材の検証',outline:defaultOutline('note有料記事'),noExternalFacts:false}};
 assert.equal((await localRequest(rehearsal.baseURL,'/api/business/editorial',{method:'POST',body:paid})).status,201);await page.locator('#editorial-queue-refresh').click();await page.locator('#editorial-queue li').filter({hasText:'業務整理ガイド'}).getByRole('button',{name:'開く'}).click();await approve();download=page.waitForEvent('download');await page.locator('#editorial-download').click();await download;assert.match(await page.locator('#editorial-paid').inputValue(),/完成テンプレート/);
 assert.equal(rehearsal.stats().outboundAttempts,0);assert.deepEqual(errors,[]);console.log(JSON.stringify({result:'passed',scope:'local browser + actual HTTP handlers + disposable SQLite; not live Preview',freeNote:'UI save/reload/approve/export/edit',paidNote:'HTTP fixture save/UI load/approve/export',externalRequests:0}));
}catch(e){console.error(JSON.stringify({result:e.code?.startsWith('BROWSER_')?'blocked':'failed',code:e.code||'BROWSER_FLOW_FAILED',message:e.code?.startsWith('BROWSER_')?e.message:'ブラウザの一連検証が失敗しました。実APIやリモートDBは利用していません'}));process.exitCode=e.code?.startsWith('BROWSER_')?2:1;}
finally{if(browser)await browser.close();if(rehearsal)await rehearsal.close();}
