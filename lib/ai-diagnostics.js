// Fixed fields only: never log prompts, provider bodies, headers or exception messages.
export function createDiagnostic() {
  const id=crypto.randomUUID(), start=performance.now();
  let stage='configuration', since=start;
  const elapsed=()=>Math.max(0,Math.round(performance.now()-start));
  const emit=fields=>{try{console.info(JSON.stringify({event:'ai_diagnostic',diagnosticId:id,...fields}));}catch{}};
  return {
    id,
    operation(operationId,timeoutMs){emit({stage,status:'configured',operationId,timeoutMs});},
    stage(next){const now=performance.now();emit({stage,status:'finished',durationMs:Math.max(0,Math.round(now-since)),elapsedMs:elapsed()});stage=next;since=now;},
    upstream(response){const raw=response.headers?.get('request-id')||response.headers?.get('x-request-id');emit({stage,status:'headers',httpStatus:response.status,...(/^[A-Za-z0-9_-]{1,128}$/.test(raw||'')?{upstreamRequestId:raw}:{})});},
    finish(code='OK'){const snapshot={id,stage,elapsedMs:elapsed()};emit({stage,status:code==='OK'?'completed':'failed',code,durationMs:Math.max(0,Math.round(performance.now()-since)),elapsedMs:snapshot.elapsedMs});return snapshot;},
  };
}
