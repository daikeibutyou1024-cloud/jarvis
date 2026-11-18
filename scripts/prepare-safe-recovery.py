#!/usr/bin/env python3
"""Build/verify a pinned, deterministic recovery bundle locally. Never deploy or contact a service."""
import argparse,hashlib,json,pathlib,subprocess,zipfile
ROOT=pathlib.Path(__file__).resolve().parents[1]
POLICY='jarvis-readonly-no-ai-v1'
SOURCE_FILES=['release/recovery/worker-template.mjs','release/recovery/index.html']
FORBIDDEN='658b3bcef0c389cfe945d33bff6e6b9b88e09fa5'
def sha(data):return hashlib.sha256(data).hexdigest()
def source(commit):
 full=subprocess.check_output(['git','rev-parse','--verify',commit+'^{commit}'],cwd=ROOT,text=True).strip()
 if full==FORBIDDEN:raise ValueError('658b3bc is not a safe recovery source')
 blobs={p:subprocess.check_output(['git','show',full+':'+p],cwd=ROOT,stderr=subprocess.DEVNULL) for p in SOURCE_FILES}
 return full,blobs
def payloads(blobs):
 template=blobs[SOURCE_FILES[0]].decode();page=blobs[SOURCE_FILES[1]].decode()
 if template.count('__RECOVERY_HTML_JSON__')!=1 or "const RECOVERY_POLICY='"+POLICY+"';" not in template:raise ValueError('Unknown recovery policy')
 return {'_worker.js':template.replace('__RECOVERY_HTML_JSON__',json.dumps(page,ensure_ascii=True)).encode(),'index.html':page.encode()}
def build(output,commit,blobs):
 output=pathlib.Path(output)
 if output.exists() and any(output.iterdir()):raise ValueError('Output must be empty; existing artifacts are never overwritten')
 files=payloads(blobs);public=output/'public';public.mkdir(parents=True,exist_ok=True)
 for name,body in files.items():(public/name).write_bytes(body)
 with zipfile.ZipFile(output/'bundle.zip','w',compression=zipfile.ZIP_DEFLATED) as archive:
  for name,body in sorted(files.items()):
   info=zipfile.ZipInfo(name,date_time=(2026,1,1,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;info.external_attr=0o100644<<16;archive.writestr(info,body)
 manifest={'schema':1,'policy':POLICY,'source_commit':commit,'files':{n:sha(b) for n,b in files.items()},'archive_sha256':sha((output/'bundle.zip').read_bytes()),'advanced_mode':True,'legacy_functions_included':False,'deployed':False}
 (output/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n');return manifest
def verify(output,expected_commit=None):
 output=pathlib.Path(output);manifest=json.loads((output/'manifest.json').read_text());commit=manifest['source_commit']
 if expected_commit and commit!=expected_commit:raise ValueError('Recovery source does not match the approved candidate')
 full,blobs=source(commit);expected=payloads(blobs)
 if manifest.get('schema')!=1 or manifest.get('policy')!=POLICY or manifest.get('advanced_mode') is not True or manifest.get('legacy_functions_included') is not False:raise ValueError('Recovery manifest policy mismatch')
 if {p.name for p in output.iterdir()}!={'public','manifest.json','bundle.zip'}:raise ValueError('Unexpected bundle entry')
 if {p.name for p in (output/'public').iterdir()}!=set(expected):raise ValueError('Legacy/extra files in deploy directory')
 if manifest.get('files')!={n:sha(b) for n,b in expected.items()}:raise ValueError('Recovery manifest hash mismatch')
 for name,body in expected.items():
  if (output/'public'/name).read_bytes()!=body:raise ValueError('Recovery content differs from pinned source')
 if sha((output/'bundle.zip').read_bytes())!=manifest.get('archive_sha256'):raise ValueError('Recovery archive hash mismatch')
 with zipfile.ZipFile(output/'bundle.zip') as archive:
  if sorted(archive.namelist())!=sorted(expected):raise ValueError('Unsafe archive members')
  for name,body in expected.items():
   if archive.read(name)!=body:raise ValueError('Archive content differs from pinned source')
 return manifest
if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('--source-commit',default='HEAD');parser.add_argument('--output',required=True);parser.add_argument('--verify',action='store_true');args=parser.parse_args()
 try:
  if args.verify:
   commit,_=source(args.source_commit);result=verify(args.output,expected_commit=commit)
  else:
   commit,blobs=source(args.source_commit);result=build(args.output,commit,blobs)
  print(json.dumps(result,indent=2))
 except Exception as error:raise SystemExit(type(error).__name__+': '+str(error))
