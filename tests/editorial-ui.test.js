// DOM-controller test without a browser or provider. Browser rendering is tested separately.
import test from 'node:test';
import assert from 'node:assert/strict';
import {initEditorial} from '../assets/editorial.js';
import * as api from '../functions/api/business/editorial.js';
import {testDB} from './runtime-fixture.js';
import {REVIEW_CHECKS} from '../lib/editorial.js';
class Element{
 constructor(){this.value='';this.checked=false;this.disabled=false;this.hidden=false;this.textContent='';this.children=[];this.listeners={};}
 append(...nodes){this.children.push(...nodes);}
 replaceChildren(){this.children=[];}
 addEventListener(type,fn){(this.listeners[type]??=[]).push(fn);}
 setAttribute(){}
 click(){this.onclick?.();}
}
test('editorial controls save and reopen a note, require five checks, export, and reject unsaved approval',async()=>{
 const db=testDB(),originalDoc=globalThis.document,originalFetch=globalThis.fetch,elements=new Map();
 const $=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
 globalThis.document={getElementById:$,createElement:()=>new Element()};
 globalThis.fetch=()=>{throw Error('No network');};
 let state={projectId:'ui-note',expectedRevision:0,topic:'考察メモ',audience:'初心者',notes:'体験を整理',format:'note無料記事',text:'# 考察\n## 悩み\n困りごと。\n## 解決\n考えた対策。',evidence:'',generation:{articleStatus:'manual_complete'}},busy=false,message='',calls=0;
 const request=async(url,method='GET',body)=>{
  calls++;const r=await api[method==='POST'?'onRequestPost':'onRequestGet']({env:{JARVIS_DB:db,JARVIS_ACCESS_PASSWORD:'test'},request:new Request('http://localhost'+url,{method,headers:{'x-jarvis-password':'test'},...(body?{body:JSON.stringify(body)}:{})})});const d=await r.json();if(!r.ok)throw Error(d.error);return d;
 };
 try{
  const controller=initEditorial({request,say:m=>message=m,getDraft:()=>({...state}),applyDraft:d=>{state={...state,projectId:d.projectId,expectedRevision:d.revision,topic:d.topic,audience:d.audience,notes:d.notes,format:d.format,text:d.output,evidence:d.evidence,generation:d.generation};},selectChapter:()=>{},researchSnapshot:()=>({evidence:''}),adoptEvidence:()=>{},cloneDraft:()=>{},setBusy:v=>busy=v,getBusy:()=>busy});
  $('editorial-idea').value='体験を読者が使える考察にする';$('editorial-outline').value='悩み\n解決';$('editorial-no-facts').checked=true;
  await $('editorial-save').onclick();assert.equal(state.expectedRevision,1);assert.match($('editorial-status').textContent,/全文確認待ち/);assert.equal(busy,false);
  const before=calls;await $('editorial-approve').onclick();assert.equal(calls,before+1);assert.match(message,/確認が必要/);
  for(const key of REVIEW_CHECKS)$('review-'+key).checked=true;
  await $('editorial-approve').onclick();assert.match($('editorial-status').textContent,/全文確認済み/);
  await $('editorial-download').onclick();assert.match($('editorial-export').value,/# 考察/);assert.equal($('editorial-paid').value,'');
  state.text+='編集中。';for(const fn of $('output').listeners.input)fn();
  const n=calls;await $('editorial-approve').onclick();assert.equal(calls,n);assert.match(message,/先に「制作案件を保存」/);assert.equal($('editorial-export').value,'');
  await $('editorial-save').onclick();assert.equal(state.expectedRevision,2);assert.match($('editorial-status').textContent,/全文確認待ち/);
  await $('editorial-queue-refresh').onclick();assert.equal($('editorial-queue').children.length,1);
  assert.doesNotThrow(()=>controller.requireSaved());
 }finally{globalThis.document=originalDoc;globalThis.fetch=originalFetch;db.db.close();}
});
