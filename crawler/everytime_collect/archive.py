"""Append-only private storage for a supplied observation; performs no HTTP."""
from datetime import datetime, timezone
import json
from pathlib import Path

from . import VERSION
from .raw import MAX_INPUT_BYTES, ObservationError, digest, duplicate_relation, fingerprints, read_document

CRAWLER = Path(__file__).resolve().parents[1]
PRIVATE = CRAWLER / "data" / "private"
OUTPUT = CRAWLER / "output"


def private_input(path, *, private_root=PRIVATE, output_root=OUTPUT):
    path = Path(path).resolve()
    if not any(path.is_relative_to(Path(root).resolve()) for root in (private_root, output_root)):
        raise ObservationError("Observation input must be under crawler/data/private/ or crawler/output/")
    if not path.is_file():
        raise ObservationError("Private observation input is not a file")
    with path.open("rb") as stream:
        data = stream.read(MAX_INPUT_BYTES + 1)
    return path, data, read_document(data)


def archive_observation(source, destination=None, *, against=(), private_root=PRIVATE, output_root=OUTPUT):
    """Archive all supplied reviews, even when duplicate candidates are found.

    Alternate roots exist for isolated synthetic tests. The CLI always uses
    the repository's fixed private roots. No cookies, browser profile or session
    material are accepted. No live collection is implied by a successful save.
    """
    source, original, doc = private_input(source, private_root=private_root, output_root=output_root)
    prior = []
    if len(against) > 20:
        raise ObservationError("Compare at most 20 explicitly named previous observation files")
    compared = []
    for name in against:
        path, data, previous = private_input(name, private_root=private_root, output_root=output_root)
        file_hash = digest(data)
        compared.append({"file": str(path), "sha256": file_hash})
        for index, review in enumerate(previous["reviews"]):
            prior.append((fingerprints(previous, review), {"file": str(path), "file_sha256": file_hash, "review_index": index}))
    inventory = []
    for index, review in enumerate(doc["reviews"]):
        current = fingerprints(doc, review)
        matches = []
        for earlier, provenance in prior:
            relation = duplicate_relation(current, earlier)
            if relation:
                matches.append({"relation": relation, **provenance})
        inventory.append({"review_index": index, **current, "duplicate_candidates": matches})
        prior.append((current, {"file": "raw.json", "file_sha256": digest(original), "review_index": index}))

    output_root = Path(output_root).resolve()
    now = datetime.now(timezone.utc)
    destination = Path(destination).resolve() if destination else output_root / ("collect_observation_" + now.strftime("%Y%m%dT%H%M%S%fZ"))
    if destination == output_root or not destination.is_relative_to(output_root):
        raise ObservationError("Output must be a NEW subdirectory of crawler/output/")
    # Validate everything before creating output; never delete/replace old files.
    manifest = {
        "schema_version": 1, "collector_version": VERSION,
        "operation": "archive_supplied_observation",
        "network_requests": 0, "site_adapter": None, "site_structure_verified": False,
        "observation_provenance": "Supplied by the operator; evidence consistency was checked, not independently collected from the site.",
        "stored_at": now.isoformat(), "observed_at": doc["capture"]["observed_at"],
        "source_file": {"path": str(source), "sha256": digest(original)},
        "raw_file": {"path": "raw.json", "sha256": digest(original)},
        "coverage": "sample", "reviews_supplied": len(doc["reviews"]), "reviews_saved": len(doc["reviews"]),
        "reviews_with_duplicate_candidates": sum(bool(item["duplicate_candidates"]) for item in inventory),
        "deduplication_policy": "Flag only; never discard, merge, or overwrite observations. IDs are supplied source claims; ID-less matches remain possible duplicates.",
        "compared_files": compared, "reviews": inventory,
        "human_review_status": "unreviewed",
    }
    if doc["schema_version"] == 2:
        manifest["collection"] = doc["capture"]["metadata"]["collection"]
        manifest["site_adapter"] = manifest["collection"]["adapter"]
        manifest["network_requests_scope"] = "Local archive operation only; browser page traffic is not measured."
        manifest["observation_provenance"] = "Supplied from the approved browser DOM adapter; local validation checks evidence consistency, not browser authenticity."
    destination.mkdir(parents=True, exist_ok=False)
    with (destination / "raw.json").open("xb") as stream:
        stream.write(original)
    with (destination / "manifest.json").open("x", encoding="utf-8", newline="\n") as stream:
        json.dump(manifest, stream, ensure_ascii=False, indent=2, allow_nan=False)
        stream.write("\n")
    return destination, manifest
