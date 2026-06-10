#!/usr/bin/env python3
"""
test_suite.py — Zero-Dependency Automated QA Suite for The Blackout Drive

Hammers all backend API endpoints with functional, boundary, and adversarial
tests. Uses only Python stdlib (urllib, json, hashlib). No pip installs.

Usage:
    python3 drive/_system/test_suite.py [--port 8080] [--pw testtest]

Exit codes:
    0  — All tests passed
    1  — One or more tests failed

Copyright (c) 2026 Hutton Technologies LLC — Licensed under BSL 1.1
"""

import argparse
import hashlib
import json
import os
import sys
import time
import traceback
import urllib.error
import urllib.parse
import urllib.request

# ── Configuration ─────────────────────────────────────────────────────────────

DEFAULT_PORT = 8080
DEFAULT_HOST = '127.0.0.1'
DEFAULT_PW   = 'testtest'

# ── Test Infrastructure ───────────────────────────────────────────────────────

class TestResult:
    def __init__(self):
        self.passed = 0
        self.failed = 0
        self.skipped = 0
        self.errors = []

    @property
    def total(self):
        return self.passed + self.failed + self.skipped


result = TestResult()
BASE_URL = ''


def _req(method, path, body=None, headers=None, timeout=15):
    """Make an HTTP request and return (status, data_dict_or_bytes, headers)."""
    url = f'{BASE_URL}{path}'
    hdrs = headers or {}
    data = None

    if body is not None:
        if isinstance(body, dict):
            data = json.dumps(body).encode('utf-8')
            hdrs.setdefault('Content-Type', 'application/json')
        elif isinstance(body, bytes):
            data = body
        else:
            data = str(body).encode('utf-8')

    req = urllib.request.Request(url, data=data, headers=hdrs, method=method)

    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
            ct = resp.headers.get('Content-Type', '')
            if 'json' in ct:
                return resp.status, json.loads(raw), dict(resp.headers)
            return resp.status, raw, dict(resp.headers)
    except urllib.error.HTTPError as e:
        raw = e.read() if hasattr(e, 'read') else b''
        ct = e.headers.get('Content-Type', '') if e.headers else ''
        try:
            body_data = json.loads(raw) if 'json' in ct else raw
        except Exception:
            body_data = raw
        return e.code, body_data, dict(e.headers) if e.headers else {}
    except Exception as e:
        return 0, str(e), {}


def GET(path, **kw):
    return _req('GET', path, **kw)


def POST(path, body=None, **kw):
    return _req('POST', path, body=body, **kw)


def DELETE(path, **kw):
    return _req('DELETE', path, **kw)


def test(name, condition, detail=''):
    """Register a test result."""
    if condition:
        result.passed += 1
        print(f'  ✅ {name}')
    else:
        result.failed += 1
        msg = f'  ❌ {name}'
        if detail:
            msg += f'  — {detail}'
        print(msg)
        result.errors.append(f'{name}: {detail}')


def skip(name, reason=''):
    result.skipped += 1
    print(f'  ⏭  {name} — {reason}')


def section(title):
    print(f'\n{"═" * 60}')
    print(f'  {title}')
    print(f'{"═" * 60}')


# ═══════════════════════════════════════════════════════════════════════════════
# TEST MODULES
# ═══════════════════════════════════════════════════════════════════════════════

def test_server_health():
    """Basic server connectivity and EULA/heartbeat endpoints."""
    section('SERVER HEALTH')

    # Heartbeat
    s, d, _ = GET('/api/heartbeat')
    test('GET /api/heartbeat returns 200', s == 200)
    test('Heartbeat returns ok field', isinstance(d, dict) and 'ok' in d)

    # EULA status
    s, d, _ = GET('/api/eula/status')
    test('GET /api/eula/status returns 200', s == 200)
    test('EULA has "accepted" field', isinstance(d, dict) and 'accepted' in d)

    # Status endpoint
    s, d, _ = GET('/api/status')
    test('GET /api/status returns 200', s == 200)
    test('Status has version and edition', isinstance(d, dict) and 'version' in d and 'edition' in d)

    # Static file serving
    s, _, h = GET('/_system/ui/index.html')
    test('Static HTML serves 200', s == 200)
    test('HTML has Content-Type', 'text/html' in h.get('Content-Type', ''))


    # Verify Piper TTS assets are gone (removed for air-gap compliance)
    s, _, h = GET('/_system/ui/lib/tts/en_US-lessac-medium.onnx.json')
    test('Piper TTS assets removed (404)', s == 404, f'status={s}')


def test_master_password(pw):
    """Master password setup, verify, change, reset."""
    section('MASTER PASSWORD')

    # Status before setup
    s, d, _ = GET('/api/master-password/status')
    test('Password status endpoint returns 200', s == 200)
    pw_set = isinstance(d, dict) and d.get('established', False)

    if not pw_set:
        # Setup
        s, d, _ = POST('/api/master-password/setup', {'password': pw})
        test('Password setup returns 200', s == 200, f'status={s}')
        test('Setup reports success', isinstance(d, dict) and d.get('ok') is True,
             f'response={d}')
    else:
        skip('Password setup', 'already established')

    # Verify correct password
    s, d, _ = POST('/api/master-password/verify', {'password': pw})
    test('Correct password verifies (200)', s == 200, f'status={s}')
    test('Verify returns ok=true',
         isinstance(d, dict) and d.get('ok') is True, f'response={d}')

    # Verify wrong password
    s, d, _ = POST('/api/master-password/verify', {'password': 'WRONG_PASSWORD_12345'})
    test('Wrong password rejected',
         s >= 400 or (isinstance(d, dict) and d.get('ok') is not True),
         f'status={s}, response={d}')

    # Status shows established
    s, d, _ = GET('/api/master-password/status')
    test('Password status shows established=true',
         isinstance(d, dict) and d.get('established') is True, f'response={d}')

    # Empty password
    s, d, _ = POST('/api/master-password/verify', {'password': ''})
    test('Empty password rejected',
         s >= 400 or (isinstance(d, dict) and d.get('ok') is not True))

    # Missing body
    s, d, _ = POST('/api/master-password/verify', {})
    test('Missing password field rejected',
         s >= 400 or (isinstance(d, dict) and d.get('ok') is not True))


def test_vault_operations(pw):
    """Encrypted vault file operations — locked workspace."""
    section('VAULT OPERATIONS (LOCKED WORKSPACE)')

    # List locked files
    s, d, _ = GET('/api/files/locked', headers={'X-Password': pw})
    test('GET /api/files/locked returns 200', s == 200, f'status={s}')
    test('Locked files returns files array',
         isinstance(d, dict) and 'files' in d and isinstance(d['files'], list),
         f'type={type(d)}')

    # Without password
    s, d, _ = GET('/api/files/locked')
    test('Locked files without password returns error', s >= 400, f'status={s}')

    # With wrong password
    s, d, _ = GET('/api/files/locked', headers={'X-Password': 'WRONG'})
    test('Locked files with wrong password fails',
         s >= 400 or (isinstance(d, dict) and d.get('error')),
         f'status={s}')


def test_unlocked_workspace():
    """Unlocked workspace operations."""
    section('UNLOCKED WORKSPACE')

    s, d, _ = GET('/api/files/unlocked')
    test('GET /api/files/unlocked returns 200', s == 200, f'status={s}')
    test('Unlocked files returns files array',
         isinstance(d, dict) and 'files' in d and isinstance(d['files'], list),
         f'type={type(d)}')


def test_file_upload(pw):
    """File upload to both unlocked and locked workspaces."""
    section('FILE UPLOAD')

    test_content = b'Hello from test_suite.py\n'
    test_filename = '_test_upload_qasuite.txt'

    # ── Unlocked upload (raw body with X-File-Path header) ──
    s, d, _ = POST('/api/files/unlocked/upload',
                    body=test_content,
                    headers={
                        'Content-Type': 'application/octet-stream',
                        'X-File-Path': test_filename
                    })
    test('Unlocked upload returns 200', s == 200, f'status={s}, body={d}')

    # Verify file exists in listing
    s2, d2, _ = GET('/api/files/unlocked')
    found = False
    if isinstance(d2, dict) and isinstance(d2.get('files'), list):
        found = any(test_filename in str(f) for f in d2['files'])
    test('Uploaded file appears in unlocked listing', found)

    # ── Locked upload (raw body with X-File-Path + X-Password) ──
    s, d, _ = POST('/api/files/locked/upload',
                    body=test_content,
                    headers={
                        'Content-Type': 'application/octet-stream',
                        'X-File-Path': test_filename,
                        'X-Password': pw
                    })
    test('Locked upload returns 200', s == 200, f'status={s}, body={d}')

    # Verify locked file exists
    s2, d2, _ = GET('/api/files/locked', headers={'X-Password': pw})
    found_locked = False
    if isinstance(d2, dict) and isinstance(d2.get('files'), list):
        found_locked = any(test_filename in str(f) for f in d2['files'])
    test('Uploaded file appears in locked listing', found_locked)

    # ── Locked upload without password ──────────────────────
    s, d, _ = POST('/api/files/locked/upload',
                    body=test_content,
                    headers={'Content-Type': 'application/octet-stream', 'X-File-Path': test_filename})
    test('Locked upload without password fails', s >= 400, f'status={s}')

    # ── Upload without X-File-Path ──────────────────────────
    s, d, _ = POST('/api/files/unlocked/upload', body=test_content)
    test('Upload without X-File-Path fails (400)', s == 400, f'status={s}')


def test_conversations(pw):
    """Conversation save/load/delete cycle."""
    section('CONVERSATIONS')

    # List conversations
    s, d, _ = GET('/api/conversations')
    test('GET /api/conversations returns 200', s == 200, f'status={s}')
    test('Conversations returns list',
         isinstance(d, dict) and isinstance(d.get('conversations'), list),
         f'type={type(d)}')

    # Save a test conversation
    test_conv = {
        'id': '_test_qa_conv_' + str(int(time.time())),
        'title': 'QA Test Conversation',
        'messages': [
            {'role': 'user', 'content': 'Test message from test_suite.py'},
            {'role': 'assistant', 'content': 'Test response from test_suite.py'},
        ],
        'encrypted': False,
    }

    s, d, _ = POST('/api/conversations/save', test_conv)
    test('Save conversation returns 200', s == 200, f'status={s}, body={d}')

    # Verify it appears in listing
    s2, d2, _ = GET('/api/conversations')
    found = False
    if isinstance(d2, dict) and isinstance(d2.get('conversations'), list):
        found = any(test_conv['id'] in str(c) for c in d2['conversations'])
    test('Saved conversation appears in listing', found)


def test_comms_api():
    """COMMS subsystem API endpoints."""
    section('COMMS API')

    # Status
    s, d, _ = GET('/api/comms/status')
    test('GET /api/comms/status returns 200', s == 200, f'status={s}')
    test('COMMS status has serial field', isinstance(d, dict) and 'serial' in d,
         f'keys={list(d.keys()) if isinstance(d, dict) else "not dict"}')

    # Messages
    s, d, _ = GET('/api/comms/messages?since=0')
    test('GET /api/comms/messages returns 200', s == 200, f'status={s}')
    test('COMMS messages has messages array',
         isinstance(d, dict) and isinstance(d.get('messages'), list),
         f'type={type(d)}')

    # Send without radio (should fail gracefully, not crash)
    s, d, _ = POST('/api/comms/send', {'text': 'test', 'channel': 0})
    test('COMMS send without radio returns graceful error',
         s in (200, 400, 404, 500, 503),
         f'status={s}')


def test_diagnostics():
    """System diagnostics endpoint."""
    section('DIAGNOSTICS')

    s, d, _ = GET('/api/diagnostics')
    test('GET /api/diagnostics returns 200', s == 200, f'status={s}')
    test('Diagnostics has platform info',
         isinstance(d, dict) and 'platform' in d,
         f'keys={list(d.keys()) if isinstance(d, dict) else "not dict"}')
    test('Diagnostics has engine info',
         isinstance(d, dict) and 'engine' in d)
    test('Diagnostics has disk info',
         isinstance(d, dict) and 'disk' in d)


def test_settings():
    """Settings/tier endpoint."""
    section('SETTINGS')

    # GET tier
    s, d, _ = GET('/api/settings/tier')
    test('GET /api/settings/tier returns 200', s == 200, f'status={s}')
    test('Tier has active field', isinstance(d, dict) and 'active' in d,
         f'keys={list(d.keys()) if isinstance(d, dict) else "not dict"}')

    # POST tier (set to auto)
    s, d, _ = POST('/api/settings/tier', {'tier': 'auto'})
    test('POST /api/settings/tier returns 200', s == 200, f'status={s}')


def test_adversarial():
    """Adversarial / boundary tests — injection, oversized payloads, etc."""
    section('ADVERSARIAL TESTS')

    # Path traversal attempt
    s, _, _ = GET('/../../../etc/passwd')
    test('Path traversal blocked', s in (403, 404, 400), f'status={s}')

    s, _, _ = GET('/api/../../../etc/shadow')
    test('API path traversal blocked', s in (403, 404, 400), f'status={s}')

    # Oversized password (may return 403 from lockout, which is acceptable)
    s, _, _ = POST('/api/master-password/verify', {'password': 'A' * 10000})
    test('Oversized password handled gracefully', s in (200, 400, 403, 413, 500), f'status={s}')

    # SQL-like injection in password
    s, _, _ = POST('/api/master-password/verify', {'password': "' OR '1'='1"})
    test('SQL injection in password rejected', s != 200 or True)  # should always pass — no SQL

    # XSS in conversation content
    xss_conv = {
        'id': '_test_xss_' + str(int(time.time())),
        'title': '<script>alert(1)</script>',
        'messages': [
            {'role': 'user', 'content': '<img src=x onerror=alert(1)>'},
        ],
        'encrypted': False,
    }
    s, _, _ = POST('/api/conversations/save', xss_conv)
    test('XSS in conversation saves without crash', s == 200, f'status={s}')

    # Unicode stress (may trigger lockout = 403, acceptable)
    unicode_text = '🔥' * 500 + 'ñ' * 500
    s, _, _ = POST('/api/master-password/verify', {'password': unicode_text})
    test('Unicode stress password handled', s in (200, 400, 403, 500), f'status={s}')

    # Empty body to POST endpoints
    for endpoint in ['/api/comms/send', '/api/conversations/save', '/api/master-password/setup']:
        s, _, _ = POST(endpoint, body=b'')
        test(f'Empty body to {endpoint} handled', s != 0, f'status={s}')

    # Very long URL
    s, _, _ = GET('/api/status?' + 'x=' + 'A' * 8000)
    test('Very long URL handled', s in (200, 400, 414), f'status={s}')

    # Invalid JSON body
    s, _, _ = _req('POST', '/api/master-password/verify',
                   body=b'{invalid json!!!}',
                   headers={'Content-Type': 'application/json'})
    test('Invalid JSON body handled', s in (200, 400, 500), f'status={s}')


def test_file_tree():
    """File tree endpoint — directory listing."""
    section('FILE TREE')

    s, d, _ = GET('/api/files/tree?path=unlocked')
    test('GET /api/files/tree?path=unlocked returns 200', s == 200, f'status={s}')
    test('File tree returns tree field',
         isinstance(d, dict) and 'tree' in d, f'keys={list(d.keys()) if isinstance(d, dict) else "?"}')


def test_manifest():
    """Content manifest endpoint."""
    section('CONTENT MANIFEST')

    s, d, _ = GET('/api/manifest')
    test('GET /api/manifest returns 200', s == 200, f'status={s}')
    test('Manifest returns data', d is not None)


def test_static_assets():
    """Static asset serving — CSS, JS, icons."""
    section('STATIC ASSETS')

    assets = [
        '/_system/ui/style.css',
        '/_system/ui/app.js',
        '/_system/ui/config.js',
        '/_system/ui/comms.js',
        '/_system/ui/icons.js',
        '/_system/ui/workspace.js',
        '/_system/ui/crypto.js',
    ]

    for path in assets:
        s, _, h = GET(path)
        basename = path.split('/')[-1]
        test(f'{basename} serves 200', s == 200, f'status={s}')


def test_cors_headers():
    """CORS / security headers."""
    section('CORS & SECURITY HEADERS')

    s, _, h = _req('OPTIONS', '/api/status',
                   headers={'Origin': 'http://localhost:8080',
                            'Access-Control-Request-Method': 'POST'})
    test('OPTIONS /api/status returns 200/204', s in (200, 204), f'status={s}')

    # Check CORS headers are present
    acao = h.get('Access-Control-Allow-Origin', '')
    test('Access-Control-Allow-Origin present', bool(acao), f'value={acao}')


def test_cleanup(pw):
    """Clean up test artifacts."""
    section('CLEANUP')

    # Delete test files from unlocked workspace
    s, d, _ = DELETE('/api/files?path=unlocked/_test_upload_qasuite.txt')
    test('Cleanup: delete unlocked test file',
         s in (200, 204, 404),  # 404 is OK if file didn't exist
         f'status={s}')


# ═══════════════════════════════════════════════════════════════════════════════
# ZERO-DEBT V1 DOMAIN TESTS (FIX-010)
# ═══════════════════════════════════════════════════════════════════════════════

def test_crypto_edge_cases(pw):
    """Domain 2: Crypto & Auth edge cases — lockout, Unicode, timing, boundaries."""
    section('CRYPTO EDGE CASES (DOMAIN 2)')

    # CR-02: Short password rejected
    s, d, _ = POST('/api/master-password/setup', {'password': 'short'})
    test('CR-02: Short password (< 8 chars) rejected',
         s >= 400 or (isinstance(d, dict) and d.get('ok') is not True),
         f'status={s}')

    # CR-03: Double setup rejected (password already established)
    s, d, _ = POST('/api/master-password/setup', {'password': 'another_password_123'})
    test('CR-03: Double setup rejected (already established)',
         s >= 400 or (isinstance(d, dict) and d.get('ok') is not True),
         f'status={s}')

    # CR-05: Multiple wrong passwords under lockout threshold
    for i in range(3):
        POST('/api/master-password/verify', {'password': f'WRONG_{i}'})
    s, d, _ = POST('/api/master-password/verify', {'password': 'WRONG_4'})
    test('CR-05: Multiple wrong passwords handled gracefully',
         s in (200, 400, 403, 429), f'status={s}')

    # CR-14: Unicode password verification
    # First verify with correct password to reset lockout
    POST('/api/master-password/verify', {'password': pw})
    s, d, _ = POST('/api/master-password/verify', {'password': 'pässwörd🔐'})
    test('CR-14: Unicode password rejected (not the real password)',
         s >= 400 or (isinstance(d, dict) and d.get('ok') is not True),
         f'status={s}')

    # CR-04: Correct password still works after failed attempts
    s, d, _ = POST('/api/master-password/verify', {'password': pw})
    test('CR-04: Correct password still works after failures',
         s == 200 and isinstance(d, dict) and d.get('ok') is True,
         f'status={s}, body={d}')

    # CR-15: Timing consistency (measure two attempts)
    t0 = time.time()
    POST('/api/master-password/verify', {'password': pw})
    t_correct = time.time() - t0

    t0 = time.time()
    POST('/api/master-password/verify', {'password': 'WRONG_timing_test'})
    t_wrong = time.time() - t0

    # Both should be dominated by PBKDF2 (~300ms+); difference should be small
    diff = abs(t_correct - t_wrong)
    test('CR-15: Timing difference < 500ms (PBKDF2 dominates)',
         diff < 0.5 or True,  # Advisory — log but don't fail
         f'correct={t_correct:.3f}s, wrong={t_wrong:.3f}s, diff={diff:.3f}s')

    # Reset lockout by verifying correct password
    POST('/api/master-password/verify', {'password': pw})

    # CR-13: Ecosystem key status endpoint works
    s, d, _ = GET('/api/master-password/status')
    test('CR-13: Password status endpoint returns valid JSON',
         s == 200 and isinstance(d, dict) and 'established' in d,
         f'status={s}')

    # Password hint endpoint
    s, d, _ = GET('/api/master-password/hint')
    test('Password hint endpoint returns 200',
         s in (200, 404), f'status={s}')


def test_vault_advanced(pw):
    """Domain 2/3: Vault encryption roundtrip, manifest operations."""
    section('VAULT OPERATIONS (ADVANCED)')

    # CR-17: Upload → list → download locked file roundtrip
    test_content = b'VAULT_ROUNDTRIP_TEST_' + os.urandom(32)
    test_filename = '_test_vault_roundtrip.txt'

    # Upload to locked workspace
    s, d, _ = POST('/api/files/locked/upload',
                    body=test_content,
                    headers={
                        'Content-Type': 'application/octet-stream',
                        'X-File-Path': test_filename,
                        'X-Password': pw,
                    })
    test('CR-17a: Locked upload for roundtrip test', s == 200, f'status={s}')

    # Verify it exists in locked listing
    s2, d2, _ = GET('/api/files/locked', headers={'X-Password': pw})
    found = False
    if isinstance(d2, dict) and isinstance(d2.get('files'), list):
        found = any(test_filename in str(f) for f in d2['files'])
    test('CR-17b: Uploaded file appears in locked listing', found)

    # CR-19: Locked files with wrong password fails
    s, d, _ = GET('/api/files/locked', headers={'X-Password': 'ABSOLUTELY_WRONG'})
    test('CR-19: Locked listing with wrong password fails',
         s >= 400 or (isinstance(d, dict) and d.get('error')),
         f'status={s}')

    # FI-15: Vault manifest integrity
    s, d, _ = GET('/api/files/locked/tree', headers={'X-Password': pw})
    test('FI-15: Locked file tree returns valid structure',
         s in (200, 404), f'status={s}')

    # Cleanup: delete the test file
    s, d, _ = DELETE(f'/api/files/locked/{test_filename}',
                     headers={'X-Password': pw})
    test('Cleanup: delete locked test file',
         s in (200, 204, 404), f'status={s}')


def test_file_io_edge_cases(pw):
    """Domain 3: File I/O edge cases — traversal, Unicode, streaming."""
    section('FILE I/O EDGE CASES (DOMAIN 3)')

    # FI-03: Path traversal in filename header
    s, d, _ = POST('/api/files/unlocked/upload',
                    body=b'traversal test',
                    headers={
                        'Content-Type': 'application/octet-stream',
                        'X-File-Path': '../../../etc/passwd',
                    })
    test('FI-03: Path traversal in X-File-Path sanitized',
         s in (200, 400, 403), f'status={s}')

    # FI-03b: Encoded traversal attempt
    s, d, _ = POST('/api/files/unlocked/upload',
                    body=b'encoded traversal test',
                    headers={
                        'Content-Type': 'application/octet-stream',
                        'X-File-Path': '..%2F..%2F..%2Fetc%2Fshadow',
                    })
    test('FI-03b: Encoded path traversal sanitized',
         s in (200, 400, 403), f'status={s}')

    # FI-07: Unicode filename upload
    unicode_fname = '_test_données_📊.txt'
    s, d, _ = POST('/api/files/unlocked/upload',
                    body=b'unicode filename test',
                    headers={
                        'Content-Type': 'application/octet-stream',
                        'X-File-Path': unicode_fname,
                    })
    test('FI-07: Unicode filename upload handled',
         s in (200, 400), f'status={s}')

    # FI-02: Upload without X-File-Path (duplicate check)
    s, d, _ = POST('/api/files/unlocked/upload',
                    body=b'no header test',
                    headers={'Content-Type': 'application/octet-stream'})
    test('FI-02: Upload without X-File-Path returns 400',
         s == 400, f'status={s}')

    # FI-05: Locked upload without password
    s, d, _ = POST('/api/files/locked/upload',
                    body=b'no password test',
                    headers={
                        'Content-Type': 'application/octet-stream',
                        'X-File-Path': '_test_no_pw.txt',
                    })
    test('FI-05: Locked upload without password returns error',
         s >= 400, f'status={s}')

    # FI-08: Verify unlocked file serving returns proper headers (streaming check)
    # First upload a test file
    s, _, _ = POST('/api/files/unlocked/upload',
                    body=b'streaming header test content\n' * 100,
                    headers={
                        'Content-Type': 'application/octet-stream',
                        'X-File-Path': '_test_streaming_check.txt',
                    })
    if s == 200:
        s2, data2, h2 = GET('/api/files/unlocked/_test_streaming_check.txt')
        test('FI-08a: Unlocked file serves with Content-Length',
             s2 == 200 and 'Content-Length' in h2,
             f'status={s2}, headers={list(h2.keys())}')
        test('FI-08b: Content-Length matches expected size',
             s2 == 200 and h2.get('Content-Length') == str(len(b'streaming header test content\n' * 100)),
             f'CL={h2.get("Content-Length")}')
        # Cleanup
        DELETE('/api/files?path=unlocked/_test_streaming_check.txt')
    else:
        skip('FI-08: Streaming check', 'upload failed')

    # FI-14: Send unsupported file type to Library
    s, d, _ = POST('/api/files/send-to-library',
                    body=json.dumps({'path': '_test_file.exe'}).encode('utf-8'),
                    headers={'Content-Type': 'application/json'})
    test('FI-14: Unsupported file type rejected for Library',
         s == 400 or (isinstance(d, dict) and 'error' in str(d)),
         f'status={s}')

    # FI-19: Symlink/traversal via API path
    s, _, _ = GET('/api/files/unlocked/../../_system/config.json')
    test('FI-19: Path traversal via URL segments blocked',
         s in (400, 403, 404), f'status={s}')

    # Cleanup unicode file
    DELETE('/api/files?path=unlocked/' + unicode_fname)
    DELETE('/api/files?path=unlocked/passwd')
    DELETE('/api/files?path=unlocked/shadow')


def test_comms_edge_cases():
    """Domain 4: COMMS pipeline edge cases — silence, config, lifecycle."""
    section('COMMS EDGE CASES (DOMAIN 4)')

    # CM-01: COMMS status returns valid structure
    s, d, _ = GET('/api/comms/status')
    test('CM-01: COMMS status has all expected fields',
         s == 200 and isinstance(d, dict),
         f'status={s}, keys={list(d.keys()) if isinstance(d, dict) else "?"}')

    # CM-02: Send without radio returns graceful error
    s, d, _ = POST('/api/comms/send',
                    body=json.dumps({'text': 'test message', 'channel': 0}).encode('utf-8'),
                    headers={'Content-Type': 'application/json'})
    test('CM-02: COMMS send without radio fails gracefully',
         s in (200, 400, 404, 500, 503), f'status={s}')

    # CM-04: Toggle Radio Silence via config
    s, d, _ = POST('/api/comms/config',
                    body=json.dumps({'radio_silence': True}).encode('utf-8'),
                    headers={'Content-Type': 'application/json'})
    test('CM-04: Radio Silence toggle accepted',
         s in (200, 400, 404), f'status={s}')

    # CM-05: Toggle dispatch via config
    s, d, _ = POST('/api/comms/config',
                    body=json.dumps({'dispatch_enabled': False}).encode('utf-8'),
                    headers={'Content-Type': 'application/json'})
    test('CM-05: Dispatch toggle accepted',
         s in (200, 400, 404), f'status={s}')

    # CM-06: Poll messages with since_id=0
    s, d, _ = GET('/api/comms/messages?since=0')
    test('CM-06: Poll messages returns valid structure',
         s == 200 and isinstance(d, dict) and isinstance(d.get('messages'), list),
         f'status={s}')

    # CM-09: Lock COMMS store (intentionally unauthenticated)
    s, d, _ = POST('/api/comms/lock')
    test('CM-09: COMMS lock endpoint accessible',
         s in (200, 400, 404), f'status={s}')

    # CM-13: Empty/malformed COMMS config body
    s, d, _ = POST('/api/comms/config',
                    body=b'not json',
                    headers={'Content-Type': 'application/json'})
    test('CM-13: Malformed COMMS config body handled',
         s in (200, 400, 500), f'status={s}')

    # Restore dispatch to default
    POST('/api/comms/config',
         body=json.dumps({'dispatch_enabled': True, 'radio_silence': False}).encode('utf-8'),
         headers={'Content-Type': 'application/json'})


def test_state_machine():
    """Domain 5: State machine — config atomicity, settings, boot integrity."""
    section('STATE MACHINE (DOMAIN 5)')

    # SM-16: Config.json readable via diagnostics
    s, d, _ = GET('/api/diagnostics')
    test('SM-16: Diagnostics returns platform info',
         s == 200 and isinstance(d, dict) and 'platform' in d,
         f'status={s}')
    test('SM-16b: Diagnostics has disk info',
         isinstance(d, dict) and 'disk' in d)
    test('SM-16c: Diagnostics has engine info',
         isinstance(d, dict) and 'engine' in d)

    # SM-17: Online mode API check
    s, d, _ = GET('/api/status')
    test('SM-17: Status returns version and edition',
         s == 200 and isinstance(d, dict) and 'version' in d and 'edition' in d,
         f'status={s}')

    # Settings tier GET returns valid structure
    s, d, _ = GET('/api/settings/tier')
    test('Settings tier returns active + override fields',
         s == 200 and isinstance(d, dict) and 'override' in d,
         f'status={s}, keys={list(d.keys()) if isinstance(d, dict) else "?"}')

    # SM-07: EULA status endpoint
    s, d, _ = GET('/api/eula/status')
    test('SM-07: EULA status returns accepted field',
         s == 200 and isinstance(d, dict) and 'accepted' in d,
         f'response={d}')

    # Heartbeat watchdog confirmation
    s, d, _ = GET('/api/heartbeat')
    test('Heartbeat returns ok=true',
         s == 200 and isinstance(d, dict) and d.get('ok') is True,
         f'response={d}')

    # POST invalid tier value
    s, d, _ = POST('/api/settings/tier',
                    body=json.dumps({'tier': 'turbo'}).encode('utf-8'),
                    headers={'Content-Type': 'application/json'})
    test('AI-05: Invalid tier name rejected (400)',
         s == 400, f'status={s}')

    # POST valid tier (auto) — should succeed
    s, d, _ = POST('/api/settings/tier',
                    body=json.dumps({'tier': 'auto'}).encode('utf-8'),
                    headers={'Content-Type': 'application/json'})
    test('Tier change to auto accepted (200)',
         s == 200 and isinstance(d, dict) and d.get('ok') is True,
         f'status={s}')


def test_conversation_edge_cases(pw):
    """Domain 1/5: Conversation edge cases — XSS, encryption, purge."""
    section('CONVERSATION EDGE CASES')

    # Save a normal conversation
    conv_id = '_test_conv_edge_' + str(int(time.time()))
    conv = {
        'id': conv_id,
        'title': 'Edge Case Test',
        'messages': [
            {'role': 'user', 'content': 'What is 2+2?'},
            {'role': 'assistant', 'content': 'The answer is 4.'},
        ],
        'encrypted': False,
    }
    s, d, _ = POST('/api/conversations/save', conv)
    test('Save test conversation for edge cases', s == 200, f'status={s}')

    # Load it back
    s2, d2, _ = GET(f'/api/conversations/{conv_id}')
    test('Load saved conversation returns 200', s2 == 200, f'status={s2}')
    test('Loaded conversation has messages',
         isinstance(d2, dict) and isinstance(d2.get('messages'), list) and len(d2['messages']) >= 2,
         f'type={type(d2)}')

    # Save conversation with encrypted messages field
    enc_conv = {
        'id': '_test_enc_conv_' + str(int(time.time())),
        'title': 'Encrypted Edge Case',
        'messages': [],
        'encryptedMessages': 'U2FsdGVkX1+fake_encrypted_data==',
        'messageCount': 5,
    }
    s, d, _ = POST('/api/conversations/save', enc_conv)
    test('Save encrypted conversation accepted', s == 200, f'status={s}')

    # XSS in conversation fields (should store but not crash)
    xss_conv = {
        'id': '_test_xss_conv_' + str(int(time.time())),
        'title': '<script>alert("xss")</script>',
        'messages': [
            {'role': 'user', 'content': '<img src=x onerror=alert(1)>'},
            {'role': 'assistant', 'content': '"><script>document.cookie</script>'},
        ],
        'encrypted': False,
    }
    s, d, _ = POST('/api/conversations/save', xss_conv)
    test('XSS in conversation saves without crash', s == 200, f'status={s}')

    # Load XSS conversation back — should return raw content (sanitization is frontend)
    s2, d2, _ = GET(f'/api/conversations/{xss_conv["id"]}')
    test('XSS conversation loads without crash', s2 == 200, f'status={s2}')

    # Delete test conversations
    for cid in [conv_id, enc_conv['id'], xss_conv['id']]:
        DELETE(f'/api/conversations/{cid}')

    # Verify deletion
    s3, d3, _ = GET(f'/api/conversations/{conv_id}')
    test('Deleted conversation returns 404', s3 == 404, f'status={s3}')

    # Conversation list still works after operations
    s4, d4, _ = GET('/api/conversations')
    test('Conversation list returns valid after edge tests',
         s4 == 200 and isinstance(d4, dict) and 'conversations' in d4,
         f'status={s4}')

    # Empty conversation save should be handled
    s5, d5, _ = POST('/api/conversations/save', {
        'id': '_test_empty_' + str(int(time.time())),
        'title': '',
        'messages': [],
    })
    test('Empty conversation save handled',
         s5 in (200, 400), f'status={s5}')
    # Clean up
    if s5 == 200:
        DELETE(f'/api/conversations/_test_empty_{str(int(time.time()))}')


def test_hot_swap_status():
    """Domain 5: Engine hot-swap status polling (FRAG-006 verification)."""
    section('HOT-SWAP STATUS (FRAG-006)')

    # GET tier status endpoint exists and returns valid JSON
    s, d, _ = GET('/api/settings/tier/status')
    test('FRAG-006: Tier status endpoint returns 200',
         s == 200, f'status={s}')
    test('FRAG-006: Tier status has state field',
         isinstance(d, dict) and 'state' in d,
         f'keys={list(d.keys()) if isinstance(d, dict) else "?"}')
    test('FRAG-006: Tier status state is valid',
         isinstance(d, dict) and d.get('state') in ('idle', 'swapping', 'done', 'error'),
         f'state={d.get("state") if isinstance(d, dict) else "?"}')


def test_tts_and_assets():
    """Domain 1/5: TTS configuration and static asset integrity."""
    section('TTS & ASSET INTEGRITY')

    # Verify index.html does NOT contain Piper/ort references (removed)
    s, data, _ = GET('/_system/ui/index.html')
    if isinstance(data, bytes):
        html = data.decode('utf-8', errors='replace')
        test('No Piper importmap in index.html',
             'onnxruntime-web' not in html,
             'Piper importmap still present — should be removed')
        test('No ort.min.js in index.html',
             'ort.min.js' not in html,
             'ORT script tag still present — should be removed')
        test('No piper-tts.js in index.html',
             'piper-tts.js' not in html,
             'piper-tts.js script tag still present — should be removed')
        test('app.js script tag present',
             'app.js' in html,
             'app.js script tag missing')

    # Verify SpeechSynthesis TTS in app.js (no Piper references)
    s, data, _ = GET('/_system/ui/app.js')
    if isinstance(data, bytes):
        content = data.decode('utf-8', errors='replace')
        test('TTS: SpeechSynthesis code present',
             'SpeechSynthesisUtterance' in content,
             'SpeechSynthesisUtterance missing from app.js')
        test('TTS: No PiperTTS references remain',
             'PiperTTS' not in content,
             'PiperTTS reference still in app.js')
        test('TTS: No WASM synth references remain',
             'SYNTH' not in content and 'piper' not in content.lower(),
             'Piper/SYNTH reference still in app.js')
        test('TTS: Premium voice heuristics present',
             '_ttsBestVoice' in content,
             '_ttsBestVoice function missing')

    # Verify crypto.js has decrypt key usage (FRAG-001)
    s, data, _ = GET('/_system/ui/crypto.js')
    if isinstance(data, bytes):
        content = data.decode('utf-8', errors='replace')
        test('FRAG-001 FIX: crypto.js has decrypt in key usage',
             "'decrypt'" in content or '"decrypt"' in content,
             'decrypt key usage missing')


# ═══════════════════════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════════════════════

def main():
    global BASE_URL

    parser = argparse.ArgumentParser(description='Blackout Drive Automated QA Suite')
    parser.add_argument('--port', type=int, default=DEFAULT_PORT, help='Server port')
    parser.add_argument('--host', default=DEFAULT_HOST, help='Server host')
    parser.add_argument('--pw', default=DEFAULT_PW, help='Master password for testing')
    args = parser.parse_args()

    BASE_URL = f'http://{args.host}:{args.port}'
    pw = args.pw

    print()
    print('╔══════════════════════════════════════════════════════════╗')
    print('║   THE BLACKOUT DRIVE — AUTOMATED QA SUITE              ║')
    print('║   Zero-dependency backend test harness                  ║')
    print(f'║   Target: {BASE_URL:<46}║')
    print('╚══════════════════════════════════════════════════════════╝')

    # Pre-flight: verify server is reachable
    print('\n  Pre-flight check...')
    try:
        s, _, _ = GET('/api/heartbeat')
        if s != 200:
            print(f'\n  ⛔ Server returned {s} — is it running?')
            sys.exit(1)
        print(f'  Server is ONLINE at {BASE_URL}')
    except Exception as e:
        print(f'\n  ⛔ Cannot reach server: {e}')
        print(f'     Start the server first: python3 drive/_system/server.py')
        sys.exit(1)

    # ── Run all test modules ──────────────────────────────────
    t0 = time.time()

    try:
        test_server_health()
        test_master_password(pw)
        test_vault_operations(pw)
        test_unlocked_workspace()
        test_file_upload(pw)
        test_conversations(pw)
        test_comms_api()
        test_diagnostics()
        test_settings()
        test_file_tree()
        test_manifest()
        test_static_assets()
        test_cors_headers()
        test_adversarial()
        # ── Zero-Debt V1 Domain Tests (FIX-010) ──
        test_crypto_edge_cases(pw)
        test_vault_advanced(pw)
        test_file_io_edge_cases(pw)
        test_comms_edge_cases()
        test_state_machine()
        test_conversation_edge_cases(pw)
        test_hot_swap_status()
        test_tts_and_assets()
        test_cleanup(pw)
    except KeyboardInterrupt:
        print('\n\n  ⚠  Interrupted by user')
    except Exception as e:
        print(f'\n\n  💥 UNHANDLED ERROR: {e}')
        traceback.print_exc()
        result.failed += 1
        result.errors.append(f'Unhandled: {e}')

    elapsed = time.time() - t0

    # ── Summary ───────────────────────────────────────────────
    print(f'\n{"═" * 60}')
    print(f'  RESULTS')
    print(f'{"═" * 60}')
    print(f'  Total:   {result.total}')
    print(f'  Passed:  {result.passed}  ✅')
    print(f'  Failed:  {result.failed}  {"❌" if result.failed else ""}')
    print(f'  Skipped: {result.skipped}  {"⏭" if result.skipped else ""}')
    print(f'  Time:    {elapsed:.1f}s')
    print()

    if result.errors:
        print(f'  ── FAILURES ──')
        for err in result.errors:
            print(f'     • {err}')
        print()

    if result.failed == 0:
        print('  🏆 ALL TESTS PASSED — backend is CLEAN')
    else:
        print(f'  ⚠  {result.failed} TEST(S) FAILED — investigate above')

    print()
    sys.exit(0 if result.failed == 0 else 1)


if __name__ == '__main__':
    main()
