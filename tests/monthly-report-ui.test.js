import test from 'node:test';
import assert from 'node:assert/strict';
import {initMonthlyReport} from '../assets/monthly-report.js';
class Element{constructor(){this.value='';this.disabled=false;this.hidden=false;this.textContent='';this.children=[];}append(...x){this.children.push(...x);}replaceChildren(){this.children=[];}}
function dom(){const old=globalThis.document,elements=new Map();const $=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};globalThis.document={getElementById:$,createElement:()=>new Element()};return {$,restore:()=>globalThis.document=old};}
const data={period:'2026-11',asOf:'2026-11-11T00:00:00Z',notice:'入力済み記録・実利益未取得',coverage:{records:true},nextCursor:'case-a',projects:[{projectId:'case-a',title:'案件A',revision:2,recordedTotals:null,excludedCurrencyEntries:0,manualPublicationRecords:null,metrics:[{channel:'note',visits:0,clicks:0,conversions:0,ctr:null,conversionRate:null}],suggestions:['計測範囲を確認'],suggestionsBasis:'入力に基づく確認事項'}]};
test('monthly UI waits for explicit action, distinguishes unknown from zero and binds pagination to the selected month',async()=>{
 const d=dom(),calls=[];let message='';try{
  initMonthlyReport({request:async url=>{calls.push(url);return data;},say:s=>message=s});assert.equal(calls.length,0);d.$('monthly-period').value='2026-11';await d.$('monthly-refresh').onclick();assert.equal(calls[0],'/api/business/monthly-report?period=2026-11');assert.match(d.$('monthly-projects').children[0].children[1].textContent,/収支未入力/);assert.match(d.$('monthly-projects').children[0].children[3].children[0].textContent,/アクセス 0/);assert.match(d.$('monthly-projects').children[0].children[3].children[0].textContent,/未算出/);assert.equal(d.$('monthly-next').hidden,false);
  d.$('monthly-period').value='2026-12';await d.$('monthly-next').onclick();assert.equal(calls.length,1);assert.match(message,/対象月が変わりました/);d.$('monthly-period').value='2026-11';await d.$('monthly-next').onclick();assert.equal(calls[1],'/api/business/monthly-report?period=2026-11&after=case-a');
 }finally{d.restore();}
});
test('monthly UI suppresses concurrent requests and clears stale reports on failure',async()=>{
 const d=dom();let resolve,calls=0,fail=false;try{
  initMonthlyReport({request:async()=>{calls++;if(fail)throw Error('読取失敗');return new Promise(yes=>resolve=yes);},say:()=>{}});d.$('monthly-period').value='2026-11';const pending=d.$('monthly-refresh').onclick();assert.equal(d.$('monthly-period').disabled,true);await d.$('monthly-refresh').onclick();assert.equal(calls,1);resolve(data);await pending;assert.equal(d.$('monthly-projects').children.length,1);
  fail=true;await d.$('monthly-refresh').onclick();assert.equal(d.$('monthly-projects').children.length,0);assert.match(d.$('monthly-summary').textContent,/取得できません/);assert.equal(d.$('monthly-next').hidden,true);assert.equal(d.$('monthly-period').disabled,false);
 }finally{d.restore();}
});
