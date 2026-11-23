import {previewHost,validSession} from '../../../lib/preview-session.js';
import {onRequest as tickerRequest} from './bitbank-ticker-preview.js';
import {fetchMarket} from '../../../lib/bitbank-public.js';
import {fetchNews} from '../../../lib/btc-news.js';
import {buildMarketReport} from '../../../lib/btc-market-report.js';
let cached=null,pending=null;
const json=(d,status=200)=>Response.json(d,{status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});
export async function onRequest({request,env}){
 if(!previewHost(request,env))return json({error:'対象Previewのみ利用できます'},403);
 if(!await validSession(request,env))return json({error:'認証が必要です'},401);
 if(request.method!=='GET'||new URL(request.url).search)return json({error:'固定の公開市場レポートを参照する操作のみです'},405);
 const now=Date.now();if(cached&&now-cached.generatedAt<60000&&(!cached.ticker||now-cached.ticker.sourceAt<=60000))return json(cached);
 if(!pending)pending=(async()=>{const [t,m,n]=await Promise.allSettled([tickerRequest({request:new Request(new URL('/api/business/bitbank-ticker-preview',request.url),{headers:request.headers}),env}).then(async r=>{const body=await r.json();if(!r.ok){const error=Error('現在価格未取得');error.diagnostic=body.diagnostic;throw error;}return body;}),fetchMarket('year',now,'bitbank'),fetchNews(now)]);const diagnostics=[],errors=[];for(const [source,x]of [['bitbank-ticker',t],['bitbank-candles',m]])if(x.status==='rejected'){const e=x.reason?.diagnostic||x.reason;diagnostics.push({sourceId:source,code:typeof e?.code==='string'&&/^[A-Z_]{1,40}$/.test(e.code)?e.code:'FETCH_FAILED',stage:typeof e?.stage==='string'&&/^[a-z_]{1,32}$/.test(e.stage)?e.stage:'fetch',...(Number.isInteger(e?.httpStatus)?{httpStatus:e.httpStatus}:{})});}if(t.status==='rejected')errors.push('現在価格を取得できません。');if(m.status==='rejected')errors.push('日足を取得できません。確率・購入判断は保留します。');const report=buildMarketReport({ticker:t.status==='fulfilled'?t.value:null,market:m.status==='fulfilled'?m.value:null,news:n.status==='fulfilled'?n.value:[],now:Date.now(),errors,diagnostics,computeForecasts:false});cached=report;return report;})().finally(()=>{pending=null;});
 try{return json(await pending);}catch{return json({error:'公開市場レポートを作成できません。自動再試行しません。'},503);}
}
