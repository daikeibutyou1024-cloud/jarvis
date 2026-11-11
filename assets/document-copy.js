export function initDocumentCopy({request,say,getCurrentDocument,getBusy=()=>false,setBusy=()=>{},assertCanReplace=()=>{},applyCopy}){
 const $=id=>document.getElementById(id);let busy=false,prepared=null,saved=null;
 const buttons=['copy-preview','copy-save','copy-open'];
 async function work(fn){if(busy||getBusy())return;busy=true;setBusy(true);for(const id of buttons)$(id).disabled=true;$('copy-confirmed').disabled=true;try{await fn();}catch(e){say(e.message);}finally{busy=false;setBusy(false);for(const id of buttons)$(id).disabled=false;$('copy-confirmed').disabled=false;}}
 $('copy-preview').onclick=()=>work(async()=>{
  prepared=null;saved=null;$('copy-confirmed').checked=false;$('copy-content').value='';$('copy-status').textContent='保存版を確認中…';
  const d=getCurrentDocument();
  try{const data=await request('/api/business/document-copy','POST',{action:'preview',sourceProjectId:d.projectId,sourceRevision:d.revision});prepared={source:data.source,target:crypto.randomUUID()};
   $('copy-content').value=JSON.stringify({source:data.source,department:data.document.department,topic:data.document.topic,audience:data.document.audience,notes:data.document.notes,format:data.document.format,workflow:data.document.workflow,evidence:data.document.evidence,output:data.document.output},null,2);
   $('copy-status').textContent=`元の案件 ${data.source.projectId} / 版${data.source.revision} → 新しい案件 ${prepared.target}。${data.notice}`;say('保存済みの版を表示しました。まだ複製していません。編集中の内容は含みません。');
  }catch(e){$('copy-status').textContent='保存版を確認できませんでした。元データ・編集中の内容は変更していません。';throw e;}
 });
 $('copy-save').onclick=()=>work(async()=>{
  if(!prepared||!$('copy-confirmed').checked)throw Error('先に保存版をプレビューし、内容を確認してください');
  const binding=prepared;const data=await request('/api/business/document-copy','POST',{action:'copy',sourceProjectId:binding.source.projectId,sourceRevision:binding.source.revision,preparedDigest:binding.source.digest,targetProjectId:binding.target,confirmed:true});saved=data.document;
  $('copy-status').textContent=`複製した案件 ${saved.projectId} / 版${saved.revision}。${data.notice} 開く場合は「複製した案件を開く」を押してください。`;say('別案件への保存が完了しました。編集中の画面は切り替えていません。');
 });
 $('copy-open').onclick=()=>{if(busy||getBusy())return;try{if(!saved)throw Error('先に別案件として保存してください');assertCanReplace();applyCopy(saved);say('複製した案件を開きました。元の案件は保持しています。全文確認をやり直してください。');}catch(e){say(e.message);}};
}
