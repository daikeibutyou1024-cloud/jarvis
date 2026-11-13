import test from 'node:test';
import assert from 'node:assert/strict';
import {createVoiceConversation} from '../assets/voice-conversation.js';
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
function fixture(extra={}){
 const recognitions=[],timers=new Map(),states=[];let next=0,calls=0,spoken=0,auths=0;
 class Recognition{constructor(){recognitions.push(this);}start(){this.onstart();}stop(){this.onend();}abort(){}}
 const c=createVoiceConversation({Recognition,authorize:async()=>{auths++;return true;},send:async()=>{calls++;return '模擬回答';},speak:async()=>{spoken++;},cancelSpeech(){},onState:(s)=>states.push(s),setTimer:fn=>{timers.set(++next,fn);return next;},clearTimer:id=>timers.delete(id),...extra});
 return {c,recognitions,states,stats:()=>({calls,spoken,auths}),fire:async()=>{const callbacks=[...timers.values()];timers.clear();callbacks.forEach(fn=>fn());await flush();}};
}
function result(rec,text='確認したい',final=true){const row=[{transcript:text}];row.isFinal=final;rec.onresult({results:[row]});}
test('silence, automatic send, TTS, next listening turn; no send button',async()=>{
 const f=fixture();await f.c.start();const first=f.recognitions[0];result(first);first.onspeechend();await f.fire();await f.fire();assert.deepEqual(f.stats(),{calls:1,spoken:1,auths:1});assert.equal(f.c.phase,'listening');assert.equal(f.recognitions.length,2);f.c.stop();
});
test('duplicate recognition events and repeated start do not double-send',async()=>{
 const f=fixture();await f.c.start();await f.c.start();const rec=f.recognitions[0];result(rec);result(rec);rec.onend();rec.onend();await f.fire();result(rec);rec.onend();await f.fire();assert.equal(f.stats().calls,1);assert.equal(f.recognitions.length,2);f.c.stop();
});
test('interim-only, denied microphone and start exceptions pause without sending',async()=>{
 const f=fixture();await f.c.start();result(f.recognitions[0],'途中',false);f.recognitions[0].onend();await f.fire();assert.equal(f.stats().calls,0);assert.equal(f.c.phase,'paused');await f.c.start();f.recognitions[1].onerror({error:'not-allowed'});assert.equal(f.c.phase,'paused');assert.equal(f.stats().calls,0);
 const g=fixture({Recognition:class{start(){throw Error();}}});await g.c.start();assert.equal(g.c.phase,'paused');
});
test('stop during AI request suppresses speech/restart and API failure never retries',async()=>{
 let resolve,calls=0;const f=fixture({send:()=>{calls++;return new Promise(r=>resolve=r);}});await f.c.start();result(f.recognitions[0]);f.recognitions[0].onend();await f.fire();assert.equal(f.c.phase,'processing');f.c.stop();resolve('遅い回答');await flush();assert.equal(f.stats().spoken,0);assert.equal(f.recognitions.length,1);assert.equal(calls,1);
 const g=fixture({send:async()=>{throw Error('診断ID: mock-timeout');}});await g.c.start();result(g.recognitions[0]);g.recognitions[0].onend();await g.fire();assert.equal(g.c.phase,'paused');assert.equal(g.recognitions.length,1);
});
test('stop during authentication ignores late authorization; background and busy do not start',async()=>{
 let resolve;const f=fixture({authorize:()=>new Promise(r=>resolve=r)});const start=f.c.start();f.c.stop();resolve(true);await start;assert.equal(f.recognitions.length,0);
 for(const option of [{isBusy:()=>true},{isHidden:()=>true}]){const g=fixture(option);await g.c.start();assert.equal(g.recognitions.length,0);}
});
test('recognition remains stopped throughout TTS; cancelled speech cannot resume',async()=>{
 let end;const f=fixture({speak:()=>new Promise(r=>end=r)});await f.c.start();result(f.recognitions[0]);f.recognitions[0].onend();await f.fire();assert.equal(f.c.phase,'speaking');assert.equal(f.recognitions.length,1);f.c.stop();end();await flush();assert.equal(f.recognitions.length,1);
});

test('silence stop without an end event pauses instead of staying locked',async()=>{
 const f=fixture({Recognition:class{start(){this.onstart();globalThis.stalledRec=this;}stop(){}abort(){}}});
 try{await f.c.start();result(globalThis.stalledRec);await f.fire();await f.fire();assert.equal(f.c.phase,'paused');assert.equal(f.stats().calls,0);}finally{delete globalThis.stalledRec;f.c.stop();}
});
test('speech rejection, cancelled authorization and oversized final text never restart automatically',async()=>{
 const f=fixture({speak:async()=>{throw Error('gesture required');}});await f.c.start();result(f.recognitions[0]);f.recognitions[0].onend();await f.fire();assert.equal(f.c.phase,'paused');assert.equal(f.recognitions.length,1);
 const g=fixture({authorize:async()=>false});await g.c.start();assert.equal(g.recognitions.length,0);
 const h=fixture();await h.c.start();result(h.recognitions[0],'長'.repeat(2001));h.recognitions[0].onend();await h.fire();assert.equal(h.stats().calls,0);assert.equal(h.c.phase,'paused');
});

test('no speech and missing recognition start pause without any AI request',async()=>{
 const f=fixture();await f.c.start();await f.fire();assert.equal(f.c.phase,'paused');assert.equal(f.stats().calls,0);
 const g=fixture({Recognition:class{start(){}abort(){}}});await g.c.start();await g.fire();assert.equal(g.c.phase,'paused');assert.equal(g.stats().calls,0);
});
