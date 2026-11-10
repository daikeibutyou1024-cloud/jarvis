import {denied,responseJSON as json} from '../../../lib/research-network.js';
import {latestDocument,checkRevision,projectId} from '../../../lib/documents.js';
import {initEditorialData,editorialDigest,editorialSummary} from './editorial.js';
import {exportArticle} from '../../../lib/editorial.js';
import {referenceUrl} from '../../../assets/research-data.js';
import {japanDay} from '../../../lib/calendar.js';
import {BusinessError,saveBusinessRecord,currentRecord,fingerprint} from '../../../lib/business-records.js';
export async function onRequestPost({request,env}){
 const auth=denied(request,env);if(auth)return auth;
 try{
  const raw=await request.text();if(raw.length>10000)throw new BusinessError('要求が大きすぎます');const b=JSON.parse(raw),db=env.JARVIS_DB;
  if(['void','restore'].includes(b.action)){
   const old=await currentRecord(db,b.id);if(!old||old.kind!=='publication')throw new BusinessError('公開記録が見つかりません');
   const result=await saveBusinessRecord(db,{id:old.id,kind:old.kind,projectId:old.project_id,payload:old.payload},b.expectedVersion,b.action==='void'?'void':'active');
   return json({...result,notice:'公開記録の状態だけを変更しました。外部投稿の削除・復元は行っていません'});
  }
  if(!['package','record'].includes(b.action))throw new BusinessError('操作が不正です');
  const caseId=projectId(b.projectId);await initEditorialData(db);await checkRevision(db,caseId,b.expectedRevision);
  const doc=await latestDocument(db,caseId);if(!doc)throw new BusinessError('制作案件が見つかりません',404);
  const review=await editorialSummary(db,doc);if(!review.approved)throw new BusinessError('現在の保存版の全文確認が必要です',409);
  const hash=await editorialDigest(doc);
  if(b.action==='package'){
   await checkRevision(db,caseId,doc.revision);
   return json({projectId:caseId,revision:doc.revision,title:doc.topic,digest:hash,...exportArticle(doc),teaserDraft:`${doc.topic}\n${doc.audience}向けに、${doc.workflow.idea}\n本文：[確認した公開URLを入力]`,teaserStatus:'unreviewed',notice:'確認済み記事と集客案の準備です。集客案は別途確認が必要です。外部投稿・販売・価格設定は行っていません'});
  }
  if(b.preparedDigest!==hash)throw new BusinessError('公開準備と現在の保存版が一致しません。再確認してください',409);
  if(b.publishedManually!==true||b.checks?.account!==true||b.checks?.terms!==true||b.checks?.content!==true)throw new BusinessError('利用者自身による公開と、アカウント・利用条件・公開内容の確認が必要です');
  if(!['note','x','instagram','tiktok','other'].includes(b.channel))throw new BusinessError('公開先を選択してください');
  const url=referenceUrl(b.url);if(!url)throw new BusinessError('公開URLは安全なHTTPS URLで入力してください');
  let date;try{if(!b.date)throw Error();date=japanDay(b.date).date;}catch{throw new BusinessError('公開した日付を指定してください');}
  const recordId='pub-'+(await fingerprint(JSON.stringify([caseId,doc.revision,b.channel,url]))).slice(0,48);
  const payload={kind:'publication',projectId:caseId,revision:doc.revision,title:doc.topic,digest:hash,channel:b.channel,url,date,source:'user_reported',externalVerified:false};
  const existing=await currentRecord(db,recordId);
  if(existing&&existing.state==='active'&&existing.payload_json===JSON.stringify(payload))return json({id:recordId,version:existing.version,alreadyRecorded:true,externalVerified:false});
  const guard={sql:'(SELECT MAX(revision) FROM document_revisions WHERE project_id=?)=? AND EXISTS(SELECT 1 FROM editorial_reviews WHERE project_id=? AND revision=? AND digest=?)',args:[caseId,doc.revision,caseId,doc.revision,hash]};
  const result=await saveBusinessRecord(db,{id:recordId,kind:'publication',projectId:caseId,payload},0,'active',guard);
  return json({...result,externalVerified:false,notice:'利用者の申告として公開を記録しました。外部での公開状態は取得していません'},201);
 }catch(e){return json({error:e instanceof BusinessError||e.code==='SAVE_CONFLICT'?e.message:'公開準備・記録を完了できませんでした',code:e.code},e.status||400);}
}
