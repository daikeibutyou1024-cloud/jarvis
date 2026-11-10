import {responseJSON as json} from '../../../lib/research-network.js';
import {scheduleConfig,runDueCollection,ScheduleError} from '../../../lib/schedules.js';
export async function onRequestPost({request,env}){
 try{
  const config=scheduleConfig(env);
  // A separate server-only credential is required; the browser access password cannot invoke a tick.
  if(!config.hasToken)return json({error:'定期実行用の認証が未設定です'},503);
  if(request.headers.get('Authorization')!=='Bearer '+env.JARVIS_SCHEDULER_TOKEN)return json({error:'認証が必要です'},401);
  if(!config.enabled)return json({error:'定期収集は全体停止中です'},503);
  const raw=await request.text();if(raw.length>1000)return json({error:'要求が大きすぎます'},400);
  if(raw.trim()&&raw.trim()!=='{}')return json({error:'実行対象やURLは指定できません'},400);
  return json(await runDueCollection(env));
 }catch(e){return json({error:e instanceof ScheduleError?e.message:'定期収集を開始できませんでした'},e instanceof ScheduleError?e.status:503);}
}
