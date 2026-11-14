// Same-origin management requests only; no remote URL, HTML injection, storage or polling.
const $=id=>document.getElementById(id);
let password='',state=null,busy=false,session=0,stopping=false,stopRequested=false,stopConfirmed=false,stopEpoch=0;
async function request(body){
 if(body&&body.action!=='stop'&&(stopping||(stopRequested&&!(body.action==='start'&&stopConfirmed))))throw Error('停止要求済みです。停止確認後に明示的に再開してください');
 const current=session;
 const response=await fetch('/api/business/automation',{method:body?'POST':'GET',redirect:'error',cache:'no-store',headers:{'x-jarvis-password':password,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const data=await response.json();if(current!==session)throw Error('認証を破棄したため応答を破棄しました');if(!response.ok)throw Object.assign(Error(data.error||'要求に失敗しました'),{status:response.status});return data;
}
function applySnapshot(next){if(state&&next.control.version<state.control.version)return;state=next;render();}
async function refresh(){applySnapshot(await request());}
function render(){
 $('manager').hidden=false;$('control').textContent=`制御: ${state.control.state} ／ 版: ${state.control.version} ／ 自動起動: 無効 ／ 実通信: 0件`;
 $('runs').textContent=JSON.stringify(state.runs,null,2);$('events').textContent=JSON.stringify(state.events,null,2);$('items').replaceChildren();
 for(const item of state.items){
  const box=document.createElement('article'),title=document.createElement('h3'),pre=document.createElement('pre');
  title.textContent=`${item.day} ${item.kind} / ${item.state} / 版${item.version}`;pre.textContent=JSON.stringify(item.payload,null,2);box.append(title,pre);
  if(['sources','theme'].includes(item.kind)&&item.state==='awaiting_approval'){
   const label=document.createElement('label'),check=document.createElement('input'),button=document.createElement('button');check.type='checkbox';label.append(check,document.createTextNode('この版の模擬内容を読み、次工程への利用を確認しました（実記事の承認ではありません）'));button.textContent='この版を模擬確認';button.disabled=true;check.onchange=()=>{button.disabled=!check.checked;};
   button.onclick=()=>perform(async()=>{await request({action:'approve',expectedVersion:state.control.version,day:item.day,kind:item.kind,itemVersion:item.version,confirmed:check.checked});await refresh();});box.append(label,button);
  }
  $('items').append(box);
 }
}
async function perform(fn,{allowedAfterStop=false}={}){
 if(busy||stopping)return;
 if(stopRequested&&!allowedAfterStop){$('message').textContent='停止要求済みです。停止確認後に明示的に再開してください。';return;}
 const epoch=stopEpoch,current=session;busy=true;$('manager').setAttribute('aria-busy','true');$('message').textContent='処理中…';
 try{await fn();if(epoch===stopEpoch&&current===session)$('message').textContent='完了。実AI・外部取得は行っていません。';}catch(e){if(epoch===stopEpoch&&current===session)$('message').textContent=e.message+' 自動再送はしません。必要に応じて再読込してください。';}finally{busy=false;$('manager').setAttribute('aria-busy','false');}
}
// Stop bypasses busy, immediately fences all other mutations in this tab, and
// obtains a fresh version even while an older tick response is still pending.
async function stop(){
 if(stopping||!password)return;
 stopping=true;stopRequested=true;stopConfirmed=false;stopEpoch++;const current=session;
 $('message').textContent='停止要求中…新しい工程は開始しません。';
 try{
  for(let attempt=0;attempt<3;attempt++){
   const latest=await request();applySnapshot(latest);
   let stopped;
   try{stopped=await request({action:'stop',expectedVersion:latest.control.version});}
   catch(e){if(e.status===409&&attempt<2)continue;throw e;}
   // Always send stop, even if GET said stopped: incrementing version/epoch
   // invalidates any older start/tick request still travelling to the server.
   const after=await request();applySnapshot(after);
   if(after.control.state!=='stopped'||after.control.version<stopped.version)throw Error('別の操作で状態が変わりました。停止を再要求してください');
   stopConfirmed=true;$('message').textContent='停止を確認しました。再開には明示操作が必要です。';return;
  }
 }catch(e){if(current===session)$('message').textContent=e.message+' 停止は未確認です。新しい工程を禁止したまま、停止を再要求してください。';}
 finally{stopping=false;}
}
$('login').onsubmit=e=>{e.preventDefault();if(busy)return;session++;password=$('password').value;$('password').value='';state=null;$('manager').hidden=true;perform(refresh);};
$('logout').onclick=()=>{session++;password='';state=null;$('manager').hidden=true;$('items').replaceChildren();$('runs').textContent='';$('events').textContent='';$('message').textContent='認証を破棄しました';};
$('refresh').onclick=()=>perform(refresh,{allowedAfterStop:true});
for(const button of document.querySelectorAll('[data-action]'))button.onclick=()=>{
 const action=button.dataset.action;if(action==='stop'){void stop();return;}
 void perform(async()=>{const epoch=stopEpoch;await request({action,expectedVersion:state.control.version});if(action==='start'&&epoch===stopEpoch){stopRequested=false;stopConfirmed=false;}await refresh();},{allowedAfterStop:action==='start'});
};
$('tick').onclick=()=>perform(async()=>{await request({action:'tick',expectedVersion:state.control.version,step:$('step').value,at:$('at').value+':00+09:00'});await refresh();});
