import assert from 'node:assert/strict';
import {browserRuntime} from './browser-runtime.mjs';
import {startRehearsal} from './rehearsal-server.mjs';
const r=await startRehearsal(),rt=await browserRuntime();let browser,posts=0,release;
const gate=new Promise(resolve=>release=resolve);
const waitPosts=async count=>{const until=Date.now()+5000;while(posts<count&&Date.now()<until)await new Promise(resolve=>setTimeout(resolve,20));assert.equal(posts,count);};
try{
 browser=await rt.playwright.chromium.launch({headless:true,executablePath:rt.executable});const c=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 await c.route('**/*',route=>new URL(route.request().url()).origin===r.baseURL?route.continue():route.abort());
 await c.addInitScript(()=>{
  window.recs=[];window.SpeechRecognition=class{constructor(){window.recs.push(this);}start(){this.onstart?.();}stop(){this.onend?.();}abort(){}};
  window.SpeechSynthesisUtterance=class{constructor(text){this.text=text;}};
  Object.defineProperty(window,'speechSynthesis',{value:{speak(u){window.lastSpeech=u;u.onstart?.();},cancel(){const old=window.lastSpeech;window.lastSpeech=null;old?.onend?.();}}});
 });
 await c.route('**/api/chat',async route=>{posts++;assert.equal(route.request().headers()['x-jarvis-password'],'rehearsal-only');if(posts===1){await gate;return route.fulfill({json:{answer:'模擬回答です 😊'}});}if(posts===2)return route.fulfill({status:504,json:{error:'模擬タイムアウト',diagnostic:{id:'voice-mock',stage:'provider_body'}}});if(posts===3)return route.fulfill({status:401,json:{error:'認証が失効しました'}});return route.fulfill({json:{answer:'手動の模擬回答'}});});
 const p=await c.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));await p.goto(r.baseURL+'/#overview');
 await p.locator('#voice-start').click();await p.locator('#password').fill('rehearsal-only');await p.locator('#auth-form button.primary').click();await p.waitForFunction(()=>document.querySelector('#home-input-state').textContent==='入力中');assert.equal(posts,0);
 const utter=async text=>p.evaluate(text=>{const rec=window.recs.at(-1),row=[{transcript:text}];row.isFinal=true;rec.onresult({results:[row]});rec.onresult({results:[row]});rec.onend();rec.onend();},text);
 await utter('最初の相談');await p.waitForFunction(()=>document.querySelector('#voice-conversation-status').textContent.includes('回答を生成'));await waitPosts(1);assert.equal(await p.locator('#orb-voice').getAttribute('data-state'),'thinking');
 await utter('AI処理中の誤入力');assert.equal(posts,1);release();await p.waitForFunction(()=>document.querySelector('#home-speech-state').textContent==='読み上げ中');assert.equal(await p.evaluate(()=>window.recs.length),1);assert.equal(await p.evaluate(()=>window.lastSpeech.text),'模擬回答です');
 await p.evaluate(()=>window.lastSpeech.onend());await p.waitForFunction(()=>window.recs.length===2);assert.equal(await p.locator('#auth-dialog').isVisible(),false);
 await utter('次の相談');await p.waitForFunction(()=>document.querySelector('#voice-start').textContent.includes('再開'));assert.equal(posts,2);assert.match(await p.locator('#conversation').textContent(),/voice-mock/);assert.equal(await p.evaluate(()=>window.recs.length),2);
 await p.locator('#voice-start').click();await p.waitForFunction(()=>window.recs.length===3);assert.equal(await p.locator('#orb-voice').getAttribute('data-state'),'listening');await utter('認証エラーの相談');await p.waitForFunction(()=>document.querySelector('#voice-conversation-status').textContent.includes('認証'));assert.equal(posts,3);
 await p.locator('#voice-start').click();assert(await p.locator('#auth-dialog').isVisible());await p.locator('#cancel-auth').click();
 await p.locator('#manual-input > summary').click();await p.locator('#command').fill('手動相談');await p.locator('#send-command').click();await p.locator('#password').fill('rehearsal-only');await p.locator('#auth-form button.primary').click();await p.waitForFunction(()=>document.querySelector('#conversation').textContent.includes('手動の模擬回答'));assert.equal(posts,4);
 await p.locator('#voice-start').click();await p.waitForFunction(()=>window.recs.length===4);await p.locator('#voice-stop').click();await utter('停止後の古いイベント');assert.equal(posts,4);await p.waitForFunction(()=>document.querySelector('#orb-voice').dataset.state==='idle');
 assert.equal(await p.evaluate(()=>Object.values(localStorage).join('|').includes('rehearsal-only')||Object.values(sessionStorage).join('|').includes('rehearsal-only')),false);
 assert.deepEqual(errors,[]);assert.equal(r.stats().outboundAttempts,0);console.log(JSON.stringify({result:'passed',flows:'auto-send,TTS,mic restart,duplicate prevention,timeout pause,401 reauth,manual input,stop,credentials not persisted',remoteRequests:0,realMicrophone:false,engine:'Chromium mobile emulation; not iPhone Safari'}));
}finally{await browser?.close();await r.close();}
