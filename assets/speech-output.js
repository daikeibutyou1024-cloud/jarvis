// One speech output at a time. Never use silent audio or autoplay-unlock loops.
export function createSpeechOutput({synth,Utterance,track=()=>{},onStop=()=>{},setTimer=setTimeout,clearTimer=clearTimeout}){
 let current=null;
 function stop(){const previous=current;current=null;previous?.finish(Error('読み上げを停止しました'));onStop();try{synth?.cancel();}catch{}}
 function speak(text,{rate=1}={}){
  stop();if(!synth||!Utterance)return Promise.reject(Error('読み上げに非対応です。画面の回答を確認してください。'));
  return new Promise((resolve,reject)=>{
   const utterance=new Utterance(text);utterance.lang='ja-JP';utterance.rate=rate;track(utterance);let done=false,startTimer,endTimer;
   const finish=error=>{if(done)return;done=true;clearTimer(startTimer);clearTimer(endTimer);if(current?.utterance===utterance)current=null;onStop();error?reject(error):resolve();};current={utterance,finish};
   const start=utterance.onstart,end=utterance.onend,error=utterance.onerror;
   utterance.onstart=e=>{if(done)return;start?.(e);clearTimer(startTimer);};
   utterance.onend=e=>{if(done)return;end?.(e);finish();};
   utterance.onerror=e=>{if(done)return;error?.(e);finish(Error('音声を再生できませんでした。画面を確認し、ボタンをタップしてください。'));};
   startTimer=setTimer(()=>{if(done)return;finish(Error('自動音声再生が制限されています。起動ボタンをタップしてください。'));try{synth.cancel();}catch{}},4000);
   endTimer=setTimer(()=>{if(done)return;finish(Error('読み上げが終了しませんでした。オーブをタップして再開してください。'));try{synth.cancel();}catch{}},180000);
   try{synth.speak(utterance);}catch{finish(Error('音声を再生できませんでした。起動ボタンをタップしてください。'));}
  });
 }
 return {speak,stop};
}
export function createWelcome({speak,onFallback=()=>{},text}){
 let attempted=false,done=false,pending=null,epoch=0;
 function play({userInitiated=false}={}){
  if(done)return Promise.resolve(true);if(pending)return pending;if(attempted&&!userInitiated)return Promise.resolve(false);
  attempted=true;const token=++epoch;onFallback(false);
  // Invoke speech immediately inside the user gesture, before any await/auth request.
  pending=Promise.resolve().then(()=>{});let speech;try{speech=speak(text,{rate:0.95});}catch(error){speech=Promise.reject(error);}
  pending=Promise.resolve(speech).then(()=>{if(token!==epoch)return false;done=true;onFallback(false);return true;},()=>{if(token===epoch)onFallback(true);return false;}).finally(()=>{if(token===epoch)pending=null;});return pending;
 }
 function cancel(){epoch++;pending=null;}
 return {play,cancel,get active(){return pending!==null;},get completed(){return done;}};
}
