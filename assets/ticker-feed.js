import {validateTicker} from '../lib/bitbank-ticker.js';
// Foreground public prices only. No AI, trades, storage, Cron, overlapping calls or infinite retry.
export function createTickerFeed({getTicker,onState,isActive=()=>true,now=Date.now,setTimer=setTimeout,clearTimer=clearTimeout}){
 let wanted=false,epoch=0,timer=null,staleTimer=null,controller=null,failures=0,last=null,pending=false,restart=false,wasActive=null;
 const emit=(status,extra={})=>onState({status,value:last,stale:status!=='fresh',...extra});
 const clear=()=>{clearTimer(timer);clearTimer(staleTimer);timer=staleTimer=null;};
 function cancel(){epoch++;clear();controller?.abort();controller=null;}
 function stop(reason='自動更新を停止しました。表示価格は前回値です。'){wanted=false;restart=false;cancel();emit('stopped',{reason});}
 function pause(reason='画面が非表示のため停止中。表示価格は前回値です。'){wasActive=false;restart=false;cancel();emit('paused',{reason});}
 function freshTimer(token){clearTimer(staleTimer);const remaining=Math.min(last.sourceAt+60000,last.fetchedAt+30000)-now();staleTimer=setTimer(()=>{if(token===epoch&&wanted)emit('stale',{reason:'更新が途絶えたため前回値です。'});},Math.max(0,remaining));}
 function schedule(ms,token){clearTimer(timer);timer=setTimer(()=>{timer=null;if(token===epoch)void poll();},ms);}
 async function poll(){
  if(!wanted)return;if(!isActive()){pause();return;}if(pending){restart=true;return;}
  const token=epoch;controller=new AbortController();const current=controller,requestTimer=setTimer(()=>current.abort(),8000);pending=true;emit(last?'refreshing':'connecting',{stale:!last||now()-last.sourceAt>60000||now()-last.fetchedAt>30000});
  try{const d=validateTicker(await getTicker({signal:current.signal}),now());if(token!==epoch||!wanted||!isActive())return;
   if(last&&d.sourceAt<last.sourceAt)throw Error('古い配信時刻の価格を拒否しました。');const direction=last?Math.sign(d.price-last.price):0;last=d;failures=0;emit('fresh',{stale:false,direction});freshTimer(token);schedule(10000,token);
  }catch(error){if(token!==epoch||!wanted)return;clearTimer(staleTimer);if(error.auth){stop('認証を確認してから価格更新を再開してください。');return;}failures++;if(failures>=5){stop('接続失敗が5回続いたため停止しました。手動で再開できます。');return;}const retryMs=Math.min(60000,10000*2**(failures-1));emit('retry',{reason:current.signal.aborted?'現在価格の通信が8秒でタイムアウトしました。':error.message||'現在価格の通信に失敗しました。',retryMs});schedule(retryMs,token);
  }finally{clearTimer(requestTimer);pending=false;if(controller===current)controller=null;if(restart){restart=false;if(wanted&&isActive())void poll();}}
 }
 function start(){if(wanted){activityChanged();return;}wanted=true;failures=0;epoch++;wasActive=isActive();void poll();}
 function activityChanged(){if(!wanted)return;const active=isActive();if(active===wasActive)return;wasActive=active;if(!active)pause();else{cancel();void poll();}}
 return {start,stop,pause,activityChanged,get enabled(){return wanted;}};
}
