"""Browser adapter source and private storage; the CLI itself never opens the site."""
import argparse
import json
from pathlib import Path
import sys

from .archive import archive_observation, private_input
from .course_run import archive_course_run
from .raw import ObservationError
from .archive import PRIVATE, OUTPUT
from .run_v2 import private_json, save_event, finalize_run
from .transfer import unpack


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("browser-script", help="Print the function to run with an approved cua_repl tab; no browser is launched")
    sub.add_parser("browser-end-script", help="Print the same-course UI scroll generator; use with browser-script")
    sub.add_parser("browser-pack-script", help="Print lossless data transport helper")
    transfer = sub.add_parser("unpack-transfer", help="Verify and decode an opaque browser-returned JSON transfer")
    transfer.add_argument("--input", type=Path, required=True)
    transfer.add_argument("--output", type=Path, required=True)
    event = sub.add_parser("save-batch-event", help="Validate and archive one yielded event before next browser action")
    event.add_argument("--input", type=Path, required=True)
    event.add_argument("--output", type=Path, required=True)
    event.add_argument("--against", type=Path, action="append", default=[])
    finish = sub.add_parser("finalize-course-run", help="Verify already saved batches and write an exclusive final report")
    finish.add_argument("--input", type=Path, action="append", default=[])
    finish.add_argument("--report", type=Path, required=True)
    finish.add_argument("--output", type=Path, required=True)
    finish.add_argument("--against", type=Path, action="append", default=[])
    run = sub.add_parser("save-course-run", help="Archive explicit schema-2 batches and their observed UI end report")
    run.add_argument("--input", type=Path, action="append", required=True)
    run.add_argument("--report", type=Path, required=True)
    run.add_argument("--output", type=Path)
    run.add_argument("--against", type=Path, action="append", default=[])
    validate = sub.add_parser("validate", help="Check a supplied private raw observation without saving")
    validate.add_argument("--input", type=Path, required=True)
    save = sub.add_parser("save-observation", help="Archive a supplied observation; does not contact Everytime")
    save.add_argument("--input", type=Path, required=True)
    save.add_argument("--output", type=Path, help="New folder under crawler/output/")
    save.add_argument("--against", type=Path, action="append", default=[], help="Explicit previous raw.json for duplicate-candidate comparison; repeatable")
    args = parser.parse_args(argv)
    try:
        if args.command in ("browser-script", "browser-end-script", "browser-pack-script"):
            filename = {"browser-script": "browser_collect.js", "browser-end-script": "browser_collect_to_end.js", "browser-pack-script": "browser_pack.js"}[args.command]
            print(Path(__file__).with_name(filename).read_text(encoding="utf-8"))
            return 0
        if args.command == "unpack-transfer":
            _, _, packed = private_json(args.input)
            data = unpack(packed)
            output = args.output.resolve()
            if not any(output.is_relative_to(root.resolve()) for root in (PRIVATE, OUTPUT)):
                raise ObservationError("Transport output must be private")
            with output.open("xb") as stream:
                stream.write(data)
            result = {"output": str(output), "verified_bytes": len(data)}
        elif args.command == "save-batch-event":
            output, manifest = save_event(args.input, args.output, against=args.against)
            result = {"output": str(output), "reviews_saved": manifest["reviews_saved"] if manifest else 0}
        elif args.command in ("save-course-run", "finalize-course-run"):
            archive = archive_course_run if args.command == "save-course-run" else finalize_run
            output, summary = archive(args.input, args.report, args.output, against=args.against)
            result = {"output": str(output), "reviews_saved": summary["reviews_saved"], "review_failures": summary["review_failures"],
                      "duplicate_candidates": summary["duplicate_candidates"], "ui_end_confirmed": summary["ui_observation"]["ui_end_confirmed"]}
        elif args.command == "validate":
            _path, _data, doc = private_input(args.input)
            result = {"valid": True, "reviews": len(doc["reviews"]), "site_verified": False, "network_requests": 0}
        else:
            output, manifest = archive_observation(args.input, args.output, against=args.against)
            result = {"output": str(output), "reviews_saved": manifest["reviews_saved"],
                      "reviews_with_duplicate_candidates": manifest["reviews_with_duplicate_candidates"],
                      "site_verified": False, "network_requests": 0}
            if "collection" in manifest:
                result["collection"] = manifest["collection"]
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except ObservationError as error:
        print(f"ERROR: {error}", file=sys.stderr)
    except OSError:
        print("ERROR: Cannot read input or create a NEW output directory; existing output is never replaced", file=sys.stderr)
    return 2


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    raise SystemExit(main())
