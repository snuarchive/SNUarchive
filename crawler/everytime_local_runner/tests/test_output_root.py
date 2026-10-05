"""Cross-process destination agreement without browser or data writes."""
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


class OutputRootTests(unittest.TestCase):
    def test_python_and_node_use_same_absolute_destination(self):
        with tempfile.TemporaryDirectory() as directory:
            env = dict(os.environ, EVERYTIME_LOCAL_OUTPUT_ROOT=directory)
            python = subprocess.run([sys.executable, '-X', 'utf8', '-B', '-c',
                'from crawler.everytime_local_runner.storage import ROOT; print(ROOT)'],
                env=env, capture_output=True, text=True, check=True)
            node = subprocess.run(['node', '-e',
                "console.log(require('./crawler/everytime_local_runner/output_root.cjs').outputRoot(process.cwd()))"],
                env=env, capture_output=True, text=True, check=True)
            self.assertEqual(Path(python.stdout.strip()), Path(directory).resolve())
            self.assertEqual(Path(node.stdout.strip()), Path(directory).resolve())
            self.assertEqual(list(Path(directory).iterdir()), [])

    def test_relative_configuration_fails_before_writing(self):
        result = subprocess.run([sys.executable, '-X', 'utf8', '-B', '-c',
            'from crawler.everytime_local_runner.storage import ROOT'],
            env=dict(os.environ, EVERYTIME_LOCAL_OUTPUT_ROOT='relative-output'),
            capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Output root must be absolute', result.stderr)
