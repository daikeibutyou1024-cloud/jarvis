import {emptyOffice} from './virtual-office.js';
export async function loadOffice(db){const row=await db.prepare("SELECT body_json FROM vo_workspace WHERE id='office'").first();if(!row)throw Object.assign(Error('Preview専用SQLの適用・初期行を確認してください。'),{status:503});return JSON.parse(row.body_json);}
export async function saveOffice(db,previous,next,commandId){
 if(next.version===previous.version)return previous;
 if(new TextEncoder().encode(JSON.stringify(next)).length>1000000)throw Object.assign(Error('オフィス保存量が上限に達しました。既存履歴を保持して追加を停止します。'),{status:413});
 const guard=" EXISTS(SELECT 1 FROM vo_workspace WHERE id='office' AND version=? AND last_command=?)";
 const ss=[db.prepare("UPDATE vo_workspace SET version=?,last_command=?,body_json=? WHERE id='office' AND version=?").bind(next.version,commandId,JSON.stringify(next),previous.version)];
 const upsert=(table,columns,values,pk='id')=>ss.push(db.prepare(`INSERT INTO ${table}(${columns.join(',')}) SELECT ${columns.map(()=>'?').join(',')} WHERE ${guard} ON CONFLICT(${pk}) DO UPDATE SET ${columns.filter(c=>c!==pk).map(c=>`${c}=excluded.${c}`).join(',')}`).bind(...values,next.version,commandId));
 for(const a of next.agents.filter(a=>JSON.stringify(a)!==JSON.stringify(previous.agents.find(x=>x.id===a.id))))upsert('vo_agents',['id','name','role','enabled','budget_limit','version','body_json'],[a.id,a.name,a.role,a.enabled?1:0,a.budgetMicroUSD,a.version,JSON.stringify(a)]);
 for(const t of next.tasks.filter(t=>JSON.stringify(t)!==JSON.stringify(previous.tasks.find(x=>x.id===t.id))))upsert('vo_tasks',['id','agent_id','status','version','last_command','objective','input_json','output_json','body_json','created_at','updated_at'],[t.id,t.agentId,t.status,t.version,t.commands.at(-1)?.id||commandId,t.objective,JSON.stringify(t.input),JSON.stringify({text:t.output,source:t.source}),JSON.stringify(t),t.createdAt,t.updatedAt]);
 for(const a of next.approvals.filter(a=>JSON.stringify(a)!==JSON.stringify(previous.approvals.find(x=>x.id===a.id))))upsert('vo_approvals',['id','task_id','action','status','task_version','reviewer','body_json','created_at'],[a.id,a.taskId,a.action,a.status,a.taskVersion,a.reviewer||null,JSON.stringify(a),a.createdAt]);
 for(const r of next.runs.filter(r=>JSON.stringify(r)!==JSON.stringify(previous.runs.find(x=>x.id===r.id))))upsert('vo_runs',['id','task_id','agent_id','status','operation_id','model','estimated_cost','body_json','created_at'],[r.id,r.taskId,r.agentId,r.status,r.operationId||null,r.model||null,r.costMicroUSD||r.reservedMicroUSD||0,JSON.stringify(r),r.createdAt]);
 for(const m of next.metrics.filter(m=>!previous.metrics.some(x=>x.id===m.id)))upsert('vo_metrics',['id','task_id','metric','value','source','body_json','observed_at'],[m.id,m.taskId,m.metric,m.yen,m.source,JSON.stringify(m),m.observedAt]);
 const result=await db.batch(ss);if(!result[0].meta?.changes)throw Object.assign(Error('別の画面で更新されました。再読込してください。'),{status:409});
 return next;
}
export {emptyOffice};
