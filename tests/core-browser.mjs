import assert from 'node:assert/strict';
import {browserRuntime} from './browser-runtime.mjs';
import {startRehearsal} from './rehearsal-server.mjs';
const r=await startRehearsal(),rt=await browserRuntime();let browser;
try{
 browser=await rt.playwright.chromium.launch({headless:true,executablePath:rt.executable});const c=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2});
 await c.route('**/*',route=>new URL(route.request().url()).origin===r.baseURL?route.continue():route.abort());
 await c.addInitScript(()=>{
  window.SpeechSynthesisUtterance=class {constructor(text){this.text=text;}};
  Object.defineProperty(window,'speechSynthesis',{value:{cancel(){},speak(u){window.lastSpeech=u;u.onstart?.();}}});
  window.SpeechRecognition=class{start(){window.recognition=this;this.onstart();}stop(){this.onend();}};
 });
 const p=await c.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));await p.goto(r.baseURL+'/#overview');
 await p.evaluate(()=>window.lastSpeech?.onend?.());const core=p.locator('#orb-voice');
 for(const width of [320,375,390,430,768,1440]){await p.setViewportSize({width,height:900});assert(await core.isVisible());assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert((await core.boundingBox()).width<=width);}
 await p.setViewportSize({width:390,height:844});assert.equal(await p.locator('.orb-ring').evaluate(el=>getComputedStyle(el).animationDuration),'28s');await p.screenshot({path:'/tmp/jarvis-hologram-idle.png'});
 await core.click();await p.waitForFunction(()=>document.querySelector('#orb-voice').dataset.state==='listening');await p.evaluate(()=>window.recognition.onresult({results:[[{transcript:'音声入力テスト'}]]}));assert.equal(await p.locator('#command').inputValue(),'音声入力テスト');await core.click();assert.equal(await core.getAttribute('data-state'),'idle');
 let release;const gate=new Promise(resolve=>release=resolve);
 await c.route('**/api/chat',async route=>{await gate;await route.fulfill({json:{answer:'模擬回答です。😊'}});});
 await p.locator('#speak').check();await p.locator('#send-command').click();await p.locator('#password').fill('rehearsal-only');await p.locator('#auth-form button.primary').click();await p.waitForFunction(()=>document.querySelector('#orb-voice').dataset.state==='thinking');
 assert.equal(await p.locator('.orb-ring').evaluate(el=>getComputedStyle(el).animationDuration),'5s');release();await p.waitForFunction(()=>document.querySelector('#orb-voice').dataset.state==='speaking');assert.match(await p.locator('#conversation').textContent(),/模擬回答です。😊/);
 await p.locator('#stop-speech').click();assert.equal(await core.getAttribute('data-state'),'idle');
 await c.route('**/api/chat',route=>route.fulfill({status:504,json:{error:'模擬タイムアウト',diagnostic:{id:'mock-diagnostic',stage:'provider_body'}}}));
 await p.locator('#command').fill('失敗テスト');await p.locator('#send-command').click();await p.waitForFunction(()=>document.querySelector('#orb-voice').dataset.state==='error');assert.equal(await core.evaluate(el=>getComputedStyle(el).getPropertyValue('--core-light').trim()),'#ffac52');await p.waitForFunction(()=>document.querySelector('#orb-voice').dataset.state==='idle');
 await p.emulateMedia({reducedMotion:'reduce'});assert.equal(await p.locator('.orb-ring').evaluate(el=>getComputedStyle(el).animationName),'none');
 assert.deepEqual(errors,[]);assert.equal(r.stats().outboundAttempts,0);console.log(JSON.stringify({result:'passed',viewports:6,states:['idle','listening','thinking','speaking','error'],reducedMotion:true,externalRequests:0,engine:'Chromium mobile emulation; not real Safari'}));
}finally{await browser?.close();await r.close();}
