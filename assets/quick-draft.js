import {recordJob,JOBS_KEY,reviseMock} from '../lib/internal-jobs.js';
import {report} from '../lib/activity-report.js';
import {socialDrafts} from '../lib/marketing-preview.js';
import {createPack,savePack,latestPacks,QUICK_KEY} from '../lib/quick-draft.js';
export function initQuickDraft({request,say,authorize=async()=>true}){
 const $=id=>document.getElementById(id);let current=null,busy=false,dirty=false,stage='';
 const read=()=>latestPacks(JSON.parse(localStorage.getItem(QUICK_KEY)||'[]'));
 function lock(value){for(const id of ['quick-create','quick-save','quick-approve','quick-article','quick-x','quick-instagram','quick-source-check','quick-content-check','job-apply-request','job-reject','job-request','job-review','job-approve'])$(id).disabled=value;}
 function status(text){$('quick-status').textContent=text;}
 const stateName=p=>p.approvedAt?'承認済み':({revision_requested:'修正依頼中',rejected:'差し戻し',awaiting_approval:'承認待ち'})[p.jobState]||'承認待ち';
 const jobRows=()=>JSON.parse(localStorage.getItem(JOBS_KEY)||'[]');
 function jobReport(){
  const root=$('job-report');root.replaceChildren();const packs=read(),rows=jobRows();
  const today=new Date(Date.now()+9*3600000).toISOString().slice(0,10),todayRows=rows.filter(j=>new Date(Date.parse(j.updatedAt)+9*3600000).toISOString().slice(0,10)===today);const day=document.createElement('p');day.textContent=`今日の業務：${todayRows.length}ジョブ更新（重複判定・修正を含む）。案件状態は下の一覧で確認できます。`;root.append(day);
  const p=document.createElement('p');p.textContent=`作成記事 ${packs.length}件 / SNS案 ${packs.length*2}件 / 承認待ち ${packs.filter(p=>!p.approvedAt&&!['rejected','revision_requested'].includes(p.jobState)).length}件 / 修正依頼中 ${packs.filter(p=>p.jobState==='revision_requested').length}件 / エラー・中断 ${rows.filter(j=>['failed','running'].includes(j.state)).length}件。全てPreviewモック。自動公開・定期実行なし。`;root.append(p);const f=document.createElement('p');f.textContent='成果・収益は下の副業レポートに表示します。手入力の記録分のみで、未登録・API請求未確認を実績と扱いません。';root.append(f);
  const ms=JSON.parse(localStorage.getItem('jarvis_project_metrics_v1')||'[]').filter(m=>m.date.startsWith(today.slice(0,7))),metrics=document.createElement('p');metrics.textContent='今月の手入力成果（増分合計）：'+Object.entries({noteViews:'note閲覧',noteLikes:'noteスキ',xViews:'X表示',xReactions:'X反応',instagramViews:'Instagram表示',instagramReactions:'Instagram反応'}).map(([key,label])=>{const known=ms.filter(m=>m[key]!==null&&m[key]!==undefined);return label+' '+(known.length?known.reduce((n,m)=>n+Number(m[key]),0):'未登録');}).join(' / ');root.append(metrics);
  for(const row of rows.filter(j=>['failed','running'].includes(j.state))){const b=document.createElement('button');b.textContent=`${row.id}：${row.error||'中断・他タブ実行中の可能性'} ／ 手動で再試行`;b.onclick=()=>runJob(row.id);root.append(b);}
 }
 function list(){const root=$('quick-saved');root.replaceChildren();for(const p of read().sort((a,b)=>b.savedAt.localeCompare(a.savedAt))){const b=document.createElement('button');const j=jobRows().find(j=>j.id===p.projectId);b.textContent=p.title+' / '+p.projectId+' / '+stateName(p)+' / '+(j?'工程 '+(j.stages?.length||0)+'/6':'既存案件')+' / '+p.savedAt;b.onclick=async()=>{if(busy||!await authorize())return;if(dirty&&!confirm('未保存の編集を置き換えますか？'))return;current=structuredClone(p);dirty=false;render();status('保存版を開きました。自動取得・公開はしません。');};root.append(b);}jobReport();}
 function render(){if(!current)return;$('quick-result').hidden=false;$('job-revision-history').textContent=(current.revisionRequests||[]).map(r=>r.at+'：'+r.instruction).join('\n');$('quick-project').textContent=`案件ID：${current.projectId} / 版${current.revision} / Previewモック・実AI不使用 / ${current.approvedAt?'本人確認済み（公開はしていません）':'資料・記事・投稿案は未確認'}`;const s=$('quick-source');s.replaceChildren();const a=document.createElement('a');a.href=current.source.sourceUrl;a.textContent=current.source.title;a.target='_blank';a.rel='noopener noreferrer';s.append(a,document.createTextNode(` / 公開：${current.source.publishedAt} / 取得：${current.source.fetchedAt} / 情報源：Ollama公式 / ${current.source.reviewedAt?'本人確認済み':'真偽・全文は未確認'}`));for(const [id,key] of [['quick-article','article'],['quick-x','x'],['quick-instagram','instagram']])$(id).value=current[key];$('quick-source-check').checked=$('quick-content-check').checked=!!current.approvedAt;}
 async function persist(){current=await savePack(localStorage,navigator.locks,current,current.revision===0?0:current.revision);dirty=false;await recordJob(localStorage,navigator.locks,current.projectId,{state:current.approvedAt?'approved':current.jobState||'awaiting_approval',packId:current.projectId});list();render();window.dispatchEvent(new Event('jarvis-quick-changed'));}
 const button=$('quick-create');button.onclick=()=>runJob();
 async function runJob(retryId){
  if(busy)return;if(dirty&&!confirm('未保存の編集があります。業務を実行しますか？'))return;
  if(!await authorize())return;
  busy=true;lock(true);
  const id=retryId||crypto.randomUUID();let job;
  try{
   await navigator.locks.request('jarvis-internal-job-run',{ifAvailable:true},async lease=>{
    if(!lease)throw Error('別タブで内部ジョブを実行中です。完了を待ってください');
    const previous=jobRows().find(x=>x.id===id);job=await recordJob(localStorage,navigator.locks,id,{state:'running',error:null,attempt:(previous?.attempt||0)+1,stages:previous?.stages||[]});
    const existing=read().find(p=>p.projectId===id);
    if(existing){current=existing;stage='集計の再開';}
    else{
     stage='公開情報の取得';status('内部業務：公開情報を収集しています…');
     const data=previous?.sourceData||await request('/api/research/collect?source=ollama&q=AI');
     if(data.status!=='acquired'||!data.items?.length)throw Error(data.error||'公開情報を取得できません');
     job=await recordJob(localStorage,navigator.locks,id,{sourceData:{status:'acquired',items:[data.items[0]]},stages:['research']});
     const duplicate=read().find(p=>p.source.sourceUrl===data.items[0].sourceUrl&&p.source.publishedAt===data.items[0].publishedAt);
     if(duplicate){current=structuredClone(duplicate);await recordJob(localStorage,navigator.locks,id,{state:'duplicate',packId:duplicate.projectId});render();list();status('同じ出典・公開日時の案件があるため、重複作成せず既存案件を表示しました。');return;}
     stage='記事・SNS案の作成';current=createPack(data,id);current.revision=0;current.jobState='awaiting_approval';dirty=true;render();
     await recordJob(localStorage,navigator.locks,id,{stages:['research','content','marketing']});
     stage='端末への保存';await persist();
    }
    stage='成果・収支の整理';const snapshot=report({ledger:JSON.parse(localStorage.getItem('jarvis_business_ledger_v2')||'[]'),metrics:JSON.parse(localStorage.getItem('jarvis_project_metrics_v1')||'[]')});
    await recordJob(localStorage,navigator.locks,id,{state:current.approvedAt?'approved':current.jobState||'awaiting_approval',packId:current.projectId,stages:['research','content','marketing','analytics','finance','approval'],summary:{finance:snapshot.month,metrics:snapshot.metrics.filter(m=>m.projectId===current.projectId),notice:'手入力・記録分。未登録は未登録。API請求は未確認。'}});
    render();list();status('内部ジョブ完了：記事とSNS案を保存し、登録済み成果・収支を整理しました。内容確認・承認・修正依頼だけ行えます。公開はしていません。');
   });
  }catch(e){try{if(job)await recordJob(localStorage,navigator.locks,id,{state:'failed',error:stage+'：'+e.message});jobReport();}catch{}status(`${stage||'業務開始'}で停止しました：${e.message}。業務報告の再試行ボタンから手動で再開してください。自動再送しません。`);}
  finally{busy=false;lock(false);}
 }
 for(const id of ['quick-article','quick-x','quick-instagram'])$(id).oninput=()=>{if(!current)return;current.article=$('quick-article').value;current.x=$('quick-x').value;current.instagram=$('quick-instagram').value;current.approvedAt=null;current.jobState='awaiting_approval';current.source.reviewedAt=null;$('quick-source-check').checked=$('quick-content-check').checked=false;dirty=true;status('未保存の編集があります。「編集を保存」を押してください。承認状態は解除しました。');};
 async function save(approve=false){if(busy||!current||!await authorize())return;busy=true;lock(true);try{if(!current.article.trim()||!current.x.trim()||!current.instagram.trim())throw Error('記事と投稿案を空にしないでください');if(approve){const job=jobRows().find(j=>j.id===current.projectId);if(current.jobState==='revision_requested')throw Error('修正依頼が未反映です。本文を修正して保存してから再承認してください');if(job?.attempt>0&&(!job.stages?.includes('approval')||['failed','running'].includes(job.state)))throw Error('内部業務が未完了です。業務報告から再試行して完了を確認してください');if(!$('quick-source-check').checked||!$('quick-content-check').checked)throw Error('出典と内容を本人が確認して、両方にチェックしてください');current.jobState='approved';current.approvedAt=new Date().toISOString();current.source.reviewedAt=current.approvedAt;}await persist();status(approve?'本人の確認を記録し保存しました。公開はしていません。':'編集を新しい版として保存しました。');}catch(e){status(e.message+' 編集は画面に残っています。コピーして退避できます。');}finally{busy=false;lock(false);}}
 $('quick-save').onclick=()=>save();$('quick-approve').onclick=()=>save(true);
 $('job-review').onclick=async()=>{if(!await authorize())return;$('quick-result').hidden=!current;if(current)$('quick-result').scrollIntoView({behavior:'smooth'});else status('承認待ち案件はありません。一括作成ボタンで内部ジョブを手動実行してください。');};
 $('job-approve').onclick=async()=>{if(!current){status('先に承認待ち案件を開いてください');return;}if(await authorize()&&confirm('出典の全文・公開日時・利用条件と、記事・SNS案の内容・引用・表現を本人が確認しましたか？承認しても公開しません。')){$('quick-source-check').checked=$('quick-content-check').checked=true;await save(true);}};
 $('job-request').onclick=async()=>{if(!await authorize())return;if(!current){status('先に承認待ち案件を開くか、一括作成で業務を実行してください');return;}$('job-revision-panel').hidden=false;$('job-instruction').focus();};
 $('job-reject').onclick=async()=>{if(busy||!current||!await authorize())return;busy=true;lock(true);try{current.jobState='rejected';current.approvedAt=null;current.source.reviewedAt=null;current.revisionRequests=[...(current.revisionRequests||[]),{instruction:$('job-instruction').value||'本人が差し戻しました',at:new Date().toISOString(),mode:'manual-reject'}];await persist();status('差し戻しを案件IDに紐づけて保存しました。公開しません。');}catch(e){status(e.message);}finally{busy=false;lock(false);}};
 $('job-apply-request').onclick=async()=>{if(busy||!current||!await authorize())return;busy=true;lock(true);try{current=reviseMock(current,$('job-instruction').value);if(current.jobState==='awaiting_approval'){const posts=socialDrafts({projectId:current.projectId,title:current.title,article:current.article,evidence:current.evidence,mock:true});current.x=posts.x;current.instagram=posts.instagram;}await persist();status(current.jobState==='revision_requested'?'修正依頼を保存しました。モックが自動反映できない依頼です。本文を編集して保存すると再承認待ちに戻ります。':'モック修正を反映し再承認待ちにしました。出典は未確認のままです。');}catch(e){status(e.message);}finally{busy=false;lock(false);}};
 for(const key of ['article','x','instagram'])$('quick-copy-'+key).onclick=async()=>{if(!await authorize())return;try{await navigator.clipboard.writeText($('quick-'+key).value);status('コピーしました。自動投稿は行いません。');}catch{$('quick-'+key).focus();$('quick-'+key).select();status('文章を選択しました。端末のコピー操作を使ってください。');}};
 window.addEventListener('jarvis-ledger-changed',()=>{try{jobReport();}catch(e){say(e.message);}});window.addEventListener('storage',e=>{if(e.key===QUICK_KEY)try{list();}catch(e){say(e.message);}});try{list();const packs=read().sort((a,b)=>b.savedAt.localeCompare(a.savedAt));if(packs.length){current=structuredClone(packs[0]);render();status('前回保存した下書きを表示しています。新たな取得・生成・公開はしていません。');}}catch(e){status(e.message+' 新規作成せず、既存データを確認してください。');button.disabled=true;}
}
