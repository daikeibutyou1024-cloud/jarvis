import {saveRevision,initDocuments} from './documents.js';
import {preparePaidDraft} from './paid-draft.js';
import {departments} from '../assets/business.js';
export class CopyError extends Error{constructor(message,status=400,code='COPY_INPUT'){super(message);this.status=status;this.code=code;}}
export function copyId(value){if(typeof value!=='string'||!/^[-a-zA-Z0-9]{1,80}$/.test(value))throw new CopyError('案件IDを確認してください');return value;}
async function digest(value){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return [...new Uint8Array(bytes)].map(v=>v.toString(16).padStart(2,'0')).join('');}
export async function copySource(db,id,revision){
 copyId(id);if(!Number.isSafeInteger(revision)||revision<0)throw new CopyError('保存済みの版を指定してください');
 // No legacy seeding or schema repair while previewing a historical snapshot.
 const exists=await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='document_revisions'").first();
 const row=exists?await db.prepare('SELECT payload,created_at FROM document_revisions WHERE project_id=? AND revision=?').bind(id,revision).first():null;
 if(!row)throw new CopyError('指定した保存版が見つかりません',404,'COPY_SOURCE_MISSING');
 if(row.payload.length>250000)throw new CopyError('元の保存内容が大きすぎます。元データは変更していません');
 let payload;try{payload=JSON.parse(row.payload);}catch{throw new CopyError('元の保存内容を読み取れません。修復や上書きはしていません');}
 if(!payload||!Object.hasOwn(departments,payload.department)||typeof payload.topic!=='string'||!payload.topic.trim()||payload.topic.length>160||typeof payload.output!=='string'||payload.output.length>70000||(payload.evidence!==undefined&&typeof payload.evidence!=='string')||(payload.evidence?.length||0)>3500)throw new CopyError('元の保存形式を安全に複製できません。元データは変更していません');
 return {raw:row.payload,payload:{...payload,evidence:payload.evidence??''},source:{projectId:id,revision,digest:await digest(row.payload),savedAt:row.created_at}};
}
export async function previewDocumentCopy(db,id,revision){
 const {payload,source}=await copySource(db,id,revision);
 return {source,document:{...payload,projectId:id,revision},notice:'保存済みの版です。編集中の変更は含みません。確認後、別案件に複製します。元の案件・履歴・全文確認記録を変更しません'};
}
function copiedPayload(original,source,target){
 const payload=structuredClone(original);payload.approved=false;
 for(const key of ['audience','notes','format'])if(payload[key]===undefined)payload[key]='';
 for(const key of ['approvedAt','reviewedAt','humanReview','projectId','revision','updated_at','legacy'])delete payload[key];
 let generation=payload.generation&&typeof payload.generation==='object'&&!Array.isArray(payload.generation)?structuredClone(payload.generation):null;
 if(payload.format==='note有料記事'){
  // Recompute paid structural state but retain the historical body byte-for-byte.
  const prepared=preparePaidDraft({text:payload.output,evidence:payload.evidence,topic:payload.topic,audience:payload.audience,notes:payload.notes,generation,approved:false,manualComplete:generation?.articleStatus==='manual_complete'},target);
  generation=prepared.generation;
 }
 if(generation){
  delete generation.approved;delete generation.approvedAt;delete generation.reviewedAt;delete generation.humanReview;
  generation.document={projectId:target,revision:1};
  if(generation.project){generation.project.id=target;generation.project.humanReview={status:'pending'};}
 }
 payload.generation=generation;payload.copiedFrom={projectId:source.projectId,revision:source.revision,digest:source.digest};
 return payload;
}
export async function copyDocument(db,{sourceProjectId,sourceRevision,preparedDigest,targetProjectId,confirmed}){
 const sourceId=copyId(sourceProjectId),target=copyId(targetProjectId);
 if(sourceId===target||confirmed!==true)throw new CopyError('元の案件とは異なるIDと、保存版の内容確認が必要です');
 const source=await copySource(db,sourceId,sourceRevision);
 if(typeof preparedDigest!=='string'||preparedDigest!==source.source.digest)throw new CopyError('複製前のプレビューを確認し直してください',409,'COPY_SOURCE_CHANGED');
 const payload=copiedPayload(source.payload,source.source,target),serialized=JSON.stringify(payload);
 const readExisting=async()=>db.prepare('SELECT revision,payload FROM document_revisions WHERE project_id=? ORDER BY revision DESC LIMIT 1').bind(target).first();
 const existing=await readExisting();
 const legacyTable=await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='paid_content_drafts'").first();
 if(legacyTable&&await db.prepare('SELECT id FROM paid_content_drafts WHERE id=?').bind(target).first()&&!existing)throw new CopyError('複製先に旧形式の有料原稿があります。上書きを停止しました',409,'COPY_TARGET_EXISTS');
 if(existing){if(existing.revision===1&&existing.payload===serialized)return {document:{...payload,projectId:target,revision:1},alreadyCopied:true,notice:'同じ複製は保存済みです。元の案件と確認記録は変更していません'};throw new CopyError('複製先の案件が既に存在するか更新されています。別のIDを用意してください',409,'COPY_TARGET_EXISTS');}
 await initDocuments(db);
 const paid=payload.format==='note有料記事';
 if(paid)await db.prepare('CREATE TABLE IF NOT EXISTS paid_content_drafts (id TEXT PRIMARY KEY, topic TEXT NOT NULL, output TEXT NOT NULL, generation_json TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)').run();
 try{
  await saveRevision(db,target,0,payload,paid?write=>db.prepare('INSERT INTO paid_content_drafts(id,topic,output,generation_json) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM document_revisions WHERE write_id=?)').bind(target,payload.topic,payload.output,JSON.stringify(payload.generation),write):null,{sql:'EXISTS(SELECT 1 FROM document_revisions WHERE project_id=? AND revision=? AND payload=?) AND NOT EXISTS(SELECT 1 FROM document_revisions WHERE project_id=?)'+(legacyTable||paid?' AND NOT EXISTS(SELECT 1 FROM paid_content_drafts WHERE id=?)':''),args:[sourceId,sourceRevision,source.raw,target,...(legacyTable||paid?[target]:[])]});
 }catch(e){
  const saved=await readExisting();if(saved?.revision===1&&saved.payload===serialized)return {document:{...payload,projectId:target,revision:1},alreadyCopied:true,notice:'同じ複製は保存済みです。再送による追加保存はしていません'};
  throw new CopyError('競合または保存失敗のため複製できませんでした。元の案件は変更していません',409,'COPY_CONFLICT');
 }
 return {document:{...payload,projectId:target,revision:1},alreadyCopied:false,notice:'別案件の版1として保存しました。元の案件・全履歴・公開記録は変更していません。全文確認をやり直してください'};
}
