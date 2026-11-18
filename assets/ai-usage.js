import {usdMicro} from '../lib/ai-money.js';
export function initAIUsage({request,say,getBusy=()=>false}){
 const $=id=>document.getElementById(id);const panel=$('prepaid-panel'),workspace=$('workspace');if(panel&&workspace)workspace.append(panel);let busy=false,threadsAttempted=false;
 async function work(fn){if(busy||getBusy())return;busy=true;$('usage-refresh').disabled=true;try{await fn();}catch(e){say(e.message);}finally{busy=false;$('usage-refresh').disabled=false;}}
 async function refresh(){
  const d=await request('/api/business/usage');
  $('usage-summary').textContent=d.mode==='prepaid'?`プリペイド方式（月額上限なし） / Claude累計記録費用 $${(d.recordedCostMicroUSD/1e6).toFixed(6)} / 未確定予約 $${(d.pendingMicroUSD/1e6).toFixed(6)} / ユーザー報告残高 約$${(d.reportedBalanceMicroUSD/1e6).toFixed(2)} / 推定残高 ${d.estimatedBalanceMicroUSD===null?(Number.isSafeInteger(d.referenceEstimateMicroUSD)?'参考 $'+(d.referenceEstimateMicroUSD/1e6).toFixed(6)+'（報告値－未確定予約・未照合）':'基準時点の照合待ち'):'$'+(d.estimatedBalanceMicroUSD/1e6).toFixed(6)}。${d.notice}`:`${d.month} UTC / 月額予算 $${d.budgetUSD??'未設定'} / 確定・予約＋開始額 $${(d.committedMicroUSD/1e6+Number(d.openingUSD)).toFixed(6)}。${d.notice}`;
  if($('threads-generate'))$('threads-generate').disabled=threadsAttempted||d.threadsAllowed!==true;
  const root=$('usage-list');root.replaceChildren();
  for(const op of d.operations){
   const li=document.createElement('li');li.textContent=`${op.id} / ${op.provider||''} / ${op.purpose} / ${op.state} / $${(op.charged_micro/1e6).toFixed(6)}`;
   if(d.mode==='prepaid'&&op.usage_json){try{const credit=JSON.parse(op.usage_json).prepaid;if(Number.isSafeInteger(credit?.estimatedBalanceMicroUSD)){const balance=document.createElement('p');balance.textContent=`この処理後の推定残高 $${(credit.estimatedBalanceMicroUSD/1e6).toFixed(6)}（実残高ではありません）`;li.append(balance);}}catch{}}
   if(op.reconciliation_recorded_at!==null&&op.reconciliation_recorded_at!==undefined){const audit=document.createElement('p');audit.textContent=`照合前 ${op.reconciliation_prior_state} / 管理値 $${(op.reconciliation_prior_charged_micro/1e6).toFixed(6)} → 確認額 $${(op.reconciliation_charged_micro/1e6).toFixed(6)} / ${new Date(op.reconciliation_recorded_at).toISOString()} / ${op.reconciliation_note}。元のトークン利用情報は保持しています。`;li.append(audit);}
   else if(op.state==='reconciled'){const legacy=document.createElement('p');legacy.textContent='旧形式の照合済み記録です。今回追加した詳細履歴はありません。';li.append(legacy);}
   if(['uncertain','interrupted','overrun'].includes(op.state)){
    const form=document.createElement('form'),amount=document.createElement('input'),note=document.createElement('input'),check=document.createElement('input'),label=document.createElement('label'),button=document.createElement('button');
    amount.type='number';amount.min='0';amount.step='0.000001';amount.required=true;amount.placeholder='請求確認額（USD）';amount.setAttribute('aria-label','請求確認額（USD）');
    note.required=true;note.maxLength=500;note.placeholder='請求履歴を確認したメモ';note.setAttribute('aria-label','請求確認メモ');check.type='checkbox';check.required=true;label.append(check,document.createTextNode('請求を確認しました'));button.textContent='確認額で照合する';form.append(amount,note,label,button);
    form.onsubmit=e=>{e.preventDefault();return work(async()=>{
     if(!check.checked||!note.value.trim())throw Error('請求履歴の確認とメモが必要です');const chargedMicroUSD=usdMicro(amount.value);
     for(const element of [amount,note,check,button])element.disabled=true;
     try{const result=await request('/api/business/usage','POST',{id:op.id,chargedMicroUSD,note:note.value,confirmed:true,expectedState:op.state,expectedChargedMicroUSD:op.charged_micro});say(result.alreadyReconciled?'同じ照合は保存済みです。追加変更はしていません。':'利用額を照合しました。元の利用情報と照合履歴を保持しました。再試行は行いません。');await refresh();}
     finally{for(const element of [amount,note,check,button])element.disabled=false;}
    });};li.append(form);
   }root.append(li);
  }
 }
 if($('threads-generate'))$('threads-generate').onclick=()=>work(async()=>{
  if(threadsAttempted)return;threadsAttempted=true;$('threads-generate').disabled=true;
  try{const d=await request('/api/business/threads-preview','POST',{topic:$('threads-topic').value});$('threads-output').value=d.answer;$('threads-status').textContent=d.complete?'下書きを生成しました。本日の追加生成は停止します。内容を確認して手動で利用してください。':'出力上限で途中終了しました。本日は再送せず、下書きを手動で編集してください。';await refresh();}
  catch(error){$('threads-status').textContent=error.message;}
  finally{$('threads-generate').disabled=true;}
 });
 $('usage-refresh').onclick=()=>work(()=>refresh());
}
