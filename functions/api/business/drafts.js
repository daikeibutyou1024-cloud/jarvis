import { denied, responseJSON as json } from '../../../lib/research-network.js';
import { projectId, saveRevision, documentList, initDocuments, revisionOf, seedLegacyPaid } from '../../../lib/documents.js';
import { departments } from '../../../assets/business.js';
export async function onRequestGet({request,env}) {
 const auth=denied(request,env); if(auth)return auth;
 try {
  const url=new URL(request.url),id=url.searchParams.get('projectId');
  if(!id)return json({drafts:await documentList(env.JARVIS_DB)});
  projectId(id); await initDocuments(env.JARVIS_DB);
  const rows=await env.JARVIS_DB.prepare('SELECT * FROM document_revisions WHERE project_id=? ORDER BY revision DESC LIMIT 100').bind(id).all();
  return json({revisions:rows.results.map(r=>({...JSON.parse(r.payload),projectId:r.project_id,revision:r.revision,updated_at:r.created_at}))});
 } catch {return json({error:'版履歴を取得できませんでした'},503);}
}
export async function onRequestPost({request,env}) {
 const auth=denied(request,env); if(auth)return auth;
 try {
  const text=await request.text(); if(text.length>250000)throw Error();
  const b=JSON.parse(text),id=projectId(b.projectId);
  if(!Object.hasOwn(departments,b.department)||typeof b.topic!=='string'||!b.topic.trim()||b.topic.length>160||typeof b.text!=='string'||!b.text.trim()||b.text.length>60000||typeof b.evidence!=='string'||b.evidence.length>3500)throw Error();
  // Paid drafts must use their server-side structural revalidation endpoint.
  if(b.generation?.project || b.format==='note有料記事' || b.generation?.format==='note有料記事') return json({error:'有料記事は有料原稿の保存を利用してください'},400);
  await seedLegacyPaid(env.JARVIS_DB,id);
  await revisionOf(env.JARVIS_DB,id);
  const old=await env.JARVIS_DB.prepare('SELECT payload FROM document_revisions WHERE project_id=? ORDER BY revision DESC LIMIT 1').bind(id).first();
  if(old && JSON.parse(old.payload).format==='note有料記事')return json({error:'有料原稿は専用の保存で更新してください'},400);
  const version=await saveRevision(env.JARVIS_DB,id,b.expectedRevision??0,{department:b.department,topic:b.topic,output:b.text,evidence:b.evidence,format:String(b.format||'').slice(0,80),generation:b.generation||null,approved:false});
  return json(version,201);
 }catch(e){return json({error:e.code==='SAVE_CONFLICT'?e.message:'保存する原稿の形式またはDB設定を確認してください',code:e.code,currentRevision:e.currentRevision},e.status||400);}
}
