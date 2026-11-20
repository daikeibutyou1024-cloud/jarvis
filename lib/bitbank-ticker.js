import {MarketError} from './market-error.js';
export const TICKER_MAX_AGE=60000;
export function tickerValue(body,now=Date.now()){
 if(body?.success!==1)throw new MarketError('PROVIDER_ERROR','bitbankの現在価格を取得できません。',{stage:'ticker',sourceId:'bitbank'});
 const d=body.data,valid=n=>typeof n==='string'&&/^\d{1,15}(?:\.\d{1,18})?$/.test(n)&&Number.isFinite(Number(n));
 if(!d||!valid(d.last)||!valid(d.open)||Number(d.last)<=0||!Number.isSafeInteger(d.timestamp)||d.timestamp<=0)throw new MarketError('TICKER_SCHEMA','現在価格・24時間基準価格・時刻の形式が不正です。',{stage:'ticker',sourceId:'bitbank'});
 if(d.timestamp>now+5000||now-d.timestamp>TICKER_MAX_AGE)throw new MarketError('STALE_TICKER','現在価格の配信時刻が古い、または時計が一致していません。',{stage:'freshness',sourceId:'bitbank'});
 return {pair:'BTC/JPY',source:'bitbank公式公開Ticker',sourceId:'bitbank',mode:'polling',intervalMs:10000,price:Number(d.last),change24h:Number(d.open)>0?(Number(d.last)/Number(d.open)-1)*100:null,sourceAt:d.timestamp,fetchedAt:now,mock:false};
}
export function validateTicker(d,now=Date.now()){
 if(d?.mock!==false||d.sourceId!=='bitbank'||d.pair!=='BTC/JPY'||d.mode!=='polling'||!Number.isFinite(d.price)||d.price<=0||(d.change24h!==null&&!Number.isFinite(d.change24h))||!Number.isSafeInteger(d.sourceAt)||d.sourceAt<=0||!Number.isSafeInteger(d.fetchedAt)||d.fetchedAt<=0||d.sourceAt>now+5000||d.fetchedAt>now+5000||now-d.sourceAt>TICKER_MAX_AGE||now-d.fetchedAt>30000)throw Error('現在価格を最新値として確認できません。');
 return d;
}
