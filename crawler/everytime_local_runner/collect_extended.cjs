// Local-only bounded orchestration fork; original DOM parser stays shared.
// Consume/validate/archive every batch before next(). No HTTP or browser launch.
module.exports =
(async function* collectEverytimeToEnd(tab, collector, { overviewTab, maxScrolls = 12, maxBatches = 20, idleWaitMs = 1500 } = {}) {
  if (!Number.isInteger(maxScrolls) || maxScrolls < 1 || maxScrolls > 300 || !Number.isInteger(maxBatches) || maxBatches < 1 || maxBatches > 200 ||
      !Number.isInteger(idleWaitMs) || idleWaitMs < 1000 || idleWaitMs > 5000) throw new Error("Invalid bounded UI limits");
  const compact = s => ({ count: s.count, scroll_top: s.scroll_top, scroll_height: s.scroll_height, client_height: s.client_height,
    at_bottom: s.at_bottom, filter: s.buttons[0], sort: s.buttons[1], empty_text: s.empty_text });
  let context = null, previous = null, initial = null, attempted = 0, succeeded = 0, failed = 0, batches = 0, idle = 0;
  let reason = "scroll_limit_reached", errorText = null;
  const trace = [], failures = [];
  try {
    context = await collector.prepare(tab, overviewTab);
    previous = await collector.read(tab);
    initial = previous.count;
    trace.push({ action: "initial", ...compact(previous) });
    let scroll = 0;
    while (true) {
      while (attempted < previous.count) {
        if (batches === maxBatches) { reason = "batch_limit_reached"; break; }
        const doc = collector.batch(context, previous, attempted), collection = doc.capture.metadata.collection;
        batches++;
        failures.push(...collection.failures.map(f => ({ list_position: attempted + f.list_position, reason: f.reason, batch: batches })));
        attempted += collection.attempted; succeeded += collection.succeeded; failed += collection.failed;
        yield { type: collection.succeeded ? "batch" : "failed_batch", batch: batches, observation: collection.succeeded ? doc : null,
          window: doc.capture.metadata.list_window, collection };
        if (collection.failed) { reason = "review_read_failure"; break; }
      }
      if (reason === "batch_limit_reached" || reason === "review_read_failure") break;
      if (!previous.count) {
        if (!previous.at_bottom) throw new Error("Empty list has inconsistent bottom geometry");
        reason = context.displayed_total.value === 0 ? "explicit_empty_list" : "empty_total_mismatch"; break;
      }
      if (idle >= 2) { reason = previous.count === context.displayed_total.value ? "displayed_total_matched_and_bottom_stable" : "bottom_stable_total_mismatch"; break; }
      if (scroll >= maxScrolls) break;
      await tab.scroll(previous.point, "down", 3);
      const ui = await tab.getAXState({ emit: false });
      if (/CAPTCHA|captcha|접근이 제한|접근 제한|너무 많은 요청|Too Many Requests/.test(ui)) throw new Error("Access restriction displayed; stop without retry");
      let state = await collector.read(tab);
      if (state.count === previous.count && state.at_bottom) {
        try { await tab.playwright.locator(collector.cardsSelector).nth(state.count).waitFor({ state: "attached", timeoutMs: idleWaitMs }); }
        catch (error) { if (!/timeout|timed out/i.test(String(error))) throw error; }
        state = await collector.read(tab);
      }
      if (state.count < previous.count || previous.rows.some((r, i) => JSON.stringify(r) !== JSON.stringify(state.rows[i]))) throw new Error("Previously loaded physical cards changed; stop without merging");
      const added = state.count - previous.count;
      idle = !added && state.at_bottom ? idle + 1 : 0;
      trace.push({ action: "scroll_down_3_pages", scroll: ++scroll, added, ...compact(state) });
      previous = state;
      yield { type: "progress", state: trace.at(-1) };
    }
  } catch (error) {
    reason = "interrupted";
    errorText = String(error);
  }
  const confirmed = ["explicit_empty_list", "displayed_total_matched_and_bottom_stable"].includes(reason) && failed === 0;
  yield { type: "complete", report: {
    report_version: 2, target: collector.target, source_url: collector.url, status: confirmed ? "complete" : "partial",
    initial_loaded: initial, final_loaded: previous?.count ?? null, added: initial === null ? null : previous.count - initial,
    attempted, succeeded, failed, failures, batches, unattempted_loaded: previous === null ? null : previous.count - attempted,
    displayed_total: context?.displayed_total ?? null, identity_evidence: context?.identity ?? null,
    loading_method: "scroll_inside_review_list", scope_locator: collector.scopeLocator,
    ui_end_confirmed: confirmed, termination_reason: reason, stop_error: errorText,
    limits: { max_scrolls: maxScrolls, max_batches: maxBatches, batch_size: 20, idle_wait_ms: idleWaitMs, comparison_files: 200 },
    bottom_confirmations: idle, final_state: previous ? compact(previous) : null, trace, finished_at: new Date().toISOString()
  } };
})
;
