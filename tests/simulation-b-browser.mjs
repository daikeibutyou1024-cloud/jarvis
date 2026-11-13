import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {browserRuntime} from './browser-runtime.mjs';
const html=await readFile(new URL('../work/b-simulation-report.html',import.meta.url),'utf8');
const server=createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'"});res.end(html);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
try{
 const rt=await browserRuntime();browser=await rt.playwright.chromium.launch({headless:true,executablePath:rt.executable});const context=await browser.newContext();const origin='http://127.0.0.1:'+server.address().port;
 await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin);
 assert.equal(await page.locator('section').count(),4);assert.match(await page.locator('body').textContent(),/承認待ち/);assert.match(await page.locator('body').textContent(),/AI_TIMEOUT/);assert.match(await page.locator('body').textContent(),/実請求ではない/);
 for(const width of [390,1440]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.locator('summary').first().click();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.locator('summary').first().click();await page.screenshot({path:`/tmp/jarvis-b-report-${width}.png`,fullPage:true});}
 assert.deepEqual(errors,[]);console.log(JSON.stringify({result:'passed',scope:'static local simulation report only',viewports:[390,1440],remoteRequests:0}));
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
