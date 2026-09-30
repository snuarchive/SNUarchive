"""Archive explicit same-course batches and an observed UI termination report."""
from datetime import datetime, timezone
import json
from pathlib import Path

from .archive import OUTPUT, PRIVATE, archive_observation, private_input
from .raw import MAX_INPUT_BYTES, ObservationError, _keys, _no_secrets, digest, duplicate_relation, fingerprints, read_json

from .target import course_urls


def validate_run_report(report):
    if report.get("report_version") == 2:
        from .run_v2 import validate_report
        return validate_report(report)
    _no_secrets(report)
    base, url = course_urls(report.get("source_url"))
    _keys(report, ("source_url", "initial_loaded", "final_loaded", "added", "attempted", "succeeded", "failed",
                   "failures", "batches", "displayed_total", "loading_method", "ui_end_confirmed", "termination_reason",
                   "bottom_confirmations", "final_state", "trace", "finished_at"), "course run")
    if report["source_url"] != url or report["loading_method"] != "scroll_inside_review_list":
        raise ObservationError("Unsupported course or loading method")
    for name in ("initial_loaded", "final_loaded", "added", "attempted", "succeeded", "failed", "batches", "bottom_confirmations"):
        if type(report[name]) is not int or report[name] < 0:
            raise ObservationError("Invalid run counts")
    if (not 1 <= report["initial_loaded"] <= 20 or report["final_loaded"] < report["initial_loaded"] or
            report["added"] != report["final_loaded"] - report["initial_loaded"] or
            report["attempted"] != report["final_loaded"] or report["succeeded"] + report["failed"] != report["attempted"]):
        raise ObservationError("Inconsistent run counts")
    total = report["displayed_total"]
    _keys(total, ("value", "text", "page_url", "locator", "observed_at"), "displayed total")
    if (type(total["value"]) is not int or total["value"] < 0 or total["text"] != f'({total["value"]}개)' or
            total["page_url"] != base or total["locator"] != "div.rating > div.title > span.count"):
        raise ObservationError("Invalid displayed count evidence")
    for stamp in (report["finished_at"], total["observed_at"]):
        try:
            if not isinstance(stamp, str) or "T" not in stamp or datetime.fromisoformat(stamp.replace("Z", "+00:00")).utcoffset() is None:
                raise ValueError()
        except ValueError:
            raise ObservationError("Invalid run observation time") from None
    trace = report["trace"]
    if not isinstance(trace, list) or not 2 <= len(trace) <= 31:
        raise ObservationError("Expected bounded UI trace")
    state_keys = ("count", "scroll_top", "scroll_height", "client_height", "at_bottom")
    trailing_idle = 0
    previous_count = None
    for index, state in enumerate(trace):
        _keys(state, ("action", *state_keys, *(("scroll", "added") if index else ())), "UI trace state")
        if state["action"] != ("scroll_down_3_pages" if index else "initial"):
            raise ObservationError("Unobserved navigation method")
        if type(state["count"]) is not int or state["count"] < 1:
            raise ObservationError("Invalid UI count")
        for name in ("scroll_top", "scroll_height", "client_height"):
            if type(state[name]) not in (int, float) or state[name] < 0:
                raise ObservationError("Invalid scroll geometry")
        at_bottom = state["scroll_height"] - state["client_height"] - state["scroll_top"] <= 2
        if type(state["at_bottom"]) is not bool or state["at_bottom"] != at_bottom:
            raise ObservationError("Bottom claim does not match geometry")
        if index:
            if (type(state["scroll"]) is not int or state["scroll"] != index or
                    type(state["added"]) is not int or state["added"] < 0 or state["added"] != state["count"] - previous_count):
                raise ObservationError("Invalid append trace")
            trailing_idle = trailing_idle + 1 if state["added"] == 0 and at_bottom else 0
        previous_count = state["count"]
    final = {key: trace[-1][key] for key in state_keys}
    if (report["final_state"] != final or trace[0]["count"] != report["initial_loaded"] or
            final["count"] != report["final_loaded"] or report["bottom_confirmations"] != trailing_idle):
        raise ObservationError("Run report does not match UI trace")
    confirmed = trailing_idle >= 2 and final["at_bottom"] and final["count"] == total["value"]
    reason = "displayed_total_matched_and_bottom_stable" if confirmed else (
        "bottom_stable_total_mismatch" if trailing_idle >= 2 else "scroll_limit_reached")
    if report["ui_end_confirmed"] is not confirmed or report["termination_reason"] != reason:
        raise ObservationError("Unsupported end-of-list claim")
    if not isinstance(report["failures"], list) or len(report["failures"]) != report["failed"]:
        raise ObservationError("Failure records do not match run counts")


def archive_course_run(sources, report_path, destination=None, *, against=(), private_root=PRIVATE, output_root=OUTPUT):
    policy = {"private_root": private_root, "output_root": output_root}
    if not 1 <= len(sources) <= 20 or len(sources) + len(against) > 20:
        raise ObservationError("Explicit batch and comparison file limit exceeded")
    report_path = Path(report_path).resolve()
    if not any(report_path.is_relative_to(Path(root).resolve()) for root in (private_root, output_root)):
        raise ObservationError("Run report must be in a private observation directory")
    with report_path.open("rb") as stream:
        report_bytes = stream.read(MAX_INPUT_BYTES + 1)
    report = read_json(report_bytes)
    validate_run_report(report)
    batches = [private_input(path, **policy) for path in sources]
    references = [private_input(path, **policy) for path in against]
    reference_prints = [fingerprints(doc, r) for _, _, doc in references for r in doc["reviews"]]
    previous = []
    within = external = appended_vs_initial = 0
    coverage = {key: 0 for key in ("text_raw", "enrollment_term_raw", "source_id", "created_at_raw", "updated_at_raw")}
    next_position = 1
    batch_failures = []
    saved = failed = 0
    identity = None
    for batch_number, (_, _, doc) in enumerate(batches, 1):
        if doc["schema_version"] != 2:
            raise ObservationError("Course run requires schema 2 batches")
        cap = doc["capture"]
        current_identity = (cap["page_url"], doc["course"]["title_raw"], doc["course"]["instructor_raw"])
        if cap["page_url"] != report["source_url"]:
            raise ObservationError("Batch URL differs from the run")
        if identity is not None and identity != current_identity:
            raise ObservationError("Mixed course labels in one run")
        identity = current_identity
        window = cap["metadata"].get("list_window")
        collection = cap["metadata"]["collection"]
        if (window is None or window["start_position"] != next_position or collection["not_attempted_loaded"] != 0 or
                window["dom_loaded_count"] not in [state["count"] for state in report["trace"]]):
            raise ObservationError("Missing, overlapping, or unobserved batch window")
        next_position = window["end_position"] + 1
        batch_failures.extend({"list_position": window["start_position"] + f["list_position"] - 1,
                               "reason": f["reason"], "batch": batch_number} for f in collection["failures"])
        failed_positions = {f["list_position"] for f in collection["failures"]}
        good_positions = [window["start_position"] + i - 1 for i in range(1, collection["attempted"] + 1) if i not in failed_positions]
        for position, review in zip(good_positions, doc["reviews"]):
            fp = fingerprints(doc, review)
            within += any(duplicate_relation(fp, earlier) for _, earlier in previous)
            external += any(duplicate_relation(fp, earlier) for earlier in reference_prints)
            if position > report["initial_loaded"]:
                appended_vs_initial += any(duplicate_relation(fp, earlier) for pos, earlier in previous if pos <= report["initial_loaded"])
            previous.append((position, fp))
            for key in coverage:
                coverage[key] += review[key] is not None
        saved += len(doc["reviews"])
        failed += collection["failed"]
    if (next_position - 1 != report["final_loaded"] or len(batches) != report["batches"] or
            saved != report["succeeded"] or failed != report["failed"] or batch_failures != report["failures"]):
        raise ObservationError("Run counts, failures, or windows disagree with available raw batches")
    # All validation precedes creation. Existing directories are never reused.
    output_root = Path(output_root).resolve()
    now = datetime.now(timezone.utc)
    destination = Path(destination).resolve() if destination else output_root / ("course_run_" + now.strftime("%Y%m%dT%H%M%S%fZ"))
    if destination == output_root or not destination.is_relative_to(output_root):
        raise ObservationError("Course run output must be a NEW private output subdirectory")
    destination.mkdir(parents=True, exist_ok=False)
    stored = []
    comparisons = list(against)
    for number, (path, _, _) in enumerate(batches, 1):
        folder, manifest = archive_observation(path, destination / f"batch_{number:03d}", against=comparisons, **policy)
        stored.append({"directory": folder.name, "reviews_saved": manifest["reviews_saved"], "raw_sha256": manifest["raw_file"]["sha256"]})
        comparisons.append(folder / "raw.json")
    summary = {
        "schema_version": 1, "operation": "archive_single_course_ui_run", "ui_observation": report,
        "observed_report_sha256": digest(report_bytes), "stored_at": now.isoformat(),
        "batches": stored, "reviews_saved": saved, "review_failures": failed,
        "duplicate_candidates": {"within_run_reviews": within, "against_prior_reviews": external,
                                 "appended_vs_initial_reviews": appended_vs_initial, "automatically_merged_or_deleted": 0},
        "field_coverage": {"course.title_raw": saved, "course.instructor_raw": saved, "capture.page_url": saved,
                           **{"reviews[]." + key: value for key, value in coverage.items()}},
        "all_observed_rows_saved": saved == report["final_loaded"] and failed == 0,
        "scope": "This course and the observed UI only; raw batches retain schema 2 sample coverage.",
        "network_requests": 0, "network_requests_scope": "Local archive only; browser traffic is not measured."
    }
    with (destination / "run_report.json").open("x", encoding="utf-8", newline="\n") as stream:
        json.dump(summary, stream, ensure_ascii=False, indent=2)
        stream.write("\n")
    return destination, summary
