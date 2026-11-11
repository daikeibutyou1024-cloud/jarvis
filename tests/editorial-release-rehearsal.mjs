import assert from 'node:assert/strict';
import {localRequest} from './local-http.mjs';
import {startRehearsal} from './rehearsal-server.mjs';
import {defaultOutline,REVIEW_CHECKS} from '../lib/editorial.js';
import {article,evidence} from './paid-fixture.js';

const run=await startRehearsal();
try{
 const path='/api/business/editorial';
 assert.equal((await localRequest(run.baseURL,'/')).status,200);
 assert.equal((await localRequest(run.baseURL,path,{password:'wrong'})).status,401);
 assert.equal(run.db.db.prepare("SELECT name FROM sqlite_master WHERE name='document_revisions'").get(),undefined);
 const note={action:'save',projectId:'release-note-free',expectedRevision:0,topic:'検証用の実体験メモ',audience:'初心者',notes:'ローカル検証専用',format:'note無料記事',text:'# 検証用の実体験メモ\n## 悩み\n作業が整理できないという架空の例。\n## 対策\nメモに書き出して順番を決める。',evidence:'',manualComplete:true,workflow:{idea:'体験の考察',outline:['悩み','対策'],noExternalFacts:true}};
 let r=await localRequest(run.baseURL,path,{method:'POST',body:note});assert.equal(r.status,201);assert.equal(r.json().document.revision,1);
 r=await localRequest(run.baseURL,path+'?projectId='+note.projectId);assert.equal(r.status,200);assert.equal(r.json().document.output,note.text);
 const approval={action:'approve',projectId:note.projectId,expectedRevision:1,checks:Object.fromEntries(REVIEW_CHECKS.map(key=>[key,true]))};
 assert.equal((await localRequest(run.baseURL,path,{method:'POST',body:{...approval,checks:{facts:true}}})).status,400);
 assert.equal((await localRequest(run.baseURL,path,{method:'POST',body:approval})).json().report.approved,true);
 r=await localRequest(run.baseURL,path,{method:'POST',body:{action:'export',projectId:note.projectId,expectedRevision:1}});assert.equal(r.status,200);assert.match(r.json().markdown,/## 対策/);
 r=await localRequest(run.baseURL,path,{method:'POST',body:{...note,expectedRevision:1,text:note.text+'\n後から加えた検証用の修正。'}});assert.equal(r.status,201);assert.equal(r.json().document.revision,2);assert.equal(r.json().report.approved,false);
 assert.equal((await localRequest(run.baseURL,path,{method:'POST',body:{action:'export',projectId:note.projectId,expectedRevision:2}})).status,409);
 assert.equal((await localRequest(run.baseURL,path,{method:'POST',body:note})).status,409);
 const paid={...note,projectId:'release-note-paid',format:'note有料記事',topic:'業務整理ガイド',text:article,evidence,workflow:{idea:'架空の業務整理教材',outline:defaultOutline('note有料記事'),noExternalFacts:false}};
 r=await localRequest(run.baseURL,path,{method:'POST',body:paid});assert.equal(r.status,201);const saved=r.json().document;
 r=await localRequest(run.baseURL,path+'?projectId='+paid.projectId);assert.equal(r.json().document.output,saved.output);
 assert.equal((await localRequest(run.baseURL,path,{method:'POST',body:{...approval,projectId:paid.projectId}})).json().report.approved,true);
 r=await localRequest(run.baseURL,path,{method:'POST',body:{action:'export',projectId:paid.projectId,expectedRevision:1}});assert.equal(r.status,200);assert.match(r.json().freeMarkdown,/無料部分/);assert.match(r.json().paidMarkdown,/完成テンプレート/);
 const stats=run.stats();assert.equal(stats.outboundAttempts,0);assert.equal(run.db.db.prepare('SELECT COUNT(*) n FROM document_revisions').get().n,3);assert.equal(run.db.db.prepare('SELECT COUNT(*) n FROM editorial_reviews').get().n,2);
 console.log(JSON.stringify({result:'passed',scope:'HTTP + actual Pages handlers + disposable SQLite; not live Preview or browser',flows:['wrong_password_401_no_write','free_note_save_reload_approve_export','incomplete_human_checks_rejected','new_revision_requires_new_approval','stale_save_409','paid_note_save_reload_approve_split_export'],documents:2,revisions:3,approvalRecords:2,externalRequests:stats.outboundAttempts}));
}finally{await run.close();}
