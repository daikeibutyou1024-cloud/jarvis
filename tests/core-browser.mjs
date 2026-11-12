import assert from 'node:assert/strict';
import {browserRuntime} from './browser-runtime.mjs';
import {startRehearsal} from './rehearsal-server.mjs';
const r=await startRehearsal(),rt=await browserRuntime();let browser;
try{
 browser=await rt.playwright.chromium.launch({headless:true,executablePath:rt.executable});const c=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2,timezoneId:"Asia/Tokyo"});
 await c.route('**/*',route=>new URL(route.request().url()).origin===r.baseURL?route.continue():route.abort());
 await c.addInitScript(()=>{
  window.SpeechSynthesisUtterance=class {constructor(text){this.text=text;}};
  Object.defineProperty(window,'speechSynthesis',{value:{cancel(){},speak(u){window.lastSpeech=u;u.onstart?.();}}});
  window.SpeechRecognition=class{start(){window.recognition=this;this.onstart();}stop(){this.onend();}};
 });
 const p=await c.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));await p.goto(r.baseURL+'/#overview');
 await p.evaluate(()=>window.lastSpeech?.onend?.());const core=p.locator('#orb-voice');
 for(const width of [320,375,390,430,768,1440]){await p.setViewportSize({width,height:900});assert(await core.isVisible());assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert((await core.boundingBox()).width<=width);const boxes=await p.evaluate(()=>{const rect=id=>{const r=document.querySelector(id).getBoundingClientRect();return {x:r.x,y:r.y,bottom:r.bottom,right:r.right};};return {system:rect('.hud-system'),core:rect('.hud-core-stage'),chat:rect('#home-communication'),input:rect('#home-command')};});if(width===1440){assert(boxes.system.right<=boxes.core.x);assert(boxes.core.right<=boxes.chat.x);assert(boxes.input.y>=boxes.chat.bottom);await p.evaluate(()=>scrollTo(0,0));await p.screenshot({path:'/tmp/jarvis-command-desktop.png',fullPage:true});}if(width<=430){assert(boxes.system.bottom<=boxes.core.y);assert(boxes.core.bottom<=boxes.chat.y);assert(boxes.chat.bottom<=boxes.input.y);}}
 await p.setViewportSize({width:390,height:844});assert.equal(await p.locator('.orb-ring').evaluate(el=>getComputedStyle(el).animationDuration),'28s');await p.screenshot({path:'/tmp/jarvis-command-mobile.png',fullPage:true});assert.equal(await p.locator('#ai-status').textContent(),'未確認');assert.equal(await p.locator('#db-status').textContent(),'未確認');assert.match(await p.locator('#home-time').textContent(),/\d{1,2}:\d{2}:\d{2}/);
 await core.click();await p.waitForFunction(()=>document.querySelector('#orb-voice').dataset.state==='listening');assert.equal(await p.locator('#home-input-state').textContent(),'入力中');await p.evaluate(()=>window.recognition.onresult({results:[[{transcript:'音声入力テスト'}]]}));assert.equal(await p.locator('#command').inputValue(),'音声入力テスト');await core.click();assert.equal(await core.getAttribute('data-state'),'idle');
 let release;const gate=new Promise(resolve=>release=resolve);
 await c.route('**/api/chat',async route=>{await gate;await route.fulfill({json:{answer:'模擬回答です。😊'}});});
 await p.locator('#speak').check();await p.locator('#send-command').click();await p.locator('#password').fill('rehearsal-only');await p.locator('#auth-form button.primary').click();await p.waitForFunction(()=>document.querySelector('#orb-voice').dataset.state==='thinking');
 assert.equal(await p.locator('.orb-ring').evaluate(el=>getComputedStyle(el).animationDuration),'5s');release();await p.waitForFunction(()=>document.querySelector('#orb-voice').dataset.state==='speaking');assert.equal(await p.locator('#home-speech-state').textContent(),'読み上げ中');assert.match(await p.locator('#conversation').textContent(),/模擬回答です。😊/);
 await p.locator('#stop-speech').click();assert.equal(await core.getAttribute('data-state'),'idle');
 await c.route('**/api/chat',route=>route.fulfill({status:504,json:{error:'模擬タイムアウト',diagnostic:{id:'mock-diagnostic',stage:'provider_body'}}}));
 await p.locator('#command').fill('失敗テスト');await p.locator('#send-command').click();await p.waitForFunction(()=>document.querySelector('#orb-voice').dataset.state==='error');assert.equal(await core.evaluate(el=>getComputedStyle(el).getPropertyValue('--core-light').trim()),'#ffac52');await p.waitForFunction(()=>document.querySelector('#orb-voice').dataset.state==='idle');
 await p.emulateMedia({reducedMotion:'reduce'});assert.equal(await p.locator('.orb-ring').evaluate(el=>getComputedStyle(el).animationName),'none');
 assert.deepEqual(errors,[]);assert.equal(r.stats().outboundAttempts,0);console.log(JSON.stringify({result:'passed',viewports:6,states:['idle','listening','thinking','speaking','error'],reducedMotion:true,externalRequests:0,engine:'Chromium mobile emulation; not real Safari'}));
}finally{await browser?.close();await r.close();}
