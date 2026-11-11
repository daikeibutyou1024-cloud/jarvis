import {denied,responseJSON as json} from '../../../lib/research-network.js';
import {CopyError,previewDocumentCopy,copyDocument} from '../../../lib/document-copy.js';
export async function onRequestPost({request,env}){
 const auth=denied(request,env);if(auth)return auth;
 try{
  const raw=await request.text();if(raw.length>2000)throw new CopyError('要求が大きすぎます');const b=JSON.parse(raw);if(!b||typeof b!=='object'||Array.isArray(b))throw new CopyError('要求の形式が不正です');
  if(b.action==='preview')return json(await previewDocumentCopy(env.JARVIS_DB,b.sourceProjectId,b.sourceRevision));
  if(b.action==='copy')return json(await copyDocument(env.JARVIS_DB,b),201);
  throw new CopyError('操作が不正です');
 }catch(e){if(e instanceof SyntaxError)return json({error:'要求の形式が不正です'},400);return json({error:e instanceof CopyError?e.message:'保存版を読み込めませんでした。元データは変更していません',code:e instanceof CopyError?e.code:undefined},e instanceof CopyError?e.status:503);}
}
