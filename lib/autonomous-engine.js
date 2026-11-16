// Runtime-neutral orchestration. No DOM, localStorage, D1, timers, fetch or provider SDKs.
export const ENGINE_STAGES=['research','content','marketing','analytics','finance','approval'];
export async function executeAutonomousJob({id,trigger='manual',ports}){
 if(trigger!=='manual')throw Error('定期起動は無効です。スケジューラーは未接続です');
 if(ports?.ai?.kind!=='preview-mock')throw Error('実AI接続は無効です。Previewモックだけ利用できます');
 if(!id||typeof ports.exclusive!=='function')throw Error('ジョブIDと排他実行アダプターが必要です');
 return ports.exclusive(async acquired=>{
  if(!acquired)throw Error('別の実行元でジョブを実行中です');
  let stage='start',job;
  try{
   const previous=await ports.jobs.get(id);
   job=await ports.jobs.update(id,{state:'running',error:null,attempt:(previous?.attempt||0)+1,stages:previous?.stages||[]});
   let pack=await ports.packs.get(id);
   if(!pack){
    stage='research';await ports.notify(stage);
    const data=previous?.sourceData||await ports.research.collect();
    if(data?.status!=='acquired'||!data.items?.length)throw Error(data?.error||'公開情報を取得できません');
    await ports.jobs.update(id,{sourceData:{status:'acquired',items:[data.items[0]]},stages:['research']});
    const duplicate=await ports.packs.findSource(data.items[0]);
    if(duplicate){await ports.jobs.update(id,{state:'duplicate',packId:duplicate.projectId});return {state:'duplicate',pack:duplicate};}
    stage='content';await ports.notify(stage);pack=await ports.ai.build(data,id);
    if(pack.projectId!==id||!pack.mock||pack.approvedAt||pack.source?.reviewedAt)throw Error('生成結果の案件ID・未確認状態が不正です');
    await ports.jobs.update(id,{stages:['research','content']});
    stage='marketing';await ports.notify(stage);if(!pack.x?.trim()||!pack.instagram?.trim())throw Error('SNS案が未完成です');
    await ports.jobs.update(id,{stages:['research','content','marketing']});
    pack={...pack,revision:0,jobState:'awaiting_approval'};
    pack=await ports.packs.put(pack,0);
   }
   stage='analytics';await ports.notify(stage);const snapshot=await ports.records.snapshot();
   await ports.jobs.update(id,{stages:['research','content','marketing','analytics']});
   stage='finance';await ports.notify(stage);const summary=await ports.analysis.summarize(snapshot,pack.projectId);
   stage='approval';await ports.notify(stage);
   const state=pack.approvedAt?'approved':pack.jobState||'awaiting_approval';
   await ports.jobs.update(id,{state,packId:pack.projectId,stages:ENGINE_STAGES,summary});
   return {state,pack};
  }catch(error){if(job)await ports.jobs.update(id,{state:'failed',error:stage+'：'+String(error.message||'処理に失敗しました').slice(0,500)});error.stage=stage;error.jobId=id;throw error;}
 });
}
// Future entry points are descriptors only, never activation or API clients.
export function schedulerDescriptor(id){return {id,trigger:'scheduler',enabled:false};}
export function cloudPersistenceAdapter(){throw Error('クラウド永続化は未接続です。Preview専用スキーマ・移行計画の承認が必要です');}
export function publicationDescriptor({projectId,revision,approvedAt}){
 if(!projectId||!Number.isSafeInteger(revision)||revision<1||!approvedAt)throw Error('本人が承認した特定版が必要です');
 return {projectId,revision,approvalAt:approvedAt,idempotencyKey:`${projectId}:${revision}`,enabled:false,requiresContentDigest:true,requiresCancellation:true};
}
