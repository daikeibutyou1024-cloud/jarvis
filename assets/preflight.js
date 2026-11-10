const labels={development_branch:'開発ブランチ',other_branch:'別のブランチ',unknown:'不明',unavailable:'確認不能',incomplete:'不足あり',columns_present:'必須列あり（その他は未検証）',unconfigured:'未設定または形式不正',configured_unverified:'設定形式を確認（実接続は未検証）',ledger_unavailable:'利用台帳は未確認',blocked:'停止条件あり',disabled:'全体停止',idle:'対象時刻の設定なし',eligible_snapshot:'開始条件の見込みあり（稼働は未確認）'};
const reasons={configuration:'設定形式が不正',configuration_or_storage:'設定または読取に問題あり',global_stop:'全体停止',dedicated_token_missing:'専用認証が未設定',inbox_capacity:'受信箱の容量上限',already_running:'別の処理が実行中',daily_limit:'本日の試行上限',nothing_due:'対象時刻の設定なし',storage_unavailable:'保存先が未確認'};
export function initPreflight({request,say,getBusy=()=>false}){
 const button=document.getElementById('preflight-check'),output=document.getElementById('preflight-output');let busy=false;
 button.onclick=async()=>{
  if(busy||getBusy())return;busy=true;button.disabled=true;output.textContent='確認中…';
  try{
   const d=await request('/api/business/preflight');
   const lines=[`確認時刻：${d.checkedAt}`,d.notice,`環境：${labels[d.environment.state]||'不明'}`,d.environment.notice,`保存先：${labels[d.database.state]||'確認不能'}`,d.database.notice];
   for(const t of d.database.tables)if(t.state!=='columns_present')lines.push(`${t.name}：${t.state==='missing'?'未作成':'必須列不足'}（${t.missingColumns.join(', ')}）`);
   lines.push(`AI：${labels[d.ai.state]||'確認不能'}`,d.ai.notice);
   if(d.ai.month)lines.push(`UTC対象月 ${d.ai.month} / 管理値・予約 $${(d.ai.committedMicroUSD/1e6).toFixed(6)} / 管理上の残枠 $${(d.ai.remainingMicroUSD/1e6).toFixed(6)}（請求実額・次回の生成可否は未確認） / 停止対象 ${d.ai.blockingOperations}件 / 期限超過 ${d.ai.expiredRunning}件`);
   lines.push(`定期収集：${labels[d.collection.state]||'確認不能'}`,...d.collection.reasons.map(r=>reasons[r]||'条件を再確認してください'),d.collection.notice);
   if(d.collection.snapshot){const s=d.collection.snapshot;lines.push(`対象時刻の設定 ${s.due}件 / 実行中 ${s.running}件 / 期限超過 ${s.expiredRunning}件（整理は未実行） / 試行 ${s.attemptsTodayUTC}/${d.collection.dailyLimit}回（UTC日） / 受信箱 ${s.inbox}/500件`);}
   lines.push('別途確認が必要：',...d.manualChecks.map(c=>c.message),'本番反映の準備は未完了です');output.textContent=lines.filter(Boolean).join('\n');say('設定と開始条件を確認しました。AI・収集・データ変更は実行していません。');
  }catch(e){output.textContent='確認できませんでした。以前の確認結果を現在の状態として扱わないでください。';say(e.message);}
  finally{busy=false;button.disabled=false;}
 };
}
