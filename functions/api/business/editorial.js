import {denied,responseJSON as json} from '../../../lib/research-network.js';
import {projectId,checkRevision,saveRevision,latestDocument,initDocuments} from '../../../lib/documents.js';
import {EditorialError,workflowInput,editorialReport,compactGeneration,REVIEW_CHECKS,exportArticle,NOTE_FORMATS} from '../../../lib/editorial.js';
import {preparePaidDraft} from '../../../lib/paid-draft.js';
import {PAID_FORMAT,articleBody} from '../../../lib/paid-content.js';
export const REVIEW_SCHEMA=`CREATE TABLE IF NOT EXISTS editorial_reviews (project_id TEXT NOT NULL, revision INTEGER NOT NULL, digest TEXT NOT NULL, checks_json TEXT NOT NULL, reviewed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(project_id,revision))`;
export async function initEditorialData(db){await initDocuments(db);await db.prepare(REVIEW_SCHEMA).run();}
export async function editorialDigest(doc){
 const content=JSON.stringify([doc.topic,doc.audience,doc.notes,doc.format,doc.output,doc.evidence,doc.workflow]);
 const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(content));
 return [...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('');
}
export async function editorialSummary(db,doc){
 const report=editorialReport(doc);
 const review=await db.prepare('SELECT * FROM editorial_reviews WHERE project_id=? AND revision=?').bind(doc.projectId,doc.revision).first();
 const approved=report.readyForReview&&review?.digest===await editorialDigest(doc);
 return {...report,stage:approved?'approved':report.stage,approved,reviewedAt:approved?review.reviewed_at:null};
}
const validateText=(s,max,required=false)=>typeof s==='string'&&s.length<=max&&(!required||!!s.trim());
export async function onRequestGet({request,env}){
 const auth=denied(request,env);if(auth)return auth;
 try{
  const db=env.JARVIS_DB,url=new URL(request.url),id=url.searchParams.get('projectId');await initEditorialData(db);
  if(id){projectId(id);const doc=await latestDocument(db,id);if(!doc)return json({error:'制作案件が見つかりません'},404);return json({document:doc,report:await editorialSummary(db,doc)});}
  const before=url.searchParams.get('before');if(before!==null&&!/^\d+$/.test(before))return json({error:'ページ指定が不正です'},400);
  const cursor=before===null?Number.MAX_SAFE_INTEGER:Number(before);if(!Number.isSafeInteger(cursor))return json({error:'ページ指定が不正です'},400);
  const rows=await db.prepare(`SELECT d.*,d.rowid AS cursor FROM document_revisions d WHERE d.revision=(SELECT MAX(revision) FROM document_revisions WHERE project_id=d.project_id) AND json_extract(d.payload,'$.workflow.version')=1 AND d.rowid<? ORDER BY d.rowid DESC LIMIT 51`).bind(cursor).all();
  const page=rows.results.slice(0,50),projects=[];
  for(const row of page){const doc={...JSON.parse(row.payload),projectId:row.project_id,revision:row.revision};projects.push({projectId:doc.projectId,revision:doc.revision,topic:doc.topic,format:doc.format,report:await editorialSummary(db,doc)});}
  return json({projects,nextCursor:rows.results.length>50?page.at(-1).cursor:null});
 }catch{return json({error:'制作案件を読み込めませんでした'},503);}
}
export async function onRequestPost({request,env}){
 const auth=denied(request,env);if(auth)return auth;
 try{
  const raw=await request.text();if(raw.length>250000)return json({error:'保存内容が大きすぎます'},400);
  const b=JSON.parse(raw);if(!b||!['save','approve','export'].includes(b.action))return json({error:'操作が不正です'},400);
  const id=projectId(b.projectId),db=env.JARVIS_DB;await initEditorialData(db);await checkRevision(db,id,b.expectedRevision??0);
  const previous=await latestDocument(db,id);
  if(b.action==='save'){
   if(!NOTE_FORMATS.includes(b.format)||!validateText(b.topic,160,true)||!validateText(b.audience,160)||!validateText(b.notes,2500)||!validateText(b.evidence,3500)||!validateText(b.text,70000)||articleBody(b.text).length>60000)return json({error:'制作条件・本文・資料の長さと形式を確認してください'},400);
   if(previous&&(previous.department!=='content'||previous.format!==b.format))return json({error:'既存案件の部門・形式は変更できません。別の案件として保存してください'},400);
   const workflow=workflowInput(b.workflow,b.format);
   let generation=compactGeneration(b.generation),output=b.text;
   if(b.format===PAID_FORMAT){
    ({generation,output}=preparePaidDraft({...b,approved:false,manualComplete:b.manualComplete===true},id));
    await db.prepare('CREATE TABLE IF NOT EXISTS paid_content_drafts (id TEXT PRIMARY KEY, topic TEXT NOT NULL, output TEXT NOT NULL, generation_json TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)').run();
   }else if(b.manualComplete===true&&b.text.trim())generation={...generation,articleStatus:'manual_complete'};
   generation.document={projectId:id,revision:(b.expectedRevision??0)+1};
   const payload={department:'content',topic:b.topic,audience:b.audience,notes:b.notes,format:b.format,output,evidence:b.evidence,workflow,generation,approved:false};
   await saveRevision(db,id,b.expectedRevision??0,payload,b.format===PAID_FORMAT?writeId=>db.prepare('INSERT INTO paid_content_drafts(id,topic,output,generation_json) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM document_revisions WHERE write_id=?) ON CONFLICT(id) DO UPDATE SET topic=excluded.topic,output=excluded.output,generation_json=excluded.generation_json,updated_at=CURRENT_TIMESTAMP').bind(id,b.topic,output,JSON.stringify(generation),writeId):null);
   const doc={...payload,projectId:id,revision:generation.document.revision};return json({document:doc,report:await editorialSummary(db,doc)},201);
  }
  if(!previous?.workflow)return json({error:'先に制作案件として保存してください'},400);
  const report=await editorialSummary(db,previous);
  if(!report.readyForReview)return json({error:'未完成の項目を補完してください',report},409);
  if(b.action==='approve'){
   if(!REVIEW_CHECKS.every(key=>b.checks?.[key]===true))return json({error:'全文・根拠・実用性・権利・個人情報・広告表記の確認が必要です'},400);
   const hash=await editorialDigest(previous);
   const result=await db.prepare(`INSERT OR IGNORE INTO editorial_reviews(project_id,revision,digest,checks_json) SELECT ?,?,?,? WHERE (SELECT MAX(revision) FROM document_revisions WHERE project_id=?)=?`).bind(id,previous.revision,hash,JSON.stringify(Object.fromEntries(REVIEW_CHECKS.map(k=>[k,true]))),id,previous.revision).run();
   await checkRevision(db,id,previous.revision);
   if(!result.meta?.changes&&!report.approved)return json({error:'確認状態が変わりました。再読込してください'},409);
   return json({projectId:id,revision:previous.revision,report:await editorialSummary(db,previous)});
  }
  if(!report.approved)return json({error:'この版の全文確認を先に完了してください'},409);
  await checkRevision(db,id,previous.revision);
  return json({projectId:id,revision:previous.revision,...exportArticle(previous)});
 }catch(e){return json({error:e.code==='SAVE_CONFLICT'||e instanceof EditorialError?e.message:'制作条件またはDB設定を確認してください。保存は完了していません',code:e.code,currentRevision:e.currentRevision},e.status||400);}
}
