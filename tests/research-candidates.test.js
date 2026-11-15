import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {parseRecords,selectCandidates,destination,boundedFetch,onRequestGet,SCHEMA} from '../functions/api/research/collect.js';
const date='2026-11-01T00:00:00Z';
const atom=(n=7)=>`<feed xmlns="http://www.w3.org/2005/Atom">${Array.from({length:n},(_,i)=>`<entry><title>AI release ${i}</title><link href="https://github.com/ollama/ollama/releases/tag/v${i}"/><published>${date}</published><content type="html">&lt;p&gt;Local AI tools ${i}&lt;/p&gt;</content></entry>`).join('')}</feed>`;
function db(){
 const raw=new DatabaseSync(':memory:');for(const sql of SCHEMA)raw.exec(sql);const writes=[];
 return {raw,writes,prepare(sql){const s={args:[],bind(...args){s.args=args;return s;},async all(){return {results:raw.prepare(sql).all(...s.args)};},async first(){return raw.prepare(sql).get(...s.args)||null;},async run(){writes.push(sql);return {meta:{changes:Number(raw.prepare(sql).run(...s.args).changes)}};}};return s;},async batch(ss){return Promise.all(ss.map(s=>s.run()));}};
}
const request=(password='test')=>new Request('https://abc12345.asset-simulator-87y.pages.dev/api/research/collect?source=ollama&q=AI',{headers:{'x-jarvis-password':password}});
test('official Atom yields at most five attributed real records with summaries and dates',()=>{
 const rows=selectCandidates(parseRecords(atom(),'ollama',date),Date.parse(date));assert.equal(rows.length,5);assert.match(rows[0].title,/Ollama/);assert.match(rows[0].text,/Local AI tools/);assert.equal(rows[0].origin,'ollama');assert.equal(rows[0].fetchedAt,date);assert.equal(rows[0].publishedAt,date);
 assert.equal(parseRecords(atom().replaceAll('/ollama/ollama/','/evil/repository/'),'ollama').length,0);
});
test('deduplicates canonical URLs, orders by publication, rejects invalid and future dates',()=>{
 const row={sourceUrl:'https://github.com/ollama/ollama/releases/tag/v1',publishedAt:date};
 const rows=selectCandidates([row,{...row,sourceUrl:row.sourceUrl+'#notes'},{...row,sourceUrl:row.sourceUrl+'future',publishedAt:'2099-01-01'},{...row,sourceUrl:row.sourceUrl+'bad',publishedAt:'invalid'}],Date.parse(date));assert.equal(rows.length,1);
});
test('candidate path never touches D1 and platform cache avoids repeat upstream requests',async()=>{
 const original=globalThis.fetch,originalCaches=globalThis.caches,d=db();let calls=0,stored;globalThis.caches={default:{async match(){return stored?.clone();},async put(k,v){stored=v.clone();}}};
 globalThis.fetch=async(url,opts)=>{calls++;assert.equal(url,destination('ollama','AI'));assert.equal(opts.headers.Authorization,undefined);return new Response(atom(),{headers:{'content-type':'application/atom+xml'}});};
 try{
  const env={get JARVIS_DB(){throw Error('DB access forbidden');},JARVIS_ACCESS_PASSWORD:'test'};
  assert.equal((await onRequestGet({request:request('wrong'),env})).status,401);assert.equal(calls,0);
  const first=await (await onRequestGet({request:request(),env})).json();assert.equal(first.items.length,5);assert.equal(first.status,'acquired');
  const second=await (await onRequestGet({request:request(),env})).json();assert.equal(second.cached,true);assert.equal(calls,1);
  assert.equal(d.writes.length,0);
 }finally{globalThis.fetch=original;globalThis.caches=originalCaches;d.raw.close();}
});
test('failed feed returns an explicit error and no invented items',async()=>{
 const original=globalThis.fetch,d=db();globalThis.fetch=async()=>new Response('no',{status:503});
 try{const data=await (await onRequestGet({request:request(),env:{JARVIS_DB:d,JARVIS_ACCESS_PASSWORD:'test'}})).json();assert.equal(data.status,'unavailable');assert.deepEqual(data.items,[]);assert.ok(data.error);}finally{globalThis.fetch=original;d.raw.close();}
});
test('fixed destination and redirect denial prevent using collection as a URL proxy',async()=>{
 await assert.rejects(boundedFetch('https://github.com/evil/feed','ollama',async()=>{throw Error('must not call');}),/許可/);
 await assert.rejects(boundedFetch(destination('ollama','AI'),'ollama',async()=>new Response('',{status:302,headers:{location:'https://evil.invalid'}})),/リダイレクト/);
});
