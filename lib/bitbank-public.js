import {marketPlan,normalizeCandles,analyzeMarket} from './bitbank-market.js';
import {MarketError} from './market-error.js';
export const MARKET_SOURCES={bitbank:{name:'bitbank公式公開API',host:'public.bitbank.cc'},gmo:{name:'GMOコイン公式公開API（別取引所・bitbank価格ではありません）',host:'api.coin.z.com'}};
async function bodyJSON(r,max,context){
 if(!r.body)throw new MarketError('EMPTY_BODY','公開APIの応答本文がありません。',context);
 const type=(r.headers.get('content-type')||'').toLowerCase();if(!/(?:application\/(?:[\w.-]+\+)?json|text\/plain)/.test(type))throw new MarketError('CONTENT_TYPE','公開APIがJSONを返していません。アクセス制限画面などの可能性があります。',{...context,contentType:type.slice(0,80)});
 const reader=r.body.getReader(),chunks=[];let size=0;for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();throw new MarketError('BODY_LIMIT','公開APIの応答サイズが上限を超えました。',context);}chunks.push(value);}
 const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
 try{return JSON.parse(new TextDecoder().decode(bytes));}catch{throw new MarketError('INVALID_JSON','公開APIのJSONを読み取れません。',context);}
}
function providerCode(data,source){const c=source==='bitbank'?data?.data?.code:data?.messages?.[0]?.message_code;return typeof c==='number'&&Number.isSafeInteger(c)?c:typeof c==='string'&&/^[A-Z0-9_-]{1,30}$/.test(c)?c:undefined;}
export async function fetchMarket(period,now=Date.now(),sourceId='bitbank'){
 if(!Object.hasOwn(MARKET_SOURCES,sourceId))throw new MarketError('SOURCE','取得元が不正です。');
 const plan=marketPlan(period,now,sourceId),rows=[],requests=[],source=MARKET_SOURCES[sourceId];let context={sourceId,stage:'plan'};
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
 try{for(const part of plan.parts){
  const url=sourceId==='bitbank'?`https://${source.host}/btc_jpy/candlestick/${plan.type}/${part}`:`https://${source.host}/public/v1/klines?symbol=BTC&interval=${plan.type}&date=${part}`;
  context={sourceId,stage:'fetch',endpoint:url,partition:part};let r;
  try{r=await fetch(url,{method:'GET',redirect:'error',headers:{accept:'application/json'},signal:controller.signal,cf:{cacheTtl:60,cacheEverything:true}});}catch{throw new MarketError(controller.signal.aborted?'TIMEOUT':'NETWORK',controller.signal.aborted?'公開API取得が10秒でタイムアウトしました。':'公開APIへ接続できません。ネットワーク・名前解決・接続制限・redirectを確認してください。',context);}
  context={...context,httpStatus:r.status,stage:'response'};
  if(!r.ok){let data;try{data=await bodyJSON(r,16384,context);}catch{}throw new MarketError('UPSTREAM_HTTP',r.status===403?'公開APIがアクセスを拒否しました。IP・地域・ネットワーク制限の可能性があります。':r.status===429?'公開APIの取得頻度制限に達しました。':'公開APIのHTTPエラーです。',{...context,...(providerCode(data,sourceId)!==undefined?{apiCode:providerCode(data,sourceId)}:{})});}
  context={...context,stage:'json'};const data=await bodyJSON(r,2000000,context);context={...context,stage:'schema'};
  let partRows;
  if(sourceId==='bitbank'){
   if(data?.success!==1)throw new MarketError('PROVIDER_ERROR','bitbankがAPIエラーを返しました。',{...context,...(providerCode(data,sourceId)!==undefined?{apiCode:providerCode(data,sourceId)}:{})});
   const candle=data?.data?.candlestick;if(!Array.isArray(candle)||candle.length!==1||candle[0].type!==plan.type||!Array.isArray(candle[0].ohlcv))throw new MarketError('SCHEMA','bitbankのローソク足形式が想定と異なります。',context);partRows=candle[0].ohlcv;
  }else{
   if(data?.status!==0)throw new MarketError('PROVIDER_ERROR','GMOコインがAPIエラーを返しました。',{...context,...(providerCode(data,sourceId)!==undefined?{apiCode:providerCode(data,sourceId)}:{})});
   if(!Array.isArray(data.data)||data.data.length>10000)throw new MarketError('SCHEMA','GMOコインのローソク足形式が想定と異なります。',context);
   partRows=data.data.map(b=>{if(typeof b?.openTime!=='string'||!/^\d{13}$/.test(b.openTime))throw new MarketError('TIMESTAMP','GMOコインの時刻形式が不正です。',context);return [b.open,b.high,b.low,b.close,b.volume,Number(b.openTime)];});
  }
  if(partRows.length>10000)throw new MarketError('ROW_LIMIT','取得件数が上限を超えました。',context);rows.push(...partRows);requests.push({partition:part,httpStatus:r.status,receivedRows:partRows.length});
 }
 context={sourceId,stage:'candles',receivedRows:rows.length,partitions:requests.map(r=>r.partition)};let bars;try{bars=normalizeCandles(rows,plan,now);}catch{throw new MarketError('CANDLE_VALUES','価格・出来高・時刻・重複データの検証に失敗しました。',context);}
 if(bars.length>600)throw new MarketError('ROW_LIMIT','表示件数が上限を超えました。',context);
 if(!bars.length)throw new MarketError('NO_CLOSED_CANDLES','確定済みローソク足を取得できませんでした。',context);
 const result=analyzeMarket(bars,plan,now);
 return {pair:'BTC/JPY',source:source.name,sourceId,mock:false,period,type:plan.type,step:plan.step,displayStart:plan.start,fetchedAt:now,bars,...result,acquisition:{requests,receivedRows:rows.length,closedRows:bars.length,firstClosedAt:bars[0].time+plan.step,lastClosedAt:bars.at(-1).time+plan.step}};
 }catch(error){if(error instanceof MarketError)throw error;throw new MarketError(controller.signal.aborted?'TIMEOUT':'READ_FAILURE',controller.signal.aborted?'公開API取得が10秒でタイムアウトしました。':'公開APIの応答を最後まで読み取れませんでした。',context);}finally{clearTimeout(timer);}
}
