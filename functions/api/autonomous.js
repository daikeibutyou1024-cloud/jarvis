import {workspaceHost,workspaceTarget} from '../../lib/workspace-target.js';
import {CLOUD_STORAGE_ENABLED,CLOUD_STORAGE_DISABLED_REASON} from '../../config/cloud-storage.js';
import {validSession} from '../../lib/preview-session.js';
import {cloudStore,ownerScope,rejectSecrets,identifier,fault} from '../../lib/cloud-store.js';
import {candidateResponse} from './research/collect.js';
const json=(data,status=200)=>Response.json(data,{status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});
async function boundedJSON(request){
 if(!request.headers.get('content-type')?.startsWith('application/json'))throw fault('JSON形式で操作してください',415);
 const reader=request.body?.getReader();if(!reader)throw fault('操作内容がありません');let size=0,text='',decoder=new TextDecoder();
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>256000){await reader.cancel();throw fault('リクエスト上限を超えています',413);}text+=decoder.decode(value,{stream:true});}text+=decoder.decode();return JSON.parse(text);}catch(e){if(e.status)throw e;throw fault('操作内容の形式が不正です');}finally{reader.releaseLock();}
}
// Factory injects mock collection/storage only for offline tests. The routed export always
// uses the committed switch; branch/host checks always reject Production.
export function createCloudHandler({enabled=CLOUD_STORAGE_ENABLED,collect=({request})=>candidateResponse(request,'ollama','AI'),clock,allowMockRun=false}={}){
 return async function({request,env}){
  if(!workspaceHost(request,env))return json({error:'対象環境では利用できません'},403);
  if(!await validSession(request,env))return json({error:'ログインが必要です'},401);
  const u=new URL(request.url),origin=request.headers.get('origin'),site=request.headers.get('sec-fetch-site');
  if((origin&&origin!==u.origin)||(site&&!['same-origin','none'].includes(site))||(request.method!=='GET'&&origin!==u.origin))return json({error:'同一オリジンから操作してください'},403);
  if(!['GET','POST'].includes(request.method))return json({error:'許可されていない操作です'},405);
  if(!enabled)return json({enabled:false,reason:CLOUD_STORAGE_DISABLED_REASON});
  try{
   if(!env.CF_PAGES_URL||!workspaceHost(new Request(env.CF_PAGES_URL),env)||env.PREVIEW_MOCK_AUTOMATION_ENABLED!=='false')throw fault('実行環境・停止フラグを確認できません',503);
   const store=cloudStore(env.JARVIS_DB,await ownerScope(env),{...(clock?{now:clock}:{})});await store.binding(workspaceTarget(request,env));
   if(request.method==='GET'){if(u.searchParams.size){if([...u.searchParams.keys()].some(k=>!['projectId','history','revision'].includes(k)))throw fault('取得項目が不正です');const id=identifier(u.searchParams.get('projectId'));if(u.searchParams.get('history')==='1'&&!u.searchParams.has('revision'))return json({enabled:true,history:await store.history(id)});if(u.searchParams.has('revision')&&!u.searchParams.has('history'))return json({enabled:true,pack:await store.version(id,Number(u.searchParams.get('revision')))});throw fault('取得方法が不正です');}return json({enabled:true,...await store.snapshot()});}
   const body=await boundedJSON(request);if(!body||Array.isArray(body)||typeof body!=='object')throw fault('操作内容が不正です');
   const fields=body.op==='run'?['op','id']:['op','id','mutationId','expectedRevision','action','article','x','instagram','instruction','sourceChecked','contentChecked'];
   if(Object.keys(body).some(k=>!fields.includes(k))||!['run','save'].includes(body.op))throw fault('未対応の操作・項目があります');
   identifier(body.id);rejectSecrets(body,env);
   if(workspaceTarget(request,env)?.kind==='production'&&!allowMockRun&&(body.op==='run'||body.action==='revise'))throw fault('本番ではモック生成・自動修正を実行しません。手動編集と保存を利用してください',403);
   let result;
   if(body.op==='run'){
    result=await store.run(body.id,async()=>{
     const response=await collect({request:new Request(u.origin+'/api/research/collect?source=ollama&q=AI'),env});
     if(!response.ok)throw fault('公開情報を取得できません。再試行前に保存状態を確認してください',503);
     const data=await response.json();rejectSecrets(data,env);return data;
    });
   }else{identifier(body.mutationId);result={state:'saved',pack:await store.edit(body)};}
   return json({enabled:true,...result,...await store.snapshot()});
  }catch(e){return json({error:e.status?e.message:'クラウド処理に失敗しました。保存済みの内容を再取得し、結果を確認してください。端末データは削除しません。'},e.status||503);}
 };
}
export const onRequest=createCloudHandler();
