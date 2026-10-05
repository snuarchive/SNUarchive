'use strict';
// Only fixed labels leave the exception. Never persist its message, stack or URL.
const SEARCH_ERRORS = new Map([
  ['Search query or mode changed', 'search_query_or_mode_changed'],
  ['Wrong school', 'wrong_school'],
  ['Search candidate limit; stop', 'search_candidate_limit'],
  ['Search scroll limit; stop', 'search_scroll_limit'],
  ['Excessive search wait; stop', 'search_deadline'],
  ['Repeated search candidate URL', 'repeated_search_candidate_url'],
  ['Search prefix changed; stop', 'search_prefix_changed'],
  ['Search card UI changed', 'search_card_ui_changed'],
  ['Loading failure is not not_found', 'search_empty_evidence_missing'],
  ['Login or unexpected search page; stop', 'unexpected_search_page'],
  ['Missing search geometry', 'search_geometry_missing'],
  ['Invalid observed overview URL', 'invalid_overview_url'],
  ['Access restriction; stop without retry', 'access_restriction'],
]);
function safeFailureDiagnostic(error) {
  const message = typeof error?.message === 'string' ? error.message : '';
  if (SEARCH_ERRORS.has(message)) return {category: SEARCH_ERRORS.get(message)};
  const network = message.match(/\bnet::(ERR_[A-Z_]+)\b/);
  const allowed = ['ERR_INTERNET_DISCONNECTED', 'ERR_NAME_NOT_RESOLVED', 'ERR_CONNECTION_RESET',
    'ERR_CONNECTION_CLOSED', 'ERR_CONNECTION_REFUSED', 'ERR_CONNECTION_TIMED_OUT', 'ERR_TIMED_OUT', 'ERR_ABORTED'];
  if (network && allowed.includes(network[1])) return {category: 'browser_network_error', code: network[1]};
  if (error?.name === 'TimeoutError') return {category: 'browser_timeout'};
  if (message.includes('Execution context was destroyed')) return {category: 'execution_context_destroyed'};
  return {category: 'unclassified'};
}
module.exports = {safeFailureDiagnostic};
