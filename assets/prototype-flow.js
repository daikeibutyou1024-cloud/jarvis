export function prototypeProgress(s={}) {
 const stages=[['情報取得',!!s.records],['資料確認',!!s.reviewed],['テーマ選定',!!s.plan],['引き継ぎ',!!s.handoff],['下書き生成',!!s.text],['保存',!!s.saved],['再読込・照合',!!s.reloaded]];
 const first=stages.find(([,done])=>!done);
 return {stages,next:first?.[0]||'内容確認・手動公開',complete:!first};
}
export function initPrototypeFlow({getState,navigate}) {
 const $=id=>document.getElementById(id);let reloaded=null;
 const stamp=d=>JSON.stringify([d.projectId,d.revision,d.text,d.evidence]);
 const hints={
  '情報取得':['research','research-source','情報源とキーワードを選び「無料の情報源から取得」を押してください。'],
  '資料確認':['research','research-records','出典と取得内容を開いて確認し、使う事実資料を確認済みにして選択してください。取得だけでは確認済みになりません。'],
  'テーマ選定':['research','research-propose','制作ブリーフのテーマを入力し、確認済み資料から企画を提案してください。AI料金・回数を消費します。'],
  '引き継ぎ':['research','research-plans','採用する企画の「この企画と確認済み資料でCONTENTへ」を押してください。評価はAI仮説です。'],
  '下書き生成':['content','editorial-research','「現在のRESEARCH資料・企画を取り込む」で構成を準備し、下の「AIで作成＋クラウド保存」を明示的に1回実行してください。既存原稿は先に保存してください。'],
  '保存':['content','editorial-save','本文・出典・生成状態を確認し「制作案件を保存」を押してください。保存自体はAIを使いません。'],
  '再読込・照合':['content','editorial-load','「保存版から再開」で同じ案件・版を再取得してください。編集中なら先に保存してください。'],
  '内容確認・手動公開':['content','editorial-panel','Aの保存・再読込を確認しました。記事の完成・内容・出典・PR表記は別途人間が確認します。自動公開は行いません。'],
 };
 function refresh(){const s=getState();s.reloaded=!!reloaded&&s.saved&&stamp(s)===reloaded;const p=prototypeProgress(s);const root=$('prototype-steps');root.replaceChildren();for(const [label,done] of p.stages){const li=document.createElement('li');li.textContent=(done?'✓ ':'○ ')+label;li.dataset.done=String(done);root.append(li);}const hint=hints[p.next];$('prototype-next').textContent='次：'+p.next+' — '+hint[2];$('prototype-go').onclick=()=>{navigate(hint[0]);$(hint[1])?.scrollIntoView({block:'center',behavior:'auto'});$(hint[1])?.focus({preventScroll:true});};$('prototype-flow').dataset.complete=String(p.complete);}
 return {refresh,loaded(d){reloaded=JSON.stringify([d.projectId,d.revision,d.output,d.evidence||'']);},failure(message){$('prototype-result').textContent='操作停止：'+message+' 自動再試行は行いません。保存・実行履歴を確認してください。';},success(message){$('prototype-result').textContent=message;}};
}
