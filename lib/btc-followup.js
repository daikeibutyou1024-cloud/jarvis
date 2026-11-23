import {normalizeCoreCommand} from './core-command.js';
// Interpret only supported follow-ups against an explicitly fetched local report. No AI or fetch.
export function btcFollowUp(report,text,{pronounContext=false}={}){
 if(!report)return null;const q=normalizeCoreCommand(text).replace(/\s+/g,''),explicit=/BTC|ビットコイン|レポート|RSI|アールエスアイ|移動平均|支持線|抵抗線/i.test(q),topic=/なぜ|どうして|理由|意味|詳しく|もう一度|反対|リスク|条件|変わ|価格|いくら|確率|ニュース|RSI|アールエスアイ|移動平均|支持線|抵抗線/i;
 if((!explicit&&!pronounContext)||(!/BTC|ビットコイン/i.test(q)&&/天気|雨|カレンダー|予定|記事|保存|収支|音声設定/.test(q))||!topic.test(q)||/最新|再取得|更新/.test(q))return null;
 const time=new Date(report.generatedAt).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'}),prefix=`先ほどの、${time}に作成したBTCレポートについて説明します。`,m=report.market?.metrics,f=n=>Number.isFinite(n)?n.toLocaleString('ja-JP',{maximumFractionDigits:2}):'未取得';let answer;
 if(/もう一度|繰り返/.test(q))answer=report.speech;
 else if(/確率/.test(q))answer=report.forecasts.map(x=>`${x.horizonDays===1?'24時間':x.horizonDays+'日'}後は、${x.probabilities?'過去データからの参考推定で上昇'+f(x.probabilities.up*100)+'%、下落'+f(x.probabilities.down*100)+'%です。将来の保証ではありません。':x.reason}`).join(' ');
 else if(/RSI|アールエスアイ/i.test(q))answer=`RSIは最近の上昇と下落の強さを0から100で表す目安です。数値だけで売買は判断しません。今回の値は${f(m?.rsi)}です。`;
 else if(/移動平均/.test(q))answer=`移動平均は一定期間の価格を平均し、流れを見やすくした線です。20日平均は${f(m?.ma20)}円、50日平均は${f(m?.ma50)}円でした。`;
 else if(/支持線|抵抗線/.test(q))answer=`過去20本の安値${f(m?.low20)}円と高値${f(m?.high20)}円を目安にしています。そこで必ず反転する線ではありません。`;
 else if(/ニュース/.test(q)){const items=report.news.flatMap(s=>s.items||[]);answer=items.length?items.slice(0,2).map(n=>n.source+'の'+n.kind+'です。'+n.title+'。'+n.why+' '+n.pricedIn).join(' '):'取得できた関連ニュースはありません。情報が存在しないと確認した意味ではありません。';}
 else if(/反対|リスク/.test(q))answer=report.judgment.opposite;
 else if(/条件|変わ/.test(q))answer=report.judgment.changes;
 else if(/価格|いくら/.test(q))answer=report.ticker?`取得時点の価格は${f(report.ticker.price)}円、24時間比は${f(report.ticker.change24h)}%でした。今の価格を知るにはレポートを取り直してください。`:'現在価格は未取得です。数字を推測して補いません。';
 else if(/それ|その|判断|レポート|^(なぜ|どうして)(ですか)?[？?。\s]*$|理由を|詳しく|もう少し/.test(q))answer=report.judgment.reason+' 反対材料は、'+report.judgment.opposite+' 判断が変わる条件は、'+report.judgment.changes;
 else return null;
 return prefix+answer+' 取得後の値動きは反映していません。';
}
