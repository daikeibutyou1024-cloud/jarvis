// Fixed rules, expanding-window training; no news or future labels in features.
import {indicators} from './bitbank-market.js';
const DAY=86400000,MIN_TRAIN=120,NEIGHBORS=60,MIN_TEST=120;
const wilson=(k,n)=>{const z=1.96,p=k/n,d=1+z*z/n,c=(p+z*z/(2*n))/d,r=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d;return [Math.max(0,c-r),Math.min(1,c+r)];};
export function probabilityForecast(bars,horizon,now=Date.now(),includeHistory=false){
 const hold=(reason,validation=null)=>({horizonDays:horizon,status:'算出保留',reason,probabilities:null,validation});
 if(![1,7,30].includes(horizon))return hold('対象期間ではありません。');
 if(bars.length<MIN_TRAIN+60||bars.some((b,i)=>!Number.isFinite(b.close)||b.close<=0||!Number.isSafeInteger(b.time)||(i&&b.time-bars[i-1].time!==DAY)||b.time+DAY>now))return hold('連続した確定日足が不足、または未来・未確定データが含まれます。');
 if(now-(bars.at(-1).time+DAY)>2*DAY)return hold('最新の日足が古いため保留します。');
 const s=indicators(bars),features=s.map((m,i)=>i<49?null:[(m.rsi-50)/25,(bars[i].close/m.ma50-1)*10,(m.ma20/m.ma50-1)*10]);
 const label=i=>bars[i+horizon].close>bars[i].close?0:bars[i+horizon].close<bars[i].close?1:2;
 function at(i){const train=[];for(let j=49;j+horizon<=i;j++)train.push(j);if(train.length<MIN_TRAIN)return null;const all=[0,0,0];for(const j of train)all[label(j)]++;const near=train.map(j=>({j,d:features[j].reduce((a,v,k)=>a+(v-features[i][k])**2,0)})).sort((a,b)=>a.d-b.d||a.j-b.j).slice(0,NEIGHBORS),count=[1,1,1];for(const {j} of near)count[label(j)]++;return {p:count.map(v=>v/(NEIGHBORS+3)),baseline:all.map(v=>v/train.length),latestLabelAt:bars[i].time+DAY,trainingSamples:train.length,counts:count};}
 const records=[];for(let i=49+MIN_TRAIN+horizon;i+horizon<bars.length;i+=horizon){const f=at(i);if(!f)continue;const y=label(i),loss=p=>p.reduce((sum,v,k)=>sum+(v-(k===y?1:0))**2,0);records.push({p:f.p,y,brier:loss(f.p),baseline:loss(f.baseline),correct:f.p.indexOf(Math.max(...f.p))===y,predictedAt:bars[i].time+DAY,labelAt:bars[i+horizon].time+DAY,latestTrainingLabelAt:f.latestLabelAt});}
 const n=records.length;if(!n)return hold('時系列の検証標本がありません。');const avg=k=>records.reduce((a,r)=>a+r[k],0)/n,brier=avg('brier'),baselineBrier=avg('baseline'),accuracy=avg('correct');let calibrationError=0;
 for(let k=0;k<3;k++){let e=0;for(let bin=0;bin<5;bin++){const rows=records.filter(r=>Math.min(4,Math.floor(r.p[k]*5))===bin);if(rows.length)e+=Math.abs(rows.reduce((a,r)=>a+r.p[k],0)/rows.length-rows.filter(r=>r.y===k).length/rows.length)*rows.length/n;}calibrationError=Math.max(calibrationError,e);}
 const differences=records.map(r=>r.baseline-r.brier),mean=baselineBrier-brier,se=Math.sqrt(differences.reduce((a,v)=>a+(v-mean)**2,0)/Math.max(1,n-1)/n);
 const validation={...(includeHistory?{history:records}:{}),samples:n,minimumSamples:MIN_TEST,accuracy,accuracyInterval95:wilson(records.filter(r=>r.correct).length,n),brier,baselineBrier,calibrationError,brierImprovementLower95:mean-1.96*se,nonOverlappingTargets:true,newsUsed:false,firstPredictionAt:records[0].predictedAt,lastLabelAt:records.at(-1).labelAt,method:'固定60近傍・拡大型時系列検証。各予測時点で結果が確定済みの標本だけ使用。',notice:'検証期間内の参考値です。独立性・将来の再現性を保証せず、手数料・売買成果は評価していません。'};
 if(n<MIN_TEST||calibrationError>.10||validation.brierImprovementLower95<=0)return hold(n<MIN_TEST?'非重複の検証標本が120件未満です。':'確率校正または基準モデルとの差の検証条件を満たしません。',validation);
 const f=at(bars.length-1);return {horizonDays:horizon,status:'参考推定',reason:'事前固定した検証条件を通過した過去データに基づく推定です。',probabilities:{up:f.p[0],down:f.p[1],flat:f.p[2]},intervals95:{up:wilson(f.counts[0]-1,NEIGHBORS),down:wilson(f.counts[1]-1,NEIGHBORS)},trainingSamples:f.trainingSamples,validation};
}
