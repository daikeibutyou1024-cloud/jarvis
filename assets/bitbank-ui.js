import {assetSpeech} from '../lib/bitbank-report.js';
export function initBitbank({request,say}){
 const $=id=>document.getElementById(id);let pending=null,epoch=0;
 const clear=()=>{epoch++;$('bitbank-summary').textContent='未取得。実APIには接続しません。';$('bitbank-rows').replaceChildren();};
 async function report(){if(pending)return pending;const token=epoch;$('bitbank-refresh').disabled=true;
 pending=(async()=>{try{const d=await request('/api/business/bitbank-preview');if(token!==epoch)throw Error('認証状態が変わりました');if(d.mock!==true||!Array.isArray(d.rows))throw Error('架空データを確認できません');
 $('bitbank-summary').textContent=`${d.source} / 評価${d.complete?'合計':'小計'} ${d.totalJPY}円 / 24時間価格変動 ${d.valueChange24hJPY??'未取得'}円 / 取得 ${new Date(d.asOf).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'})} 日本時間。${d.notice}`;
 $('bitbank-rows').replaceChildren();for(const r of d.rows){const li=document.createElement('li');li.textContent=`${r.asset}：保有 ${r.quantity}（利用可能 ${r.free} / ロック ${r.locked} / ロック内の出金中 ${r.withdrawing}）/ 参考価格 ${r.priceJPY}円 / 評価 ${r.valueJPY}円 / 24時間 ${r.changePercent24h??'未取得'}%`;$('bitbank-rows').append(li);}if(d.excluded.length){const li=document.createElement('li');li.textContent='評価対象外：'+d.excluded.join('、');$('bitbank-rows').append(li);}return assetSpeech(d);
 }catch(error){if(token===epoch){$('bitbank-rows').replaceChildren();$('bitbank-summary').textContent='取得失敗：'+error.message+' 自動再試行しません。';}throw error;}finally{pending=null;$('bitbank-refresh').disabled=false;}})();return pending;}
 $('bitbank-refresh').onclick=()=>void report().then(say).catch(e=>say(e.message));return {report,clear};
}
