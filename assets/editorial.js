import {defaultOutline,workflowInput,compactGeneration,editorialReport,REVIEW_CHECKS} from '../lib/editorial.js';
const stages={planning:'企画・構成を準備',drafting:'本文を作成・補完',review_pending:'全文確認待ち',approved:'この版は全文確認済み'};
export function initEditorial({request,say,getDraft,applyDraft,selectChapter,researchSnapshot,adoptEvidence,cloneDraft,setBusy,getBusy}){
 const $=id=>document.getElementById(id);let savedSignature=null,backupSignature=null,queueCursor=null,operationBusy=false;
 function workflow(){return workflowInput({idea:$('editorial-idea').value,outline:$('editorial-outline').value.split('\n').filter(x=>x.trim()),noExternalFacts:$('editorial-no-facts').checked},getDraft().format);}
 function signature(){const d=getDraft();return JSON.stringify({...d,generation:compactGeneration(d.generation),workflow:{idea:$('editorial-idea').value,outline:$('editorial-outline').value,noExternalFacts:$('editorial-no-facts').checked}});}
 function dirty(){try{return !savedSignature||savedSignature!==signature();}catch{return true;}}
 function clearChecks(){for(const k of REVIEW_CHECKS)$('review-'+k).checked=false;$('editorial-export').value='';$('editorial-free').value='';$('editorial-paid').value='';}
 function render(report){
  $('editorial-status').textContent=`${stages[report.stage]||report.stage} / ${report.characters}文字 / 資料${report.sourceCount}件。${report.notice}`;
  $('editorial-missing').textContent=report.missing.join(' ／ ')||'形式検査を通過しました。全文と出典を確認してください。';
  const root=$('editorial-chapters');root.replaceChildren();
  for(const c of report.chapters){const li=document.createElement('li'),b=document.createElement('button');li.textContent=`${c.title} / ${c.status==='missing'?'未作成':c.status==='duplicate'?'重複・要修正':c.status==='needs_work'?'補完が必要':'本文あり・内容は要確認'} `;b.textContent='この章を選択';b.onclick=()=>{selectChapter(c.title);say('対象章を選択しました。既存章の補完には「続きを作成」を使ってください。AIはまだ呼び出していません。');};li.append(b);root.append(li);}
 }
 function observeDocument(value,saved=false){
  const format=getDraft().format;
  $('editorial-idea').value=value?.idea||'';
  $('editorial-outline').value=(value?.outline||defaultOutline(format)).join('\n');
  $('editorial-no-facts').checked=value?.noExternalFacts===true;
  savedSignature=null;clearChecks();
  if(value)render(editorialReport({...getDraft(),output:getDraft().text,workflow:value}));
  else $('editorial-status').textContent='資料・企画・構成・本文を制作案件として保存できます。';
  if(saved){savedSignature=signature();if(value)$("editorial-status").textContent=`版${getDraft().expectedRevision}の保存原稿です。全文確認の記録は「制作状況を取得」で確認できます。`;}
 }
 function accept(data){applyDraft(data.document);observeDocument(data.document.workflow);savedSignature=signature();render(data.report);}
 async function guarded(task){if(operationBusy||getBusy())return;operationBusy=true;setBusy(true);for(const id of ['editorial-save','editorial-load','editorial-approve','editorial-download'])$(id).disabled=true;try{await task();}catch(e){say(e.message);}finally{operationBusy=false;setBusy(false);for(const id of ['editorial-save','editorial-load','editorial-approve','editorial-download'])$(id).disabled=false;}}
 function assertCanReplace(){if(dirty()&&backupSignature!==signature()&&(getDraft().text.trim()||$('editorial-idea').value.trim()))throw Error('編集中の原稿・企画を制作案件または端末に保存してから開いてください');}
 function requireSaved(){if(dirty())throw Error('編集中の内容があります。先に「制作案件を保存」を押してください');}
 $('editorial-default-outline').onclick=()=>{if(operationBusy)return;$('editorial-outline').value=defaultOutline(getDraft().format).join('\n');clearChecks();say('既定の構成を入力しました。保存すると新しい版になります。');};
 $('editorial-clone').onclick=()=>{if(operationBusy)return;cloneDraft();savedSignature=null;clearChecks();say('原稿を保持して別の案件IDを用意しました。既存案件は変更していません。');};
 $('editorial-research').onclick=()=>{try{if(operationBusy)return;const snapshot=researchSnapshot();if(!snapshot.evidence)throw Error('RESEARCHで確認済み資料をCONTENTへ引き継いでください');adoptEvidence(snapshot.evidence);if(snapshot.idea)$('editorial-idea').value=snapshot.idea;clearChecks();say('確認済み資料と採用企画を取り込みました。制作案件を保存してください。');}catch(e){say(e.message);}};
 $('editorial-save').onclick=()=>guarded(async()=>{const d=getDraft();const data=await request('/api/business/editorial','POST',{...d,action:'save',workflow:workflow(),generation:compactGeneration(d.generation),manualComplete:d.generation?.articleStatus==='manual_complete'});accept(data);say('資料・企画・構成・本文を同じ案件の新しい版として保存しました。AIは利用していません。');});
 $('editorial-load').onclick=()=>guarded(async()=>{if(dirty()&&backupSignature!==signature()&&(getDraft().text.trim()||$('editorial-idea').value.trim()))throw Error('編集中の原稿があります。制作案件を保存するか端末保存してから、一覧の「開く」で再開してください');const d=getDraft();accept(await request('/api/business/editorial?projectId='+encodeURIComponent(d.projectId)));say('保存した制作案件を再開しました。');});
 $('editorial-approve').onclick=()=>guarded(async()=>{requireSaved();const d=getDraft();const checks=Object.fromEntries(REVIEW_CHECKS.map(k=>[k,$('review-'+k).checked]));const data=await request('/api/business/editorial','POST',{action:'approve',projectId:d.projectId,expectedRevision:d.expectedRevision,checks});render(data.report);say('現在の保存版の全文確認を記録しました。公開・販売は行いません。');});
 $('editorial-download').onclick=()=>guarded(async()=>{requireSaved();const d=getDraft();const data=await request('/api/business/editorial','POST',{action:'export',projectId:d.projectId,expectedRevision:d.expectedRevision});$('editorial-export').value=data.markdown;$('editorial-free').value=data.freeMarkdown;$('editorial-paid').value=data.paidMarkdown;const blob=new Blob([data.markdown],{type:'text/markdown;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`jarvis-${d.projectId}-v${data.revision}.md`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);say(`版${data.revision}の原稿を出力しました。${data.notice}`);});
 async function queue(before=null){const data=await request('/api/business/editorial'+(before?'?before='+before:''));const root=$('editorial-queue');root.replaceChildren();for(const p of data.projects){const li=document.createElement('li'),b=document.createElement('button');li.textContent=`${p.topic} / 版${p.revision} / ${stages[p.report.stage]} `;b.textContent='開く';b.onclick=()=>guarded(async()=>{if(dirty()&&backupSignature!==signature()&&(getDraft().text.trim()||$('editorial-idea').value.trim()))throw Error('編集中の原稿を制作案件または端末に保存してから開いてください');accept(await request('/api/business/editorial?projectId='+encodeURIComponent(p.projectId)));say('制作案件を開きました。');});li.append(b);root.append(li);}queueCursor=data.nextCursor;$('editorial-queue-next').hidden=!queueCursor;if(!data.projects.length)root.textContent='保存した制作案件はありません';}
 $('editorial-queue-refresh').onclick=()=>guarded(()=>queue());$('editorial-queue-next').onclick=()=>guarded(()=>queue(queueCursor));
 for(const id of ['topic','audience','format','notes','output','editorial-idea','editorial-outline','editorial-no-facts'])$(id).addEventListener('input',()=>{if(savedSignature){clearChecks();$('editorial-status').textContent='編集中です。保存すると以前の全文確認を引き継がず、新しい版になります。';}});
 observeDocument(null);
 return {observeDocument,requireSaved,assertCanReplace,workflow,accept,markSaved:()=>{savedSignature=signature();},hasWorkflowEdits:()=>!!$("editorial-idea").value.trim()||$("editorial-no-facts").checked||$("editorial-outline").value!==defaultOutline(getDraft().format).join("\n"),markBackup:()=>{try{backupSignature=signature();}catch{backupSignature=null;}},rawWorkflow:()=>({version:1,idea:$("editorial-idea").value,outline:$("editorial-outline").value.split("\n").filter(x=>x.trim()),noExternalFacts:$("editorial-no-facts").checked})};
}
