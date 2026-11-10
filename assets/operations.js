import {sourceCatalog} from './research-data.js';
const states={completed:'完了',completed_capacity:'完了・保存上限',failed:'失敗',interrupted:'中断',running:'実行中',cancelled:'設定変更で中止',new:'未取り込み',imported:'取り込み済み'};
export function initOperations({request,say,importInbox,getBusy=()=>false}){
 const $=id=>document.getElementById(id);let busy=false,editing=null,nextCursor=null;
 $('report-date').value=new Date(Date.now()+9*3600000).toISOString().slice(0,10);
 async function work(fn){if(busy||getBusy())return;busy=true;for(const id of ['ops-refresh','ops-save','ops-new','ops-report','ops-inbox-next'])$(id).disabled=true;try{await fn();}catch(e){say(e.message);}finally{busy=false;for(const id of ['ops-refresh','ops-save','ops-new','ops-report','ops-inbox-next'])$(id).disabled=false;}}
 function clear(){editing=null;$('ops-name').value='';$('ops-source').value='digital';$('ops-query').value='';$('ops-interval').value='360';$('ops-enabled').checked=false;$('ops-editing').textContent='新しい設定（停止状態）';}
 function edit(s){editing={id:s.id,version:s.version};$('ops-name').value=s.name;$('ops-source').value=s.source;$('ops-query').value=s.query;$('ops-interval').value=String(s.interval_minutes);$('ops-enabled').checked=!!s.enabled;$('ops-editing').textContent=`${s.name} / 設定版 ${s.version}`;}
 function render(data){
  $('ops-state').textContent=`全体：${data.config.enabled?'有効':'停止'} / 専用認証：${data.config.hasToken?'設定あり':'未設定'} / 上限：${data.config.dailyLimit}回/UTC日 / 受信箱 ${data.storage.total}/${data.storage.limit}件、未取り込み ${data.storage.pending}件。${data.notice}`;
  const root=$('ops-schedules');root.replaceChildren();
  for(const s of data.schedules){const li=document.createElement('li'),button=document.createElement('button');li.textContent=`${s.name} / ${sourceCatalog[s.source]?.name||s.source} / ${s.query} / ${s.interval_minutes}分間隔 / ${s.enabled?'設定は有効':'停止'} / 次回対象 ${new Date(s.next_run_at).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'})} JST `;button.textContent='編集・停止';button.onclick=()=>{if(!busy)edit(s);};li.append(button);root.append(li);}
  if(!data.schedules.length)root.textContent='収集設定はありません';
  const runs=$('ops-runs');runs.replaceChildren();for(const r of data.runs){const li=document.createElement('li');li.textContent=`${new Date(r.started_at).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'})} JST / ${r.result?.config?.name||r.name||r.schedule_id} / ${states[r.state]||r.state} / ${r.result?.error||('取得 '+(r.result?.acquired??'未確認')+'件 / 新規保存 '+(r.result?.inserted??'未確認')+'件')}`;runs.append(li);}
  const inbox=$('ops-inbox');inbox.replaceChildren();
  for(const row of data.inbox){const li=document.createElement('li'),b=document.createElement('button'),a=document.createElement('a'),text=document.createElement('p');a.textContent=row.record.title;a.href=row.record.sourceUrl;a.target='_blank';a.rel='noopener noreferrer';text.textContent=row.record.text+' / 出典取得 '+row.record.fetchedAt+' / 内容は未確認';b.textContent='RESEARCHへ取り込む（確認済みにはしません）';b.onclick=()=>work(async()=>{if(!importInbox([row.record]))throw Error('端末への取り込みが完了しませんでした。受信箱は変更していません');await request('/api/business/schedules','POST',{action:'ack',ids:[row.id]});say('RESEARCHに取り込みました。内容・出典を確認してから記事制作へ渡してください。');await refresh();});li.append(a,text,b);inbox.append(li);}
  if(!data.inbox.length)inbox.textContent='新しい収集資料はありません';nextCursor=data.nextInboxCursor;$('ops-inbox-next').hidden=!nextCursor;
 }
 async function refresh(before=null){render(await request('/api/business/schedules'+(before?'?before='+before:'')));}
 $('ops-refresh').onclick=()=>work(()=>refresh());$('ops-inbox-next').onclick=()=>work(()=>refresh(nextCursor));$('ops-new').onclick=()=>{if(!busy)clear();};
 $('ops-save').onclick=()=>work(async()=>{await request('/api/business/schedules','POST',{action:'save',...(editing?{id:editing.id}:{}),expectedVersion:editing?.version||0,name:$('ops-name').value,source:$('ops-source').value,query:$('ops-query').value,intervalMinutes:Number($('ops-interval').value),enabled:$('ops-enabled').checked});clear();await refresh();say('収集設定を保存しました。全体停止と起動元が未設定の場合は自動実行されません。');});
 $('ops-report').onclick=()=>work(async()=>{
  const d=await request('/api/business/report?date='+encodeURIComponent($('report-date').value));
  const lines=[`${d.date} / ${d.timezone}`,`収集試行：${d.collection?d.collection.attempts+'件':'記録なし（未設定）'}`,d.collection?d.collection.states.map(s=>`${states[s.state]||s.state} ${s.count}`).join(' / '):'',`新しい資料：${d.inbox?d.inbox.acquiredToday+'件、未取り込み '+d.inbox.pending+'件':'未連携'}`,`AI：${d.ai?d.ai.attempts+'試行、管理値・予約 $'+(d.ai.committedMicroUSD/1e6).toFixed(6)+', 未確定 '+d.ai.unresolved+'件':'利用台帳なし（費用未確認）'}`,d.ai?.notice||'',d.editorial?`現在の制作案件：${d.editorial.scanned}件を確認${d.editorial.partial?'（全件集計ではありません）':''} / 企画 ${d.editorial.counts.planning} / 補完中 ${d.editorial.counts.drafting} / 全文確認待ち ${d.editorial.counts.review_pending} / 確認記録あり ${d.editorial.counts.review_recorded}`:'制作案件は未連携',d.financialNotice];
  $('ops-report-output').textContent=lines.filter(Boolean).join('\n');say('運用状況を集計しました。AI APIや売上の自動取得は利用していません。');
 });
 clear();return {refresh};
}
