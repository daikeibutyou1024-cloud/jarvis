import {previewHost,validSession} from '../../../lib/preview-session.js';
import {fetchMarket} from '../../../lib/bitbank-public.js';
import {PERIODS} from '../../../lib/bitbank-market.js';
const cache=new Map(),json=(body,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});
export async function onRequest({request,env}){
 if(!previewHost(request,env))return json({error:'対象Previewのみ利用できます'},403);
 if(!await validSession(request,env))return json({error:'認証が必要です'},401);
 if(request.method!=='GET')return json({error:'公開相場の参照専用です'},405);
 const u=new URL(request.url),period=u.searchParams.get('period');if(!Object.hasOwn(PERIODS,period)||[...u.searchParams.keys()].some(k=>k!=='period')||u.searchParams.getAll('period').length!==1)return json({error:'表示期間が不正です'},400);
 try{let data=cache.get(period);if(!data||Date.now()-data.fetchedAt>=60000){data=await fetchMarket(period);cache.set(period,data);}return json(data);}catch{return json({error:'公開相場を取得できません。判定を保留しました。自動再試行しません。',kind:'保留'},503);}
}
