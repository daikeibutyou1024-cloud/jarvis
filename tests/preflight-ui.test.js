import test from 'node:test';
import assert from 'node:assert/strict';
import {initPreflight} from '../assets/preflight.js';
import {inspectPreflight} from '../lib/preflight.js';
import {testDB} from './runtime-fixture.js';
function dom(){const old=globalThis.document,elements=new Map();globalThis.document={getElementById(id){if(!elements.has(id))elements.set(id,{textContent:'未確認',disabled:false});return elements.get(id);}};return {get:id=>elements.get(id),restore:()=>{globalThis.document=old;}};}
test('preflight UI stays idle until clicked, displays unknowns honestly and sends only one authenticated read path',async()=>{
 const d=dom(),db=testDB(),calls=[],messages=[];let appBusy=true;
 try{
  const data=await inspectPreflight({JARVIS_DB:db,JARVIS_ACCESS_PASSWORD:'test'});
  initPreflight({request:async(...args)=>{calls.push(args);return data;},say:s=>messages.push(s),getBusy:()=>appBusy});
  assert.equal(calls.length,0);await d.get('preflight-check').onclick();assert.equal(calls.length,0);appBusy=false;
  await d.get('preflight-check').onclick();assert.deepEqual(calls,[['/api/business/preflight']]);const output=d.get('preflight-output').textContent;
  assert.match(output,/必須列|不足/);assert.match(output,/未作成/);assert.match(output,/本番反映の準備は未完了/);assert.match(output,/AI：未設定/);assert.match(output,/全体停止/);assert.match(output,/DBの分離|D1が別/);assert.equal(d.get('preflight-check').disabled,false);assert.equal(messages.length,1);
 }finally{d.restore();db.db.close();}
});
test('preflight UI suppresses concurrent requests and clears stale success after a failed read',async()=>{
 const d=dom();let reject,calls=0,message='';
 try{
  initPreflight({request:()=>{calls++;return new Promise((_,no)=>{reject=no;});},say:s=>message=s});const button=d.get('preflight-check'),output=d.get('preflight-output');output.textContent='以前の確認結果';
  const pending=button.onclick();assert.equal(button.disabled,true);assert.equal(output.textContent,'確認中…');await button.onclick();assert.equal(calls,1);
  reject(Error('接続を確認してください'));await pending;assert.equal(button.disabled,false);assert.match(output.textContent,/確認できません/);assert.doesNotMatch(output.textContent,/以前の確認結果$/);assert.equal(message,'接続を確認してください');
 }finally{d.restore();}
});
