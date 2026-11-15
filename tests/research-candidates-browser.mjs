// Explicit live-source check. Local app/auth/cache only; no remote D1 or paid APIs.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {browserRuntime} from './browser-runtime.mjs';
import {onRequestGet} from '../functions/api/research/collect.js';
const root=resolve('.'),password='local-browser-test-only';
const nativeFetch=globalThis.fetch;let stored,upstream=0,fail=false;
globalThis.caches={default:{async match(){return stored?.clone();},async put(k,v){stored=v.clone();}}};
globalThis.fetch=async(url,opts)=>{assert.equal(url,'https://github.com/ollama/ollama/releases.atom');assert.ok(!opts.headers.Authorization);upstream++;if(fail)throw Error('offline');return nativeFetch(url,opts);};
const server=createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname.startsWith('/api/')){
   if(url.pathname!=='/api/research/collect'){res.writeHead(403);res.end('{}');return;}
   const response=await onRequestGet({request:new Request(url,{headers:req.headers}),env:{JARVIS_ACCESS_PASSWORD:password,get JARVIS_DB(){throw Error('DB forbidden');}}});
   res.writeHead(response.status,Object.fromEntries(response.headers));res.end(await response.text());return;
  }
  const file=resolve(root,'.'+(url.pathname==='/'?'/index.html':url.pathname));assert.ok(file.startsWith(root+'/'));
  res.setHeader('content-type',({'.html':'text/html','.js':'application/javascript','.css':'text/css'})[extname(file)]||'application/octet-stream');res.end(await readFile(file));
 }catch{res.writeHead(500);res.end('local check failed');}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;
try{
 const {playwright,executable}=await browserRuntime();browser=await playwright.chromium.launch({headless:true,executablePath:executable,args:['--no-sandbox']});
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 await page.goto('http://127.0.0.1:'+server.address().port+'/#research');
 await page.locator('#research-source').selectOption('ollama');await page.locator('#research-query').fill('AI');
 await page.locator('#research-collect').click();await page.locator('#password').fill(password);await page.locator('#auth-form button.primary').click();
 await page.waitForFunction(()=>document.querySelectorAll('.research-record').length===5);
 const text=await page.locator('#research-records').innerText();assert.match(text,/Ollama/);assert.match(text,/情報源：Ollama/);assert.match(text,/元情報の日時：20/);assert.equal(upstream,1);
 const examples=await page.locator('.research-record label').allTextContents();
 await page.locator('#research-collect').click();await page.waitForFunction(()=>document.querySelector('#research-status').textContent.includes('キャッシュ'));
 assert.equal(await page.locator('.research-record').count(),5);assert.equal(upstream,1);
 await page.reload();assert.equal(await page.locator('.research-record').count(),5);
 stored=undefined;fail=true;
 await page.locator('#research-collect').click();await page.locator('#password').fill(password);await page.locator('#auth-form button.primary').click();
 await page.waitForFunction(()=>document.querySelector('#research-status').textContent.includes('未取得'));
 assert.equal(await page.locator('.research-record').count(),5);assert.deepEqual(errors,[]);
 console.log(JSON.stringify({passed:true,real_source_examples:examples,checks:['five real records displayed','source and timestamps','cache and URL deduplication','local persistence','error without fabricated data','no DB access','no browser external traffic']}));
}finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));globalThis.fetch=nativeFetch;delete globalThis.caches;}
