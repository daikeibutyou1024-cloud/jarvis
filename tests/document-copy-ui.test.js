import test from 'node:test';
import assert from 'node:assert/strict';
import {initDocumentCopy} from '../assets/document-copy.js';
import * as copyAPI from '../functions/api/business/document-copy.js';
import {testDB} from './runtime-fixture.js';
import {initDocuments,saveRevision} from '../lib/documents.js';
function dom(){const old=globalThis.document,elements=new Map();const $=id=>{if(!elements.has(id))elements.set(id,{value:'',textContent:'',checked:false,disabled:false});return elements.get(id);};globalThis.document={getElementById:$};return {$,restore:()=>globalThis.document=old};}
test('copy UI previews exact saved version, requires confirmation, retains target on retry and never replaces unsaved work automatically',async()=>{
 const d=dom(),db=testDB(),calls=[];let message='',busy=false,dirty=true,applied=null,current={projectId:'original',revision:1};
 try{
  await initDocuments(db);await saveRevision(db,'original',0,{department:'research',topic:'保存版',format:'調査',output:'履歴の本文',evidence:'出典',approved:true});
  const request=async(url,method,b)=>{calls.push({url,method,b});const r=await copyAPI.onRequestPost({env:{JARVIS_DB:db,JARVIS_ACCESS_PASSWORD:'test'},request:new Request('http://localhost'+url,{method,headers:{'x-jarvis-password':'test'},body:JSON.stringify(b)})});const data=await r.json();if(!r.ok)throw Error(data.error);return data;};
  initDocumentCopy({request,say:s=>message=s,getCurrentDocument:()=>current,getBusy:()=>busy,setBusy:v=>busy=v,assertCanReplace:()=>{if(dirty)throw Error('編集中の原稿を保護しました');},applyCopy:s=>applied=s});
  assert.equal(calls.length,0);await d.$('copy-save').onclick();assert.equal(calls.length,0);assert.match(message,/先に/);
  await d.$('copy-preview').onclick();assert.match(d.$('copy-content').value,/履歴の本文/);assert.equal(calls[0].b.action,'preview');assert.equal(d.$('copy-confirmed').checked,false);
  current={projectId:'another',revision:2};d.$('copy-confirmed').checked=true;await d.$('copy-save').onclick();assert.equal(calls[1].b.sourceProjectId,'original');assert.equal(calls[1].b.sourceRevision,1);assert.equal(applied,null);assert.match(d.$('copy-status').textContent,/複製した案件/);
  await d.$('copy-save').onclick();assert.equal(calls[1].b.targetProjectId,calls[2].b.targetProjectId);assert.equal(db.db.prepare("SELECT COUNT(*) n FROM document_revisions WHERE project_id<>'original'").get().n,1);
  d.$('copy-open').onclick();assert.equal(applied,null);assert.match(message,/編集中/);dirty=false;d.$('copy-open').onclick();assert.equal(applied.output,'履歴の本文');assert.equal(applied.approved,false);assert.match(message,/全文確認/);assert.equal(busy,false);
 }finally{d.restore();db.db.close();}
});
test('copy UI suppresses simultaneous requests, clears stale preparations on preview failure and retries without changing destination ID',async()=>{
 const d=dom();let resolve,busy=false,message='',requests=0;const source={projectId:'original',revision:1,digest:'hash'};
 try{
  let handler=()=>new Promise(yes=>resolve=yes);initDocumentCopy({request:async(...args)=>{requests++;return handler(...args);},say:s=>message=s,getCurrentDocument:()=>({projectId:'original',revision:1}),getBusy:()=>busy,setBusy:v=>busy=v,applyCopy:()=>{throw Error('Unexpected open');}});
  const pending=d.$('copy-preview').onclick();assert.equal(busy,true);assert.equal(d.$('copy-save').disabled,true);await d.$('copy-preview').onclick();assert.equal(requests,1);resolve({source,document:{topic:'元の原稿',output:'本文',evidence:''},notice:'確認'});await pending;
  let target;handler=async(url,method,b)=>{target??=b.targetProjectId;assert.equal(b.targetProjectId,target);throw Error('応答不明');};d.$('copy-confirmed').checked=true;await d.$('copy-save').onclick();await d.$('copy-save').onclick();assert.match(message,/応答不明/);assert.equal(d.$('copy-confirmed').checked,true);
  handler=async()=>{throw Error('プレビュー失敗');};await d.$('copy-preview').onclick();assert.equal(d.$('copy-content').value,'');assert.equal(d.$('copy-confirmed').checked,false);const count=requests;await d.$('copy-save').onclick();assert.equal(requests,count);assert.match(d.$('copy-status').textContent,/確認できません/);assert.equal(busy,false);
 }finally{d.restore();}
});
