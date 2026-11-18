import test from 'node:test';import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';import {mkdtempSync,readFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {sessionCookie,validSession} from '../lib/preview-session.js';
const fixture=()=>{const dir=mkdtempSync(join(tmpdir(),'jarvis-recovery-test-'));execFileSync('python',['-c',`
import importlib.util,pathlib,sys
spec=importlib.util.spec_from_file_location('recovery','scripts/prepare-safe-recovery.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
blobs={p:(m.ROOT/p).read_bytes() for p in m.SOURCE_FILES};m.build(sys.argv[1],'a'*40,blobs)
`,dir]);return {dir,close:()=>rmSync(dir,{recursive:true,force:true})};};
async function workerAt(dir){return (await import('data:text/javascript;base64,'+readFileSync(join(dir,'public/_worker.js')).toString('base64'))).default;}
test('recovery advanced worker denies paid and write routes even with a valid Production session and provider keys',async()=>{const f=fixture(),worker=await workerAt(f.dir),origin='https://asset-simulator-87y.pages.dev',env={CF_PAGES_BRANCH:'main',CF_PAGES_URL:origin,JARVIS_RELEASE_ID:'jarvis-initial-v1',JARVIS_CLOUD_DB_ID:'4cae3d2a-eff6-4a1d-871e-56491bdf082a',JARVIS_ACCESS_PASSWORD:'synthetic-recovery-password',ANTHROPIC_API_KEY:'not-a-real-key',OPENAI_API_KEY:'not-a-real-key',AI_ALLOW_LIVE:'true'};const cookie=(await sessionCookie(new Request(origin),env)).split(';')[0];assert.equal(await validSession(new Request(origin,{headers:{cookie}}),env),true);const original=fetch;let outbound=0,bindingReads=0;globalThis.fetch=async()=>{outbound++;throw Error('paid request forbidden');};const guardedEnv=new Proxy(env,{get(){bindingReads++;throw Error('Recovery cannot use legacy bindings');}});try{for(const path of ['/api/chat','/api/pet-analyze','/api/business/jobs','/api/research/ideas','/api/autonomous','/.netlify/functions/chat','/api%2fchat'])for(const method of ['GET','POST']){const request=new Request(origin+path,{method,headers:{cookie,origin,'x-jarvis-password':env.JARVIS_ACCESS_PASSWORD,'content-type':'application/json'},...(method==='POST'?{body:JSON.stringify({prompt:'認証済みの模擬要求'})}:{})});const r=await worker.fetch(request,guardedEnv);assert.equal(r.status,503);assert.equal(r.headers.get('x-jarvis-recovery-policy'),'jarvis-readonly-no-ai-v1');assert.equal((await r.json()).code,'RECOVERY_READ_ONLY');}assert.equal(outbound,0);assert.equal(bindingReads,0);}finally{globalThis.fetch=original;f.close();}});
test('recovery page works without credentials, scripts, data access or legacy Functions',async()=>{const f=fixture();try{const worker=await workerAt(f.dir),r=await worker.fetch(new Request('https://asset-simulator-87y.pages.dev/'));assert.equal(r.status,200);assert.match(await r.text(),/復旧モード/);assert.match(r.headers.get('content-security-policy'),/script-src 'none'; connect-src 'none'/);const html=readFileSync(join(f.dir,'public/index.html'),'utf8');assert.doesNotMatch(html,/<(?:script|form|iframe)\b|localStorage|indexedDB/i);assert.equal((await worker.fetch(new Request('https://asset-simulator-87y.pages.dev/',{method:'POST'}))).status,503);const meta=await (await worker.fetch(new Request('https://asset-simulator-87y.pages.dev/__recovery__'))).json();assert.deepEqual(meta,{policy:'jarvis-readonly-no-ai-v1',aiEnabled:false,apiWritesEnabled:false});const manifest=JSON.parse(readFileSync(join(f.dir,'manifest.json')));assert.deepEqual(Object.keys(manifest.files).sort(),['_worker.js','index.html']);assert.equal(manifest.legacy_functions_included,false);}finally{f.close();}});
test('bundle verifier rejects tampering, extra legacy code and the known unsafe source',()=>{const output=execFileSync('python',['-c',`
import importlib.util,pathlib,tempfile
spec=importlib.util.spec_from_file_location('recovery','scripts/prepare-safe-recovery.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
try:m.source(m.FORBIDDEN);raise AssertionError('unsafe old source accepted')
except ValueError:pass
blobs={p:(m.ROOT/p).read_bytes() for p in m.SOURCE_FILES};m.source=lambda c:(c,blobs)
with tempfile.TemporaryDirectory() as d:
 out=pathlib.Path(d)/'bundle';m.build(out,'a'*40,blobs);m.verify(out,expected_commit='a'*40)
 try:m.verify(out,expected_commit='b'*40);raise AssertionError('wrong commit accepted')
 except ValueError:pass
 (out/'public/functions').mkdir()
 try:m.verify(out);raise AssertionError('legacy Functions accepted')
 except ValueError:pass
 (out/'public/functions').rmdir();(out/'public/_worker.js').write_text('unsafe worker')
 try:m.verify(out);raise AssertionError('tampered worker accepted')
 except ValueError:pass
print('recovery-verifier-passed')
`],{encoding:'utf8'});assert.match(output,/verifier-passed/);});
