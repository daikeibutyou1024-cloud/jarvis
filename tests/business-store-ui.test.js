import test from 'node:test';
import assert from 'node:assert/strict';
import {initBusinessStore} from '../assets/business-store.js';
import * as api from '../functions/api/business/records.js';
import * as publications from '../functions/api/business/publications.js';
import * as editorial from '../functions/api/business/editorial.js';
import {normalizeRecord,saveBusinessRecord} from '../lib/business-records.js';
import {testDB} from './runtime-fixture.js';
import {article,evidence} from './paid-fixture.js';
import {defaultOutline,REVIEW_CHECKS} from '../lib/editorial.js';
class Element{constructor(){this.value='';this.checked=false;this.disabled=false;this.hidden=false;this.textContent='';this.children=[];this.listeners={};}append(...nodes){this.children.push(...nodes);}replaceChildren(){this.children=[];}click(){this.onclick?.();}addEventListener(t,fn){(this.listeners[t]??=[]).push(fn);}}
test('shared-store controls preserve stale edits, verify transfer contents and do not erase legacy data',async()=>{
 const db=testDB(),doc=globalThis.document,oldFetch=fetch,elements=new Map();const $=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};globalThis.document={getElementById:$,createElement:()=>new Element(),createTextNode:s=>({textContent:s})};globalThis.fetch=()=>{throw Error('No network');};const env={JARVIS_DB:db,JARVIS_ACCESS_PASSWORD:'test'};let message='';const old={ledger:[{id:'old-1',date:'2026-11-11',type:'expense',amount:100,memo:'旧記録'}],metrics:{'2026-11':{period:'2026-11',visits:10,clicks:1,conversions:0}}},snapshot=JSON.stringify(old);
 const request=async(url,method='GET',b)=>{const response=await api[method==='POST'?'onRequestPost':'onRequestGet']({env,request:new Request('http://localhost'+url,{method,headers:{'x-jarvis-password':'test'},...(b?{body:JSON.stringify(b)}:{})})});const d=await response.json();if(!response.ok)throw Error(d.error);return d;};
 try{
  initBusinessStore({request,say:m=>message=m,getCurrentDraft:()=>({projectId:'none',expectedRevision:0}),readLegacy:()=>old});$('shared-kind').value='finance';$('shared-type').value='revenue';$('shared-date').value='2026-11-11';$('shared-amount').value='1000';$('shared-memo').value='入力';await $('shared-save').onclick();assert.equal(db.db.prepare('SELECT COUNT(*) n FROM business_records').get().n,1);assert.match($('shared-summary').textContent,/記録上の売上 ¥1000/);
  const head=db.db.prepare('SELECT * FROM business_records').get();$('shared-records').children[0].children[1].onclick();await saveBusinessRecord(db,await normalizeRecord({id:head.id,kind:'finance',date:'2026-11-11',type:'revenue',amount:2000,memo:'他の編集',projectId:''}),1);$('shared-amount').value='3000';await $('shared-save').onclick();assert.match(message,/別の保存/);assert.equal($('shared-amount').value,'3000');assert.equal($('shared-amount').disabled,false);
  await $('shared-legacy').onclick();assert.match($('shared-import-text').value,/旧記録/);$('shared-import-text').value+='改変';await $('shared-apply').onclick();assert.match(message,/変更されています/);assert.equal(db.db.prepare('SELECT COUNT(*) n FROM business_records').get().n,1);
  await $('shared-legacy').onclick();await $('shared-apply').onclick();assert.equal(db.db.prepare('SELECT COUNT(*) n FROM business_records').get().n,3);assert.equal(JSON.stringify(old),snapshot);await $('shared-legacy').onclick();await $('shared-apply').onclick();assert.equal(db.db.prepare('SELECT COUNT(*) n FROM business_records').get().n,3);assert.match(message,/既存2件/);
 }finally{globalThis.document=doc;globalThis.fetch=oldFetch;db.db.close();}
});
test('publication controls bind preparation to both project and revision and never submit another project silently',async()=>{
 const db=testDB(),doc=globalThis.document,oldFetch=fetch,elements=new Map();const $=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};globalThis.document={getElementById:$,createElement:()=>new Element(),createTextNode:s=>({textContent:s})};globalThis.fetch=()=>{throw Error('No network');};const env={JARVIS_DB:db,JARVIS_ACCESS_PASSWORD:'test'};let current={projectId:'ui-project',expectedRevision:1},message='',calls=0;
 const request=async(url,method='GET',b)=>{calls++;const handler=url.includes('publications')?publications:api;const r=await handler[method==='POST'?'onRequestPost':'onRequestGet']({env,request:new Request('http://localhost'+url,{method,headers:{'x-jarvis-password':'test'},...(b?{body:JSON.stringify(b)}:{})})});const d=await r.json();if(!r.ok)throw Error(d.error);return d;};
 const post=async b=>editorial.onRequestPost({env,request:new Request('http://localhost/api',{method:'POST',headers:{'x-jarvis-password':'test'},body:JSON.stringify(b)})});
 try{
  await post({action:'save',projectId:'ui-project',expectedRevision:0,topic:'記事',audience:'初心者',notes:'',format:'note有料記事',text:article,evidence,manualComplete:true,workflow:{idea:'手順を提供する',outline:defaultOutline('note有料記事'),noExternalFacts:false}});await post({action:'approve',projectId:'ui-project',expectedRevision:1,checks:Object.fromEntries(REVIEW_CHECKS.map(k=>[k,true]))});
  initBusinessStore({request,say:m=>message=m,getCurrentDraft:()=>current,readLegacy:()=>({ledger:[],metrics:{}})});await $('publication-package').onclick();assert.match($('publication-output').value,/集客案（未確認）/);assert.match($('publication-output').value,/案件ui-project/);for(const id of ['publication-done','publication-account','publication-terms','publication-content'])$(id).checked=true;$('publication-channel').value='note';$('publication-url').value='https://note.com/example/n/test';$('publication-date').value='2026-11-11';
  current={projectId:'another-project',expectedRevision:1};const count=calls;await $('publication-record').onclick();assert.equal(calls,count);assert.match(message,/版が変わり/);
  current={projectId:'ui-project',expectedRevision:1};await $('publication-record').onclick();assert.equal(db.db.prepare("SELECT COUNT(*) n FROM business_records WHERE kind='publication'").get().n,1);assert.match($('publication-state').textContent,/利用者の申告/);
 }finally{globalThis.document=doc;globalThis.fetch=oldFetch;db.db.close();}
});
