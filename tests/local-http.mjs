import {request as httpRequest} from 'node:http';
export function localRequest(base,path,{method='GET',body,password='rehearsal-only'}={}){
 const url=new URL(path,base);if(url.origin!==new URL(base).origin||url.hostname!=='127.0.0.1')throw Error('Only disposable localhost rehearsal is allowed');
 return new Promise((yes,no)=>{const r=httpRequest(url,{method,headers:{'x-jarvis-password':password,'content-type':'application/json'}},response=>{let text='';response.on('data',c=>text+=c);response.on('end',()=>yes({status:response.statusCode,text,json:()=>JSON.parse(text)}));});r.on('error',no);if(body!==undefined)r.write(JSON.stringify(body));r.end();});
}
