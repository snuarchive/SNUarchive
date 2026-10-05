const test=require('node:test'),assert=require('node:assert/strict');
const {safeFailureDiagnostic}=require('../failure_diagnostic.cjs');
test('fixed search invariants are distinguishable without storing exception text',()=>{
  assert.deepEqual(safeFailureDiagnostic(new Error('Search candidate limit; stop')),{category:'search_candidate_limit'});
  assert.deepEqual(safeFailureDiagnostic(new Error('Search query or mode changed')),{category:'search_query_or_mode_changed'});
  assert.deepEqual(safeFailureDiagnostic(new Error('Search candidate limit; stop SECRET')),{category:'unclassified'});
});
test('browser failure diagnostics discard URLs, credentials and arbitrary error codes',()=>{
  const error=new Error('page.goto: net::ERR_CONNECTION_RESET at https://example.test/?token=SECRET');
  error.stack='SECRET';
  assert.deepEqual(safeFailureDiagnostic(error),{category:'browser_network_error',code:'ERR_CONNECTION_RESET'});
  assert.deepEqual(safeFailureDiagnostic(new Error('net::ERR_SECRET')),{category:'unclassified'});
  assert.deepEqual(safeFailureDiagnostic(Object.assign(new Error('SECRET'),{name:'TimeoutError'})),{category:'browser_timeout'});
});
