#!/usr/bin/env python3
"""Read-only by default. Mutations require a pinned plan, passing evidence and explicit approval."""
import argparse,hashlib,importlib.util,json,os,pathlib,re,sqlite3,subprocess,urllib.request,urllib.error
ROOT=pathlib.Path(__file__).resolve().parents[1]
ACCOUNT='a58aa91d4347b0a3691d51d2e382a392';PROJECT='asset-simulator'
PREVIEW='5ec09d38-2ed8-4c7a-ba67-bfd9c2ed32d0';PRODUCTION='4cae3d2a-eff6-4a1d-871e-56491bdf082a'
RELEASE='jarvis-initial-v1'
def digest(value):return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()
def git(*args):return subprocess.check_output(['git',*args],cwd=ROOT,text=True).strip()
def api(suffix,data=None,edit=False,method=None,pages=False):
 key='CLOUDFLARE_D1_API_TOKEN' if edit else 'CLOUDFLARE_API_TOKEN'
 if method=='PATCH' or pages:key='CLOUDFLARE_PAGES_EDIT_TOKEN'
 req=urllib.request.Request('https://api.cloudflare.com/client/v4/accounts/'+ACCOUNT+suffix,data=None if data is None else json.dumps(data).encode(),headers={'Authorization':'Bearer '+os.environ[key],'Content-Type':'application/json'},method=method)
 try:
  with urllib.request.urlopen(req,timeout=30) as r:body=json.load(r)
 except urllib.error.HTTPError as e:raise RuntimeError('Cloudflare request failed: HTTP '+str(e.code)) from None
 if not body.get('success'):raise RuntimeError('Cloudflare rejected the operation')
 return body['result']
def query(sql,edit=False):return api('/d1/database/'+PRODUCTION+'/query',{'sql':sql,'params':[]},edit=edit)
def snapshot():
 schema=query("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name")[0]['results'];tables={}
 for row in schema:
  if row['type']!='table' or row['name'].startswith('_cf_'):continue
  rows=query('SELECT * FROM "'+row['name'].replace('"','""')+'"')[0]['results']
  tables[row['name']]={'count':len(rows),'hash':digest(sorted(json.dumps(x,sort_keys=True,separators=(',',':')) for x in rows))}
 return {'schema':schema,'tables':tables}
def sql_files():return [ROOT/'release/production-business.sql',ROOT/'release/production-cloud.sql']
def inventory():
 db=sqlite3.connect(':memory:')
 for p in sql_files():
  text=p.read_text();code=re.sub(r'--[^\n]*','',text)
  if re.search(r'\b(?:ALTER|DROP|DELETE|REPLACE|UPDATE|ATTACH|TRIGGER)\b',code,re.I):raise RuntimeError('Migration contains an unapproved statement')
  db.executescript(text)
 return db.execute("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").fetchall()
def plan():
 p=api('/pages/projects/'+PROJECT);c=p['deployment_configs'];assert p['source']['config']['repo_id']=='1434556819'
 assert c['preview']['d1_databases']['JARVIS_DB']['id']==PREVIEW and c['production']['d1_databases']['JARVIS_DB']['id']==PRODUCTION
 assert c['preview']['env_vars']['PREVIEW_MOCK_AUTOMATION_ENABLED']['value']=='false'
 metadata=api('/d1/database/'+PRODUCTION);assert metadata['uuid']==PRODUCTION and metadata['name']=='jarvis-calendar'
 new=inventory()
 return {'schema':1,'release':RELEASE,'candidate':git('rev-parse','HEAD'),'main':git('ls-remote','origin','refs/heads/main').split()[0],'production_deployment':p['canonical_deployment']['id'],'historical_rollback_allowed':False,'recovery_policy':'jarvis-readonly-no-ai-v1','production_config_hash':digest(c['production']),'production_sql_executed':False,'production_schema_currently_verified':False,'preview_id':PREVIEW,'production_id':PRODUCTION,'migration_hashes':{str(f.relative_to(ROOT)):hashlib.sha256(f.read_bytes()).hexdigest() for f in sql_files()},'new_tables':[r[1] for r in new if r[0]=='table'],'new_indexes':[r[1] for r in new if r[0]=='index'],'mutations_performed':False,'required_evidence':['preview_authenticated_save_reload_restore','weather_voice_and_hidden_legacy_reviewed','production_password_preserved','workers_free_no_extra_cost','safe_recovery_bundle_verified'],'ready_for_approval':False}
def apply(saved,evidence,approval):
 if approval!=saved['candidate']:raise RuntimeError('Approval must name the exact reviewed commit')
 if git('status','--porcelain'):raise RuntimeError('Working tree must be clean')
 now=plan()
 if now!=saved:raise RuntimeError('Plan drift: regenerate and review before changing Production')
 if evidence.get('tested_commit')!=approval or evidence.get('unit_failed')!=0 or not evidence.get('unit_passed') or not evidence.get('desktop_passed') or not evidence.get('mobile_passed'):raise RuntimeError('Passing candidate test evidence is required')
 if not all(evidence.get(k) is True for k in saved['required_evidence']):raise RuntimeError('Required real-environment evidence is incomplete')
 recovery_path=evidence.get('recovery_bundle_path')
 if not recovery_path:raise RuntimeError('A verified no-AI recovery bundle is required before Production changes')
 spec=importlib.util.spec_from_file_location('safe_recovery',ROOT/'scripts/prepare-safe-recovery.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
 module.verify(pathlib.Path(recovery_path),expected_commit=approval)
 remote=git('ls-remote','origin','refs/heads/feature/ai-business-rebuild').split()[0]
 if remote!=approval:raise RuntimeError('Candidate must match the pushed development branch')
 subprocess.run(['npm','test'],cwd=ROOT,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 # Only after explicit approval: inspect actual Production schema/data and stop on overlap.
 before=snapshot()
 if {r['name'] for r in before['schema']}&(set(saved['new_tables'])|set(saved['new_indexes'])):raise RuntimeError('New table/index overlap: review existing schema before applying SQL')
 # One D1 transaction: additive tables + marker only. Never touch backups or old rows.
 query('\n'.join(p.read_text() for p in sql_files()),edit=True)
 after=snapshot()
 old_names={r['name'] for r in before['schema']}
 if [r for r in after['schema'] if r['name'] in old_names]!=before['schema'] or {k:after['tables'][k] for k in before['tables']}!=before['tables']:raise RuntimeError('Old data drift: stop before deploying; do not delete or restore DB automatically')
 # Retain a comparison of every existing setting; never print secret values.
 previous=api('/pages/projects/'+PROJECT)['deployment_configs']['production']
 # Add only explicit production variable keys; existing secrets/bindings must survive.
 api('/pages/projects/'+PROJECT,{'deployment_configs':{'production':{'env_vars':{k:{'type':'plain_text','value':v} for k,v in {'JARVIS_RELEASE_ID':RELEASE,'JARVIS_CLOUD_DB_ID':PRODUCTION,'PREVIEW_MOCK_AUTOMATION_ENABLED':'false','COLLECTION_AUTOMATION_ENABLED':'false','JARVIS_MEMORY_ENABLED':'false'}.items()}}}},method='PATCH')
 # Verify the API retained all previous secret metadata and settings before pushing code.
 current=api('/pages/projects/'+PROJECT)['deployment_configs']['production']
 added={'JARVIS_RELEASE_ID','JARVIS_CLOUD_DB_ID','PREVIEW_MOCK_AUTOMATION_ENABLED','COLLECTION_AUTOMATION_ENABLED','JARVIS_MEMORY_ENABLED'}
 for key,value in previous.items():
  if key=='env_vars':
   if any(current.get(key,{}).get(n)!=v for n,v in value.items() if n not in added):raise RuntimeError('Existing variable metadata changed: stop without deploying')
  elif current.get(key)!=value:raise RuntimeError('Existing Production settings changed: stop without deploying')
 # main must still match the approved baseline. No force pushes or backup changes.
 if git('ls-remote','origin','refs/heads/main').split()[0]!=saved['main']:raise RuntimeError('main changed: stop without pushing')
 subprocess.run(['git','merge-base','--is-ancestor',saved['main'],approval],cwd=ROOT,check=True)
 subprocess.run(['git','push','origin',approval+':refs/heads/main'],cwd=ROOT,check=True)
 return {'submitted':True,'commit':approval,'next':'Wait for the Production deployment, verify its DB/flags, then perform authenticated smoke checks. On failure deploy the verified no-AI recovery bundle after approval; preserve new rows. Historical Pages rollback is prohibited.'}
def rollback(saved,approved):
 # Historical Pages deployments embed the former paid API code/credentials. Never activate them.
 raise RuntimeError('Historical Pages rollback is disabled, including 658b3bc. After explicit approval, redeploy the verified jarvis-readonly-no-ai-v1 bundle; do not activate an old deployment.')
def main():
 a=argparse.ArgumentParser();a.add_argument('--plan',default='work/production-plan.json');a.add_argument('--apply-approved-commit');a.add_argument('--evidence');a.add_argument('--rollback-approved-deployment');args=a.parse_args();target=ROOT/args.plan
 if args.rollback_approved_deployment:
  result=rollback(json.loads(target.read_text()),args.rollback_approved_deployment)
 elif args.apply_approved_commit:
  if not args.evidence:raise RuntimeError('Explicit approval and evidence are required')
  result=apply(json.loads(target.read_text()),json.loads(pathlib.Path(args.evidence).read_text()),args.apply_approved_commit)
 else:
  result=plan();target.parent.mkdir(parents=True,exist_ok=True);target.write_text(json.dumps(result,ensure_ascii=False,indent=2));result={k:v for k,v in result.items() if k!='production_snapshot'}
 print(json.dumps(result,ensure_ascii=False,indent=2))
if __name__=='__main__':
 try:main()
 except Exception as e:raise SystemExit(type(e).__name__+': '+str(e))
