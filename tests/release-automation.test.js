import test from 'node:test';import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';
test('release plan makes metadata GETs only; exact schema and approval/evidence guards precede every mutation',()=>{const out=execFileSync('python',['-c',`
import importlib.util
spec=importlib.util.spec_from_file_location('release','scripts/production-release.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
rows=m.inventory();assert len([x for x in rows if x[0]=='table'])==16;assert len([x for x in rows if x[0]=='index'])==6
calls=[]
def api(path,data=None,**kwargs):
 calls.append((path,data,kwargs))
 assert data is None and not kwargs
 if path.endswith('/'+m.PROJECT):return {'source':{'config':{'repo_id':'1434556819'}},'deployment_configs':{'preview':{'d1_databases':{'JARVIS_DB':{'id':m.PREVIEW}},'env_vars':{'PREVIEW_MOCK_AUTOMATION_ENABLED':{'value':'false'}}},'production':{'d1_databases':{'JARVIS_DB':{'id':m.PRODUCTION}}}},'canonical_deployment':{'id':'prior'}}
 return {'uuid':m.PRODUCTION,'name':'jarvis-calendar'}
m.api=api;m.git=lambda *a: 'a'*40
saved=m.plan();assert saved['production_sql_executed'] is False;assert len(calls)==2
calls.clear()
for approval in ['','b'*40]:
 try:m.apply(saved,{},approval);raise AssertionError('unapproved apply accepted')
 except RuntimeError:pass
assert not calls
m.git=lambda *a: '';m.plan=lambda:saved
for evidence in [{},{'tested_commit':'a'*40,'unit_failed':0,'unit_passed':1,'desktop_passed':True,'mobile_passed':True}]:
 try:m.apply(saved,evidence,'a'*40);raise AssertionError('incomplete evidence accepted')
 except RuntimeError:pass
assert not calls
print('metadata-only-and-guards-passed')
`],{encoding:'utf8'});assert.match(out,/guards-passed/);});
test('historical rollback and missing recovery evidence cannot contact Cloudflare',()=>{const out=execFileSync('python',['-c',`
import importlib.util
spec=importlib.util.spec_from_file_location('release','scripts/production-release.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
calls=[];m.api=lambda *a,**k:calls.append((a,k))
saved={'candidate':'a'*40,'production_deployment':'dc68cde8-9a6b-46f4-9f27-d73675e79f49','required_evidence':['safe_recovery_bundle_verified']}
for approved in [saved['production_deployment'],'658b3bcef0c389cfe945d33bff6e6b9b88e09fa5','other']:
 try:m.rollback(saved,approved);raise AssertionError('unsafe rollback accepted')
 except RuntimeError:pass
assert not calls
m.git=lambda *a:'';m.plan=lambda:saved
evidence={'tested_commit':'a'*40,'unit_failed':0,'unit_passed':1,'desktop_passed':True,'mobile_passed':True,'safe_recovery_bundle_verified':True}
try:m.apply(saved,evidence,'a'*40);raise AssertionError('release without recovery artifact accepted')
except RuntimeError:pass
assert not calls
print('unsafe-rollback-and-missing-artifact-denied')
`],{encoding:'utf8'});assert.match(out,/artifact-denied/);});
