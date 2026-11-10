import test from 'node:test';
import assert from 'node:assert/strict';
import {initOperations} from '../assets/operations.js';
import * as settings from '../functions/api/business/schedules.js';
import * as reports from '../functions/api/business/report.js';
import {runDueCollection,saveSchedule} from '../lib/schedules.js';
import {testDB} from './runtime-fixture.js';
class Element{constructor(){this.value='';this.checked=false;this.disabled=false;this.hidden=false;this.textContent='';this.children=[];}append(...nodes){this.children.push(...nodes);}replaceChildren(){this.children=[];}}
test('operations controls save stopped schedules, keep conflicting edits, and acknowledge inbox only after local import',async()=>{
 const originalDoc=globalThis.document,originalFetch=fetch,db=testDB(),elements=new Map();const $=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};globalThis.document={getElementById:$,createElement:()=>new Element()};globalThis.fetch=()=>{throw Error('No real network');};
 const env={JARVIS_DB:db,JARVIS_ACCESS_PASSWORD:'test'};let message='',canImport=false;
 const request=async(url,method='GET',b)=>{const api=url.includes('/report')?reports:settings;const response=await api[method==='POST'?'onRequestPost':'onRequestGet']({env,request:new Request('http://localhost'+url,{method,headers:{'x-jarvis-password':'test'},...(b?{body:JSON.stringify(b)}:{})})});const data=await response.json();if(!response.ok)throw Error(data.error);return data;};
 try{
  initOperations({request,say:m=>message=m,importInbox:()=>canImport});$('ops-name').value='AI調査';$('ops-query').value='AI';await $('ops-save').onclick();assert.match($('ops-state').textContent,/全体：停止/);assert.equal(db.db.prepare('SELECT enabled FROM collection_schedules').get().enabled,0);
  $('ops-schedules').children[0].children[0].onclick();const row=db.db.prepare('SELECT * FROM collection_schedules').get();await saveSchedule(db,{id:row.id,name:row.name,source:row.source,query:row.query,intervalMinutes:row.interval_minutes,enabled:true,expectedVersion:1},Date.parse('2026-11-11T03:00:00Z'));
  $('ops-name').value='編集中の設定';await $('ops-save').onclick();assert.match(message,/別の更新/);assert.equal($('ops-name').value,'編集中の設定');
  const time=Date.parse('2026-11-11T03:00:00Z');await runDueCollection({...env,COLLECTION_AUTOMATION_ENABLED:'true'},{clock:()=>time,collectOnce:async()=>({items:[{title:'AIニュース',text:'確認前の公式情報',sourceUrl:'https://www.digital.go.jp/news/example',origin:'digital',fetchedAt:new Date(time).toISOString()}]})});
  await $('ops-refresh').onclick();const li=$('ops-inbox').children[0],button=li.children[2];await button.onclick();assert.match(message,/受信箱は変更していません/);assert.equal(db.db.prepare('SELECT state FROM research_inbox').get().state,'new');
  canImport=true;await button.onclick();assert.equal(db.db.prepare('SELECT state FROM research_inbox').get().state,'imported');assert.equal(JSON.parse(db.db.prepare('SELECT record_json FROM research_inbox').get().record_json).reviewedAt,null);
  $('report-date').value='2026-11-11';await $('ops-report').onclick();assert.match($('ops-report-output').textContent,/Asia\/Tokyo/);assert.match($('ops-report-output').textContent,/売上・利益は未連携/);assert.match($('ops-report-output').textContent,/費用未確認/);
 }finally{globalThis.document=originalDoc;globalThis.fetch=originalFetch;db.db.close();}
});
