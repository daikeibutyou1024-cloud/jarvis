import {marketPlan,analyzeMarket} from '../lib/bitbank-market.js';
export function marketFixture(period='year',now=Date.now(),sourceId='bitbank'){
 const plan=marketPlan(period,now),n=Math.ceil(plan.days*86400000/plan.step)+61,last=Math.floor(now/plan.step)*plan.step-plan.step;
 const bars=Array.from({length:n},(_,i)=>{const close=10000000+i*500+Math.sin(i/3)*30000,open=close-2000;return {time:last-(n-1-i)*plan.step,open,high:close+1000,low:open-1000,close,volume:100+i%3};});
 return {pair:'BTC/JPY',mock:false,sourceId,source:sourceId==='bitbank'?'合成bitbank公開データ（テスト専用）':'合成GMOデータ（別取引所・テスト専用）',period,type:plan.type,step:plan.step,displayStart:plan.start,fetchedAt:now,bars,...analyzeMarket(bars,plan,now)};
}
export const rawRows=bars=>bars.map(b=>[b.open,b.high,b.low,b.close,b.volume].map(String).concat(b.time));
