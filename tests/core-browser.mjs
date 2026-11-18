import assert from 'node:assert/strict';
import {browserRuntime} from './browser-runtime.mjs';
import {startRehearsal} from './rehearsal-server.mjs';
const r=await startRehearsal(),rt=await browserRuntime();let browser;
try{
 browser=await rt.playwright.chromium.launch({headless:true,executablePath:rt.executable,args:['--no-sandbox']});
 for(const layout of [{name:'desktop',width:1440,height:1000},{name:'mobile',width:390,height:844}]){
  const c=await browser.newContext({viewport:{width:layout.width,height:layout.height},isMobile:layout.name==='mobile',hasTouch:layout.name==='mobile',timezoneId:'Asia/Tokyo'});let posts=0,release;
  const gate=new Promise(resolve=>release=resolve);
  await c.route('**/*',route=>new URL(route.request().url()).origin===r.baseURL?route.continue():route.abort());
  await c.addInitScript(()=>{
   window.recs=[];window.SpeechRecognition=class{constructor(){window.recs.push(this);}start(){window.recognition=this;this.onstart?.();}stop(){this.onend?.();}abort(){}};
   window.SpeechSynthesisUtterance=class{constructor(text){this.text=text;}};
   Object.defineProperty(window,'speechSynthesis',{value:{speak(u){window.lastSpeech=u;u.onstart?.();},cancel(){const u=window.lastSpeech;window.lastSpeech=null;u?.onend?.();},getVoices(){return [];}}});
  });
  await c.route('**/api/business/chat-preview',async route=>{posts++;assert.equal(route.request().headers()['x-jarvis-password'],'rehearsal-only');if(posts===1){await gate;return route.fulfill({json:{answer:'【Previewモック】模擬回答です。😊',mock:true,realCostUSD:0}});}return route.fulfill({status:504,json:{error:'模擬タイムアウト',diagnostic:{id:'core-mock',stage:'provider_body'}}});});
  const p=await c.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));await p.goto(r.baseURL+'/#overview');await p.evaluate(()=>window.speechSynthesis.cancel());const core=p.locator('#orb-voice'),color=()=>core.evaluate(e=>getComputedStyle(e).getPropertyValue('--core-light').trim());
  if(layout.name==='desktop')for(const width of [320,375,390,430,768,1440]){
   await p.setViewportSize({width,height:900});assert(await core.isVisible());assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert((await core.boundingBox()).width<=width);
   const b=await p.evaluate(()=>{const rect=q=>{const r=document.querySelector(q).getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom};};return {system:rect('.hud-system'),core:rect('.hud-core-stage'),chat:rect('#home-communication'),input:rect('#manual-input')};});
   assert(b.core.bottom<=b.system.y);assert(b.input.y>=b.core.y);assert(b.input.bottom<=b.core.bottom);assert(b.chat.y>=b.system.bottom);assert(await p.locator('#home-communication').evaluate(e=>e.parentElement.lastElementChild===e));assert.equal(await p.locator('#home-command').count(),0);
  }
  await p.setViewportSize({width:layout.width,height:layout.height});assert.equal(await color(),'#55e7ff',await core.getAttribute('data-state'));assert.equal(await p.locator('.orb-ring').evaluate(e=>getComputedStyle(e).animationDuration),'28s');
  // The orb now starts hands-free conversation: authenticate BEFORE recognition.
  await core.click();await p.waitForSelector('#auth-dialog[open]');assert.equal(await p.evaluate(()=>window.recs.length),0);assert.equal(posts,0);await p.locator('#password').fill('rehearsal-only');await p.locator('#auth-form button.primary').click();await p.waitForFunction(()=>document.querySelector('#orb-voice').dataset.state==='listening');assert.equal(await core.getAttribute('aria-pressed'),'true');assert.equal(await color(),'#ff5375');assert.equal(await p.locator('#home-input-state').textContent(),'入力中');
  const utter=text=>p.evaluate(text=>{const rec=window.recs.at(-1),row=[{transcript:text}];row.isFinal=true;rec.onresult({results:[row]});rec.onresult({results:[row]});rec.onend();rec.onend();},text);
  await utter('こんにちは');await p.waitForFunction(()=>document.querySelector('#orb-voice').dataset.state==='thinking');assert.equal(posts,1);assert.equal(await p.locator('.orb-ring').evaluate(e=>getComputedStyle(e).animationDuration),'5s');release();await p.waitForFunction(()=>document.querySelector('#orb-voice').dataset.state==='speaking');assert.equal(await color(),'#6596ff');assert.equal(await core.evaluate(e=>getComputedStyle(e).color),'rgb(101, 150, 255)');assert.equal(await p.evaluate(()=>window.lastSpeech.text),'模擬回答です。');assert.equal(await p.locator('#home-speech-state').textContent(),'読み上げ中');
  // Pressing the orb during speech cancels the loop. Late speech events cannot restart it.
  await p.evaluate(()=>window.savedSpeech=window.lastSpeech);await core.click();await p.waitForFunction(()=>document.querySelector('#orb-voice').dataset.state==='idle');await p.evaluate(()=>window.savedSpeech.onend?.());assert.equal(await core.getAttribute('aria-pressed'),'false');assert.equal(await p.evaluate(()=>window.recs.length),1);assert.equal(posts,1);
  await core.click();await p.waitForFunction(()=>window.recs.length===2);await utter('失敗テスト');await p.waitForFunction(()=>document.querySelector('#orb-voice').dataset.state==='error');assert.equal(await color(),'#ffac52');assert.equal(posts,2);await p.waitForFunction(()=>document.querySelector('#orb-voice').dataset.state==='idle');assert.equal(await color(),'#55e7ff');assert.equal(await core.getAttribute('aria-pressed'),'false');
  await core.click();await p.waitForFunction(()=>window.recs.length===3);await core.click();await utter('停止後の古いイベント');await p.waitForTimeout(1300);assert.equal(posts,2);assert.equal(await core.getAttribute('data-state'),'idle');
  await p.evaluate(()=>document.querySelector('#command').value='');await core.click();await p.waitForFunction(()=>window.recs.length===4);await p.evaluate(()=>window.recs.at(-1).onerror?.({error:'not-allowed'}));await p.waitForFunction(()=>document.querySelector('#orb-voice').dataset.state==='error');assert.match(await p.locator('#voice-status').innerText(),/マイク|許可/);assert.equal(posts,2);
  await p.emulateMedia({reducedMotion:'reduce'});assert.equal(await p.locator('.orb-ring').evaluate(e=>getComputedStyle(e).animationName),'none');assert.deepEqual(errors,[]);assert.equal(await p.evaluate(()=>Object.values(localStorage).join('|').includes('rehearsal-only')||Object.values(sessionStorage).join('|').includes('rehearsal-only')),false);
  await c.close();console.log(JSON.stringify({result:'passed',layout:layout.name,states:['idle','listening','thinking','speaking','error'],checks:'auth-before-listen,orb-toggle,colors,speech-filter,stop,late-event-rejection,no-auto-retry,reduced-motion',realMicrophone:false,paidCalls:0}));
 }
 assert.equal(r.stats().outboundAttempts,0);
}finally{await browser?.close();await r.close();}
