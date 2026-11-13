// Opt-in voice loop. Recognition/AI failures pause; never retry a sent AI request.
export function createVoiceConversation({Recognition,authorize,send,speak,cancelSpeech,onTranscript=()=>{},onListening=()=>{},onState=()=>{},isBusy=()=>false,isHidden=()=>false,silenceMs=1200,setTimer=setTimeout,clearTimer=clearTimeout}) {
 let session=0,active=false,phase='stopped',recognition=null,turn=null,timer=null;
 const state=(value,message)=>{phase=value;onState(value,message);};
 const clear=()=>{if(timer!==null)clearTimer(timer);timer=null;};
 function stop(message='音声会話を停止しました'){
  session++;active=false;clear();const old=recognition;recognition=null;turn=null;
  onListening(false);cancelSpeech();try{old?.abort?.();}catch{}state('stopped',message);
 }
 function pause(message){stop(message);state('paused',message);}
 function listen(token){
  if(!active||token!==session)return;
  if(isHidden()||isBusy()){pause('画面または処理状態を確認し、音声会話を再開してください');return;}
  const current={final:'',interim:'',sent:false,ended:false,stopping:false};turn=current;
  let rec;try{rec=new Recognition();}catch{pause('音声認識を開始できません。タップして再開してください');return;}
  recognition=rec;rec.lang='ja-JP';rec.continuous=false;rec.interimResults=true;
  const valid=()=>active&&token===session&&turn===current;
  const arm=()=>{clear();timer=setTimer(()=>{timer=null;if(!valid())return;if(!current.ended){state('finishing','発話終了を待っています…');try{current.stopping=true;rec.stop();if(!current.ended)timer=setTimer(()=>{if(valid()&&!current.ended)pause('音声認識が終了しませんでした。再開ボタンからやり直してください');},3000);}catch{pause('音声認識の終了に失敗しました。再開してください');}}else void transmit();},silenceMs);};
  async function transmit(){
   if(!valid()||current.sent)return;clear();
   const text=current.final.trim();if(!text){pause('発話を確定できませんでした。再開して話すか、テキストで入力してください');return;}
   if(text.length>2000){pause('音声が2000文字を超えました。短くして再開してください');return;}
   current.sent=true;onListening(false);recognition=null;state('processing','回答を生成しています。音声の自動再送はしません。');
   try{const answer=await send(text);if(!valid())return;if(!answer?.trim())throw Error('回答が空でした。再実行前に実行履歴を確認してください');state('speaking','回答を読み上げています…');await speak(answer);if(!valid())return;listen(token);}
   catch(error){if(valid())pause(error.message||'会話に失敗しました。実行履歴を確認してから再開してください');}
  }
  rec.onstart=()=>{if(!valid())return;clear();timer=setTimer(()=>{if(valid())pause('発話を検出できませんでした。音声会話を再開してください');},30000);onListening(true);state('listening','聞いています。発話終了後に自動送信します。');};
  rec.onresult=event=>{
   if(!valid()||current.sent||current.ended)return;
   let final='',interim='';for(let i=0;i<event.results.length;i++){const result=event.results[i],text=result[0]?.transcript||'';if(result.isFinal)final+=text;else interim+=text;}
   current.final=final;current.interim=interim;onTranscript(final+interim);if(!current.stopping)arm();
  };
  rec.onspeechstart=()=>{if(valid()&&!current.sent&&!current.ended&&!current.stopping)clear();};
  rec.onspeechend=()=>{if(valid()&&!current.sent&&!current.ended)arm();};
  rec.onerror=event=>{if(!valid()||current.sent||current.ended)return;pause(event.error==='not-allowed'||event.error==='service-not-allowed'?'マイク・音声認識の許可を確認し、タップして再開してください':'音声認識に失敗しました。再開ボタンからやり直せます。');};
  rec.onend=()=>{if(!valid()||current.sent||current.ended)return;current.ended=true;onListening(false);state('finishing','無音待機後、確定した文章を自動送信します…');arm();};
  state('starting','音声認識を開始しています…');timer=setTimer(()=>{if(valid())pause('音声認識を開始できませんでした。許可を確認して再開してください');},5000);try{rec.start();}catch{pause('Safariが開始を許可しませんでした。音声会話を再開してください');}
 }
 async function start(){
  if(active)return;if(!Recognition){state('paused','このブラウザは音声認識に非対応です。テキスト入力をご利用ください');return;}
  if(isBusy()||isHidden()){state('paused','処理終了後、画面を開いた状態で開始してください');return;}
  const token=++session;active=true;state('authorizing','音声会話の認証を確認しています…');
  try{if(!await authorize()){if(token===session)stop('認証をキャンセルしました');return;}if(token!==session||!active)return;cancelSpeech();listen(token);}
  catch{if(token===session)pause('認証を確認できませんでした。再開してください');}
 }
 return {start,stop,pause,get active(){return active;},get phase(){return phase;}};
}
