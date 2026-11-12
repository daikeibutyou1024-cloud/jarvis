// Local rehearsal only: actual Pages handlers + disposable SQLite, no live bindings or providers.
import {createServer} from 'node:http';
import {readFile,realpath} from 'node:fs/promises';
import {resolve,extname,sep,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {testDB} from './runtime-fixture.js';
import * as editorial from '../functions/api/business/editorial.js';
import * as drafts from '../functions/api/business/drafts.js';
import * as paid from '../functions/api/business/paid-drafts.js';
import * as usage from '../functions/api/business/usage.js';
import * as preflight from '../functions/api/business/preflight.js';
export async function startRehearsal({apiHandlers={}}={}){
const root=resolve(fileURLToPath(new URL('..',import.meta.url))),db=testDB();
const env={JARVIS_DB:db,JARVIS_ACCESS_PASSWORD:'rehearsal-only',AI_MONTHLY_BUDGET_USD:'0',COLLECTION_AUTOMATION_ENABLED:'false',CF_PAGES_BRANCH:'local-rehearsal'};
const routes=new Map([['/api/business/editorial',editorial],['/api/business/drafts',drafts],['/api/business/paid-drafts',paid],['/api/business/usage',usage],['/api/business/preflight',preflight],...Object.entries(apiHandlers)]);
let outboundAttempts=0;const requests=[];
const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{outboundAttempts++;throw Error('External requests forbidden in local rehearsal');};
const server=createServer(async(req,res)=>{
 const send=(status,body,type='application/json; charset=utf-8')=>{res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; script-src 'self'; frame-ancestors 'none'"});res.end(typeof body==='string'||Buffer.isBuffer(body)?body:JSON.stringify(body));};
 try{
  const url=new URL(req.url,'http://127.0.0.1'),path=url.pathname;
  if(path==='/__rehearsal/state'&&req.method==='GET'){
   const exists=name=>!!db.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
   return send(200,{mode:'local-disposable-sqlite',outboundAttempts,requests,documents:exists('document_revisions')?db.db.prepare('SELECT project_id,revision,payload FROM document_revisions ORDER BY rowid').all().map(r=>({projectId:r.project_id,revision:r.revision,topic:JSON.parse(r.payload).topic,output:JSON.parse(r.payload).output})):[],reviews:exists('editorial_reviews')?db.db.prepare('SELECT project_id,revision FROM editorial_reviews').all():[]});
  }
  if(path.startsWith('/api/')){
   const api=routes.get(path),handler=api?.[req.method==='GET'?'onRequestGet':req.method==='POST'?'onRequestPost':'unsupported'];
   if(!handler){requests.push({method:req.method,path,status:403});return send(403,{error:'このローカル検証ではAI・収集・定期起動・外部投稿を実行できません'});}
   let body='';for await(const chunk of req){body+=chunk;if(body.length>250000)return send(413,{error:'Body too large'});}
   const request=new Request('http://127.0.0.1'+req.url,{method:req.method,headers:req.headers,...(req.method==='POST'?{body}:{})});
   const response=await handler({env,request});requests.push({method:req.method,path,status:response.status});return send(response.status,await response.text());
  }
  if(req.method!=='GET')return send(405,{error:'Method not allowed'});
  if(path!=='/'&&path!=='/index.html'&&!path.startsWith('/assets/')&&!path.startsWith('/lib/'))return send(404,{error:'Not found'});
  const target=await realpath(resolve(root,'.'+(path==='/'?'/index.html':decodeURIComponent(path))));const rel=relative(root,target);if(!target.startsWith(root+sep)||!(rel==='index.html'||rel.startsWith('assets'+sep)||rel.startsWith('lib'+sep)))return send(403,{error:'Forbidden'});
  const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'}[extname(target)]||'application/octet-stream';let content=await readFile(target);
  if(extname(target)==='.html')content=Buffer.from(content.toString().replace('<body>','<body><aside style="padding:12px;background:#fff3cd;color:#222">LOCAL REHEARSAL：使い捨ての模擬DB・実API停止。認証は rehearsal-only。PreviewやProductionへの保存ではありません。</aside>'));
  return send(200,content,mime);
 }catch{return send(500,{error:'Local rehearsal failed'});}
});
await new Promise((yes,no)=>{server.once('error',no);server.listen(0,'127.0.0.1',yes);});
const baseURL='http://127.0.0.1:'+server.address().port;
return {baseURL,db,env,server,stats:()=>({outboundAttempts,requests:[...requests]}),close:async()=>{await new Promise(yes=>server.close(yes));db.db.close();globalThis.fetch=originalFetch;}};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const rehearsal=await startRehearsal();console.log(JSON.stringify({baseURL:rehearsal.baseURL,password:'rehearsal-only',mode:'disposable-sqlite',realAPIs:false}));
 const stop=async()=>{await rehearsal.close();process.exit(0);};process.on('SIGINT',stop);process.on('SIGTERM',stop);
}
