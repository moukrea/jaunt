"""Security boundary tests for the embedded Python download fallback."""
import ast
from pathlib import Path
import subprocess
import sys
import urllib.request

import pytest

ROOT = Path(__file__).resolve().parents[1]
SOURCE = (ROOT / 'install.sh').read_text().split("<<'PYFETCH'\n", 1)[1].split('\nPYFETCH', 1)[0]


def test_fallback_rejects_non_https_before_writing(tmp_path):
    output = tmp_path / 'download'
    result = subprocess.run([sys.executable, '-c', SOURCE,
                             'http://127.0.0.1/forbidden', str(output)],
                            capture_output=True, text=True, timeout=5)
    assert result.returncode != 0
    assert 'must remain HTTPS' in result.stderr
    assert not output.exists()


@pytest.mark.parametrize('target', ['http://example.test/unsafe', 'file:///etc/passwd'])
def test_fallback_rejects_redirect_downgrades(target):
    # Load the actual embedded redirect handler without initiating a download.
    tree = ast.parse(SOURCE)
    tree.body = [node for node in tree.body if isinstance(
        node, (ast.Import, ast.ImportFrom, ast.FunctionDef, ast.ClassDef))]
    namespace = {}
    exec(compile(tree, 'installer-fallback', 'exec'), namespace)
    handler = namespace['HTTPSRedirect']()
    request = urllib.request.Request('https://example.test/source')
    with pytest.raises(ValueError, match='must remain HTTPS'):
        handler.redirect_request(request, None, 302, 'Found', {}, target)


def test_fallback_allows_https_redirect():
    tree = ast.parse(SOURCE)
    tree.body = [node for node in tree.body if isinstance(
        node, (ast.Import, ast.ImportFrom, ast.FunctionDef, ast.ClassDef))]
    namespace = {}
    exec(compile(tree, 'installer-fallback', 'exec'), namespace)
    request = urllib.request.Request('https://example.test/source')
    redirected = namespace['HTTPSRedirect']().redirect_request(
        request, None, 302, 'Found', {}, 'https://assets.example.test/wheel')
    assert redirected.full_url == 'https://assets.example.test/wheel'
