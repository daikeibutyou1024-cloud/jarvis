import {marketFailure} from '../../../lib/market-error.js';
import {previewHost,validSession} from '../../../lib/preview-session.js';
import {MARKET_SOURCES,fetchMarket} from '../../../lib/bitbank-public.js';
import {PERIODS} from '../../../lib/bitbank-market.js';
const cache=new Map(),json=(body,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});
export async function onRequest({request,env}){
 if(!previewHost(request,env))return json({error:'対象Previewのみ利用できます'},403);
 if(!await validSession(request,env))return json({error:'認証が必要です'},401);
 if(request.method!=='GET')return json({error:'公開相場の参照専用です'},405);
 const u=new URL(request.url),period=u.searchParams.get('period'),sourceId=u.searchParams.get('source')||'bitbank';if(!Object.hasOwn(PERIODS,period)||[...u.searchParams.keys()].some(k=>!['period','source'].includes(k))||u.searchParams.getAll('period').length!==1||u.searchParams.getAll('source').length>1||!Object.hasOwn(MARKET_SOURCES,sourceId))return json({error:'表示期間が不正です'},400);
 const key=sourceId+':'+period;
 try{let data=cache.get(key);if(!data||Date.now()-data.fetchedAt>=60000){data=await fetchMarket(period,Date.now(),sourceId);cache.set(key,data);}return json(data);}catch(error){return json(marketFailure(error),503);}
}
