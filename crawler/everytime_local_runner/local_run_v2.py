"""Local-only bounded archive fork of everytime_collect.run_v2.

Original CU validators remain unchanged. Legacy reports use their original
validator; local extended reports allow 300 scrolls and 200 batches. Raw schema,
identity, append continuity, completion and checksum checks are unchanged.
"""
from datetime import datetime, timezone
import json
from pathlib import Path

from crawler.everytime_collect.archive import PRIVATE, OUTPUT, archive_observation
from crawler.everytime_collect.raw import (MAX_INPUT_BYTES, ObservationError, _keys, _no_secrets, canonical, digest,
                  duplicate_relation, fingerprints, read_json, validate_document)
from crawler.everytime_collect.target import course_urls, validate_target

STATE_KEYS = ("count", "scroll_top", "scroll_height", "client_height", "at_bottom", "filter", "sort", "empty_text")
REASONS = {"explicit_empty_list", "displayed_total_matched_and_bottom_stable", "empty_total_mismatch",
           "bottom_stable_total_mismatch", "scroll_limit_reached", "batch_limit_reached", "review_read_failure", "interrupted"}
ROW_REASONS = {"body_missing_or_ambiguous", "body_empty_or_hidden", "term_ambiguous", "term_unrecognized"}


def require(condition, message):
    if not condition:
        raise ObservationError(message)


def integer(value, lower=0, upper=10**7):
    return type(value) is int and lower <= value <= upper


def stamp(value):
    try:
        return isinstance(value, str) and "T" in value and datetime.fromisoformat(value.replace("Z", "+00:00")).utcoffset() is not None
    except ValueError:
        return False


def validate_report(report):
    if report.get("limits", {}).get("comparison_files") == 20:
        from crawler.everytime_collect.run_v2 import validate_report as legacy_validate
        return legacy_validate(report)
    _no_secrets(report)
    _keys(report, ("report_version", "target", "source_url", "status", "initial_loaded", "final_loaded", "added",
                   "attempted", "succeeded", "failed", "failures", "batches", "unattempted_loaded", "displayed_total",
                   "identity_evidence", "loading_method", "scope_locator", "ui_end_confirmed", "termination_reason",
                   "stop_error", "limits", "bottom_confirmations", "final_state", "trace", "finished_at"), "run v2")
    target = validate_target(report["target"])
    base, url = course_urls(target["url"])
    require(report["report_version"] == 2 and report["source_url"] == url, "Run URL differs from target")
    require(report["loading_method"] == "scroll_inside_review_list" and report["scope_locator"] == "div.article_tab > div.header button", "Unknown UI method or scope")
    limits = report["limits"]
    _keys(limits, ("max_scrolls", "max_batches", "batch_size", "idle_wait_ms", "comparison_files"), "run limits")
    require(integer(limits["max_scrolls"], 1, 300) and integer(limits["max_batches"], 1, 200) and limits["batch_size"] == 20 and
            integer(limits["idle_wait_ms"], 1000, 5000) and limits["comparison_files"] == 200, "Unbounded UI limits")
    for key in ("attempted", "succeeded", "failed", "batches", "bottom_confirmations"):
        require(integer(report[key]), "Invalid run counts")
    require(report["batches"] <= limits["max_batches"] and report["succeeded"] + report["failed"] == report["attempted"], "Run totals disagree")
    require(stamp(report["finished_at"]), "Invalid finish time")
    total, identity = report["displayed_total"], report["identity_evidence"]
    require((total is None) == (identity is None), "Incomplete course evidence")
    if total is not None:
        _keys(total, ("value", "text", "page_url", "locator", "observed_at"), "displayed total")
        require(integer(total["value"]) and total["text"] == f'({total["value"]}개)' and total["page_url"] == base and
                total["locator"] in ("div.rating > div.title > span.count", "section.empty.review > div.title > span.count") and stamp(total["observed_at"]), "Invalid displayed total evidence")
        _keys(identity, ("title", "instructor", "count_text", "count_locator"), "identity evidence")
        for key in ("title", "instructor"):
            _keys(identity[key], ("text", "locator"), "identity field")
            require(identity[key]["text"] == target[key] and isinstance(identity[key]["locator"], str) and bool(identity[key]["locator"]), "Expected labels differ from observed identity")
        require(identity["count_text"] == total["text"] and identity["count_locator"] == total["locator"], "Count observations disagree")
    trace = report["trace"]
    require(isinstance(trace, list) and len(trace) <= limits["max_scrolls"] + 1, "Unbounded UI trace")
    idle = 0
    for index, state in enumerate(trace):
        _keys(state, ("action", *STATE_KEYS, *(("scroll", "added") if index else ())), "UI trace state")
        require(state["action"] == ("scroll_down_3_pages" if index else "initial"), "Unknown UI action")
        require(integer(state["count"]) and state["filter"] == "전체" and state["sort"] == "등록순", "Count scope is not the entire review list")
        require(all(type(state[k]) in (int, float) and state[k] >= 0 for k in ("scroll_top", "scroll_height", "client_height")) and
                state["client_height"] > 0, "Invalid list geometry")
        bottom = state["scroll_height"] - state["client_height"] - state["scroll_top"] <= 2
        require(type(state["at_bottom"]) is bool and state["at_bottom"] == bottom, "Bottom evidence disagrees")
        require(state["empty_text"] == ("첫 번째 강의평을 남겨주세요" if state["count"] == 0 else None), "Missing or conflicting empty-list evidence")
        if index:
            require(state["scroll"] == index and integer(state["added"]) and state["added"] == state["count"] - trace[index - 1]["count"], "Invalid append trace")
            idle = idle + 1 if not state["added"] and bottom else 0
    require(report["bottom_confirmations"] == idle, "Idle count differs from trace")
    if trace:
        require(total is not None and report["initial_loaded"] == trace[0]["count"] and report["final_loaded"] == trace[-1]["count"] and
                report["final_state"] == {k: trace[-1][k] for k in STATE_KEYS}, "Run state differs from trace")
        require(report["added"] == report["final_loaded"] - report["initial_loaded"] and integer(report["unattempted_loaded"]) and
                report["unattempted_loaded"] == report["final_loaded"] - report["attempted"], "Unattempted cards not accounted for")
    else:
        require(all(report[k] is None for k in ("initial_loaded", "final_loaded", "final_state", "added", "unattempted_loaded")) and
                report["attempted"] == report["batches"] == 0, "A failed page load is not an empty successful list")
    failures = report["failures"]
    require(isinstance(failures, list) and len(failures) == report["failed"], "Failure counts disagree")
    seen = set()
    for failure in failures:
        _keys(failure, ("list_position", "reason", "batch"), "run failure")
        require(integer(failure["list_position"], 1, report["attempted"]) and failure["list_position"] not in seen and
                integer(failure["batch"], 1, report["batches"]) and failure["reason"] in ROW_REASONS, "Invalid row failure")
        seen.add(failure["list_position"])
    reason = report["termination_reason"]
    require(reason in REASONS, "Unknown termination reason")
    if reason == "interrupted":
        require(isinstance(report["stop_error"], str) and bool(report["stop_error"]), "Interruption reason missing")
    else:
        require(report["stop_error"] is None and bool(trace), "Missing observed state")
    if reason == "explicit_empty_list":
        require(total["value"] == report["final_loaded"] == report["attempted"] == report["batches"] == 0 and trace[-1]["at_bottom"], "False empty-list completion")
    if reason == "displayed_total_matched_and_bottom_stable":
        require(idle >= 2 and trace[-1]["at_bottom"] and report["final_loaded"] == total["value"] and
                report["attempted"] == report["final_loaded"] and report["failed"] == 0, "False completion claim")
    if reason == "empty_total_mismatch":
        require(report["final_loaded"] == 0 and total["value"] != 0, "False empty mismatch")
    if reason == "bottom_stable_total_mismatch":
        require(idle >= 2 and report["final_loaded"] != total["value"], "False total mismatch")
    if reason == "scroll_limit_reached":
        require(len(trace) - 1 == limits["max_scrolls"], "Scroll limit not reached")
    if reason == "batch_limit_reached":
        require(report["batches"] == limits["max_batches"] and report["unattempted_loaded"] > 0, "Batch limit not reached")
    if reason == "review_read_failure":
        require(report["failed"] > 0, "Row failure missing")
    confirmed = reason in ("explicit_empty_list", "displayed_total_matched_and_bottom_stable")
    require(report["ui_end_confirmed"] is confirmed and report["status"] == ("complete" if confirmed else "partial"), "Status disagrees with UI evidence")


def private_json(path, *, private_root=PRIVATE, output_root=OUTPUT):
    path = Path(path).resolve()
    require(any(path.is_relative_to(Path(r).resolve()) for r in (private_root, output_root)), "Input must be private")
    with path.open("rb") as stream:
        data = stream.read(MAX_INPUT_BYTES + 1)
    return path, data, read_json(data)


def validate_event(event):
    _no_secrets(event)
    _keys(event, ("type", "batch", "observation", "window", "collection"), "batch event")
    require(integer(event["batch"], 1, 200), "Invalid batch number")
    window, collection = event["window"], event["collection"]
    _keys(window, ("start_position", "end_position", "dom_loaded_count"), "batch window")
    require(all(integer(v, 1) for v in window.values()) and window["start_position"] <= window["end_position"] <= window["dom_loaded_count"], "Invalid physical window")
    _keys(collection, ("adapter", "requested_limit", "loaded_count", "attempted", "succeeded", "failed", "not_attempted_loaded", "failures", "complete_course"), "event collection")
    count = window["end_position"] - window["start_position"] + 1
    require(integer(count, 1, 20) and collection["adapter"] == "everytime_visible_dom_v2" and collection["requested_limit"] == 20 and
            collection["loaded_count"] == collection["attempted"] == count and collection["not_attempted_loaded"] == 0 and
            integer(collection["succeeded"], 0, count) and integer(collection["failed"], 0, count) and
            collection["succeeded"] + collection["failed"] == count and collection["complete_course"] is False, "Invalid event counts")
    require(isinstance(collection["failures"], list) and len(collection["failures"]) == collection["failed"], "Invalid event failures")
    positions = set()
    for f in collection["failures"]:
        _keys(f, ("list_position", "reason"), "event failure")
        require(integer(f["list_position"], 1, count) and f["list_position"] not in positions and f["reason"] in ROW_REASONS, "Invalid failure position")
        positions.add(f["list_position"])
    if collection["succeeded"]:
        require(event["type"] == "batch", "Missing successful batch")
        validate_document(event["observation"])
        metadata = event["observation"]["capture"]["metadata"]
        require(metadata["list_window"] == window and metadata["collection"] == collection, "Event and raw disagree")
    else:
        require(event["type"] == "failed_batch" and event["observation"] is None, "Empty raw must not be fabricated")


def save_event(source, destination, *, against=(), private_root=PRIVATE, output_root=OUTPUT):
    policy = {"private_root": private_root, "output_root": output_root}
    path, data, event = private_json(source, **policy)
    validate_event(event)
    destination = Path(destination).resolve()
    require(destination.is_relative_to(Path(output_root).resolve()) and destination != Path(output_root).resolve(), "Output must be private")
    require(destination.name == f'batch_{event["batch"]:03d}', "Batch directory does not match event")
    if destination.exists():
        raise FileExistsError(destination)
    if event["observation"] is not None:
        raw = path.with_name(path.stem + "_raw.json")
        with raw.open("xb") as stream:
            stream.write(canonical(event["observation"]))
        _, manifest = archive_observation(raw, destination, against=against, **policy)
    else:
        destination.mkdir(parents=True, exist_ok=False)
        manifest = None
    with (destination / "batch_event.json").open("xb") as stream:
        stream.write(data)
    return destination, manifest


def finalize_run(sources, report_path, destination, *, against=(), private_root=PRIVATE, output_root=OUTPUT):
    policy = {"private_root": private_root, "output_root": output_root}
    require(len(sources) <= 200 and len(sources) + len(against) <= 200, "Batch and comparison file limit exceeded (200 combined)")
    _, report_bytes, report = private_json(report_path, **policy)
    validate_report(report)
    destination = Path(destination).resolve()
    require(destination.is_relative_to(Path(output_root).resolve()) and destination != Path(output_root).resolve(), "Output must be private")
    if (destination / "run_report.json").exists():
        raise FileExistsError(destination / "run_report.json")
    target = validate_target(report["target"])
    references = []
    for path in against:
        _, _, doc = private_json(path, **policy)
        validate_document(doc)
        references.extend(fingerprints(doc, r) for r in doc["reviews"])
    previous, stored, failures = [], [], []
    saved = failed = within = external = appended = 0
    coverage = {k: 0 for k in ("text_raw", "enrollment_term_raw", "source_id", "created_at_raw", "updated_at_raw")}
    next_position = 1
    for number, source in enumerate(sources, 1):
        path, _, event = private_json(source, **policy)
        validate_event(event)
        folder = destination / f"batch_{number:03d}"
        require(path == folder / "batch_event.json" and event["batch"] == number, "Finalize only explicitly archived batches in this run")
        window, collection, doc = event["window"], event["collection"], event["observation"]
        require(window["start_position"] == next_position and window["dom_loaded_count"] in [s["count"] for s in report["trace"]], "Overlapping, missing, or unobserved card positions")
        next_position = window["end_position"] + 1
        failures.extend({"list_position": window["start_position"] + f["list_position"] - 1, "reason": f["reason"], "batch": number} for f in collection["failures"])
        failed += collection["failed"]
        info = {"directory": folder.name, "reviews_saved": collection["succeeded"], "raw_sha256": None}
        if doc is not None:
            require(doc["capture"]["metadata"]["target"] == target, "Batch belongs to another course")
            _, raw_bytes, archived = private_json(folder / "raw.json", **policy)
            _, _, manifest = private_json(folder / "manifest.json", **policy)
            require(archived == doc and digest(raw_bytes) == manifest["raw_file"]["sha256"], "Archived raw changed after batch validation")
            info["raw_sha256"] = digest(raw_bytes)
            bad = {f["list_position"] for f in collection["failures"]}
            positions = [window["start_position"] + i - 1 for i in range(1, collection["attempted"] + 1) if i not in bad]
            for position, review in zip(positions, doc["reviews"]):
                fp = fingerprints(doc, review)
                within += any(duplicate_relation(fp, p) for _, p in previous)
                external += any(duplicate_relation(fp, p) for p in references)
                appended += position > report["initial_loaded"] and any(duplicate_relation(fp, p) for pos, p in previous if pos <= report["initial_loaded"])
                previous.append((position, fp))
                for key in coverage:
                    coverage[key] += review[key] is not None
            saved += len(doc["reviews"])
        stored.append(info)
    require(len(sources) == report["batches"] and next_position - 1 == report["attempted"] and saved == report["succeeded"] and
            failed == report["failed"] and failures == report["failures"], "Archived batches do not match run counts")
    summary = {"schema_version": 2, "operation": "finalize_explicit_course_ui_run", "ui_observation": report,
               "observed_report_sha256": digest(report_bytes), "stored_at": datetime.now(timezone.utc).isoformat(),
               "batches": stored, "reviews_saved": saved, "review_failures": failed,
               "duplicate_candidates": {"within_run_reviews": within, "against_prior_reviews": external, "appended_vs_initial_reviews": appended, "automatically_merged_or_deleted": 0},
               "field_coverage": {"course.title_raw": saved, "course.instructor_raw": saved, "capture.page_url": saved, **{"reviews[]." + k: v for k, v in coverage.items()}},
               "all_observed_rows_saved": report["final_loaded"] is not None and saved == report["final_loaded"] and failed == 0,
               "scope": "Current verified UI scope only; no whole-site completeness claim.", "network_requests": 0,
               "network_requests_scope": "Local archive only; browser traffic is not measured."}
    destination.mkdir(parents=True, exist_ok=True)
    with (destination / "run_report.json").open("x", encoding="utf-8", newline="\n") as stream:
        json.dump(summary, stream, ensure_ascii=False, indent=2)
        stream.write("\n")
    return destination, summary
