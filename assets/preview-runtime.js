// No storage, query-string credentials, polling, automatic requests or external resources.
const form=document.getElementById('diagnostic'),input=document.getElementById('password'),button=document.getElementById('submit'),result=document.getElementById('result');
form.onsubmit=async event=>{
 event.preventDefault();if(button.disabled)return;
 if(location.protocol!=='https:'||! /^(?:[a-f0-9]{8}|feature-ai-business-rebuild)\.asset-simulator-87y\.pages\.dev$/.test(location.hostname)){input.value='';result.textContent='対象Previewの固定URLで開いてください。通信は行いません。';return;}
 let password=input.value;input.value='';button.disabled=true;result.textContent='確認中…';
 try{
  const pending=fetch('/api/business/preview-runtime',{method:'GET',redirect:'error',cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer',headers:{'x-jarvis-password':password}});password='';
  const response=await pending,data=await response.json();
  result.textContent=response.ok?JSON.stringify(data,null,2):`確認できませんでした（HTTP ${response.status}）。自動再送はしません。`;
 }catch{result.textContent='通信を確認できませんでした。自動再送はしません。';}
 finally{password='';input.value='';button.disabled=false;}
};
