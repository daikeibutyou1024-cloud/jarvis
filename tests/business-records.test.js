import test from 'node:test';
import assert from 'node:assert/strict';
import {testDB} from './runtime-fixture.js';
import {normalizeRecord,saveBusinessRecord,importBusinessRecords,businessSummary,initBusiness,currentRecord,yenMinor} from '../lib/business-records.js';
import {legacyBusinessRows,businessCsvRows,copiedBusinessRows,safeCsv} from '../lib/business-transfer.js';
import * as records from '../functions/api/business/records.js';
import * as publications from '../functions/api/business/publications.js';
import * as editorial from '../functions/api/business/editorial.js';
import {article,evidence} from './paid-fixture.js';
import {defaultOutline,REVIEW_CHECKS} from '../lib/editorial.js';
import {operationalReport} from '../lib/operational-report.js';
const env=db=>({JARVIS_DB:db,JARVIS_ACCESS_PASSWORD:'test'});
const req=b=>new Request('http://localhost/api',{method:'POST',headers:{'x-jarvis-password':'test','content-type':'application/json'},body:JSON.stringify(b)});
const finance=(extra={})=>({kind:'finance',id:'cash-1',date:'2026-11-11',type:'revenue',amount:'1000.00',memo:'売上の入力',projectId:'',...extra});
const metrics=(extra={})=>({kind:'metrics',period:'2026-11',channel:'note',visits:100,clicks:10,conversions:2,projectId:'',...extra});
async function offline(fn){const old=fetch;globalThis.fetch=()=>{throw Error('Real network forbidden');};try{return await fn();}finally{globalThis.fetch=old;}}
async function approvedCase(db){
 const b={action:'save',projectId:'article-1',expectedRevision:0,topic:'業務整理ガイド',audience:'初心者',notes:'',format:'note有料記事',text:article,evidence,manualComplete:true,workflow:{idea:'使える手順と記入例を渡す',outline:defaultOutline('note有料記事'),noExternalFacts:false}};
 assert.equal((await editorial.onRequestPost({env:env(db),request:req(b)})).status,201);assert.equal((await editorial.onRequestPost({env:env(db),request:req({action:'approve',projectId:'article-1',expectedRevision:1,checks:Object.fromEntries(REVIEW_CHECKS.map(k=>[k,true]))})})).status,200);
 return b;
}
test('money uses exact minor units and rejects unknown currency, missing data and invalid dates',async()=>{
 assert.equal(yenMinor('0.10')+yenMinor('0.20'),30);for(const amount of [0,-1,'','NaN',Infinity,'1,000','0.001','1000000000'])await assert.rejects(normalizeRecord(finance({amount})));
 await assert.rejects(normalizeRecord(finance({currency:'USD'})));await assert.rejects(normalizeRecord(finance({date:'2026-02-30'})));await assert.rejects(normalizeRecord(metrics({visits:undefined})));await assert.rejects(normalizeRecord(metrics({clicks:101})));await assert.rejects(normalizeRecord(metrics({conversions:11})));
});
test('same-ID saves are idempotent; simultaneous different writes have one winner and immutable history',async()=>offline(async()=>{
 const db=testDB(),r=await normalizeRecord(finance());await saveBusinessRecord(db,r,0);const repeated=await saveBusinessRecord(db,r,0);assert.equal(repeated.alreadySaved,true);assert.equal(db.db.prepare('SELECT COUNT(*) n FROM business_record_history').get().n,1);
 const a=await normalizeRecord(finance({amount:'2000'})),b=await normalizeRecord(finance({amount:'3000'}));const results=await Promise.allSettled([saveBusinessRecord(db,a,1),saveBusinessRecord(db,b,1)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.status,409);assert.equal(db.db.prepare('SELECT COUNT(*) n FROM business_record_history').get().n,2);assert.equal(JSON.parse(db.db.prepare('SELECT payload_json FROM business_record_history WHERE version=1').get().payload_json).amountMinor,100000);db.db.close();
}));
test('a history-storage failure rolls the current record back and never loses the old value',async()=>offline(async()=>{
 const db=testDB();await saveBusinessRecord(db,await normalizeRecord(finance()),0);db.db.exec("CREATE TRIGGER fail_history BEFORE INSERT ON business_record_history BEGIN SELECT RAISE(ABORT,'simulated'); END;");await assert.rejects(saveBusinessRecord(db,await normalizeRecord(finance({amount:'2000'})),1));assert.equal((await currentRecord(db,'cash-1')).payload.amountMinor,100000);assert.equal((await currentRecord(db,'cash-1')).version,1);assert.equal(db.db.prepare('SELECT COUNT(*) n FROM business_write_guards').get().n,0);db.db.close();
}));
test('cancel and restore are versioned bookkeeping actions without deleting historical rows',async()=>offline(async()=>{
 const db=testDB();const r=await normalizeRecord(finance());await saveBusinessRecord(db,r,0);await saveBusinessRecord(db,r,1,'void');assert.equal((await businessSummary(db)).recordedTotals,null);await saveBusinessRecord(db,r,2,'active');assert.equal((await businessSummary(db)).recordedTotals.revenue,1000);assert.equal(db.db.prepare('SELECT COUNT(*) n FROM business_record_history').get().n,3);db.db.close();
}));
test('aggregate differences subtract recorded API cost once and never mix currencies or fabricate actual profit',async()=>offline(async()=>{
 const db=testDB();for(const f of [finance({id:'rev',amount:'10000'}),finance({id:'exp',type:'expense',amount:'2000'}),finance({id:'api',type:'api',amount:'500'})])await saveBusinessRecord(db,await normalizeRecord(f),0);const r=await businessSummary(db,{period:'2026-11'});assert.deepEqual(r.recordedTotals,{revenue:10000,expense:2000,api:500,difference:7500});assert.equal(r.actualProfit,null);assert.equal(r.currency,'JPY');db.db.close();
}));
test('metrics identify each project/month/channel and keep zero denominators and overlapping scopes separate',async()=>offline(async()=>{
 const db=testDB();const a=await normalizeRecord(metrics()),b=await normalizeRecord(metrics({channel:'all',visits:200,clicks:20,conversions:4})),c=await normalizeRecord(metrics({period:'2026-12',visits:0,clicks:0,conversions:0}));for(const r of [a,b,c])await saveBusinessRecord(db,r,0);let s=await businessSummary(db,{period:'2026-11'});assert.equal(s.metrics.length,2);assert.equal(s.metrics.find(x=>x.channel==='note').ctr,0.1);assert.equal(s.metrics.find(x=>x.channel==='note').conversionRate,0.2);s=await businessSummary(db,{period:'2026-12'});assert.equal(s.metrics[0].ctr,null);assert.equal(s.metrics[0].conversionRate,null);await assert.rejects(normalizeRecord(metrics({id:a.id,period:'2026-12'})));db.db.close();
}));
test('unknown project IDs are refused; known projects can be filtered without losing other records',async()=>offline(async()=>{
 const db=testDB();await assert.rejects(saveBusinessRecord(db,await normalizeRecord(finance({projectId:'unknown'})),0));await approvedCase(db);await saveBusinessRecord(db,await normalizeRecord(finance({projectId:'article-1'})),0);assert.equal((await businessSummary(db,{projectId:'article-1'})).entries,1);assert.equal((await businessSummary(db,{projectId:'another'})).entries,0);db.db.close();
}));
test('legacy conversion preserves originals, IDs, legitimate duplicates and repeat copies without duplicates',async()=>offline(async()=>{
 const db=testDB(),ledger=[{id:'old-1',date:'2026-11-11',type:'revenue',amount:100,memo:'記録'},{date:'2026-11-11',type:'expense',amount:10,memo:'同額'},{date:'2026-11-11',type:'expense',amount:10,memo:'同額'}],m={'2026-11':{period:'2026-11',visits:0,clicks:0,conversions:0}},original=JSON.stringify([ledger,m]);const rows=await legacyBusinessRows(ledger,m);const first=await importBusinessRecords(db,rows,'legacy'),again=await importBusinessRecords(db,rows,'legacy');assert.equal(first.inserted,4);assert.equal(again.alreadyApplied,true);assert.equal(db.db.prepare('SELECT COUNT(*) n FROM business_records').get().n,4);assert.equal(JSON.stringify([ledger,m]),original);
 const reordered=await legacyBusinessRows([ledger[1],ledger[0],ledger[2]],m);await importBusinessRecords(db,reordered,'legacy');assert.equal(db.db.prepare('SELECT COUNT(*) n FROM business_records').get().n,4);db.db.close();
}));
test('import rejects changed existing data before writes and a failed batch leaves no partial records',async()=>offline(async()=>{
 const db=testDB();await importBusinessRecords(db,[finance()],'csv');await assert.rejects(importBusinessRecords(db,[finance({amount:'2000'}),finance({id:'cash-2'})],'csv'),e=>e.status===409);assert.equal(db.db.prepare('SELECT COUNT(*) n FROM business_records').get().n,1);
 db.db.exec("CREATE TRIGGER fail_second BEFORE INSERT ON business_records WHEN NEW.id='fail' BEGIN SELECT RAISE(ABORT,'fail'); END;");await assert.rejects(importBusinessRecords(db,[finance({id:'okay'}),finance({id:'fail'})],'csv'));assert.equal(db.db.prepare("SELECT COUNT(*) n FROM business_records WHERE id='okay'").get().n,0);assert.equal(db.db.prepare('SELECT COUNT(*) n FROM business_imports').get().n,1);db.db.close();
}));
test('concurrent imports have a single receipt and preserve the same record versions',async()=>offline(async()=>{
 const db=testDB();const rs=await Promise.all([importBusinessRecords(db,[finance()],'csv'),importBusinessRecords(db,[finance()],'csv')]);assert.equal(rs.filter(r=>r.alreadyApplied).length,1);assert.equal(db.db.prepare('SELECT COUNT(*) n FROM business_record_history').get().n,1);db.db.close();
}));
test('CSV handles quoted text but refuses missing measured values and duplicated semantic IDs',async()=>{
 const rows=await businessCsvRows('id,date,type,amount,memo,projectId\r\nrow1,2026-11-11,revenue,1000,"メモ,改行\n次の行",','finance');assert.equal(rows[0].memo,'メモ,改行\n次の行');await assert.rejects(businessCsvRows('period,channel,visits,clicks,conversions,projectId\n2026-11,note,,0,0,','metrics'));await assert.rejects(businessCsvRows('period,channel,visits,clicks,conversions,projectId\n2026-11,note,1,0,0,\n2026-11,note,2,0,0,','metrics'));assert.match(safeCsv([{memo:'=HYPERLINK("bad")'}],['memo']),/'=HYPERLINK/);
});
test('current-record copy preserves void status and money but does not pretend to restore all history',async()=>offline(async()=>{
 const a=testDB(),b=testDB();const r=await normalizeRecord(finance({amount:'0.29'}));await saveBusinessRecord(a,r,0);await saveBusinessRecord(a,r,1,'void');const head=await currentRecord(a,r.id);const rows=await copiedBusinessRows(JSON.stringify({schema:'jarvis-business-copy-v1',records:[head]}));await importBusinessRecords(b,rows,'copy');const copied=await currentRecord(b,r.id);assert.equal(copied.state,'void');assert.equal(copied.payload.amountMinor,29);assert.equal(copied.version,1);assert.equal((await currentRecord(a,r.id)).version,2);a.db.close();b.db.close();
}));
test('record API protects history and publication records and exposes no unauthenticated bookkeeping',async()=>offline(async()=>{
 const db=testDB();for(const method of ['onRequestGet','onRequestPost'])assert.equal((await records[method]({env:env(db),request:new Request('http://localhost/api')})).status,401);
 assert.equal((await records.onRequestPost({env:env(db),request:req({action:'save',...finance(),expectedVersion:0})})).status,201);
 const history=await records.onRequestGet({env:env(db),request:new Request('http://localhost/api?id=cash-1',{headers:{'x-jarvis-password':'test'}})});assert.equal((await history.json()).history.length,1);
 assert.equal((await records.onRequestPost({env:env(db),request:req({action:'save',kind:'publication',expectedVersion:0})})).status,400);db.db.close();
}));
test('publication package and manual report require a reviewed current revision without sending anything',async()=>offline(async()=>{
 const db=testDB();await approvedCase(db);const packageResponse=await publications.onRequestPost({env:env(db),request:req({action:'package',projectId:'article-1',expectedRevision:1})});assert.equal(packageResponse.status,200);const p=await packageResponse.json();assert.equal(p.teaserStatus,'unreviewed');assert.match(p.teaserDraft,/公開URLを入力/);
 const b={action:'record',projectId:'article-1',expectedRevision:1,preparedDigest:p.digest,date:'2026-11-11',channel:'note',url:'https://note.com/example/n/abc',publishedManually:true,checks:{account:true,terms:true,content:true}};const r=await publications.onRequestPost({env:env(db),request:req(b)});assert.equal(r.status,201);const first=await r.json();const again=await publications.onRequestPost({env:env(db),request:req(b)});assert.equal((await again.json()).alreadyRecorded,true);const row=await currentRecord(db,first.id);assert.equal(row.payload.externalVerified,false);assert.equal(row.payload.source,'user_reported');assert.equal(row.payload.revision,1);db.db.close();
}));
test('publication cannot bypass missing human checks, a stale package, URL validation or revision changes',async()=>offline(async()=>{
 const db=testDB();const old=await approvedCase(db);const p=await (await publications.onRequestPost({env:env(db),request:req({action:'package',projectId:'article-1',expectedRevision:1})})).json();const b={action:'record',projectId:'article-1',expectedRevision:1,preparedDigest:p.digest,date:'2026-11-11',channel:'note',url:'https://note.com/example/n/abc',publishedManually:true,checks:{account:true,terms:true,content:true}};
 for(const patch of [{checks:{account:true}},{preparedDigest:'wrong'},{url:'javascript:alert(1)'},{publishedManually:false}])assert.notEqual((await publications.onRequestPost({env:env(db),request:req({...b,...patch})})).status,201);
 await editorial.onRequestPost({env:env(db),request:req({...old,expectedRevision:1,text:article+'\n編集'})});assert.equal((await publications.onRequestPost({env:env(db),request:req(b)})).status,409);assert.equal((await publications.onRequestPost({env:env(db),request:req({action:'package',projectId:'article-1',expectedRevision:2})})).status,409);db.db.close();
}));
test('manual daily ledger totals remain separate from actual revenue and USD API usage',async()=>offline(async()=>{
 const db=testDB();await saveBusinessRecord(db,await normalizeRecord(finance()),0);const r=await operationalReport(db,'2026-11-11');assert.equal(r.bookkeeping.currency,'JPY');assert.equal(r.bookkeeping.recordedRevenue,1000);assert.equal(r.revenue,null);assert.equal(r.profit,null);assert.equal(r.bookkeeping.actualProfit,null);assert.equal(r.ai,null);db.db.close();
}));
test('a concurrent edit during import prevents both new rows and a misleading import receipt',async()=>offline(async()=>{
 const db=testDB();await importBusinessRecords(db,[finance()],'csv');let changed=false;
 const wrapper={...db,prepare(sql){const s=db.prepare(sql);s.testSQL=sql;return s;},async batch(ss){if(!changed&&ss[0]?.testSQL?.includes('business_imports')){changed=true;await saveBusinessRecord(db,await normalizeRecord(finance({amount:'2222'})),1);}return db.batch(ss);}};
 await assert.rejects(importBusinessRecords(wrapper,[finance(),finance({id:'new-row'})],'csv'),e=>e.status===409);assert.equal((await currentRecord(db,'cash-1')).payload.amountMinor,222200);assert.equal(db.db.prepare("SELECT COUNT(*) n FROM business_records WHERE id='new-row'").get().n,0);assert.equal(db.db.prepare('SELECT COUNT(*) n FROM business_imports').get().n,1);db.db.close();
}));
test('publication writes are guarded against a draft edit after preparing the record',async()=>offline(async()=>{
 const db=testDB();const original=await approvedCase(db);const p=await (await publications.onRequestPost({env:env(db),request:req({action:'package',projectId:'article-1',expectedRevision:1})})).json();let edited=false;
 const wrapper={...db,prepare(sql){const s=db.prepare(sql);s.testSQL=sql;return s;},async batch(ss){if(!edited&&ss[0]?.testSQL?.startsWith('INSERT INTO business_write_guards')){edited=true;await editorial.onRequestPost({env:env(db),request:req({...original,expectedRevision:1,text:article+'\n別タブの編集'})});}return db.batch(ss);}};
 const b={action:'record',projectId:'article-1',expectedRevision:1,preparedDigest:p.digest,date:'2026-11-11',channel:'note',url:'https://note.com/example/n/abc',publishedManually:true,checks:{account:true,terms:true,content:true}};
 const r=await publications.onRequestPost({env:env(wrapper),request:req(b)});assert.equal(r.status,409);assert.equal(db.db.prepare("SELECT COUNT(*) n FROM business_records WHERE kind='publication'").get().n,0);db.db.close();
}));
test('CSV and current-record copy refuse malformed quotes and missing or repeated stable identifiers',async()=>{
 await assert.rejects(businessCsvRows('id,date,type,amount,memo,projectId\na,2026-11-11,revenue,1,"bad"tail,','finance'));
 const p=(await normalizeRecord(finance())).payload;await assert.rejects(copiedBusinessRows(JSON.stringify({schema:'jarvis-business-copy-v1',records:[{payload:p,state:'active'}]})));await assert.rejects(copiedBusinessRows(JSON.stringify({schema:'jarvis-business-copy-v1',records:[{id:'same',payload:p,state:'active'},{id:'same',payload:p,state:'active'}]})));
});

test('additive migration can run twice while preserving existing jobs and record histories',async()=>{
 const {readFileSync}=await import('node:fs');const db=testDB();await saveBusinessRecord(db,await normalizeRecord(finance()),0);
 const before=db.db.prepare('SELECT * FROM business_record_history').all();const oldTables=db.db.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' AND name='business_jobs'").all();
 const sql=readFileSync(new URL('../migrations/0008_business_records.sql',import.meta.url),'utf8');db.db.exec(sql);db.db.exec(sql);
 assert.deepEqual(db.db.prepare('SELECT * FROM business_record_history').all(),before);assert.deepEqual(db.db.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' AND name='business_jobs'").all(),oldTables);db.db.close();
 await assert.rejects(businessCsvRows('id,date,type,amount,memo,projectId\n,2026-11-11,revenue,1,,','finance'));
});
