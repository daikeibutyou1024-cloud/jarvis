import importlib.util,json,sqlite3,unittest
spec=importlib.util.spec_from_file_location('release','scripts/production-release.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class SchemaPrivacy(unittest.TestCase):
 def setUp(self):
  self.db=sqlite3.connect(':memory:');self.db.row_factory=sqlite3.Row
  for obj in m.approved_objects('existing'): 
   if obj['type']=='table':self.db.execute(obj['sql'])
  for obj in m.approved_objects('existing'):
   if obj['type']=='index':self.db.execute(obj['sql'])
  self.secret='PRIVATE_LOCAL_FIXTURE_DO_NOT_EXPORT'
  self.db.execute('INSERT INTO google_tokens(id,encrypted_refresh_token) VALUES(1,?)',[self.secret])
  self.db.execute("INSERT INTO business_jobs(id,job_type,topic,status,output) VALUES('local','article',?,'draft',?)",[self.secret,self.secret])
 def tearDown(self):self.db.close()
 def read(self,sql,params=None):
  def guard(action,arg1,arg2,db,source):
   if action==sqlite3.SQLITE_READ and arg1 not in ('sqlite_master','sqlite_schema') and not arg1.startswith('pragma_'):return sqlite3.SQLITE_DENY
   return sqlite3.SQLITE_OK
  self.db.set_authorizer(guard)
  try:return [dict(r) for r in self.db.execute(sql,params or [])]
  finally:self.db.set_authorizer(None)
 def test_additive_migration_preserves_schema_and_dummy_data_without_reading_rows(self):
  before=m.snapshot(read=self.read)
  for p in m.sql_files():self.db.executescript(p.read_text())
  after=m.snapshot('migrated',read=self.read);m.verify_schema_transition(before,after)
  self.assertEqual(len(after['tables']),23)
  self.assertEqual(self.db.execute('SELECT encrypted_refresh_token FROM google_tokens').fetchone()[0],self.secret)
  self.assertEqual(self.db.execute('SELECT output FROM business_jobs').fetchone()[0],self.secret)
  encoded=json.dumps(after);self.assertNotIn(self.secret,encoded);self.assertNotIn('dflt_value',encoded)
  self.assertNotIn('"sql"',encoded);self.assertNotIn('"count"',encoded)
 def test_catalog_fits_d1_bound_parameter_limit(self):
  self.assertEqual(m.catalog_statement(m.approved_objects('migrated')).count('?'),64)
  self.assertLessEqual(m.catalog_statement(m.approved_objects('migrated')).count('?'),100)
 def test_guard_really_denies_business_reads(self):
  for sql in ('SELECT * FROM business_jobs','SELECT count(*) FROM google_tokens'):
   with self.assertRaises(sqlite3.DatabaseError):self.read(sql)
 def test_row_changes_are_deliberately_not_measured(self):
  before=m.snapshot(read=self.read)
  self.db.execute("UPDATE business_jobs SET output='changed-local-only'")
  self.assertEqual(before,m.snapshot(read=self.read))
 def test_unknown_objects_stop_without_content(self):
  for ddl in ('CREATE TABLE unexpected(x TEXT)','CREATE INDEX unexpected ON business_jobs(status)','CREATE VIEW unexpected AS SELECT output FROM business_jobs',"CREATE TRIGGER unexpected AFTER INSERT ON business_jobs BEGIN SELECT 1; END"):
   with self.subTest(ddl=ddl):
    self.db.execute(ddl)
    with self.assertRaisesRegex(RuntimeError,'Schema objects differ'):m.snapshot(read=self.read)
    self.db.execute('DROP '+('TABLE' if 'CREATE TABLE' in ddl else 'INDEX' if 'CREATE INDEX' in ddl else 'VIEW' if 'CREATE VIEW' in ddl else 'TRIGGER')+' unexpected')
 def test_definition_drift_does_not_export_default_literal(self):
  self.db.execute('ALTER TABLE google_tokens ADD COLUMN extra TEXT DEFAULT "'+self.secret+'"')
  with self.assertRaisesRegex(RuntimeError,'Schema definition changed') as e:m.snapshot(read=self.read)
  self.assertNotIn(self.secret,str(e.exception))
 def test_remote_reader_rejects_nonallowlisted_queries_before_api(self):
  original=m.query;calls=[];m.query=lambda *a,**k:calls.append((a,k))
  try:
   for sql in ('SELECT * FROM business_jobs','SELECT count(*) FROM business_jobs','SELECT sql FROM sqlite_master','PRAGMA user_version=9',m.METADATA_QUERIES['columns']+'; DELETE FROM business_jobs'):
    with self.assertRaisesRegex(RuntimeError,'Only approved'):m.schema_read(sql)
   self.assertEqual(calls,[])
  finally:m.query=original
 def test_remote_reader_requires_readonly_result(self):
  original=m.query
  try:
   for meta in ({},{'rows_written':1,'changed_db':False},{'rows_written':0,'changed_db':True}):
    m.query=lambda *a,**k:[{'success':True,'meta':meta,'results':[]}]
    with self.assertRaisesRegex(RuntimeError,'Read-only'):m.schema_read(m.METADATA_QUERIES['columns'],['business_jobs'])
   m.query=lambda *a,**k:[{'success':True,'meta':{'rows_written':0,'changed_db':False},'results':[]}]
   self.assertEqual(m.schema_read(m.METADATA_QUERIES['columns'],['business_jobs']),[])
  finally:m.query=original

if __name__=='__main__':unittest.main()
