import test from 'node:test';import assert from 'node:assert/strict';
import {onRequestPost} from '../functions/api/business/chat-preview.js';
const env={JARVIS_ACCESS_PASSWORD:'local-secret',CF_PAGES_BRANCH:'feature/ai-business-rebuild',get JARVIS_DB(){throw Error('DB forbidden');}};
const req=(body,host='https://abcd1234.asset-simulator-87y.pages.dev',password='local-secret')=>new Request(host+'/api/business/chat-preview',{method:'POST',headers:{'content-type':'application/json','x-jarvis-password':password},body:JSON.stringify(body)});
test('mock greeting and following turn stay concise without DB or network',async()=>{
 const one=await onRequestPost({env,request:req({message:'こんにちは',conversation:[]})});assert.equal(one.status,200);const a=await one.json();assert.match(a.answer,/こんにちは/);assert.equal(a.realCostUSD,0);
 const two=await onRequestPost({env,request:req({message:'次は何をする？',conversation:[{role:'user',text:'こんにちは'},{role:'assistant',text:a.answer}]})});const followup=(await two.json()).answer;assert.match(followup,/次は何をする/);assert.doesNotMatch(followup,/前の「こんにちは」/);
});
test('authentication, Preview restriction, bounds and secret rejection fail closed',async()=>{
 const b={message:'こんにちは',conversation:[]};assert.equal((await onRequestPost({env,request:req(b,undefined,'bad')})).status,401);
 assert.equal((await onRequestPost({env:Object.assign(Object.create(env),{CF_PAGES_BRANCH:'main'}),request:req(b)})).status,403);
 assert.equal((await onRequestPost({env,request:req(b,'https://asset-simulator-87y.pages.dev')})).status,403);
 assert.equal((await onRequestPost({env,request:req({...b,message:'local-secret'})})).status,400);
 assert.equal((await onRequestPost({env,request:req({...b,conversation:Array(9).fill({role:'user',text:'a'})})})).status,400);
});
