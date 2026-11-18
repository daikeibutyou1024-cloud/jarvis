import test from 'node:test';
import {execFileSync} from 'node:child_process';
test('release schema inspection excludes records, detects drift and preserves additive compatibility',()=>{
 execFileSync('python',['tests/production_release_schema_test.py'],{stdio:'pipe'});
});
