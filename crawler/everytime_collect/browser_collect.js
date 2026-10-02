// Evaluate in the existing approved cua_repl session. No browser launch or HTTP.
(function createEverytimeCollector(input) {
  const match = typeof input?.url === "string" && /^https:\/\/everytime\.kr\/lecture\/view\/([1-9][0-9]*)(?:\?tab=article)?$/.exec(input.url);
  if (!match || ["title", "instructor"].some(k => typeof input[k] !== "string" || !input[k].trim())) throw new Error("Invalid observed target");
  const base = "https://everytime.kr/lecture/view/" + match[1], url = base + "?tab=article";
  const target = { url, title: input.title, instructor: input.instructor };
  const cardsSelector = "div.article_tab > div.articles > div.article";
  const emptySelector = "div.article_tab > div.articles > div.alert > p.noarticles";
  const scopeLocator = "div.article_tab > div.header button";
  async function ensure(tab, expected) {
    if (await tab.url() !== expected) throw new Error("Page changed or login expired; stop without retry");
  }
  async function prepare(tab, overviewTab) {
    const start = await tab.url();
    if (start !== base && start !== url) throw new Error("Wrong course or login page; stop");
    // Preserve a preloaded article list; verify labels on a same-browser overview tab.
    const overview = start === base ? tab : overviewTab;
    if (!overview) throw new Error("Preloaded article requires a same-course overview tab");
    await ensure(overview, base);
    await overview.playwright.locator("section.info > div.item").first().waitFor({ state: "visible", timeoutMs: 5000 });
    const identity = await overview.playwright.evaluate(() => {
      const items = Array.from(document.querySelectorAll("section.info > div.item"));
      function field(label, selectors) {
        const matches = items.filter(item => item.querySelector(":scope > label")?.innerText === label);
        if (matches.length !== 1 || !matches[0].querySelector(":scope > label").getClientRects().length) throw new Error("Course label missing or ambiguous");
        const values = selectors.flatMap(selector => Array.from(matches[0].querySelectorAll(selector)).map(node => ({node, selector})));
        // Accept only the two observed shapes, with exactly one value in total.
        // Multiple/hidden/blank values never become a guessed professor identity.
        if (values.length !== 1 || !values[0].node.getClientRects().length || !values[0].node.innerText.trim()) throw new Error("Course value missing or ambiguous");
        return { text: values[0].node.innerText, locator: 'section.info > div.item with visible label "' + label + '" :: ' + values[0].selector };
      }
      const countLocator = document.querySelector("div.rating > div.title > span.count") ? "div.rating > div.title > span.count" : "section.empty.review > div.title > span.count";
      const counts = document.querySelectorAll(countLocator);
      if (counts.length !== 1 || !counts[0].getClientRects().length) throw new Error("Displayed review count unavailable");
      return { title: field("과목명", [":scope > a.link"]), instructor: field("교수명", [":scope > div.multiline > a.link", ":scope > span.text"]), count_text: counts[0].innerText, count_locator: countLocator };
    });
    await ensure(overview, base);
    if (identity.title.text !== target.title || identity.instructor.text !== target.instructor) throw new Error("Visible course identity differs from expected target");
    const count = /^\((\d+)개\)$/.exec(identity.count_text);
    if (!count) throw new Error("Unrecognized displayed count");
    const context = { identity, displayed_total: { value: Number(count[1]), text: identity.count_text, page_url: base,
      locator: identity.count_locator, observed_at: new Date().toISOString() } };
    if (start === base) {
      const link = tab.playwright.getByRole("link", { name: "강의평", exact: true });
      if (await link.count() !== 1 || await link.getAttribute("href") !== url.replace("https://everytime.kr", "")) throw new Error("Same-course article link missing");
      await link.click();
      await tab.getAXState({ emit: false });
    }
    await ensure(tab, url);
    await tab.playwright.locator(cardsSelector + ", " + emptySelector).first().waitFor({ state: "visible", timeoutMs: 5000 });
    return context;
  }
  async function read(tab) {
    await ensure(tab, url);
    if (await tab.title() !== target.title + " 강의실 - 에브리타임") throw new Error("Article page title differs from target");
    const state = await tab.playwright.evaluate(() => {
      const lists = document.querySelectorAll("div.article_tab > div.articles");
      if (lists.length !== 1 || !lists[0].getClientRects().length) throw new Error("Review list unavailable");
      const list = lists[0], rect = list.getBoundingClientRect();
      const buttons = Array.from(document.querySelectorAll("div.article_tab > div.header button")).filter(n => n.getClientRects().length).map(n => n.innerText);
      const empties = list.querySelectorAll(":scope > div.alert > p.noarticles");
      const emptyText = empties.length === 1 && empties[0].getClientRects().length ? empties[0].innerText : null;
      const rows = Array.from(list.querySelectorAll(":scope > div.article")).map((card, i) => {
        const bodies = card.querySelectorAll(":scope > div.text");
        const terms = card.querySelectorAll(":scope > div.article_header > div.title > div.info > span.semester");
        let reason = null;
        if (bodies.length !== 1) reason = "body_missing_or_ambiguous";
        else if (!bodies[0].getClientRects().length || !bodies[0].innerText.trim()) reason = "body_empty_or_hidden";
        else if (terms.length > 1) reason = "term_ambiguous";
        else if (terms.length && (!terms[0].getClientRects().length || !/^\d{2}년 .+ 수강자$/.test(terms[0].innerText))) reason = "term_unrecognized";
        return { position: i + 1, child: Array.from(list.children).indexOf(card) + 1,
          text: bodies.length === 1 ? bodies[0].innerText : null, term: terms.length === 1 ? terms[0].innerText : null, reason };
      });
      return { rows, count: rows.length, buttons, empty_text: emptyText,
        scroll_top: list.scrollTop, scroll_height: list.scrollHeight, client_height: list.clientHeight,
        at_bottom: list.scrollHeight - list.clientHeight - list.scrollTop <= 2,
        point: [Math.round(rect.x + rect.width / 2), Math.round(rect.y + rect.height * 0.75)] };
    });
    await ensure(tab, url);
    if (JSON.stringify(state.buttons) !== JSON.stringify(["전체", "등록순"])) throw new Error("Filter or sort changed; stop");
    if (!state.count && state.empty_text !== "첫 번째 강의평을 남겨주세요") throw new Error("No cards and no explicit empty-list evidence");
    if (state.count && state.empty_text !== null) throw new Error("Conflicting empty-list evidence");
    return state;
  }
  function batch(context, state, offset) {
    const rows = state.rows.slice(offset, offset + 20);
    if (!rows.length) throw new Error("Cannot fabricate an empty raw batch");
    const evidence = [];
    function ref(id, text, locator, page = url) {
      evidence.push({ id, kind: "visible_text", text, locator: page + " :: " + locator });
      return { evidence_id: id, start: 0, end: Array.from(text).length };
    }
    const identity = context.identity;
    const course = { title_raw: identity.title.text, instructor_raw: identity.instructor.text, source_id: null, metadata: {},
      field_evidence: { title_raw: ref("course_title", identity.title.text, identity.title.locator, base),
        instructor_raw: ref("course_instructor", identity.instructor.text, identity.instructor.locator, base) } };
    const collection = { adapter: "everytime_visible_dom_v2", requested_limit: 20, loaded_count: rows.length, attempted: rows.length,
      succeeded: rows.filter(r => !r.reason).length, failed: rows.filter(r => r.reason).length, not_attempted_loaded: 0,
      failures: rows.flatMap((r, i) => r.reason ? [{ list_position: i + 1, reason: r.reason }] : []), complete_course: false };
    const reviews = rows.filter(r => !r.reason).map(r => {
      const locator = cardsSelector + ":nth-child(" + r.child + ")";
      const field_evidence = { text_raw: ref("body_" + r.position, r.text, locator + " > div.text") };
      if (r.term !== null) field_evidence.enrollment_term_raw = ref("term_" + r.position, r.term, locator + " > div.article_header > div.title > div.info > span.semester");
      return { source_id: null, text_raw: r.text, enrollment_term_raw: r.term, created_at_raw: null, updated_at_raw: null, metadata: {}, field_evidence };
    });
    return { schema_version: 2, capture: { method: "browser_dom_observation", observed_at: new Date().toISOString(), page_url: url,
      page_title: target.title + " 강의실 - 에브리타임", coverage: "sample", metadata: { overview_page_url: base, target, collection,
        scope: { filter: state.buttons[0], sort: state.buttons[1], locator: scopeLocator },
        list_window: { start_position: rows[0].position, end_position: rows.at(-1).position, dom_loaded_count: state.count } } }, course, reviews, evidence };
  }
  return { target, base, url, cardsSelector, emptySelector, scopeLocator, prepare, read, batch };
})
