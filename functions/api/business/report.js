import {denied,responseJSON as json} from '../../../lib/research-network.js';
import {operationalReport,japanDay} from '../../../lib/operational-report.js';
export async function onRequestGet({request,env}){
 const auth=denied(request,env);if(auth)return auth;
 let date;
 try{date=japanDay(new URL(request.url).searchParams.get('date')||undefined).date;}catch{return json({error:'実在する日付をYYYY-MM-DD形式で指定してください'},400);}
 try{return json(await operationalReport(env.JARVIS_DB,date));}catch{return json({error:'運用レポートを取得できませんでした'},503);}
}
