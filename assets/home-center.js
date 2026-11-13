// HOME presentation only. Existing chat nodes and handlers are reused, never cloned.
export function initHomeCenter() {
  const $=id=>document.getElementById(id), core=$('orb-voice');
  const chat=document.querySelector('.panel.chat');
  $('history-chat-slot').append(chat);
  $('home-command').insertBefore($('voice-conversation-controls'),$('manual-input'));
  $('manual-input').append($('chat-form'));
  $('voice-options').append($('speak').closest('label'));
  $('voice-options').append($('stop-speech'));
  new MutationObserver(()=>{const items=$('conversation').querySelectorAll('.message');const latest=items[items.length-1];$('conversation-latest').textContent=latest?latest.textContent.slice(0,180):'会話・実行結果はまだありません';}).observe($('conversation'),{childList:true,subtree:true});
  new MutationObserver(()=>{const text=$('status').textContent;if(text&&!/^(回答しました|J.A.R.V.I.S.が考え)/.test(text))$('conversation-latest').textContent=text.slice(0,180);}).observe($('status'),{childList:true,subtree:true,characterData:true});
  const labels={idle:'待機中',listening:'音声入力中',thinking:'回答生成中',speaking:'読み上げ中',error:'エラー / 内容を確認'};
  const update=({state='idle',listening=false,speaking=false,thinking=false}={})=>{
    $('overview').dataset.coreState=state;
    $('overview').classList.toggle('hud-paused',document.hidden);
    $('home-state').textContent=labels[state];
    $('home-input-state').textContent=listening?'入力中':('SpeechRecognition' in window||'webkitSpeechRecognition' in window)?'待機 / タップで開始':'非対応';
    $('home-speech-state').textContent=speaking?'読み上げ中':('speechSynthesis' in window)?'停止中':'非対応';
    $('communication-state').textContent=thinking?'回答を生成しています…':labels[state];
  };
  core.addEventListener('core-state',e=>update(e.detail));update({state:core.dataset.state});
  const tick=()=>{if(document.hidden)return;const now=new Date();$('home-time').textContent=now.toLocaleTimeString('ja-JP',{hour12:false});$('home-date').textContent=now.toLocaleDateString('ja-JP',{year:'numeric',month:'2-digit',day:'2-digit',weekday:'short'});};
  $('home-timezone').textContent=Intl.DateTimeFormat().resolvedOptions().timeZone;
  tick();let timer=setInterval(tick,1000);
  document.addEventListener('visibilitychange',()=>{clearInterval(timer);if(!document.hidden){tick();timer=setInterval(tick,1000);}});
}
