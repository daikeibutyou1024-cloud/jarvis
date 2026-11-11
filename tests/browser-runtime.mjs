import {Socket} from 'node:net';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {existsSync} from 'node:fs';
export async function browserRuntime(){
 if(process.platform!=='win32'){
  const error=await new Promise(resolveError=>{const socket=new Socket();socket.once('error',e=>resolveError(e));socket.once('connect',()=>{socket.destroy();resolveError(null);});socket.connect('/tmp/jarvis-absent-browser-probe-'+process.pid+'.sock');});
  if(['EPERM','EACCES'].includes(error?.code))throw Object.assign(Error('Unixソケットが環境により禁止されています。Chromiumを起動できる実行環境が必要です。制限の回避や緩和は行いません。'),{code:'BROWSER_ENV_BLOCKED'});
 }
 let playwright;
 try{playwright=await import('playwright');}
 catch{const modules=process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES;if(modules)try{playwright=createRequire(import.meta.url)(resolve(modules,'playwright'));}catch{}}
 if(!playwright)throw Object.assign(Error('Playwrightが未導入です。実行環境へPlaywright 1.62.1とChromiumを用意してください。自動インストールは行いません。'),{code:'BROWSER_DEPENDENCY_MISSING'});
 const executable=process.env.CHROMIUM_PATH||[playwright.chromium.executablePath(),'/usr/bin/chromium','/usr/bin/google-chrome'].find(p=>existsSync(p));
 if(!executable||!existsSync(executable))throw Object.assign(Error('Chromiumが未導入です。CHROMIUM_PATHまたはPlaywrightの対応ブラウザを確認してください。'),{code:'BROWSER_EXECUTABLE_MISSING'});
 return {playwright,executable};
}
