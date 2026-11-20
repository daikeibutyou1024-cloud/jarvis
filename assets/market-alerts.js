// Device-local candidate log only. Never uses Notification API, network, DB or timers.
export const ALERT_KEY='jarvis_bitbank_market_alerts_v1';
export function alertRule(value){
 const r={enabled:value.enabled===true,kind:value.kind,maxRSI:Number(value.maxRSI),maxPrice:value.maxPrice===''||value.maxPrice===null?null:Number(value.maxPrice),minVolume:Number(value.minVolume)};
 if(!['購入検討','様子見','警戒'].includes(r.kind)||!Number.isFinite(r.maxRSI)||r.maxRSI<0||r.maxRSI>100||!Number.isFinite(r.minVolume)||r.minVolume<0||r.minVolume>100||(r.maxPrice!==null&&(!Number.isFinite(r.maxPrice)||r.maxPrice<=0||r.maxPrice>1e15)))throw Error('通知条件の値を確認してください');return r;
}
export function readAlerts(storage){const raw=storage.getItem(ALERT_KEY);if(!raw)return {version:1,rule:{enabled:false,kind:'購入検討',maxRSI:60,maxPrice:null,minVolume:0.8},events:[]};const d=JSON.parse(raw);if(d.version!==1||!Array.isArray(d.events)||d.events.length>100)throw Error('通知記録の形式を確認してください。上書きしません。');d.rule=alertRule(d.rule);return d;}
async function locked(locks,fn){if(!locks?.request)throw Error('このブラウザでは複数タブの通知重複を安全に防げないため、通知記録を停止します。');return locks.request(ALERT_KEY,fn);}
function store(storage,data){const s=JSON.stringify(data);storage.setItem(ALERT_KEY,s);if(storage.getItem(ALERT_KEY)!==s)throw Error('通知記録を保存できません');}
export function saveAlertRule(storage,locks,value,now=Date.now()){const rule=alertRule(value);return locked(locks,()=>{const d=readAlerts(storage);d.rule=rule;d.configuredAt=now;store(storage,d);return d;});}
export function evaluateAlert(storage,locks,market,now=Date.now()){
 return locked(locks,()=>{const d=readAlerts(storage),a=market.analysis,m=a.metrics,r=d.rule;
  if(!r.enabled||a.kind==='保留'||!m||a.kind!==r.kind||m.rsi>r.maxRSI||m.volumeRatio<r.minVolume||(r.maxPrice!==null&&m.close>r.maxPrice))return {data:d,candidate:null};
  if(!Number.isSafeInteger(a.closedAt)||a.closedAt>now||now-a.closedAt>market.step*2)throw Error('古い判定による通知を保留しました');
  const sourceId=market.sourceId||'bitbank',key=JSON.stringify([sourceId,market.pair,market.type,a.closedAt,r]),legacyKey=JSON.stringify([market.pair,market.type,a.closedAt,r]);if(d.events.some(e=>e.key===key||(sourceId==='bitbank'&&e.key===legacyKey)))return {data:d,candidate:null};if(d.events.length>=100)throw Error('通知記録が100件に達しました。既存履歴を保護して追加を停止します。');
  const event={key,sourceId,sourceName:market.source||'bitbank',condition:{...r},configuredAt:d.configuredAt,evaluatedAt:now,candleClosedAt:a.closedAt,pair:market.pair,type:market.type,kind:a.kind,close:m.close,rsi:m.rsi,volumeRatio:m.volumeRatio,reason:a.reason};
  d.events.push(event);store(storage,d);return {data:d,candidate:event};
 });
}
