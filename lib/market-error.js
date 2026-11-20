// Only bounded, public request metadata is allowed in diagnostics. Never echo bodies/headers.
export class MarketError extends Error{
 constructor(code,message,context={}){super(message);this.code=code;this.diagnostic={code,...context};}
}
export function marketFailure(error){
 const safe=error instanceof MarketError?error:new MarketError('INTERNAL','取得処理で予期しないエラーが発生しました。');
 const d={id:crypto.randomUUID(),stage:safe.diagnostic.stage||'internal',...safe.diagnostic};
 // Fixed public metadata only: returned diagnostic IDs can be correlated with future runtime logs.
 try{console.warn(JSON.stringify({event:'market_error',diagnosticId:d.id,code:d.code,stage:d.stage,sourceId:d.sourceId,httpStatus:d.httpStatus,apiCode:d.apiCode}));}catch{}
 const status=d.httpStatus?` / 上流HTTP ${d.httpStatus}`:'',api=d.apiCode!==undefined?` / APIコード ${d.apiCode}`:'';
 return {error:`${safe.message} [${safe.code}${status}${api}] 判定は保留です。自動再試行しません。`,kind:'保留',diagnostic:d};
}
