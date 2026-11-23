// One shared dictation controller for the orb and the text-field microphone.
// No authentication, AI, submission, network or storage operations belong here.
export function createVoiceInput({Recognition,getText,onText,onListening=()=>{},onState=()=>{},onComplete=()=>{},cancelSpeech=()=>{},isHidden=()=>false,silenceMs=3000,now=Date.now,setTimer=setTimeout,clearTimer=clearTimeout}) {
 let rec=null,active=false,stopping=false,timer=null,endTimer=null,epoch=0,base='',heard='',confirmedText='',lastActivityAt=0,stopReason='natural';
 const clear=()=>{clearTimer(timer);clearTimer(endTimer);timer=endTimer=null;};
 const finish=(message,error=false,reason=stopReason)=>{const completed={text:heard,confirmedText,lastActivityAt,reason,error};const old=rec;rec=null;active=false;stopping=false;epoch++;clear();if(old)for(const key of ['onstart','onresult','onend','onerror','onspeechstart','onspeechend'])old[key]=null;onListening(false);onState(error?'error':'idle',message);onComplete(completed);};
 function stop(message='音声入力を停止しました。文章を確認して送信してください。',{abort=false,reason='manual'}={}) {
  if(!active)return;stopReason=reason;
  if(abort){const old=rec;finish(message);try{old?.abort?.();}catch{}return;}
  if(stopping)return;stopping=true;clearTimer(timer);onListening(false);onState('stopping','音声を確定しています…');
  const old=rec,token=epoch;endTimer=setTimer(()=>{if(token!==epoch)return;finish(message);try{old?.abort?.();}catch{}},1000);
  try{old.stop();}catch{finish(message);try{old?.abort?.();}catch{}}
 }
 const arm=()=>{clearTimer(timer);if(active&&!stopping)timer=setTimer(()=>stop('無音を検知して停止しました。文章を確認し、送信ボタンを押してください。',{reason:'silence'}),silenceMs);};
 function start(){
  if(active){stop();return;}
  if(isHidden())return;
  if(!Recognition){onState('error','音声入力に非対応です。文字で入力してください。');onComplete({reason:'error',error:true,text:''});return;}
  cancelSpeech();base=getText();heard='';confirmedText='';lastActivityAt=now();stopReason='natural';let current;
  try{current=new Recognition();}catch{onState('error','音声認識を開始できません。文字で入力してください。');onComplete({reason:'error',error:true,text:''});return;}
  rec=current;active=true;stopping=false;const token=++epoch;const valid=()=>rec===current&&token===epoch;
  current.lang='ja-JP';current.continuous=true;current.interimResults=true;
  onState('starting','マイクを準備しています…');
  current.onstart=()=>{if(!valid()||stopping)return;clearTimer(endTimer);endTimer=null;lastActivityAt=now();onListening(true);onState('listening','聞いています。発話後、約3秒の無音で停止します。自動送信はしません。');timer=setTimer(()=>stop('発話を検出できませんでした。タップして再開してください。',{reason:'idle'}),30000);};
  current.onresult=event=>{
   if(!valid())return;let text='',final='';for(let i=0;i<event.results.length;i++){const part=event.results[i][0]?.transcript||'';text+=part;if(event.results[i].isFinal)final+=part;}confirmedText=final;if(!stopping)lastActivityAt=now();
   if(text){heard=text;onText(base+(base&&heard?' ':'')+heard);}
   if(!stopping)arm();
  };
  current.onspeechstart=()=>{if(valid()&&!stopping){lastActivityAt=now();arm();}};
  current.onspeechend=()=>{if(valid()&&!stopping){lastActivityAt=now();arm();}};
  current.onend=()=>{if(valid())finish('音声入力を終了しました。文章を確認して送信してください。');};
  current.onerror=event=>{
   if(!valid())return;const old=current;
   const message=['not-allowed','service-not-allowed'].includes(event.error)?'マイクの利用が許可されていません。Safariのマイク設定を確認してください。':event.error==='no-speech'?'音声を検出できませんでした。入力済みの文章は保持しています。':'音声認識に失敗しました。文章は保持しています。タップして再開できます。';
   finish(message,event.error!=='no-speech','error');try{old.abort?.();}catch{}
  };
  endTimer=setTimer(()=>{if(valid()){finish('音声認識が開始されませんでした。再開ボタンを押してください。',true,'error');try{current.abort?.();}catch{}}},30000);
  try{current.start();}catch{finish('音声入力を開始できませんでした。マイク設定を確認してください。',true,'error');try{current.abort?.();}catch{}}
 }
 return {start,stop,get active(){return active;}};
}
