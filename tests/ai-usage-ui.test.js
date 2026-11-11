import test from 'node:test';
import assert from 'node:assert/strict';
import {initAIUsage} from '../assets/ai-usage.js';
class Element{constructor(){this.value='';this.checked=false;this.disabled=false;this.textContent='';this.children=[];}append(...x){this.children.push(...x);}replaceChildren(){this.children=[];}setAttribute(){}}
function dom(){const original=documentIfAny(),elements=new Map();const $=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};globalThis.document={getElementById:$,createElement:()=>new Element(),createTextNode:t=>({textContent:t})};return {$,restore:()=>{globalThis.document=original;}};}
function documentIfAny(){return globalThis.document;}
const snapshot={month:'2026-11',budgetUSD:'10',openingUSD:'1.000001',committedMicroUSD:500000,notice:'管理値・請求未照合',operations:[{id:'op',purpose:'chat',state:'uncertain',charged_micro:500000}]};
const submit=form=>form.onsubmit({preventDefault(){}});
test('usage UI validates exact USD and a displayed snapshot before sending, preserves failed input and shows audit history',async()=>{
 const d=dom(),calls=[];let message='',fail=true;
 try{
  initAIUsage({say:s=>message=s,request:async(url,method,b)=>{calls.push({url,method,b});if(method==='POST'){if(fail)throw Error('保存失敗');return {reconciled:true};}return calls.some(c=>c.method==='POST')&&!fail?{...snapshot,operations:[{...snapshot.operations[0],state:'reconciled',charged_micro:100001,reconciliation_prior_state:'uncertain',reconciliation_prior_charged_micro:500000,reconciliation_charged_micro:100001,reconciliation_note:'請求を確認',reconciliation_recorded_at:123}]}:snapshot;}});
  assert.equal(calls.length,0);await d.$('usage-refresh').onclick();assert.match(d.$('usage-summary').textContent,/1.500001/);const form=d.$('usage-list').children[0].children[0],[amount,note,label]=form.children,check=label.children[0];
  await submit(form);assert.equal(calls.length,1);amount.value='';note.value='請求を確認';check.checked=true;await submit(form);assert.equal(calls.length,1);amount.value='0.0000001';await submit(form);assert.equal(calls.length,1);
  amount.value='0.100001';await submit(form);assert.match(message,/保存失敗/);assert.equal(amount.value,'0.100001');assert.equal(note.value,'請求を確認');assert.equal(amount.disabled,false);assert.deepEqual(calls.at(-1).b,{id:'op',chargedMicroUSD:100001,note:'請求を確認',confirmed:true,expectedState:'uncertain',expectedChargedMicroUSD:500000});
  fail=false;await submit(form);assert.match(d.$('usage-list').children[0].children[0].textContent,/照合前 uncertain/);assert.match(d.$('usage-list').children[0].children[0].textContent,/元のトークン利用情報は保持/);assert.equal(d.$('usage-refresh').disabled,false);
 }finally{d.restore();}
});
test('usage UI blocks concurrent submissions and labels old reconciliation data without inventing audits',async()=>{
 const d=dom();let resolve,calls=0,appBusy=true;
 try{
  initAIUsage({say:()=>{},getBusy:()=>appBusy,request:()=>{calls++;return new Promise(yes=>resolve=yes);}});await d.$('usage-refresh').onclick();assert.equal(calls,0);appBusy=false;const pending=d.$('usage-refresh').onclick();assert.equal(d.$('usage-refresh').disabled,true);await d.$('usage-refresh').onclick();assert.equal(calls,1);resolve({...snapshot,operations:[{...snapshot.operations[0],state:'reconciled'}]});await pending;assert.match(d.$('usage-list').children[0].children[0].textContent,/旧形式/);assert.equal(d.$('usage-refresh').disabled,false);
 }finally{d.restore();}
});
