import {createTickerFeed} from './ticker-feed.js';
export function initLivePrice({isAuthorized}){
 const $=id=>document.getElementById(id);let flash=null,manualStop=false,unloading=false;
 const active=()=>!unloading&&!document.hidden&&document.body.dataset.currentPage==='overview'&&navigator.onLine!==false&&isAuthorized()&&document.documentElement.dataset.environment!=='production';
 const feed=createTickerFeed({isActive:active,getTicker:async({signal})=>{
  const r=await fetch('/api/business/bitbank-ticker-preview',{credentials:'same-origin',cache:'no-store',signal}),d=await r.json();if(!r.ok){const e=Error(d.error||'現在価格の取得に失敗しました。');e.auth=r.status===401||r.status===403;throw e;}return d;
 },onState:s=>{
  clearTimeout(flash);$('ticker-price').classList.remove('price-up','price-down');$('ticker-direction').textContent='';$('ticker-price').classList.toggle('price-old',s.stale);
  if(s.value){$('ticker-price').textContent=s.value.price.toLocaleString('ja-JP',{style:'currency',currency:'JPY',maximumFractionDigits:2});$('ticker-change').textContent=s.value.change24h===null?'24時間変動率：未取得':`24時間変動率：${s.value.change24h>=0?'+':''}${s.value.change24h.toFixed(2)}%`;$('ticker-updated').textContent=`bitbank配信 ${new Date(s.value.sourceAt).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'})} / 受信 ${new Date(s.value.fetchedAt).toLocaleTimeString('ja-JP',{timeZone:'Asia/Tokyo'})} JST${s.stale?'（前回値・最新として扱いません）':''}`;}
  if(s.status==='fresh'&&s.direction){$('ticker-price').classList.add(s.direction>0?'price-up':'price-down');$('ticker-direction').textContent=s.direction>0?'↑':'↓';flash=setTimeout(()=>{$('ticker-price').classList.remove('price-up','price-down');$('ticker-direction').textContent='';},1200);}
  const labels={fresh:'接続中：bitbank公式API・10秒間隔の自動更新',refreshing:'現在価格を更新中',connecting:'bitbank現在価格に接続中…',retry:`切断：${s.reason} ${Math.ceil((s.retryMs||0)/1000)}秒後に再接続します。前回値です。`,stopped:s.reason,paused:!navigator.onLine?'オフラインのため停止中。前回値です。':s.reason,stale:s.reason};$('ticker-connection').textContent=labels[s.status]||s.status;
  $('ticker-toggle').textContent=feed.enabled?'価格の自動更新を停止':'価格の自動更新を開始';
 }});
 $('ticker-toggle').onclick=()=>{if(feed.enabled){manualStop=true;feed.stop();}else{manualStop=false;feed.start();}};
 window.addEventListener('jarvis-session-ready',()=>{if(!manualStop)feed.start();});
 document.addEventListener('visibilitychange',()=>feed.activityChanged());for(const event of ['offline','online'])window.addEventListener(event,()=>feed.activityChanged());
 window.addEventListener('pagehide',()=>{unloading=true;feed.pause('ページを離れたため停止中。前回値です。');});window.addEventListener('pageshow',()=>{unloading=false;feed.activityChanged();});
 new MutationObserver(()=>feed.activityChanged()).observe(document.body,{attributes:true,attributeFilter:['data-current-page']});
 return {suspendAuth:()=>feed.stop('認証待ちのため停止中。前回値です。')};
}
