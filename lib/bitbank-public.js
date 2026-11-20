import {marketPlan,normalizeCandles,analyzeMarket} from './bitbank-market.js';
export async function fetchMarket(period,now=Date.now()){
 const plan=marketPlan(period,now),rows=[];const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
 try{for(const part of plan.parts){
  const url=`https://public.bitbank.cc/btc_jpy/candlestick/${plan.type}/${part}`;
  const r=await fetch(url,{method:'GET',redirect:'error',headers:{accept:'application/json'},signal:controller.signal,cf:{cacheTtl:60,cacheEverything:true}});
  if(!r.ok)throw Error('公開相場APIが取得を拒否しました。再試行しません。');
  if(!r.headers.get('content-type')?.includes('application/json'))throw Error('公開相場APIの形式が不正です');
  const reader=r.body.getReader(),chunks=[];let size=0;for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>2000000){await reader.cancel();throw Error('公開データが上限を超えました');}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}const data=JSON.parse(new TextDecoder().decode(bytes));
  const candle=data?.data?.candlestick;if(data.success!==1||!Array.isArray(candle)||candle.length!==1||candle[0].type!==plan.type||!Array.isArray(candle[0].ohlcv))throw Error('公開相場データを確認できません');rows.push(...candle[0].ohlcv);
 }
 const bars=normalizeCandles(rows,plan,now);if(bars.length>600)throw Error('表示件数を超えました');const result=analyzeMarket(bars,plan,now);
 return {pair:'BTC/JPY',source:'bitbank公式公開API',mock:false,period,type:plan.type,step:plan.step,displayStart:plan.start,fetchedAt:now,bars,...result};
 }catch{throw Error('相場データを取得・検証できませんでした。判定は保留です。自動再試行しません。');}finally{clearTimeout(timer);}
}
