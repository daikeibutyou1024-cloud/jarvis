// BTC/JPY public data only. Time is always UTC milliseconds; no credentials or I/O here.
export const PERIODS={day:{label:'1日',days:1,hours:1,type:'1hour'},week:{label:'1週間',days:7,hours:4,type:'4hour'},month:{label:'1か月',days:30,hours:4,type:'4hour'},quarter:{label:'3か月',days:90,hours:24,type:'1day'},half:{label:'6か月',days:180,hours:24,type:'1day'},year:{label:'1年',days:365,hours:24,type:'1day'}};
export function marketPlan(period,now=Date.now(),sourceId='bitbank'){
 const p=Object.hasOwn(PERIODS,period)?PERIODS[period]:null;if(!p)throw Error('表示期間が不正です');const step=p.hours*3600000,start=now-p.days*86400000,warmStart=start-60*step,end=now-step,parts=[],shift=sourceId==='gmo'?3*3600000:0;
 if(p.type==='1hour'){for(let t=Math.floor((warmStart+shift)/86400000)*86400000;t<=end+shift;t+=86400000)parts.push(new Date(t).toISOString().slice(0,10).replaceAll('-',''));}
 else for(let y=new Date(warmStart+shift).getUTCFullYear();y<=new Date(end+shift).getUTCFullYear();y++)parts.push(String(y));
 if(parts.length>5)throw Error('取得範囲を超えました');return {...p,period,step,start,warmStart,parts};
}
export function normalizeCandles(rows,plan,now){
 if(!Array.isArray(rows)||rows.length>10000)throw Error('相場データの件数が不正です');const map=new Map();
 for(const r of rows){
 if(!Array.isArray(r)||r.length!==6||!Number.isSafeInteger(r[5])||r[5]<=0)throw Error('ローソク足の形式が不正です');
 const time=r[5];if(time<plan.warmStart||time+plan.step>now)continue;
 if(r.slice(0,5).some(v=>typeof v!=='string'||!/^\d{1,20}(?:\.\d{1,20})?$/.test(v)))throw Error('価格形式が不正です');
 const [open,high,low,close,volume]=r.slice(0,5).map(Number);if(![open,high,low,close,volume].every(Number.isFinite)||Math.min(open,high,low,close)<=0||volume<0||low>Math.min(open,close)||high<Math.max(open,close))throw Error('ローソク足の値が不正です');
 const c={time,open,high,low,close,volume};if(map.has(time)&&JSON.stringify(map.get(time))!==JSON.stringify(c))throw Error('同時刻の価格が一致しません');map.set(time,c);
 }
 return [...map.values()].sort((a,b)=>a.time-b.time);
}
export function indicators(bars){
 let sum20=0,sum50=0,vol=0,gain=0,loss=0;return bars.map((b,i)=>{
  sum20+=b.close;if(i>=20)sum20-=bars[i-20].close;sum50+=b.close;if(i>=50)sum50-=bars[i-50].close;
  if(i){const d=b.close-bars[i-1].close,g=Math.max(d,0),l=Math.max(-d,0);if(i<=14){gain+=g;loss+=l;if(i===14){gain/=14;loss/=14;}}else{gain=(gain*13+g)/14;loss=(loss*13+l)/14;}}
  const prior=bars.slice(Math.max(0,i-20),i),high=prior.length?Math.max(...prior.map(x=>x.high)):null,low=prior.length?Math.min(...prior.map(x=>x.low)):null;
  const rsi=i<14?null:loss===0?(gain===0?50:100):100-100/(1+gain/loss);const volumeRatio=i>=20&&vol>0?b.volume/(vol/20):null;
  vol+=b.volume;if(i>=20)vol-=bars[i-20].volume;
  return {ma20:i>=19?sum20/20:null,ma50:i>=49?sum50/50:null,rsi,volumeRatio,high20:high,low20:low,barChange:i?(b.close/bars[i-1].close-1)*100:null};
 });
}
const hold=reason=>({kind:'保留',reason,opposite:'十分な確定済みデータを取得してから再判定します。',metrics:null});
export function classifyAt(bars,series,i,step){
 if(i<59)return hold('指標の計算には連続した確定足60本以上が必要です。');
 for(let j=i-59;j<=i;j++)if(j>0&&bars[j].time-bars[j-1].time!==step)return hold('計算区間に欠損した足があります。');
 const b=bars[i],m=series[i];if(m.volumeRatio===null||m.rsi===null)return hold('出来高または指標が不足しています。');
 let kind='様子見',reason='方向と押し目の条件が揃っていません。',opposite='長期線を上回る推移と出来高の回復なら上向き、長期線割れなら下向きの見方に変わります。';
 if((b.close<m.ma50&&m.ma20<m.ma50)||m.rsi>=75||m.barChange<=-5){kind='警戒';reason=m.rsi>=75?'RSIが75以上で過熱の可能性があります。':m.barChange<=-5?'直前の確定足から5%以上下落しています。':'価格と短期線が長期線を下回っています。';opposite='過熱しても上昇が続く場合や、長期線を回復して反発する場合があります。警戒は下落の保証ではありません。';}
 else if(m.ma20>=m.ma50&&b.close>=m.ma50&&b.close<=m.ma20*1.02&&m.rsi>=35&&m.rsi<=60&&m.volumeRatio>=0.8){kind='購入検討';reason='短期線が長期線以上、価格が長期線以上かつ短期線の2%上方以内、RSI35〜60、出来高比0.8以上です。';opposite='押し目に見えても長期線割れや出来高減少で下落が続く可能性があります。';}
 return {kind,reason,opposite,metrics:{...m,close:b.close},candleTime:b.time,closedAt:b.time+step};
}
export function analyzeMarket(bars,plan,now=Date.now()){
 const series=indicators(bars),i=bars.length-1,view=bars.filter(b=>b.time>=plan.start);
 let result=i<0?hold('確定済みの価格がありません。'):now-(bars[i].time+plan.step)>plan.step*2?hold('最新の確定足が古いため判定を保留します。'):classifyAt(bars,series,i,plan.step);
 if(view.some((b,j)=>j>0&&b.time-view[j-1].time!==plan.step))result=hold('表示期間の足に欠損があります。');
 if(!view.length||view[0].time-plan.start>plan.step*2)result=hold('指定期間をカバーするデータが不足しています。');
 if(result.metrics)result.metrics.periodChange=(bars[i].close/view[0].open-1)*100;
 const counts={'購入検討':0,'様子見':0,'警戒':0,'保留':0};let comparisons=0,nextRises=0;
 for(let j=59;j<bars.length-1;j++){if(bars[j].time<plan.start)continue;const r=classifyAt(bars,series,j,plan.step);counts[r.kind]++;if(r.kind==='購入検討'&&bars[j+1].time-bars[j].time===plan.step){comparisons++;if(bars[j+1].close>bars[j].close)nextRises++;}}
 return {analysis:result,series,validation:{counts,purchaseSamples:comparisons,nextBarRises:nextRises,notice:'各時点までの足だけで判定し、その後の1本は事後比較にのみ使用。手数料・売買執行を含まない参考検証で、収益性や将来の再現性を示しません。'}};
}
