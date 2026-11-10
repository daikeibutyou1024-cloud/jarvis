import {denied,responseJSON as json} from '../../../lib/research-network.js';
import {BusinessError,initBusiness,normalizeRecord,saveBusinessRecord,importBusinessRecords,businessSummary,currentRecord,id,project,period} from '../../../lib/business-records.js';
export async function onRequestGet({request,env}){
 const auth=denied(request,env);if(auth)return auth;
 try{
  const url=new URL(request.url),db=env.JARVIS_DB;await initBusiness(db);
  if(url.searchParams.get('summary')==='1')return json(await businessSummary(db,{projectId:url.searchParams.get('projectId')||'',period:url.searchParams.get('period')||''}));
  if(url.searchParams.has('id')){
   const record=await currentRecord(db,id(url.searchParams.get('id')));if(!record)return json({error:'記録が見つかりません'},404);
   const history=(await db.prepare('SELECT * FROM business_record_history WHERE record_id=? ORDER BY version DESC LIMIT 100').bind(record.id).all()).results.map(({payload_json,...r})=>({...r,payload:JSON.parse(payload_json)}));
   return json({record,history,notice:'履歴は最新100版を表示。過去の保存内容は削除しません'});
  }
  const where=['rowid<?'],args=[];const before=url.searchParams.get('before');
  if(before!==null&&(!/^\d+$/.test(before)||!Number.isSafeInteger(Number(before))))throw new BusinessError('ページ指定が不正です');args.push(before===null?Number.MAX_SAFE_INTEGER:Number(before));
  const kind=url.searchParams.get('kind');if(kind){if(!['finance','metrics','publication'].includes(kind))throw new BusinessError('記録種別が不正です');where.push('kind=?');args.push(kind);}
  const projectId=url.searchParams.get('projectId');if(projectId){project(projectId);where.push('project_id=?');args.push(projectId);}
  const month=url.searchParams.get('period');if(month){period(month);where.push("COALESCE(json_extract(payload_json,'$.period'),substr(json_extract(payload_json,'$.date'),1,7))=?");args.push(month);}
  const rows=(await db.prepare(`SELECT *,rowid AS cursor FROM business_records WHERE ${where.join(' AND ')} ORDER BY rowid DESC LIMIT 51`).bind(...args).all()).results;
  const records=rows.slice(0,50).map(({payload_json,...r})=>({...r,payload:JSON.parse(payload_json)}));return json({records,nextCursor:rows.length>50?records.at(-1).cursor:null,source:'user_provided',notice:'入力済み記録です。外部サービスの実績を取得した記録ではありません'});
 }catch(e){return json({error:e instanceof BusinessError?e.message:'記録を読み込めませんでした'},e instanceof BusinessError?e.status:503);}
}
export async function onRequestPost({request,env}){
 const auth=denied(request,env);if(auth)return auth;
 try{
  const raw=await request.text();if(raw.length>100000)throw new BusinessError('コピーするデータが大きすぎます');const b=JSON.parse(raw),db=env.JARVIS_DB;
  if(b.action==='save'){const record=await normalizeRecord(b);return json(await saveBusinessRecord(db,record,b.expectedVersion),201);}
  if(b.action==='import')return json(await importBusinessRecords(db,b.rows,b.source),201);
  if(['void','restore'].includes(b.action)){
   const old=await currentRecord(db,b.id);if(!old||!['finance','metrics'].includes(old.kind))throw new BusinessError('取消対象の収支・計測記録が見つかりません');
   return json(await saveBusinessRecord(db,{id:old.id,kind:old.kind,projectId:old.project_id,payload:old.payload},b.expectedVersion,b.action==='void'?'void':'active'));
  }
  throw new BusinessError('操作が不正です');
 }catch(e){return json({error:e instanceof BusinessError?e.message:'入力形式と保存設定を確認してください',code:e instanceof BusinessError?e.code:undefined},e instanceof BusinessError?e.status:400);}
}
