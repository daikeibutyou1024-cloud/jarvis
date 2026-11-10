// Optional relay, never deployed by the Pages build. Activation is deliberately separate.
const PREVIEW_TICK='https://feature-ai-business-rebuild.asset-simulator-87y.pages.dev/api/business/tick';
export async function relay(env){
 if(env.COLLECTOR_RELAY_ENABLED!=='true')return {state:'disabled'};
 if(typeof env.JARVIS_SCHEDULER_TOKEN!=='string'||env.JARVIS_SCHEDULER_TOKEN.length<32)throw Error('Scheduler credential is missing');
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),25000);
 try{
  // Never follow redirects carrying a credential; no URL supplied by a caller is accepted.
  const r=await fetch(PREVIEW_TICK,{method:'POST',redirect:'error',signal:controller.signal,headers:{Authorization:'Bearer '+env.JARVIS_SCHEDULER_TOKEN,'content-type':'application/json'},body:'{}'});
  if(!r.ok)throw Error('Collection endpoint did not confirm success');
  const data=await r.json();
  if(!['idle','blocked','completed','failed','interrupted','cancelled'].includes(data.state))throw Error('Unexpected collection response');
  return {state:data.state};
 }finally{clearTimeout(timer);}
}
export default {
 async scheduled(controller,env){
  controller.noRetry?.();
  // One attempt only. Throwing reports a failure; this code never resends the request.
  return relay(env);
 },
 async fetch(){return new Response('Scheduled relay only',{status:405});},
};
