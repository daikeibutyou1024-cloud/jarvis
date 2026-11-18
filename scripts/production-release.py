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
def query(sql,edit=False,params=None):return api('/d1/database/'+PRODUCTION+'/query',{'sql':sql,'params':params or []},edit=edit)
# Only these selected metadata fields can leave D1. DEFAULT literals and DDL text are never returned.
METADATA_QUERIES={
 'columns':'SELECT cid,name,type,"notnull",pk,hidden FROM pragma_table_xinfo(?) ORDER BY cid',
 'foreign_keys':'SELECT id,seq,"table","from","to",on_update,on_delete,match FROM pragma_foreign_key_list(?) ORDER BY id,seq',
 'indexes':'SELECT name,"unique",origin,partial FROM pragma_index_list(?) ORDER BY name',
 'index_columns':'SELECT seqno,cid,name,"desc",coll,"key" FROM pragma_index_xinfo(?) ORDER BY seqno',
}
def approved_objects(phase):
 if phase not in ('existing','migrated'):raise RuntimeError('Unknown schema inspection phase')
 policy=json.loads((ROOT/'release/production-existing-schema.json').read_text())
 if policy.get('schema')!=1:raise RuntimeError('Unknown existing-schema policy')
 objects=policy['objects'][:]
 if phase=='migrated':objects += [dict(zip(('type','name','tbl_name','sql'),r)) for r in inventory()]
 if len({r['name'] for r in objects})!=len(objects):raise RuntimeError('Approved schema names overlap')
 return sorted(objects,key=lambda r:(r['type'],r['name']))
def catalog_statement(objects):
 cases=' '.join('WHEN name=? THEN sql=?' for _ in objects)
 return "SELECT type,name,tbl_name,CASE "+cases+" ELSE 0 END AS definition_matches FROM sqlite_master WHERE name NOT GLOB 'sqlite_*' AND name != '_cf_KV' AND tbl_name != '_cf_KV' ORDER BY type,name"
def schema_read(sql,params=None):
 allowed=set(METADATA_QUERIES.values())|{catalog_statement(approved_objects(p)) for p in ('existing','migrated')}
 if sql not in allowed:raise RuntimeError('Only approved schema metadata queries are allowed')
 result=query(sql,params=params)
 if len(result)!=1 or result[0].get('success') is not True:raise RuntimeError('Schema read did not succeed')
 meta=result[0].get('meta',{})
 if meta.get('rows_written')!=0 or meta.get('changed_db') is not False:raise RuntimeError('Read-only schema result could not be confirmed')
 return result[0]['results']
def inspect_table(read,table):
 # Names are bound values to table-valued read-only PRAGMAs, never SQL identifiers/interpolation.
 result={kind:read(METADATA_QUERIES[kind],[table]) for kind in ('columns','foreign_keys','indexes')}
 result['index_columns']={i['name']:read(METADATA_QUERIES['index_columns'],[i['name']]) for i in result['indexes']}
 return result
def snapshot(phase='existing',read=None):
 read=read or schema_read;expected=approved_objects(phase);expected_by_name={r['name']:r for r in expected}
 params=[v for r in expected for v in (r['name'],r['sql'])]
 rows=read(catalog_statement(expected),params)
 if len(rows)!=len(expected) or {r['name'] for r in rows}!=set(expected_by_name):raise RuntimeError('Schema objects differ from approved definitions; stop without retrieving content')
 if any(r.get('definition_matches')!=1 or any(r[k]!=expected_by_name[r['name']][k] for k in ('type','tbl_name')) for r in rows):raise RuntimeError('Schema definition changed; stop without retrieving DDL literals or content')
 schema=[{'type':r['type'],'name':r['name'],'tbl_name':r['tbl_name'],'definition_hash':digest(expected_by_name[r['name']]['sql'])} for r in rows]
 tables={r['name']:inspect_table(read,r['name']) for r in rows if r['type']=='table'}
 return {'schema':schema,'tables':tables}
def verify_schema_transition(before,after):
 old_names={r['name'] for r in before['schema']}
 if [r for r in after['schema'] if r['name'] in old_names]!=before['schema'] or {k:after['tables'].get(k) for k in before['tables']}!=before['tables']:raise RuntimeError('Existing schema metadata changed: stop before deploying')
 # This is deliberately NOT a comparison of row contents, counts or content hashes.
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
 return {'schema':2,'verification_mode':'schema-metadata-only-v1','existing_schema_policy_sha256':hashlib.sha256((ROOT/'release/production-existing-schema.json').read_bytes()).hexdigest(),'release':RELEASE,'candidate':git('rev-parse','HEAD'),'main':git('ls-remote','origin','refs/heads/main').split()[0],'production_deployment':p['canonical_deployment']['id'],'historical_rollback_allowed':False,'recovery_policy':'jarvis-readonly-no-ai-v1','production_config_hash':digest(c['production']),'production_sql_executed':False,'production_schema_currently_verified':False,'preview_id':PREVIEW,'production_id':PRODUCTION,'migration_hashes':{str(f.relative_to(ROOT)):hashlib.sha256(f.read_bytes()).hexdigest() for f in sql_files()},'new_tables':[r[1] for r in new if r[0]=='table'],'new_indexes':[r[1] for r in new if r[0]=='index'],'mutations_performed':False,'required_evidence':['preview_authenticated_save_reload_restore','weather_voice_and_hidden_legacy_reviewed','production_password_preserved','workers_free_no_extra_cost','safe_recovery_bundle_verified'],'ready_for_approval':False}
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
 # Only after explicit approval: inspect approved schema metadata; never read business rows.
 before=snapshot()
 if {r['name'] for r in before['schema']}&(set(saved['new_tables'])|set(saved['new_indexes'])):raise RuntimeError('New table/index overlap: review existing schema before applying SQL')
 # One request: additive tables + marker only. On error stop; never assume atomicity or retry blindly.
 query('\n'.join(p.read_text() for p in sql_files()),edit=True)
 after=snapshot(phase='migrated')
 verify_schema_transition(before,after)
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
