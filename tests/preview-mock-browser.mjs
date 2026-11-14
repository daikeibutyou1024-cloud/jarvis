// Offline browser integration: intercepted localhost only, real Pages handlers + disposable SQLite.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {browserRuntime} from './browser-runtime.mjs';
import {adaptDB} from './runtime-fixture.js';
import {onRequestGet,onRequestPost} from '../functions/api/business/automation.js';
import {manage,snapshot} from '../lib/preview-mock.js';
globalThis.fetch=async()=>{throw Error('External network forbidden');};
const {playwright,executable}=await browserRuntime();
const browser=await playwright.chromium.launch({headless:true,executablePath:executable});
const raw=new DatabaseSync(':memory:');raw.exec(readFileSync(new URL('../migrations/0011_preview_mock_automation.sql',import.meta.url),'utf8'));
const db=adaptDB(raw);
const env={JARVIS_DB:db,JARVIS_ACCESS_PASSWORD:'browser-test-only',AI_MONTHLY_BUDGET_USD:'1',CF_PAGES_BRANCH:'feature/ai-business-rebuild',CF_PAGES_URL:'https://e931cfbb.asset-simulator-87y.pages.dev',PREVIEW_MOCK_AUTOMATION_ENABLED:'true'};
let external=0,conflictOnce=false,rejectStops=0,beforeTick=null;const errors=[],mutations=[];
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const releases=[];
try{
 const page=await browser.newPage({viewport:{width:1200,height:900}});page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{
  const r=route.request(),url=new URL(r.url());
  if(url.origin!=='http://127.0.0.1:8765'){external++;return route.abort();}
  if(url.pathname==='/api/business/automation'){
   if(r.method()==='POST'){
    const body=r.postDataJSON();mutations.push(body.action);
    if(body.action==='tick'&&beforeTick){const gate=beforeTick;beforeTick=null;gate.ready.resolve();await gate.release.promise;}
    if(body.action==='stop'&&rejectStops>0){rejectStops--;return route.fulfill({status:409,json:{error:'制御版の競合を注入'}});}
    if(body.action==='stop'&&conflictOnce){conflictOnce=false;await manage(db,{action:'stop',expectedVersion:(await snapshot(db)).control.version});}
   }
   const req=new Request(r.url(),{method:r.method(),headers:r.headers(),...(r.method()==='POST'?{body:r.postData()}:{} )});
   const response=await (r.method()==='POST'?onRequestPost:onRequestGet)({request:req,env});
   return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:await response.text()});
  }
  const files={'/automation-mock.html':['automation-mock.html','text/html'],'/assets/automation-mock.js':['assets/automation-mock.js','text/javascript']};
  if(!files[url.pathname])return route.fulfill({status:404,body:''});
  const [path,contentType]=files[url.pathname];return route.fulfill({body:readFileSync(new URL('../'+path,import.meta.url)),contentType});
 });
 await page.goto('http://127.0.0.1:8765/automation-mock.html');
 const complete=()=>page.waitForFunction(()=>document.getElementById('message').textContent.startsWith('完了'));
 const stopped=()=>page.waitForFunction(()=>document.getElementById('message').textContent.startsWith('停止を確認'));
 async function click(selector){await page.locator(selector).click();await (selector==='[data-action=stop]'?stopped():complete());}
 async function login(password){await page.locator('#password').fill(password);await page.locator('#login button').click();}
 await login('wrong');await page.waitForFunction(()=>document.getElementById('message').textContent.includes('認証が必要'));
 assert.equal(await page.locator('#manager').isVisible(),false);
 await login('browser-test-only');await complete();await click('[data-action=start]');
 async function step(key,time){await page.locator('#step').selectOption(key);await page.locator('#at').fill('2026-11-14T'+time);await click('#tick');}
 async function approve(kind){const box=page.locator('#items article').filter({has:page.getByRole('heading',{name:new RegExp(' '+kind+' /')})});await box.locator('input[type=checkbox]').check();await box.locator('button').click();await complete();}
 await step('collect','12:00');await step('themes','14:00');
 assert.match(await page.locator('#runs').textContent(),/awaiting_approval/);
 await approve('sources');await step('themes','14:00');await step('content','16:00');await approve('theme');await step('content','16:00');
 await click('[data-action=stop]');await page.reload();await login('browser-test-only');await complete();assert.match(await page.locator('#control').textContent(),/stopped/);
 await click('[data-action=start]');await step('save','18:00');await step('report','19:30');
 assert.match(await page.locator('#items').textContent(),/daily_report/);
 assert.equal(raw.prepare("SELECT COUNT(*) n FROM automation_runs WHERE state='completed'").get().n,5);
 // Hold completion AFTER the durable claim. Stop must bypass the pending tick,
 // retry its version conflict, fence late results and keep its status message.
 const ready=deferred(),release=deferred(),originalBatch=db.batch.bind(db);releases.push(release);
 let armed=true;
 db.batch=async ss=>{if(armed&&ss.length>=4){armed=false;ready.resolve();await release.promise;}return originalBatch(ss);};
 await page.locator('#step').selectOption('collect');await page.locator('#at').fill('2026-11-15T12:00');await page.locator('#tick').click();await ready.promise;
 const priorStops=mutations.filter(x=>x==='stop').length;conflictOnce=true;
 await click('[data-action=stop]');assert.equal(mutations.filter(x=>x==='stop').length-priorStops,2);
 assert.equal((await snapshot(db)).control.state,'stopped');
 const count=mutations.length;await page.locator('#tick').click();await page.locator('[data-action=start]').click();assert.equal(mutations.length,count);
 release.resolve();await page.waitForFunction(()=>document.getElementById('manager').getAttribute('aria-busy')==='false');db.batch=originalBatch;
 assert.match(await page.locator('#message').textContent(),/^停止を確認/);
 assert.equal(raw.prepare("SELECT COUNT(*) n FROM automation_work_items WHERE day='2026-11-15'").get().n,0);
 assert.equal(raw.prepare("SELECT state FROM automation_runs WHERE day='2026-11-15'").get().state,'interrupted');
 await page.locator('#tick').click();assert.equal(mutations.length,count); // Busy has cleared, stop latch still blocks.
 // Hold the next tick BEFORE it reaches the handler. Stop must advance version
 // even when no run was claimed, invalidating the older request upon arrival.
 await click('[data-action=start]');
 const gate={ready:deferred(),release:deferred()};releases.push(gate.release);beforeTick=gate;
 await page.locator('#at').fill('2026-11-16T12:00');await page.locator('#tick').click();await gate.ready.promise;
 await click('[data-action=stop]');gate.release.resolve();await page.waitForFunction(()=>document.getElementById('manager').getAttribute('aria-busy')==='false');
 assert.equal(raw.prepare("SELECT COUNT(*) n FROM automation_runs WHERE day='2026-11-16'").get().n,0);
 assert.equal((await snapshot(db)).control.state,'stopped');
 // Persistent conflict is bounded; uncertain stop never unlocks start or tick.
 const beforeConflict=mutations.length;rejectStops=3;await page.locator('[data-action=stop]').click();
 await page.waitForFunction(()=>document.getElementById('message').textContent.includes('停止は未確認'));
 assert.deepEqual(mutations.slice(beforeConflict),['stop','stop','stop']);
 const afterConflict=mutations.length;await page.locator('[data-action=start]').click();await page.waitForFunction(()=>document.getElementById('manager').getAttribute('aria-busy')==='false');await page.locator('#tick').click();assert.equal(mutations.length,afterConflict);
 await click('[data-action=stop]'); // Explicit retry can confirm and permit a later explicit start.
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.locator('#logout').click();assert.equal(await page.locator('#manager').isVisible(),false);
 assert.equal(external,0);assert.deepEqual(errors,[]);
 console.log('PASS: authenticated UI, approval/resume, reload, save/report, mobile, in-flight stop, late request fencing, conflict retries/lock; external requests 0');
}finally{for(const release of releases)release.resolve();await browser.close();raw.close();}
