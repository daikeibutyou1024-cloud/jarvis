// Decimal strings from bitbank are evaluated with fixed-point integers, never floats.
// This module performs no I/O and accepts no credentials. No trading operations exist.
const SCALE=10n**18n;
function decimal(s){if(typeof s!=='string'||!/^\d{1,20}(?:\.\d{1,18})?$/.test(s))throw Error('数量・価格の形式が不正です');const [a,b='']=s.split('.');return BigInt(a)*SCALE+BigInt(b.padEnd(18,'0'));}
function fixed(n,scale=SCALE){const negative=n<0n;n=negative?-n:n;const cents=(n*100n+scale/2n)/scale;return (negative&&cents?'-':'')+(cents/100n)+'.'+String(cents%100n).padStart(2,'0');}
export function assetIntent(text){return /^(?:ジャービス[、,\s]*)?(?:bitbank[の、\s]*|ビットバンク[の、\s]*)?資産(?:状況|報告|の状況)(?:を)?(?:報告して|教えて|確認して|して)?[。！!？?\s]*$/iu.test(text.trim());}
export function buildAssetReport({assets,tickers,asOf,mock=false},now=Date.now()){
 if(!Array.isArray(assets)||assets.length>100||!Number.isSafeInteger(asOf)||asOf>now+1000||now-asOf>300000)throw Error('資産データが未取得または期限切れです');
 const rows=[],excluded=[],seen=new Set();let total=0n,change=0n;
 for(const a of assets){if(!/^[a-z0-9]{2,12}$/.test(a?.asset||'')||seen.has(a.asset))throw Error('資産名または重複を確認してください');seen.add(a.asset);const quantity=decimal(a.onhand_amount);if(!quantity)continue;
  const free=decimal(a.free_amount),locked=decimal(a.locked_amount),withdrawing=decimal(a.withdrawing_amount);if(free+locked!==quantity||withdrawing>locked)throw Error('保有量の整合性を確認してください');
  let last=SCALE,open=SCALE;
  if(a.asset!=='jpy'){const t=tickers?.[a.asset+'_jpy'];if(!t){excluded.push(a.asset.toUpperCase());continue;}if(!Number.isSafeInteger(t.timestamp)||t.timestamp>now+1000||now-t.timestamp>300000)throw Error('価格が期限切れです');last=decimal(t.last);open=decimal(t.open);if(last<=0n)throw Error('現在価格が不正です');}
  const value=quantity*last/SCALE,delta=quantity*(last-open)/SCALE;total+=value;if(open>0n)change+=delta;
  rows.push({asset:a.asset.toUpperCase(),quantity:a.onhand_amount,free:a.free_amount,locked:a.locked_amount,withdrawing:a.withdrawing_amount,priceJPY:fixed(last),valueJPY:fixed(value),changePercent24h:open>0n?fixed((last-open)*100n*SCALE/open):null,valueChange24hJPY:open>0n?fixed(delta):null});
 }
 const complete=excluded.length===0,knownChange=rows.every(r=>r.changePercent24h!==null);
 return {mock,asOf,currency:'JPY',rows,excluded,complete,totalJPY:fixed(total),valueChange24hJPY:knownChange?fixed(change):null,notice:'現在保有量×最終約定価格の参考評価です。24時間変動は同じ保有量での価格比較で、実現損益・取得原価・入出金を反映しません。出金中数量はロック量の内数です。',source:mock?'架空データ（実資産・現在相場ではありません）':'bitbank'};
}
export function mockAssetReport(now=Date.now()){
 const row=(asset,onhand_amount,free_amount=onhand_amount,locked_amount='0',withdrawing_amount='0')=>({asset,onhand_amount,free_amount,locked_amount,withdrawing_amount});
 return buildAssetReport({mock:true,asOf:now,assets:[row('jpy','100000'),row('btc','0.02','0.015','0.005','0.001'),row('eth','0.5')],tickers:{btc_jpy:{last:'15000000',open:'14500000',timestamp:now},eth_jpy:{last:'500000',open:'510000',timestamp:now}}},now);
}
export function assetSpeech(d){return `${d.mock?'架空データの資産報告です。実際の保有資産ではありません。':''}評価${d.complete?'合計':'小計'}は${d.totalJPY}円です。${d.rows.map(r=>`${r.asset}は${r.quantity}、評価${r.valueJPY}円。`).join('')}同じ保有量で計算した24時間の価格変動額は${d.valueChange24hJPY===null?'未取得':d.valueChange24hJPY+'円'}です。売買損益ではありません。${d.excluded.length?'評価対象外の資産があります。':''}`;}
