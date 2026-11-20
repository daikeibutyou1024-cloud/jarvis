import {previewHost,validSession} from '../../../lib/preview-session.js';
import {publicJSON} from '../../../lib/bitbank-public.js';
import {tickerValue} from '../../../lib/bitbank-ticker.js';
import {MarketError,marketFailure} from '../../../lib/market-error.js';
let cached=null;
const json=(data,status=200)=>Response.json(data,{status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});
export async function onRequest({request,env}){
 if(!previewHost(request,env))return json({error:'対象Previewのみです'},403);
 if(!await validSession(request,env))return json({error:'認証が必要です'},401);
 if(request.method!=='GET')return json({error:'公開価格の参照専用です'},405);
 if(new URL(request.url).search)return json({error:'固定のBTC/JPY価格だけ取得できます'},400);
 const now=Date.now();if(cached&&now-cached.fetchedAt<5000&&now-cached.sourceAt<60000)return json(cached);
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),5000),context={sourceId:'bitbank',endpoint:'https://public.bitbank.cc/btc_jpy/ticker',stage:'fetch'};
 try{
  let r;try{r=await fetch(context.endpoint,{method:'GET',redirect:'manual',headers:{accept:'application/json'},signal:controller.signal,cf:{cacheTtl:5,cacheEverything:true}});}catch{throw new MarketError(controller.signal.aborted?'TIMEOUT':'NETWORK','bitbank現在価格の通信に失敗しました。',context);}
  const c={...context,stage:'response',httpStatus:r.status};if(r.status>=300&&r.status<400)throw new MarketError('REDIRECT_BLOCKED','現在価格のredirectを拒否しました。',c);if(!r.ok)throw new MarketError('UPSTREAM_HTTP','bitbank現在価格のHTTPエラーです。',c);
  const body=await publicJSON(r,32768,{...c,stage:'json'});cached=tickerValue(body,Date.now());return json(cached);
 }catch(e){return json(marketFailure(e instanceof MarketError?e:new MarketError(controller.signal.aborted?'TIMEOUT':'READ_FAILURE','現在価格の応答を確認できませんでした。',context)),503);}finally{clearTimeout(timer);}
}
