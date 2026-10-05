"""Local file-only bridge. Never emits review bodies."""
import argparse
import json
from pathlib import Path

from .storage import ROOT, archive_batch, compare, finalize, run_path, seal


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    for command in ('batch', 'finalize', 'abort'):
        p = sub.add_parser(command)
        p.add_argument('--run', required=True)
        if command == 'batch':
            p.add_argument('--number', type=int, required=True)
        if command == 'abort':
            p.add_argument('--status', choices=('blocked', 'failed'), required=True)
    p = sub.add_parser('compare')
    p.add_argument('--baseline', required=True)
    p.add_argument('--local', required=True)
    p.add_argument('--output', required=True)
    args = parser.parse_args()
    if args.command == 'compare':
        output = Path(args.output).resolve()
        run_path(output.parent)
        result = compare(args.baseline, args.local, output)
        print(json.dumps({k: v for k, v in result.items() if not k.endswith('_files')}, ensure_ascii=False))
    elif args.command == 'batch':
        result = archive_batch(args.run, args.number)
        print(json.dumps({'batch': result['batch'], 'reviews_saved': result['reviews_saved']}))
    else:
        result = finalize(args.run) if args.command == 'finalize' else seal(run_path(args.run), args.status)
        print(json.dumps({'status': result['status'], 'details': result['details']}, ensure_ascii=False))


if __name__ == '__main__':
    main()
