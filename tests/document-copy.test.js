import test from 'node:test';
import assert from 'node:assert/strict';
import {testDB} from './runtime-fixture.js';
import {saveRevision,initDocuments} from '../lib/documents.js';
import {copyDocument,previewDocumentCopy} from '../lib/document-copy.js';
import * as copyAPI from '../functions/api/business/document-copy.js';
import * as editorial from '../functions/api/business/editorial.js';
import {defaultOutline,REVIEW_CHECKS} from '../lib/editorial.js';
import {article,evidence} from './paid-fixture.js';
const env=db=>({JARVIS_DB:db,JARVIS_ACCESS_PASSWORD:'test'});
const req=b=>new Request('http://localhost/api/business/document-copy',{method:'POST',headers:{'x-jarvis-password':'test'},body:JSON.stringify(b)});
const base={department:'content',topic:'元のテーマ',audience:'初心者',notes:'元の注意',format:'note記事',output:'# 原稿\n元の本文',evidence:'元の資料',generation:{completionStatus:'incomplete',articleStatus:'incomplete',document:{projectId:'original',revision:1}},approved:false};
async function seed(db){await initDocuments(db);await saveRevision(db,'original',0,base);await saveRevision(db,'original',1,{...base,output:'新しい本文'});}
async function prepare(db,target='copied'){const p=await previewDocumentCopy(db,'original',1);return {sourceProjectId:'original',sourceRevision:1,preparedDigest:p.source.digest,targetProjectId:target,confirmed:true};}
function snapshot(db){return db.db.prepare('SELECT * FROM document_revisions ORDER BY rowid').all();}
test('preview reads an immutable historical snapshot without writes or creating a missing schema',async()=>{
 const db=testDB();await assert.rejects(previewDocumentCopy(db,'original',0),e=>e.status===404);assert.equal(db.db.prepare("SELECT name FROM sqlite_master WHERE name='document_revisions'").get(),undefined);
 await seed(db);const before=snapshot(db),p=await previewDocumentCopy(db,'original',1);assert.equal(p.document.output,base.output);assert.equal(p.source.revision,1);assert.equal(p.source.digest.length,64);assert.deepEqual(snapshot(db),before);db.db.close();
});
test('copy saves a new first revision, preserves every source version and original text, and ignores forged client payload',async()=>{
 const db=testDB();await seed(db);const before=snapshot(db);const b=await prepare(db);const response=await copyAPI.onRequestPost({env:env(db),request:req({action:'copy',...b,text:'forged text',approved:true,workflow:{approved:true}})});assert.equal(response.status,201);
 const r=await response.json();assert.equal(r.document.output,base.output);assert.equal(r.document.evidence,base.evidence);assert.equal(r.document.revision,1);assert.equal(r.document.approved,false);assert.equal(r.document.copiedFrom.projectId,'original');assert.deepEqual(r.document.generation.document,{projectId:'copied',revision:1});assert.deepEqual(snapshot(db).filter(r=>r.project_id==='original'),before);db.db.close();
});
test('retry with the same target and concurrent requests never create duplicate versions or overwrite an edited copy',async()=>{
 const db=testDB();await seed(db);const b=await prepare(db);const results=await Promise.all([copyDocument(db,b),copyDocument(db,b)]);assert.equal(results.filter(r=>r.alreadyCopied).length,1);assert.equal((await copyDocument(db,b)).alreadyCopied,true);assert.equal(snapshot(db).filter(r=>r.project_id==='copied').length,1);
 await saveRevision(db,'copied',1,{...base,output:'コピー先で編集した本文'});await assert.rejects(copyDocument(db,b),e=>e.status===409);assert.equal(JSON.parse(snapshot(db).at(-1).payload).output,'コピー先で編集した本文');db.db.close();
});
test('confirmation, exact preview hash, IDs, revisions and pre-existing destinations are enforced',async()=>{
 const db=testDB();await seed(db);const b=await prepare(db);
 for(const patch of [{confirmed:false},{preparedDigest:'stale'},{targetProjectId:'original'},{targetProjectId:''},{targetProjectId:'bad id'},{sourceRevision:-1},{sourceRevision:99},{sourceProjectId:undefined}])await assert.rejects(copyDocument(db,{...b,...patch}));
 await saveRevision(db,'copied',0,{...base,output:'無関係な既存案件'});await assert.rejects(copyDocument(db,b),e=>e.status===409);assert.equal(snapshot(db).length,3);db.db.close();
});
test('legacy revision zero is not overwritten and legacy paid destinations are protected for every department',async()=>{
 const db=testDB();await seed(db);await db.prepare('INSERT INTO document_revisions(project_id,revision,write_id,payload) VALUES(?,0,?,?)').bind('zero','write-zero',JSON.stringify(base)).run();await assert.rejects(copyDocument(db,await prepare(db,'zero')),e=>e.status===409);
 db.db.exec('CREATE TABLE paid_content_drafts(id TEXT PRIMARY KEY,topic TEXT,output TEXT,generation_json TEXT,updated_at TEXT)');db.db.prepare("INSERT INTO paid_content_drafts VALUES('old-paid','旧原稿','保護する本文','{}','time')").run();await assert.rejects(copyDocument(db,await prepare(db,'old-paid')),e=>e.status===409);assert.equal(snapshot(db).some(r=>r.project_id==='old-paid'),false);assert.equal(db.db.prepare("SELECT output FROM paid_content_drafts WHERE id='old-paid'").get().output,'保護する本文');db.db.close();
});
async function paidSeed(db){
 const b={action:'save',projectId:'original',expectedRevision:0,topic:'業務整理ガイド',audience:'初心者',notes:'',format:'note有料記事',text:article,evidence,manualComplete:true,workflow:{idea:'初心者向けの業務整理',outline:defaultOutline('note有料記事'),noExternalFacts:false}};
 assert.equal((await editorial.onRequestPost({env:env(db),request:req(b)})).status,201);assert.equal((await editorial.onRequestPost({env:env(db),request:req({action:'approve',projectId:'original',expectedRevision:1,checks:Object.fromEntries(REVIEW_CHECKS.map(k=>[k,true]))})})).status,200);return b;
}
test('paid copy recomputes structure, preserves source text and workflow, mirrors atomically and cannot reuse editorial approval',async()=>{
 const db=testDB();await paidSeed(db);const before=snapshot(db);const source=await previewDocumentCopy(db,'original',1);const r=await copyDocument(db,await prepare(db));assert.equal(r.document.output,source.document.output);assert.deepEqual(r.document.workflow,source.document.workflow);assert.equal(r.document.generation.project.id,'copied');assert.equal(r.document.generation.project.humanReview.status,'pending');assert.equal(r.document.approved,false);assert.equal(db.db.prepare('SELECT COUNT(*) n FROM editorial_reviews').get().n,1);assert.equal(db.db.prepare("SELECT output FROM paid_content_drafts WHERE id='copied'").get().output,source.document.output);
 assert.equal((await editorial.onRequestPost({env:env(db),request:req({action:'export',projectId:'copied',expectedRevision:1})})).status,409);assert.deepEqual(snapshot(db).filter(r=>r.project_id==='original'),before);db.db.close();
});
test('failed paid mirror rolls the new document back while preserving original reviews and data',async()=>{
 const db=testDB();await paidSeed(db);const before=snapshot(db),b=await prepare(db);db.db.exec("CREATE TRIGGER fail_copy BEFORE INSERT ON paid_content_drafts WHEN NEW.id='copied' BEGIN SELECT RAISE(ABORT,'simulated'); END;");await assert.rejects(copyDocument(db,b),e=>e.status===409);assert.deepEqual(snapshot(db),before);assert.equal(db.db.prepare('SELECT COUNT(*) n FROM editorial_reviews').get().n,1);db.db.close();
});
test('new source revisions do not invalidate the selected immutable old version',async()=>{
 const db=testDB();await seed(db);const b=await prepare(db);await saveRevision(db,'original',2,{...base,output:'さらに新しい本文'});assert.equal((await copyDocument(db,b)).document.output,base.output);assert.equal(snapshot(db).filter(r=>r.project_id==='original').length,3);db.db.close();
});
test('a source change after preflight or a target appearing at commit time cannot bypass transaction guards',async()=>{
 for(const mutateSource of [true,false]){
 const db=testDB();await seed(db);const b=await prepare(db);let mutated=false;const wrapper={...db,async batch(ss){if(!mutated){mutated=true;if(mutateSource)db.db.prepare("UPDATE document_revisions SET payload=? WHERE project_id='original' AND revision=1").run(JSON.stringify({...base,output:'不正な履歴変更'}));else await saveRevision(db,'copied',0,{...base,output:'別の保存'});}return db.batch(ss);}};
 await assert.rejects(copyDocument(wrapper,b),e=>e.status===409);if(mutateSource)assert.equal(snapshot(db).some(r=>r.project_id==='copied'),false);else assert.equal(JSON.parse(snapshot(db).find(r=>r.project_id==='copied').payload).output,'別の保存');db.db.close();}
});
test('auth and malformed requests cannot access historical drafts or leak database details',async()=>{
 const trap={prepare(){throw Error('private-storage-details');}};let r=await copyAPI.onRequestPost({env:env(trap),request:new Request('http://localhost',{method:'POST',body:'{}'})});assert.equal(r.status,401);
 const db=testDB();for(const body of ['null','[]','not json',JSON.stringify({action:'unknown'}),' '.repeat(2001)]){r=await copyAPI.onRequestPost({env:env(db),request:new Request('http://localhost',{method:'POST',headers:{'x-jarvis-password':'test'},body})});assert.equal(r.status,400);}r=await copyAPI.onRequestPost({env:env(trap),request:req({action:'preview',sourceProjectId:'original',sourceRevision:1})});assert.equal(r.status,503);assert.ok(!(await r.text()).includes('private-storage-details'));db.db.close();
});

test('legacy paid source without evidence can be copied without inventing sources or reusing approval',async()=>{
 const db=testDB();await initDocuments(db);const legacy={department:'content',topic:'旧原稿',output:'元の未完成本文',format:'note有料記事',generation:{completionStatus:'complete',project:{humanReview:{status:'approved'}}},approved:true};
 await db.prepare('INSERT INTO document_revisions(project_id,revision,write_id,payload) VALUES(?,0,?,?)').bind('original','legacy-write',JSON.stringify(legacy)).run();
 const p=await previewDocumentCopy(db,'original',0);assert.equal(p.document.evidence,'');const r=await copyDocument(db,{sourceProjectId:'original',sourceRevision:0,preparedDigest:p.source.digest,targetProjectId:'copied',confirmed:true});assert.equal(r.document.output,legacy.output);assert.equal(r.document.evidence,'');assert.equal(r.document.audience,'');assert.equal(r.document.approved,false);assert.equal(r.document.generation.project.humanReview.status,'pending');assert.notEqual(r.document.generation.articleStatus,'complete');assert.equal(snapshot(db).find(r=>r.project_id==='original').payload,JSON.stringify(legacy));db.db.close();
});
