import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {onRequest} from '../functions/api/business/preview-runtime.js';
const origin='https://3cd7ce79.asset-simulator-87y.pages.dev';
const password='local-only-test-password';
const makeEnv=patch=>({JARVIS_ACCESS_PASSWORD:password,CF_PAGES_BRANCH:'feature/ai-business-rebuild',CF_PAGES_URL:origin,...patch});
const request=(url=origin,auth=password,method='GET',headers={})=>new Request(url+'/api/business/preview-runtime',{method,headers:{'x-jarvis-password':auth,...headers}});
test('authenticated diagnostics work with flag disabled and never access DB or network',async()=>{
 let touches=0;const env=makeEnv({});Object.defineProperty(env,'JARVIS_DB',{get(){touches++;throw Error('DB forbidden');}});
 const response=onRequest({request:request(),env});assert.equal(response.status,200);
 assert.deepEqual(await response.json(),{schema:'jarvis-preview-runtime-v1',branch:{present:true,matchesExpected:true},url:{present:true,matchesAllowedPreview:true},mockEnabled:false});assert.equal(touches,0);
 assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('access-control-allow-origin'),null);
});
test('authentication is required before metadata inspection',()=>{
 const env={JARVIS_ACCESS_PASSWORD:password,get CF_PAGES_BRANCH(){throw Error('metadata forbidden');}};
 for(const auth of ['', 'wrong'])assert.equal(onRequest({request:request(origin,auth),env}).status,401);
 assert.equal(onRequest({request:request(),env:{}}).status,401);
});
test('missing metadata is reported without fabricating a pass or returning secrets',async()=>{
 const response=onRequest({request:request(),env:makeEnv({CF_PAGES_BRANCH:undefined,CF_PAGES_URL:undefined,ANTHROPIC_API_KEY:'never-expose'})});
 const text=await response.text(),body=JSON.parse(text);assert.deepEqual(body.branch,{present:false,matchesExpected:false});assert.deepEqual(body.url,{present:false,matchesAllowedPreview:false});assert.ok(!text.includes(password));assert.ok(!text.includes('never-expose'));
});
test('production, other hosts and branches, cross origin and mutation methods are denied',()=>{
 for(const host of ['https://asset-simulator-87y.pages.dev','https://evil.invalid','http://3cd7ce79.asset-simulator-87y.pages.dev','https://other.asset-simulator-87y.pages.dev'])assert.equal(onRequest({request:request(host),env:makeEnv({})}).status,403);
 for(const branch of ['main','feature/other'])assert.equal(onRequest({request:request(),env:makeEnv({CF_PAGES_BRANCH:branch})}).status,403);
 for(const method of ['POST','PUT','DELETE','PATCH','OPTIONS','HEAD'])assert.equal(onRequest({request:request(origin,password,method),env:makeEnv({})}).status,405);
 assert.equal(onRequest({request:request(origin,password,'GET',{Origin:'https://evil.invalid'}),env:makeEnv({})}).status,403);
});
test('URL metadata is validated and never echoed',async()=>{
 for(const url of ['https://asset-simulator-87y.pages.dev','https://evil.invalid/private','https://user:secret@3cd7ce79.asset-simulator-87y.pages.dev','https://3cd7ce79.asset-simulator-87y.pages.dev/?secret=yes']){
  const response=onRequest({request:request(),env:makeEnv({CF_PAGES_URL:url})});const body=await response.json();assert.equal(body.url.matchesAllowedPreview,false);assert.ok(!JSON.stringify(body).includes(url));
 }
});
test('dedicated implementation has no reachable DB, imports, network or background execution',()=>{
 const api=readFileSync(new URL('../functions/api/business/preview-runtime.js',import.meta.url),'utf8');
 assert.doesNotMatch(api,/\bimport\b|\bfetch\s*\(|JARVIS_DB|\.prepare\s*\(|\.batch\s*\(|waitUntil|setInterval|setTimeout/);
 const ui=readFileSync(new URL('../assets/preview-runtime.js',import.meta.url),'utf8');assert.doesNotMatch(ui,/localStorage|sessionStorage|setInterval|setTimeout|console\./);assert.equal((ui.match(/fetch\(/g)||[]).length,1);
});
test('UI sends exactly one authenticated GET only after manual submission and clears input',async()=>{
 const {runInNewContext}=await import('node:vm');
 const source=readFileSync(new URL('../assets/preview-runtime.js',import.meta.url),'utf8');
 for(const host of ['3cd7ce79.asset-simulator-87y.pages.dev','asset-simulator-87y.pages.dev']){
  const elements={diagnostic:{},password:{value:password},submit:{disabled:false},result:{textContent:''}};const calls=[];
  runInNewContext(source,{document:{getElementById:id=>elements[id]},location:{protocol:'https:',hostname:host},fetch:async(url,options)=>{calls.push({url,options});assert.equal(elements.password.value,'');return {ok:true,json:async()=>({branch:{present:true}})};}});
  assert.equal(calls.length,0);await elements.diagnostic.onsubmit({preventDefault(){}});
  assert.equal(calls.length,host.startsWith('3cd7ce79')?1:0);assert.equal(elements.password.value,'');assert.ok(!elements.result.textContent.includes(password));
  if(calls.length){assert.equal(calls[0].url,'/api/business/preview-runtime');assert.equal(calls[0].options.method,'GET');assert.equal(calls[0].options.headers['x-jarvis-password'],password);assert.equal(calls[0].options.redirect,'error');}
 }
});
