import test from 'node:test';
import assert from 'node:assert/strict';
import {spokenText} from '../lib/speech.js';
import {onRequestPost} from '../functions/api/business/chat-preview.js';

const url='https://feature-ai-business-rebuild.asset-simulator-87y.pages.dev/api/business/chat-preview';
function request(message,envBranch='feature/ai-business-rebuild'){
  return onRequestPost({
    env:{CF_PAGES_BRANCH:envBranch,JARVIS_ACCESS_PASSWORD:'test-pass'},
    request:new Request(url,{
      method:'POST',
      headers:{'x-jarvis-password':'test-pass','content-type':'application/json','Origin':new URL(url).origin},
      body:JSON.stringify({message,conversation:[{role:'user',text:'こんにちは'}]})
    })
  });
}
test('Preview greeting is natural and speech omits visible mock notices',async()=>{
  const res=await request('こんにちは');
  assert.equal(res.status,200);
  const data=await res.json();
  assert.equal(data.mock,true);
  assert.equal(data.realCostUSD,0);
  assert.match(data.answer,/Previewモック/);
  assert.doesNotMatch(data.answer,/前の/);
  assert.equal(spokenText(data.answer),'こんにちは！今日は何をお手伝いしましょうか？');
});
test('non-greeting Preview replies are short and do not repeat old chat',async()=>{
  const res=await request('記事を作って');
  const data=await res.json();
  assert.equal(spokenText(data.answer),'「記事を作って」を受け付けました。');
});
test('Production cannot use the Preview mock route',async()=>{
  const res=await request('こんにちは','main');
  assert.equal(res.status,403);
});
test('ordinary speech remains unchanged',()=>{
  assert.equal(spokenText('今日は晴れです。'),'今日は晴れです。');
});
