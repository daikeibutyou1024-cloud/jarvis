import {denied,responseJSON as json} from '../../../lib/research-network.js';
import {BusinessError} from '../../../lib/business-records.js';
import {monthlyReport} from '../../../lib/monthly-report.js';
export async function onRequestGet({request,env}){
 const auth=denied(request,env);if(auth)return auth;
 try{const u=new URL(request.url);return json(await monthlyReport(env.JARVIS_DB,u.searchParams.get('period'),u.searchParams.get('after')));}
 catch(e){return json({error:e instanceof BusinessError?e.message:'月次の記録を集計できませんでした。入力済みデータは変更していません'},e instanceof BusinessError?400:503);}
}
