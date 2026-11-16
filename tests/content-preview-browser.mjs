import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {browserRuntime} from './browser-runtime.mjs';
import {onRequestPost} from '../functions/api/business/content-preview.js';
const root=resolve('.'),password='test-only';let calls=0;
const record={id:'official-test-source',title:'Ollama公式更新',text:'公式リリースに掲載された更新情報です。',sourceUrl:'https://github.com/ollama/ollama/releases/tag/v0.40.16',fetchedAt:'2026-11-16T00:00:00Z',recordedAt:'2026-11-16T00:00:00Z',publishedAt:'2026-11-09T23:45:36Z',kind:'fact',origin:'ollama',verification:'source_observed',status:'acquired',price:'',affiliate:''};
const server=createServer(async(req,res)=>{try{
 if(req.url.startsWith('/api/')){
  assert.equal(req.url,'/api/business/content-preview');assert.equal(req.method,'POST');calls++;
  const chunks=[];for await(const c of req)chunks.push(c);
  const response=await onRequestPost({request:new Request('https://abcd1234.asset-simulator-87y.pages.dev'+req.url,{method:'POST',headers:{...req.headers,origin:'https://abcd1234.asset-simulator-87y.pages.dev'},body:Buffer.concat(chunks)}),env:{CF_PAGES_BRANCH:'feature/ai-business-rebuild',JARVIS_ACCESS_PASSWORD:password,get JARVIS_DB(){throw Error('DB forbidden');}}});
  res.writeHead(response.status,Object.fromEntries(response.headers));res.end(await response.text());return;
 }
 const path=resolve(root,'.'+(req.url.split('?')[0]==='/'?'/index.html':req.url.split('?')[0]));assert.ok(path.startsWith(root+'/'));res.setHeader('content-type',({'.html':'text/html','.js':'application/javascript','.css':'text/css'})[extname(path)]||'application/octet-stream');res.end(await readFile(path));
 }catch(e){console.error(e.message);res.writeHead(500);res.end('{}');}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
try{
 const {playwright,executable}=await browserRuntime();browser=await playwright.chromium.launch({headless:true,executablePath:executable,args:['--no-sandbox']});const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
 await page.addInitScript(r=>localStorage.setItem('jarvis_research_records_v2',JSON.stringify([r])),record);
 await page.goto('http://127.0.0.1:'+server.address().port+'/#research');
 await page.locator('.research-record input[type=checkbox]').check();await page.locator('.research-record button').filter({hasText:'内容・出典を確認済みにする'}).click();await page.locator('#research-to-content').click();
 await page.locator('#topic').fill('初心者のローカルAI活用');await page.locator('#format').selectOption('note無料記事');await page.locator('#generate').click();await page.locator('#password').fill(password);await page.locator('#auth-form button.primary').click();
 await page.waitForFunction(()=>document.querySelector('#output').value.includes('Previewモック'));
 assert.match(await page.locator('#output').inputValue(),/Ollama公式更新/);assert.match(await page.locator('#output').inputValue(),/https:\/\/github.com/);
 await page.locator('#output').fill((await page.locator('#output').inputValue())+'\n人間が編集・確認しました。');await page.locator('#approve').click();await page.locator('#save-draft').click();
 await page.waitForFunction(()=>JSON.parse(localStorage.getItem('jarvis_business_drafts_v1')||'[]').length===1);
 const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('jarvis_business_drafts_v1'))[0]);assert.match(saved.text,/人間が編集/);assert.equal(saved.approved,true);assert.equal(calls,1);assert.deepEqual(errors,[]);
 console.log(JSON.stringify({passed:true,steps:['資料選択','資料確認','CONTENT引渡し','認証付きモック生成','出典表示','編集','確認','端末保存'],mockRequests:calls,dbAccesses:0,paidCalls:0}));
}finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
