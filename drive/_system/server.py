#!/usr/bin/env python3

"""
The Blackout Drive — Local HTTP Server
================================================================
Replaces `python3 -m http.server` with a full-featured server
that supports file management, content downloads, conversation
persistence, and system diagnostics.

Usage:
    python3 scripts/server.py [PORT] [DRIVE_ROOT]

Default PORT: 8080
Default DRIVE_ROOT: parent directory of this script

Endpoints:
    GET  /*                          → serve static files
    GET  /api/status                 → drive status + disk usage
    GET  /api/manifest               → manifest.json contents

    GET  /api/open-file?path=        → shell-open file in native OS app
    GET  /api/diagnostics            → full system health report
    GET  /api/conversations          → list saved conversations (metadata)
    GET  /api/conversations/<id>     → get conversation with messages
    POST /api/conversations/save     → save/update a conversation
    DELETE /api/conversations/<id>   → delete a saved conversation
    POST /api/download               → start background file download
    GET  /api/download/<id>          → poll download progress
    DELETE /api/download/<id>        → cancel download
    DELETE /api/files?path=          → delete file + regenerate manifest
    OPTIONS *                        → CORS preflight (for Ollama on diff port)

Security:
    - Only binds to 127.0.0.1 (localhost only)
    - All file paths normalized + checked against DRIVE_ROOT
    - Directory traversal attempts → 403
    - Conversation IDs sanitized (basename only, no path traversal)
================================================================
"""

import sys
import os
import json
import uuid
import hashlib
import shutil
import threading
import datetime
import mimetypes
import urllib.request
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# Register EPUB MIME type (not always in default mimetypes DB)
mimetypes.add_type('application/epub+zip', '.epub')

# ── Configuration ─────────────────────────────────────────────────────────────

DEFAULT_PORT = 8080
SCRIPT_DIR   = os.path.dirname(os.path.abspath(__file__))
DEFAULT_ROOT = os.path.dirname(SCRIPT_DIR)   # parent of _system/ = drive root

PORT       = int(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_PORT

# DRIVE_DIR = the drive's top-level directory (where USER_DATA/, _system/, and
# the .app bundle live).  All three OS launchers pass SCRIPT_DIR (_system/) as
# argv[2] for historical reasons.  We detect this case and resolve to parent.
_arg_root = sys.argv[2] if len(sys.argv) > 2 else DEFAULT_ROOT
DRIVE_DIR  = os.path.realpath(_arg_root)

# Auto-detect: if the caller passed _system/ instead of the drive root,
# go up one level.  We know we're inside _system/ when config.json sits
# directly in the given directory (it lives at _system/config.json, NOT
# at drive/config.json).
if os.path.isfile(os.path.join(DRIVE_DIR, 'config.json')) and \
   os.path.isfile(os.path.join(DRIVE_DIR, 'server.py')):
    DRIVE_DIR = os.path.dirname(DRIVE_DIR)

# USER_DATA_DIR: the user-facing data folder inside the drive root.
# Contains conversations/, unlocked/, and locked/
USER_DATA_DIR = os.path.realpath(os.path.join(DRIVE_DIR, 'USER_DATA'))
os.makedirs(USER_DATA_DIR, exist_ok=True)

# ── Debug Logging ──────────────────────────────────────────────────────────────
# When launched with --debug <log_dir>, writes detailed logs to <log_dir>/server.log.
# This flag is read from config.json and passed by the launcher scripts.
import logging as _logging

_debug_mode = False
_debug_log_dir = None
_logger = _logging.getLogger('blackout')

# Parse --debug flag from argv (can appear at any position after argv[2])
for i, arg in enumerate(sys.argv):
    if arg == '--debug' and i + 1 < len(sys.argv):
        _debug_mode = True
        _debug_log_dir = sys.argv[i + 1]
        break

if _debug_mode and _debug_log_dir:
    os.makedirs(_debug_log_dir, exist_ok=True)
    _log_path = os.path.join(_debug_log_dir, 'server.log')
    _file_handler = _logging.FileHandler(_log_path, encoding='utf-8')
    _file_handler.setFormatter(_logging.Formatter(
        '%(asctime)s [%(levelname)s] %(message)s', datefmt='%Y-%m-%d %H:%M:%S'
    ))
    _logger.addHandler(_file_handler)
    _logger.setLevel(_logging.DEBUG)
    _logger.info('=== Server starting (debug mode) ===')
    _logger.info(f'DRIVE_DIR: {DRIVE_DIR}')
    _logger.info(f'PORT: {PORT}')
    _logger.info(f'Log file: {_log_path}')
else:
    _logger.addHandler(_logging.NullHandler())
    _logger.setLevel(_logging.WARNING)

# ── Download Job Tracking ──────────────────────────────────────────────────────
# { job_id: { progress, total, done, error, thread, cancel_flag } }
_download_jobs = {}
_jobs_lock = threading.Lock()
_job_counter = 0

# ── Heartbeat Watchdog ─────────────────────────────────────────────────────────
# The browser sends a heartbeat every 30 seconds. If no heartbeat is received
# for WATCHDOG_TIMEOUT seconds after the first one, the server shuts down
# and kills Ollama. This ensures closing the browser stops the system.
import time as _time
import signal as _signal
import subprocess as _subprocess
import platform as _platform

_heartbeat_lock = threading.Lock()
_last_heartbeat = 0.0       # timestamp of last heartbeat (0 = never received)
_heartbeat_active = False   # becomes True after first heartbeat
WATCHDOG_TIMEOUT = 45       # seconds without heartbeat before shutdown
_server_ref = None          # set at startup, used by watchdog to shut down

def _new_job_id():
    global _job_counter
    with _jobs_lock:
        _job_counter += 1
        return f'dl_{_job_counter}'


# ── Data Directory Helpers ─────────────────────────────────────────────────────

def _data_dir(drive_dir: str, subdir: str = '') -> str:
    """Return path to drive/data/ or a subdirectory. Creates it if missing."""
    base = os.path.join(drive_dir, 'data', subdir) if subdir else os.path.join(drive_dir, 'data')
    os.makedirs(base, exist_ok=True)
    return base


def _conversations_dir(drive_dir: str) -> str:
    """Return the conversations directory inside USER_DATA/.
    On first boot after migration, moves any conversations from the
    legacy _system/data/conversations/ location."""
    new_dir = os.path.join(USER_DATA_DIR, 'conversations')
    os.makedirs(new_dir, exist_ok=True)

    # One-time migration from legacy location
    legacy_dir = os.path.join(drive_dir, 'data', 'conversations')
    if os.path.isdir(legacy_dir):
        try:
            for fname in os.listdir(legacy_dir):
                if fname.endswith('.json'):
                    src = os.path.join(legacy_dir, fname)
                    dst = os.path.join(new_dir, fname)
                    if not os.path.exists(dst):  # don't overwrite newer files
                        shutil.move(src, dst)
            # Remove legacy dir if empty
            remaining = [f for f in os.listdir(legacy_dir) if not f.startswith('.')]
            if not remaining:
                shutil.rmtree(legacy_dir, ignore_errors=True)
        except Exception as e:
            _logger.warning(f'Conversation migration error: {e}')

    return new_dir


def _unlocked_dir() -> str:
    """Return the unlocked user files directory."""
    d = os.path.join(USER_DATA_DIR, 'unlocked')
    os.makedirs(d, exist_ok=True)
    return d


def _locked_dir() -> str:
    """Return the Locked files directory."""
    d = os.path.join(USER_DATA_DIR, 'locked')
    os.makedirs(d, exist_ok=True)
    return d


def _tmp_dir() -> str:
    """Return a temp directory inside USER_DATA for transient file operations."""
    d = os.path.join(USER_DATA_DIR, '.tmp')
    os.makedirs(d, exist_ok=True)
    return d


def _purge_stale_temp_sessions(max_age_seconds: int = 900):
    """Remove temp session directories older than max_age_seconds (default 15 min)."""
    tmp = _tmp_dir()
    now = _time.time()
    try:
        for entry in os.listdir(tmp):
            session_path = os.path.join(tmp, entry)
            if not os.path.isdir(session_path):
                continue
            try:
                age = now - os.path.getmtime(session_path)
                if age > max_age_seconds:
                    shutil.rmtree(session_path, ignore_errors=True)
            except OSError:
                pass
    except FileNotFoundError:
        pass


# ── Bundled 7-Zip Helper ──────────────────────────────────────────────────────

def _get_7zz_path() -> str:
    """Return the path to the platform-specific bundled 7zz binary."""
    tools_dir = os.path.join(SCRIPT_DIR, 'tools')
    if sys.platform == 'darwin':
        return os.path.join(tools_dir, '7zz-mac')
    elif sys.platform == 'win32':
        return os.path.join(tools_dir, '7zz-windows.exe')
    else:
        arch = _platform.machine().lower()
        if 'aarch64' in arch or 'arm64' in arch:
            return os.path.join(tools_dir, '7zz-linux-arm64')
        return os.path.join(tools_dir, '7zz-linux-x64')


# ── User File Operations ──────────────────────────────────────────────────────

def _list_user_files(base_directory: str, sub_path: str = '') -> list:
    """List files and folders in a user directory with metadata.
    Supports subfolder navigation via sub_path."""
    target_dir = os.path.abspath(os.path.join(base_directory, sub_path))
    # Security: ensure target_dir is inside base_directory
    if not target_dir.startswith(os.path.abspath(base_directory)):
        return []
    if not os.path.isdir(target_dir):
        return []
    items = []
    for fname in sorted(os.listdir(target_dir)):
        if fname.startswith('.') or fname == 'README.txt':
            continue
        fpath = os.path.join(target_dir, fname)
        is_dir = os.path.isdir(fpath)
        try:
            stat = os.stat(fpath)
            items.append({
                'name': fname,
                'type': 'directory' if is_dir else 'file',
                'size': 0 if is_dir else stat.st_size,
                'modified': datetime.datetime.fromtimestamp(
                    stat.st_mtime, tz=datetime.timezone.utc
                ).isoformat(),
            })
        except OSError:
            pass
    # Sort: directories first, then files, both alphabetical
    items.sort(key=lambda x: (0 if x['type'] == 'directory' else 1, x['name'].lower()))
    return items


def _build_file_tree(current_dir: str, root_dir: str) -> list:
    """Recursively list files and folders to build a nested tree structure."""
    if not current_dir.startswith(os.path.abspath(root_dir)):
        return []
    if not os.path.isdir(current_dir):
        return []
        
    items = []
    for fname in sorted(os.listdir(current_dir)):
        if fname.startswith('.') or fname == 'README.txt' or fname.startswith('__pycache__'):
            continue
        fpath = os.path.join(current_dir, fname)
        is_dir = os.path.isdir(fpath)
        
        # Build relative path from the root_dir
        rel_path = os.path.relpath(fpath, root_dir)
        rel_path = rel_path.replace('\\', '/')
        
        item = {
            'name': fname,
            'type': 'directory' if is_dir else 'file',
            'path': rel_path
        }
        
        if is_dir:
            item['children'] = _build_file_tree(fpath, root_dir)
            
        items.append(item)
        
    items.sort(key=lambda x: (0 if x['type'] == 'directory' else 1, x['name'].lower()))
    return items


def _encrypt_file_7z(src_path: str, dest_path: str, password: str) -> tuple:
    """Encrypt a file using the bundled 7zz binary.
    Returns (success: bool, error: str|None)."""
    zz = _get_7zz_path()
    if not os.path.isfile(zz):
        return False, '7-Zip binary not found'
    try:
        result = _subprocess.run(
            [zz, 'a', '-t7z', f'-p{password}', '-mhe=on', '-mx=1',
             dest_path, src_path],
            capture_output=True, text=True, timeout=300
        )
        if result.returncode == 0:
            return True, None
        return False, result.stderr or result.stdout or 'Unknown error'
    except _subprocess.TimeoutExpired:
        return False, 'Encryption timed out'
    except Exception as e:
        return False, str(e)


def _decrypt_file_7z(encrypted_path: str, out_dir: str, password: str) -> tuple:
    """Decrypt a .7z file to a directory using the bundled 7zz binary.
    Returns (success: bool, error: str|None)."""
    zz = _get_7zz_path()
    if not os.path.isfile(zz):
        return False, '7-Zip binary not found'
    try:
        result = _subprocess.run(
            [zz, 'x', f'-p{password}', f'-o{out_dir}', '-y', encrypted_path],
            capture_output=True, text=True, timeout=300
        )
        if result.returncode == 0:
            return True, None
        # Check for wrong password
        if 'Wrong password' in (result.stderr or '') or result.returncode == 2:
            return False, 'Wrong password'
        return False, result.stderr or result.stdout or 'Decryption failed'
    except _subprocess.TimeoutExpired:
        return False, 'Decryption timed out'
    except Exception as e:
        return False, str(e)


# ── Master Password System ─────────────────────────────────────────────────────
# One password governs all encryption: Locked files and encrypted chat history.
# Stored as a PBKDF2-SHA256 verifier hash in USER_DATA/ecosystem_key.json.

import hashlib as _hashlib

def _ecosystem_key_path() -> str:
    return os.path.join(USER_DATA_DIR, 'ecosystem_key.json')

def _is_master_password_set() -> bool:
    path = _ecosystem_key_path()
    if not os.path.isfile(path):
        return False
    try:
        with open(path, 'r') as f:
            cfg = json.load(f)
        return bool(cfg.get('verifier') and cfg.get('salt'))
    except Exception:
        return False

def _master_password_setup(password: str) -> bool:
    """Create a new master password. Stores PBKDF2 verifier + salt."""
    import secrets
    salt = secrets.token_hex(32)  # 32 bytes = 64 hex chars
    verifier = _hashlib.pbkdf2_hmac(
        'sha256', password.encode('utf-8'), bytes.fromhex(salt), 600000
    ).hex()
    cfg = {'salt': salt, 'verifier': verifier, 'version': 1}
    try:
        with open(_ecosystem_key_path(), 'w') as f:
            json.dump(cfg, f)
        return True
    except Exception:
        return False

def _master_password_verify(password: str) -> bool:
    """Verify a password against the stored verifier hash."""
    path = _ecosystem_key_path()
    if not os.path.isfile(path):
        return False
    try:
        with open(path, 'r') as f:
            cfg = json.load(f)
        salt = cfg['salt']
        expected = cfg['verifier']
        actual = _hashlib.pbkdf2_hmac(
            'sha256', password.encode('utf-8'), bytes.fromhex(salt), 600000
        ).hex()
        return actual == expected
    except Exception:
        return False


# ── Conversation Storage ───────────────────────────────────────────────────────

def _save_conversation(drive_dir: str, conv_id: str, title: str, messages: list,
                       encrypted_messages: str = None,
                       message_count_override: int = None) -> dict:
    """Write or overwrite a conversation JSON file. Returns the conversation metadata."""
    conv_dir = _conversations_dir(drive_dir)
    now = _now_utc()
    # Sanitize ID to prevent directory traversal
    safe_id = os.path.basename(conv_id).replace('..', '')
    if not safe_id:
        safe_id = str(uuid.uuid4())
    path = os.path.join(conv_dir, f'{safe_id}.json')

    # If file exists, preserve original created_at and last_message_at
    created_at = now
    prev_msg_count = 0
    prev_last_message_at = now
    if os.path.isfile(path):
        try:
            with open(path) as f:
                existing = json.load(f)
            created_at = existing.get('created_at', now)
            prev_msg_count = existing.get('message_count', 0)
            prev_last_message_at = existing.get('last_message_at', existing.get('updated_at', now))
        except Exception:
            pass

    # Use client-provided count for encrypted convos (messages array is empty)
    msg_count = message_count_override if message_count_override is not None else len(messages)

    # Only update last_message_at when the message count actually changes
    # (i.e. a new message was sent, not just a re-save of existing data).
    # This prevents the chat list from reordering when merely switching chats.
    if msg_count != prev_msg_count:
        last_message_at = now
    else:
        last_message_at = prev_last_message_at

    conv = {
        'id': conv_id,
        'title': title or _auto_title(messages),
        'created_at': created_at,
        'updated_at': now,
        'last_message_at': last_message_at,
        'message_count': msg_count,
        'messages': messages,
    }
    # Store encrypted messages blob if provided (client-side AES-256-GCM)
    if encrypted_messages:
        conv['encryptedMessages'] = encrypted_messages
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(conv, f, indent=2, ensure_ascii=False)
    return conv


def _auto_title(messages: list) -> str:
    """Generate a title from the first user message (first 60 chars)."""
    for msg in messages:
        if msg.get('role') == 'user':
            text = msg.get('content', '').strip()
            return (text[:57] + '...') if len(text) > 57 else text
    return 'Conversation'


def _list_conversations(drive_dir: str) -> list:
    """Return list of conversation metadata dicts, sorted newest first."""
    conv_dir = _conversations_dir(drive_dir)
    convs = []
    for fname in os.listdir(conv_dir):
        if not fname.endswith('.json'):
            continue
        path = os.path.join(conv_dir, fname)
        try:
            with open(path, encoding='utf-8') as f:
                data = json.load(f)
            # Return metadata only (no messages array) for the list view
            convs.append({
                'id': data.get('id'),
                'title': data.get('title', 'Untitled'),
                'created_at': data.get('created_at'),
                'updated_at': data.get('updated_at'),
                'last_message_at': data.get('last_message_at', data.get('updated_at')),
                'message_count': data.get('message_count', 0),
                'encrypted': bool(data.get('encryptedMessages')),
            })
        except Exception:
            continue
    # Sort by last_message_at (when a message was actually sent/received),
    # NOT updated_at (which changes on every re-save including chat switches).
    # Fall back to updated_at for conversations saved before last_message_at existed.
    return sorted(convs, key=lambda c: c.get('last_message_at', c.get('updated_at', '')), reverse=True)


def _get_conversation(drive_dir: str, conv_id: str) -> dict | None:
    """Load a full conversation (including messages) by ID."""
    # Sanitize ID to prevent directory traversal
    safe_id = os.path.basename(conv_id).replace('..', '')
    path = os.path.join(_conversations_dir(drive_dir), f'{safe_id}.json')
    if not os.path.isfile(path):
        return None
    try:
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return None


def _delete_conversation(drive_dir: str, conv_id: str) -> bool:
    """Delete a conversation file. Returns True if deleted, False if not found."""
    safe_id = os.path.basename(conv_id).replace('..', '')
    path = os.path.join(_conversations_dir(drive_dir), f'{safe_id}.json')
    if not os.path.isfile(path):
        return False
    os.remove(path)
    return True


# ── Manifest Generation ────────────────────────────────────────────────────────

def build_manifest(drive_dir: str) -> dict:
    """Scan content directory and return a manifest dict."""
    content_dir = os.path.join(drive_dir, '_system', 'content')
    files = {}
    total_bytes = 0

    if not os.path.isdir(content_dir):
        return {'schema': '1.0', 'assembled': _now_utc(),
                'file_count': 0, 'total_bytes': 0, 'files': {}}

    for root, dirs, filenames in os.walk(content_dir):
        dirs[:] = sorted(d for d in dirs if not d.startswith('.'))
        for fname in sorted(filenames):
            if fname.startswith('.') or fname.endswith('.ddtmp') or fname in (
                'manifest.json', 'library.json', 'catalog.json',
                'catalog_extended.json', 'text_index.json', 'prompts.json',
                'Thumbs.db', 'desktop.ini', '.DS_Store',
            ):
                continue
            full = os.path.join(root, fname)
            rel  = os.path.relpath(full, os.path.join(drive_dir, '_system')).replace('\\', '/')
            size = os.path.getsize(full)
            total_bytes += size
            # Quick partial checksum (first + last 64 KB)
            md5 = hashlib.md5()
            try:
                with open(full, 'rb') as f:
                    md5.update(f.read(65536))
                    if size > 65536:
                        f.seek(size - 65536)
                        md5.update(f.read(65536))
            except OSError:
                pass
            files[rel] = {'size': size, 'checksum': md5.hexdigest()}

    return {
        'schema':      '1.0',
        'assembled':   _now_utc(),
        'file_count':  len(files),
        'total_bytes': total_bytes,
        'files':       files,
    }


_manifest_lock = threading.Lock()

def write_manifest(drive_dir: str) -> dict:
    """Regenerate and write manifest.json. Thread-safe via _manifest_lock."""
    with _manifest_lock:
        manifest = build_manifest(drive_dir)
        path = os.path.join(drive_dir, '_system', 'content', 'manifest.json')
        os.makedirs(os.path.dirname(path), exist_ok=True)
        # Write atomically via temp file to prevent corruption
        tmp_path = path + '.tmp'
        with open(tmp_path, 'w') as f:
            json.dump(manifest, f, indent=2)
        shutil.move(tmp_path, path)
        return manifest


def _now_utc() -> str:
    return datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


# ── Download Worker ────────────────────────────────────────────────────────────

def _download_worker(job_id: str, url: str, dest_abs: str, drive_dir: str):
    """Background thread: downloads a file, updates progress, writes manifest."""
    job = _download_jobs[job_id]
    tmp = dest_abs + '.ddtmp'
    try:
        os.makedirs(os.path.dirname(dest_abs), exist_ok=True)
        headers = {'User-Agent': 'Mozilla/5.0 (compatible; BlackoutDrive/1.0)'}
        request = urllib.request.Request(url, headers=headers)
        req = urllib.request.urlopen(request, timeout=60)
        total = int(req.getheader('Content-Length', 0))
        with _jobs_lock:
            job['total'] = total

        received = 0
        chunk_size = 65536
        with open(tmp, 'wb') as out:
            while not job.get('cancel_flag'):
                chunk = req.read(chunk_size)
                if not chunk:
                    break
                out.write(chunk)
                received += len(chunk)
                with _jobs_lock:
                    job['progress'] = received

        if job.get('cancel_flag'):
            if os.path.exists(tmp):
                os.remove(tmp)
            with _jobs_lock:
                job['done'] = True
                job['error'] = 'cancelled'
            return

        # Atomically move temp file to destination
        if os.path.exists(dest_abs):
            os.remove(dest_abs)
        shutil.move(tmp, dest_abs)

        # Regenerate manifest
        write_manifest(drive_dir)

        with _jobs_lock:
            job['progress'] = received
            job['done'] = True

    except Exception as e:
        if os.path.exists(tmp):
            try:
                os.remove(tmp)
            except OSError:
                pass
        # Clean up error message — strip paths, keep meaningful text
        err_msg = str(e)
        # If it's an HTTP error, extract the useful part
        if 'HTTP Error' in err_msg or 'urlopen' in err_msg:
            err_msg = 'Download failed — check internet connection'
        elif 'timed out' in err_msg.lower():
            err_msg = 'Download timed out — try again'
        elif len(err_msg) > 100:
            err_msg = err_msg[:100] + '...'
        with _jobs_lock:
            job['done'] = True
            job['error'] = err_msg


# ── Request Handler ────────────────────────────────────────────────────────────

class BlackoutDriveHandler(BaseHTTPRequestHandler):

    def log_message(self, fmt, *args):
        # Log HTTP requests to file when debug mode is on
        if _debug_mode:
            _logger.debug(f'{self.address_string()} {fmt % args}')

    # ── Response helpers ──────────────────────────────────────

    def _send_json(self, code: int, data: dict):
        body = json.dumps(data, indent=2).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self._cors_headers()
        self.end_headers()
        self.wfile.write(body)

    def _cors_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

    def _safe_path(self, rel: str):
        """Resolve a relative path, ensure it stays inside DRIVE_DIR.
        Rewrites content/ and ui/ paths to _system/ since those directories
        live under _system/, not under the drive root."""
        rel = rel.lstrip('/')
        # Rewrite content/ → _system/content/ (same logic as URL rewriting)
        if rel.startswith('content/'):
            rel = '_system/' + rel
        elif rel == 'ui' or rel.startswith('ui/'):
            rel = '_system/' + rel
        full = os.path.realpath(os.path.join(DRIVE_DIR, rel))
        if full.startswith(DRIVE_DIR):
            return full
        # Also allow USER_DATA/ under DRIVE_DIR
        user_data = os.path.join(DRIVE_DIR, 'USER_DATA')
        if full.startswith(os.path.realpath(user_data)):
            return full
        return None

    def _read_body(self) -> bytes:
        length = int(self.headers.get('Content-Length', 0))
        return self.rfile.read(length) if length else b''

    def _stream_to_file(self, dest_path: str) -> int:
        """Stream the request body directly to a file in 64KB chunks.
        Never loads the full file into memory. Returns bytes written."""
        content_length = int(self.headers.get('Content-Length', 0))
        bytes_read = 0
        chunk_size = 65536  # 64KB
        os.makedirs(os.path.dirname(dest_path), exist_ok=True)
        with open(dest_path, 'wb') as f:
            while bytes_read < content_length:
                to_read = min(chunk_size, content_length - bytes_read)
                chunk = self.rfile.read(to_read)
                if not chunk:
                    break
                f.write(chunk)
                bytes_read += len(chunk)
        return bytes_read

    # ── File serving ──────────────────────────────────────────

    def _serve_file(self, url_path: str):
        # Map URL path to filesystem path under DRIVE_DIR
        url_path = urllib.parse.unquote(url_path)
        rel = url_path.lstrip('/')

        # Root URL → redirect to /_system/ui/ (where index.html lives)
        if not rel:
            self.send_response(302)
            self.send_header('Location', '/_system/ui/')
            self.end_headers()
            return

        # Rewrite /ui/... → /_system/ui/... so launcher-opened URLs work.
        # All OS launchers open /ui/ but the files live at _system/ui/.
        if rel == 'ui' or rel.startswith('ui/'):
            rel = '_system/' + rel

        # Rewrite /content/... → /_system/content/... so library.js paths
        # (e.g. content/books/bible/bible_kjv.txt) resolve to the actual location
        if rel.startswith('content/') and not rel.startswith('content/manifest'):
            rel = '_system/' + rel

        # User content lives at DRIVE_DIR/USER_DATA/content/
        if rel.startswith('USER_DATA/content/'):
            candidate = os.path.realpath(os.path.join(DRIVE_DIR, rel))
            user_base = os.path.realpath(os.path.join(DRIVE_DIR, 'USER_DATA', 'content'))
            if candidate.startswith(user_base):
                full = candidate
            else:
                full = None
        else:
            full = self._safe_path(rel)

        if not full:
            self.send_error(403, 'Forbidden')
            return
        # Append index.html for directories
        if os.path.isdir(full):
            full = os.path.join(full, 'index.html')
        if not os.path.isfile(full):
            self.send_error(404, 'File not found')
            return

        mime, _ = mimetypes.guess_type(full)
        mime = mime or 'application/octet-stream'
        size = os.path.getsize(full)

        self.send_response(200)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(size))
        # No-cache for HTML, JS, CSS, and JSON to prevent stale UI state
        if full.endswith(('.html', '.js', '.css', '.json')):
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
            self.send_header('Pragma', 'no-cache')
        self.end_headers()
        try:
            with open(full, 'rb') as f:
                shutil.copyfileobj(f, self.wfile)
        except (BrokenPipeError, ConnectionResetError):
            pass

    # ── GET handler ───────────────────────────────────────────

    def do_GET(self):
        parsed  = urllib.parse.urlparse(self.path)
        path    = parsed.path
        qs      = urllib.parse.parse_qs(parsed.query)

        # ── / → redirect to /_system/ui/ (where the web UI lives) ──
        if path in ('/', ''):
            self.send_response(302)
            self.send_header('Location', '/_system/ui/')
            self.end_headers()
            return

        # ── /api/heartbeat ──────────────────────────────────
        if path == '/api/heartbeat':
            global _last_heartbeat, _heartbeat_active
            with _heartbeat_lock:
                _last_heartbeat = _time.time()
                if not _heartbeat_active:
                    _heartbeat_active = True
                    _logger.info('First heartbeat received — watchdog activated')
            self._send_json(200, {'ok': True})
            return

        # ── /api/status ─────────────────────────────────────
        if path == '/api/status':
            content_dir = os.path.join(DRIVE_DIR, '_system', 'content')
            content_size = 0
            if os.path.isdir(content_dir):
                for dp, _, fnames in os.walk(content_dir):
                    for fn in fnames:
                        try:
                            content_size += os.path.getsize(os.path.join(dp, fn))
                        except OSError:
                            pass
            try:
                free = shutil.disk_usage(DRIVE_DIR).free
            except OSError:
                free = 0
            # Read version from config.json
            version = '1.0.0'
            edition = 'standard'
            try:
                cfg_path = os.path.join(DRIVE_DIR, '_system', 'config.json')
                with open(cfg_path) as f:
                    cfg = json.load(f)
                version = cfg.get('app', {}).get('version', version)
                edition = cfg.get('app', {}).get('edition', edition)
            except Exception:
                pass
            self._send_json(200, {
                'status': 'ok',
                'version': version,
                'edition': edition,
                'content_size_bytes': content_size,
                'free_bytes': free,
            })
            return

        # ── /api/manifest ────────────────────────────────────
        if path == '/api/manifest':
            mf_path = os.path.join(DRIVE_DIR, '_system', 'content', 'manifest.json')
            if not os.path.isfile(mf_path):
                self._send_json(404, {'error': 'manifest not found'})
                return
            with open(mf_path) as f:
                self._send_json(200, json.load(f))
            return

        # ── /api/download/<jobId> ────────────────────────────
        if path.startswith('/api/download/'):
            job_id = urllib.parse.unquote(path[len('/api/download/'):])
            with _jobs_lock:
                job = _download_jobs.get(job_id)
            if not job:
                self._send_json(404, {'error': 'job not found'})
                return
            self._send_json(200, {
                'jobId':    job_id,
                'progress': job.get('progress', 0),
                'total':    job.get('total', 0),
                'done':     job.get('done', False),
                'error':    job.get('error'),
            })
            return


        # ── /api/user-files ──────────────────────────────────
        # List user files from USER_DATA/content/
        if path == '/api/user-files':
            user_dir = os.path.join(USER_DATA_DIR, 'content')
            files = []
            if os.path.isdir(user_dir):
                for dp, _, fnames in os.walk(user_dir):
                    for fn in sorted(fnames):
                        if fn.startswith('.') or fn == '.gitkeep':
                            continue
                        full = os.path.join(dp, fn)
                        ext = os.path.splitext(fn)[1].lower()
                        IMAGE_EXTS = {'.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.ico', '.tiff', '.tif'}
                        if ext == '.pdf':
                            ftype = 'pdf'
                        elif ext == '.epub':
                            ftype = 'epub'
                        elif ext == '.txt':
                            ftype = 'text'
                        elif ext in IMAGE_EXTS:
                            ftype = 'image'
                        else:
                            ftype = 'file'
                        rel = 'USER_DATA/content/' + os.path.relpath(full, user_dir).replace('\\', '/')
                        try:
                            size = os.path.getsize(full)
                        except OSError:
                            size = 0
                        files.append({
                            'id': fn.replace(' ', '_').lower(),
                            'name': os.path.splitext(fn)[0].replace('_', ' ').replace('-', ' ').title(),
                            'file': rel,
                            'type': ftype,
                            'size': size,
                            'readable': ext in ('.txt', '.epub', '.pdf') or ext in IMAGE_EXTS,
                        })
            self._send_json(200, {
                'files': files,
                'count': len(files),
                'supported_types': ['txt', 'epub', 'pdf', 'jpg', 'png', 'gif', 'webp', 'svg'],
                'upload_hint': 'Use the MY FILES panel to upload files. TXT, EPUB, PDF, and image files can be viewed in-app. All file types are stored.',
            })
            return

        # ── /api/master-password/status ────────────────────────
        if path == '/api/master-password/status':
            self._send_json(200, {'established': _is_master_password_set()})
            return

        # ── /api/files/unlocked ────────────────────────────────
        # List user files in the unlocked directory (supports ?path= for subfolders)
        if path == '/api/files/unlocked':
            sub_path = (qs.get('path', [''])[0]).strip()
            files = _list_user_files(_unlocked_dir(), sub_path)
            self._send_json(200, {'files': files, 'count': len(files), 'path': sub_path})
            return

        # ── /api/files/tree ───────────────────────────────────
        # Return a recursive nested JSON tree for the IDE
        # Supports ?path=unlocked/Flappy-Bird or ?path=locked/Project or ?path=system
        if path == '/api/files/tree':
            sub_path = (qs.get('path', [''])[0]).strip()

            if sub_path.startswith('unlocked'):
                root_dir = os.path.abspath(_unlocked_dir())
                target_rel = sub_path[len('unlocked'):].strip('/')
            elif sub_path.startswith('locked'):
                root_dir = os.path.abspath(_locked_dir())
                target_rel = sub_path[len('locked'):].strip('/')
            elif sub_path == 'system':
                root_dir = os.path.abspath(SCRIPT_DIR)
                target_rel = ''
            else:
                self._send_json(400, {'error': 'Invalid path prefix'})
                return

            target_dir = os.path.join(root_dir, target_rel)
            if not os.path.abspath(target_dir).startswith(root_dir):
                self._send_json(403, {'error': 'Path traversal blocked'})
                return

            tree = _build_file_tree(target_dir, target_dir)
            self._send_json(200, {'tree': tree, 'path': sub_path})
            return

        # ── /api/files/locked ─────────────────────────────────
        # List encrypted files in Locked storage (supports ?path= for subfolders)
        if path == '/api/files/locked':
            sub_path = (qs.get('path', [''])[0]).strip()
            files = _list_user_files(_locked_dir(), sub_path)
            self._send_json(200, {'files': files, 'count': len(files), 'path': sub_path})
            return

        # ── /api/files/unlocked/<path> ────────────────────────
        # Serve an unlocked file for viewing/download (supports nested paths)
        if path.startswith('/api/files/unlocked/'):
            fname = urllib.parse.unquote(path[len('/api/files/unlocked/'):])
            # Sanitize: strip traversal segments, resolve safely
            parts = [p for p in fname.split('/') if p and p not in ('.', '..')]
            if not parts:
                self._send_json(400, {'error': 'Invalid file path'})
                return
            fpath = os.path.join(_unlocked_dir(), *parts)
            if not os.path.isfile(fpath):
                self._send_json(404, {'error': 'File not found'})
                return
            ctype = mimetypes.guess_type(fpath)[0] or 'application/octet-stream'
            try:
                with open(fpath, 'rb') as f:
                    data = f.read()
                self.send_response(200)
                self.send_header('Content-Type', ctype)
                self.send_header('Content-Length', str(len(data)))
                self.send_header('Content-Disposition', f'inline; filename="{fname}"')
                self.end_headers()
                self.wfile.write(data)
            except Exception as e:
                self._send_json(500, {'error': str(e)})
            return

        # ── GET /api/files/temp/<session>/<filename> ──────────
        # Serve a decrypted file from a temp session
        if path.startswith('/api/files/temp/'):
            parts = path[len('/api/files/temp/'):].split('/', 1)
            if len(parts) != 2 or '..' in parts[0] or '..' in parts[1]:
                self._send_json(404, {'error': 'Not found'})
                return
            session_id, fname = parts[0], urllib.parse.unquote(parts[1])
            # Auto-purge stale temp sessions (>15 minutes)
            _purge_stale_temp_sessions()
            temp_path = os.path.join(_tmp_dir(), session_id, fname)
            if not os.path.isfile(temp_path):
                self._send_json(404, {'error': 'Temp file not found or expired'})
                return
            ctype = mimetypes.guess_type(temp_path)[0] or 'application/octet-stream'
            try:
                with open(temp_path, 'rb') as f:
                    data = f.read()
                self.send_response(200)
                self.send_header('Content-Type', ctype)
                self.send_header('Content-Length', str(len(data)))
                self.send_header('Content-Disposition',
                                 f'inline; filename="{os.path.basename(fname)}"')
                self.end_headers()
                self.wfile.write(data)
            except Exception as e:
                self._send_json(500, {'error': str(e)})
            return




        # ── /api/open-file ───────────────────────────────────
        # Shell-opens a file in the OS native application (PDF, ZIM, etc.)
        if path == '/api/open-file':
            rel = (qs.get('path', [''])[0]).strip()
            if not rel:
                self._send_json(400, {'error': 'path param required'})
                return
            full = self._safe_path(rel)
            if not full or not os.path.isfile(full):
                self._send_json(404, {'error': 'file not found'})
                return
            try:
                import subprocess, sys as _sys
                if _sys.platform == 'darwin':
                    subprocess.Popen(['open', full])
                elif _sys.platform == 'win32':
                    os.startfile(full)
                else:
                    subprocess.Popen(['xdg-open', full])
                self._send_json(200, {'ok': True, 'opened': rel})
            except Exception as e:
                self._send_json(500, {'error': str(e)})
            return

        # ── /api/conversations ────────────────────────────────
        # List all saved conversations (metadata only, no messages)
        if path == '/api/conversations':
            convs = _list_conversations(DRIVE_DIR)
            self._send_json(200, {'conversations': convs, 'count': len(convs)})
            return

        # ── /api/conversations/<id> ───────────────────────────
        # Get a specific conversation including messages
        if path.startswith('/api/conversations/'):
            conv_id = urllib.parse.unquote(path[len('/api/conversations/'):])
            conv = _get_conversation(DRIVE_DIR, conv_id)
            if not conv:
                self._send_json(404, {'error': 'conversation not found'})
                return
            self._send_json(200, conv)
            return

        # ── /api/settings/tier ────────────────────────────────
        # GET: returns current tier info (active tier + override setting)
        # The active tier was written by model_setup.py at boot.
        if path == '/api/settings/tier':
            # Read active tier info
            active_tier = None
            tier_path = os.path.join(DRIVE_DIR, '_system', 'data', 'active_tier.json')
            if os.path.isfile(tier_path):
                try:
                    with open(tier_path, encoding='utf-8') as f:
                        active_tier = json.load(f)
                except Exception:
                    pass
            # Read override setting
            override = 'auto'
            override_path = os.path.join(DRIVE_DIR, '_system', 'data', 'tier_override.json')
            if os.path.isfile(override_path):
                try:
                    with open(override_path, encoding='utf-8') as f:
                        data = json.load(f)
                    override = data.get('tier', 'auto')
                except Exception:
                    pass
            self._send_json(200, {
                'active': active_tier,
                'override': override,
            })
            return

        # ── /api/diagnostics ─────────────────────────────────
        if path == '/api/diagnostics':
            import platform as _plat

            # Disk usage
            try:
                usage = shutil.disk_usage(DRIVE_DIR)
                disk_total = usage.total
                disk_used  = usage.used
                disk_free  = usage.free
            except Exception:
                disk_total = disk_used = disk_free = 0

            # Content stats — split library books vs user uploads
            books_dir = os.path.join(DRIVE_DIR, '_system', 'content', 'books')
            lib_files = 0
            lib_bytes = 0
            if os.path.isdir(books_dir):
                for dp, _, fnames in os.walk(books_dir):
                    for fn in fnames:
                        if not fn.startswith('.'):
                            lib_files += 1
                            try: lib_bytes += os.path.getsize(os.path.join(dp, fn))
                            except OSError: pass

            # User content (lives at USER_DATA/content/)
            user_content_dir = os.path.join(USER_DATA_DIR, 'content')
            user_files = 0
            user_bytes = 0
            if os.path.isdir(user_content_dir):
                for dp, _, fnames in os.walk(user_content_dir):
                    for fn in fnames:
                        if not fn.startswith('.') and fn != '.gitkeep':
                            user_files += 1
                            try: user_bytes += os.path.getsize(os.path.join(dp, fn))
                            except OSError: pass

            content_files = lib_files + user_files
            content_bytes = lib_bytes + user_bytes

            # Saved conversations count
            conv_count = len(_list_conversations(DRIVE_DIR))

            # Config info
            version = '1.0.0'
            edition = 'standard'
            try:
                with open(os.path.join(DRIVE_DIR, '_system', 'config.json')) as f:
                    cfg = json.load(f)
                version = cfg.get('app', {}).get('version', version)
                edition = cfg.get('app', {}).get('edition', edition)
            except Exception:
                pass

            # Ollama health check (non-blocking, 2s timeout)
            ollama_running = False
            ollama_model_loaded = False
            ollama_model_name = None
            ollama_version = None
            # Read Ollama port from config.json (single source of truth)
            ollama_port = 11434
            try:
                cfg_path_d = os.path.join(DRIVE_DIR, '_system', 'config.json')
                with open(cfg_path_d) as f_d:
                    cfg_d = json.load(f_d)
                ollama_port = cfg_d.get('network', {}).get('ollamaPort', 11434)
            except Exception:
                pass
            try:
                import urllib.request as _ureq
                req = _ureq.Request(f'http://localhost:{ollama_port}/api/version')
                with _ureq.urlopen(req, timeout=2) as resp:
                    ver_data = json.loads(resp.read())
                    ollama_running = True
                    ollama_version = ver_data.get('version')
                req2 = _ureq.Request(f'http://localhost:{ollama_port}/api/tags')
                with _ureq.urlopen(req2, timeout=2) as resp2:
                    tags_data = json.loads(resp2.read())
                    models = [m.get('name', '') for m in tags_data.get('models', [])]
                    beacon = next((m for m in models if 'beacon' in m.lower() or 'blackout' in m.lower()), None)
                    if beacon:
                        ollama_model_loaded = True
                        ollama_model_name = beacon
                    elif models:
                        ollama_model_name = models[0]
            except Exception:
                pass

            # Active engine tier info (written by model_setup.py at boot)
            active_tier = None
            tier_path = os.path.join(DRIVE_DIR, '_system', 'data', 'active_tier.json')
            if os.path.isfile(tier_path):
                try:
                    with open(tier_path, encoding='utf-8') as f:
                        active_tier = json.load(f)
                except Exception:
                    pass

            self._send_json(200, {
                'version': version,
                'edition': edition,
                'platform': {
                    'os':   _plat.system(),
                    'arch': _plat.machine(),
                },
                'disk': {
                    'total_bytes': disk_total,
                    'used_bytes': disk_used,
                    'free_bytes': disk_free,
                    'total_gb': round(disk_total / 1e9, 1),
                    'used_gb': round(disk_used / 1e9, 1),
                    'free_gb': round(disk_free / 1e9, 1),
                },
                'content': {
                    'file_count':    content_files,
                    'library_files': lib_files,
                    'user_files':    user_files,
                    'total_bytes':   content_bytes,
                    'total_mb':      round(content_bytes / 1e6, 1),
                    'total_size_mb': round(content_bytes / 1e6, 1),
                },
                'ollama': {
                    'running':      ollama_running,
                    'model_loaded': ollama_model_loaded,
                    'model_name':   ollama_model_name,
                    'version':      ollama_version,
                },
                'engine': active_tier,
                'conversations': {
                    'count':       conv_count,
                    'saved_count': conv_count,
                },
                'server': {
                    'drive_dir': DRIVE_DIR,
                    'port': PORT,
                },
                'checked_at': _now_utc(),
            })
            return

        # ── GET /api/system/files ────────────────────────────
        # List all editable system files with categories
        if path == '/api/system/files':
            editable = BlackoutDriveHandler._SYSTEM_EDITABLE_FILES
            safe_set = BlackoutDriveHandler._SYSTEM_SAFE_FILES
            files = []
            for rel in sorted(editable):
                fp = os.path.join(SCRIPT_DIR, rel)
                if os.path.isfile(fp):
                    files.append({
                        'path': rel,
                        'name': os.path.basename(rel),
                        'category': 'safe' if rel in safe_set else 'core',
                        'size': os.path.getsize(fp),
                    })
            self._send_json(200, {'files': files})
            return

        # ── GET /api/system/files/<path> ─────────────────────
        # Serve a system file for reading in Monaco
        if path.startswith('/api/system/files/'):
            rel = path[len('/api/system/files/'):]
            rel = urllib.parse.unquote(rel)
            editable = BlackoutDriveHandler._SYSTEM_EDITABLE_FILES
            if rel not in editable:
                self._send_json(403, {'error': 'File not in editable whitelist'})
                return
            fp = os.path.join(SCRIPT_DIR, rel)
            abs_fp = os.path.realpath(fp)
            if not abs_fp.startswith(os.path.realpath(SCRIPT_DIR)):
                self._send_json(403, {'error': 'Path traversal blocked'})
                return
            if not os.path.isfile(fp):
                self._send_json(404, {'error': 'File not found'})
                return
            try:
                with open(fp, 'r', encoding='utf-8', errors='replace') as f:
                    content = f.read()
                safe_set = BlackoutDriveHandler._SYSTEM_SAFE_FILES
                self._send_json(200, {
                    'content': content,
                    'path': rel,
                    'category': 'safe' if rel in safe_set else 'core',
                    'size': os.path.getsize(fp),
                })
            except Exception as e:
                self._send_json(500, {'error': str(e)})
            return

        # ── Static file fallback ─────────────────────────────
        self._serve_file(path)

    # ── POST handler ──────────────────────────────────────────

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path   = parsed.path

        # ── /api/download ─────────────────────────────────────
        if path == '/api/download':
            try:
                body = json.loads(self._read_body())
            except json.JSONDecodeError:
                self._send_json(400, {'error': 'invalid JSON'})
                return
            url  = body.get('url', '').strip()
            dest = body.get('dest', '').strip()
            if not url or not dest:
                self._send_json(400, {'error': 'url and dest are required'})
                return
            dest_abs = self._safe_path(dest)
            if not dest_abs:
                self._send_json(403, {'error': 'forbidden path'})
                return

            # Idempotency: if file already exists on disk, skip the download
            if os.path.exists(dest_abs) and os.path.getsize(dest_abs) > 0:
                # Ensure manifest is up-to-date with this file
                write_manifest(DRIVE_DIR)
                self._send_json(200, {'ok': True, 'jobId': '__exists',
                                      'skipped': True, 'reason': 'file already exists'})
                return

            # Guard: limit concurrent downloads to prevent resource exhaustion
            with _jobs_lock:
                active_count = sum(1 for j in _download_jobs.values()
                                   if not j.get('done'))
            if active_count >= 8:
                self._send_json(429, {'error': 'Too many downloads in progress. Please wait.'})
                return

            job_id = _new_job_id()
            job = {'progress': 0, 'total': 0, 'done': False, 'error': None, 'cancel_flag': False}
            with _jobs_lock:
                _download_jobs[job_id] = job
            t = threading.Thread(
                target=_download_worker,
                args=(job_id, url, dest_abs, DRIVE_DIR),
                daemon=True
            )
            job['thread'] = t
            t.start()
            self._send_json(202, {'ok': True, 'jobId': job_id})
            return

        # ── POST /api/master-password/setup ───────────────────
        if path == '/api/master-password/setup':
            try:
                body = json.loads(self._read_body())
            except json.JSONDecodeError:
                self._send_json(400, {'error': 'Invalid JSON'})
                return
            password = body.get('password', '')
            if not password or len(password) < 4:
                self._send_json(400, {'error': 'Password must be at least 4 characters'})
                return
            if _is_master_password_set():
                self._send_json(409, {'error': 'Master password already set'})
                return
            if _master_password_setup(password):
                self._send_json(200, {'ok': True})
            else:
                self._send_json(500, {'error': 'Failed to save password configuration'})
            return

        # ── POST /api/master-password/verify ──────────────────
        if path == '/api/master-password/verify':
            try:
                body = json.loads(self._read_body())
            except json.JSONDecodeError:
                self._send_json(400, {'error': 'Invalid JSON'})
                return
            password = body.get('password', '')
            if not password:
                self._send_json(400, {'error': 'Password required'})
                return
            if _master_password_verify(password):
                self._send_json(200, {'ok': True})
            else:
                self._send_json(403, {'error': 'Wrong password'})
            return

        # ── POST /api/master-password/reset ───────────────────
        # Destructive reset: delete password + all encrypted data
        if path == '/api/master-password/reset':
            try:
                body = json.loads(self._read_body())
            except json.JSONDecodeError:
                self._send_json(400, {'error': 'Invalid JSON'})
                return
            if body.get('confirm') != 'RESET':
                self._send_json(400, {'error': 'Confirmation required'})
                return
            deleted_convs = 0
            deleted_files = 0
            # 1. Delete ecosystem_key.json
            key_path = _ecosystem_key_path()
            if os.path.isfile(key_path):
                os.remove(key_path)
            # 2. Delete encrypted conversations (those with encryptedMessages)
            conv_dir = _conversations_dir(DRIVE_DIR)
            if os.path.isdir(conv_dir):
                for fname in os.listdir(conv_dir):
                    if not fname.endswith('.json'):
                        continue
                    fpath = os.path.join(conv_dir, fname)
                    try:
                        with open(fpath, 'r') as f:
                            conv = json.load(f)
                        if conv.get('encryptedMessages'):
                            os.remove(fpath)
                            deleted_convs += 1
                    except Exception:
                        pass
            # 3. Delete all files in locked directory
            locked = os.path.join(USER_DATA_DIR, 'locked')
            if os.path.isdir(locked):
                for fname in os.listdir(locked):
                    fpath = os.path.join(locked, fname)
                    if os.path.isfile(fpath) and fname != 'README.txt':
                        os.remove(fpath)
                        deleted_files += 1
            _logger.info(f'Master password reset: {deleted_convs} encrypted conversations, '
                 f'{deleted_files} locked files deleted')
            self._send_json(200, {
                'ok': True,
                'deleted_conversations': deleted_convs,
                'deleted_files': deleted_files
            })
            return

        # ── POST /api/master-password/change ──────────────────
        # Non-destructive password change: verify old, re-encrypt files, update hash
        if path == '/api/master-password/change':
            try:
                body = json.loads(self._read_body())
            except json.JSONDecodeError:
                self._send_json(400, {'error': 'Invalid JSON'})
                return
            current_pw = body.get('currentPassword', '')
            new_pw = body.get('newPassword', '')
            if not current_pw or not new_pw:
                self._send_json(400, {'error': 'Both currentPassword and newPassword required'})
                return
            if len(new_pw) < 4:
                self._send_json(400, {'error': 'New password must be at least 4 characters'})
                return
            if not _master_password_verify(current_pw):
                self._send_json(403, {'error': 'Current password is incorrect'})
                return

            # 1. Re-encrypt all locked .7z files
            re_encrypted_files = 0
            locked = os.path.join(USER_DATA_DIR, 'locked')
            if os.path.isdir(locked):
                tmp = _tmp_dir()
                for fname in os.listdir(locked):
                    if not fname.endswith('.7z'):
                        continue
                    fpath = os.path.join(locked, fname)
                    if not os.path.isfile(fpath):
                        continue
                    # Decrypt with old password to temp dir
                    extract_dir = os.path.join(tmp, f'_reenc_{uuid.uuid4().hex[:8]}')
                    os.makedirs(extract_dir, exist_ok=True)
                    ok, err = _decrypt_file_7z(fpath, extract_dir, current_pw)
                    if not ok:
                        shutil.rmtree(extract_dir, ignore_errors=True)
                        continue
                    # Find extracted file
                    extracted = []
                    for root, dirs, fnames_inner in os.walk(extract_dir):
                        for ef in fnames_inner:
                            extracted.append(os.path.join(root, ef))
                    if not extracted:
                        shutil.rmtree(extract_dir, ignore_errors=True)
                        continue
                    # Re-encrypt with new password
                    new_dest = fpath + '.tmp'
                    ok2, err2 = _encrypt_file_7z(extracted[0], new_dest, new_pw)
                    # Cleanup extracted files immediately
                    shutil.rmtree(extract_dir, ignore_errors=True)
                    if ok2:
                        # Atomic replace
                        os.replace(new_dest, fpath)
                        re_encrypted_files += 1
                    else:
                        # Cleanup failed temp if needed
                        try: os.remove(new_dest)
                        except OSError: pass

            # 2. Find encrypted conversation IDs (for client-side re-encryption)
            encrypted_conv_ids = []
            conv_dir = _conversations_dir(DRIVE_DIR)
            if os.path.isdir(conv_dir):
                for fname in os.listdir(conv_dir):
                    if not fname.endswith('.json'):
                        continue
                    fpath = os.path.join(conv_dir, fname)
                    try:
                        with open(fpath, 'r') as f:
                            conv = json.load(f)
                        if conv.get('encryptedMessages'):
                            encrypted_conv_ids.append(conv.get('id', fname[:-5]))
                    except Exception:
                        pass

            # 3. Update ecosystem_key.json with new verifier hash
            if _master_password_setup(new_pw):
                _logger.info(f'Master password changed: {re_encrypted_files} locked files re-encrypted, '
                 f'{len(encrypted_conv_ids)} encrypted conversations flagged for client re-encryption')
                self._send_json(200, {
                    'ok': True,
                    'reEncryptedFiles': re_encrypted_files,
                    'encryptedConversationIds': encrypted_conv_ids,
                })
            else:
                self._send_json(500, {'error': 'Failed to update password configuration'})
            return

        # ── POST /api/files/send-to-library ───────────────────
        # Copy a file from USER_DATA/unlocked/ to USER_DATA/content/ so it
        # appears in the Library's "My Uploads" category.
        if path == '/api/files/send-to-library':
            try:
                body = json.loads(self._read_body())
            except Exception:
                self._send_json(400, {'error': 'Invalid JSON'})
                return
            source = body.get('source', 'unlocked')
            rel_path = (body.get('path') or '').strip()
            if not rel_path:
                self._send_json(400, {'error': 'path required'})
                return

            # Validate extension is library-compatible
            LIBRARY_EXTS = {'.epub', '.pdf', '.txt', '.md',
                            '.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'}
            ext = os.path.splitext(rel_path)[1].lower()
            if ext not in LIBRARY_EXTS:
                self._send_json(400, {
                    'error': f'File type "{ext}" is not supported in the library. '
                             f'Supported: epub, pdf, txt, md, and images.'
                })
                return

            # Resolve source file
            if source == 'unlocked':
                parts = [p for p in rel_path.split('/') if p and p not in ('.', '..')]
                if not parts:
                    self._send_json(400, {'error': 'Invalid path'})
                    return
                src_path = os.path.join(_unlocked_dir(), *parts)
            else:
                self._send_json(400, {'error': 'Only unlocked files can be sent to the library'})
                return

            if not os.path.isfile(src_path):
                self._send_json(404, {'error': 'Source file not found'})
                return

            # Copy to USER_DATA/content/ (flat — just the filename)
            filename = os.path.basename(src_path)
            dest_dir = os.path.join(USER_DATA_DIR, 'content')
            os.makedirs(dest_dir, exist_ok=True)
            dest_path = os.path.join(dest_dir, filename)

            try:
                shutil.copy2(src_path, dest_path)
                dest_rel = 'USER_DATA/content/' + filename
                _logger.info(f'Sent to library: {rel_path} → {dest_rel}')
                self._send_json(200, {'ok': True, 'file': dest_rel, 'filename': filename})
            except Exception as e:
                self._send_json(500, {'error': f'Copy failed: {e}'})
            return

        # ── POST /api/files/unlocked/upload ───────────────────
        # Stream-upload a file to USER_DATA/unlocked/ preserving folder structure.
        # File path comes from X-File-Path header; body is raw binary.
        if path == '/api/files/unlocked/upload':
            raw_path = self.headers.get('X-File-Path', '')
            filepath = urllib.parse.unquote(raw_path).replace('\\', '/')
            if not filepath:
                self._send_json(400, {'error': 'X-File-Path header required'})
                return
            # Sanitize: strip traversal segments
            parts = [p for p in filepath.split('/') if p and p not in ('.', '..')]
            if not parts:
                self._send_json(400, {'error': 'Invalid file path'})
                return
            dest = os.path.join(_unlocked_dir(), *parts)
            try:
                bytes_written = self._stream_to_file(dest)
                self._send_json(200, {'ok': True, 'path': '/'.join(parts), 'size': bytes_written})
            except Exception as e:
                self._send_json(500, {'error': str(e)})
            return

        # ── POST /api/files/locked/upload ─────────────────────
        # Stream-upload + encrypt a file via 7zz, preserving folder structure.
        # Path from X-File-Path, password from X-Password, body is raw binary.
        if path == '/api/files/locked/upload':
            raw_path = self.headers.get('X-File-Path', '')
            filepath = urllib.parse.unquote(raw_path).replace('\\', '/')
            raw_pw = self.headers.get('X-Password', '')
            password = urllib.parse.unquote(raw_pw)
            if not filepath or not password:
                self._send_json(400, {'error': 'X-File-Path and X-Password headers required'})
                return
            # Verify master password
            if not _master_password_verify(password):
                self._send_json(403, {'error': 'Wrong master password'})
                return
            # Sanitize path
            parts = [p for p in filepath.split('/') if p and p not in ('.', '..')]
            if not parts:
                self._send_json(400, {'error': 'Invalid file path'})
                return
            # Stream plaintext to temp
            tmp = _tmp_dir()
            tmp_path = os.path.join(tmp, parts[-1])
            try:
                self._stream_to_file(tmp_path)
            except Exception as e:
                self._send_json(500, {'error': str(e)})
                return
            # Build locked destination preserving folder structure
            locked_dest_dir = os.path.join(_locked_dir(), *parts[:-1]) if len(parts) > 1 else _locked_dir()
            os.makedirs(locked_dest_dir, exist_ok=True)
            encrypted_name = os.path.splitext(parts[-1])[0] + '.7z'
            dest = os.path.join(locked_dest_dir, encrypted_name)
            ok, err = _encrypt_file_7z(tmp_path, dest, password)
            # Delete plaintext temp file immediately
            try:
                os.remove(tmp_path)
            except OSError:
                pass
            if ok:
                result_path = '/'.join(parts[:-1] + [encrypted_name])
                self._send_json(200, {'ok': True, 'path': result_path, 'size': os.path.getsize(dest)})
            else:
                self._send_json(500, {'error': err or 'Encryption failed'})
            return

        # ── POST /api/files/locked/upload-folder-start ────────
        # Create a staging session for folder uploads to LOCKED.
        # Files are streamed in individually, then sealed as a single .7z.
        if path == '/api/files/locked/upload-folder-start':
            try:
                body = json.loads(self._read_body())
            except json.JSONDecodeError:
                self._send_json(400, {'error': 'Invalid JSON'})
                return
            password = body.get('password', '')
            if not password or not _master_password_verify(password):
                self._send_json(403, {'error': 'Wrong master password'})
                return
            session_id = str(uuid.uuid4())
            staging_dir = os.path.join(_tmp_dir(), f'stage-{session_id}')
            os.makedirs(staging_dir, exist_ok=True)
            self._send_json(200, {'ok': True, 'session': session_id})
            return

        # ── POST /api/files/locked/upload-folder-file ─────────
        # Stream a single file into a staging session (preserving folder structure).
        # X-Upload-Session header identifies the session.
        if path == '/api/files/locked/upload-folder-file':
            session_id = self.headers.get('X-Upload-Session', '')
            raw_path = self.headers.get('X-File-Path', '')
            filepath = urllib.parse.unquote(raw_path).replace('\\', '/')
            if not session_id or not filepath:
                self._send_json(400, {'error': 'X-Upload-Session and X-File-Path required'})
                return
            # Validate session directory exists
            staging_dir = os.path.join(_tmp_dir(), f'stage-{session_id}')
            if not os.path.isdir(staging_dir):
                self._send_json(404, {'error': 'Session not found or expired'})
                return
            # Sanitize path
            parts = [p for p in filepath.split('/') if p and p not in ('.', '..')]
            if not parts:
                self._send_json(400, {'error': 'Invalid file path'})
                return
            dest = os.path.join(staging_dir, *parts)
            try:
                bytes_written = self._stream_to_file(dest)
                self._send_json(200, {'ok': True, 'path': '/'.join(parts), 'size': bytes_written})
            except Exception as e:
                self._send_json(500, {'error': str(e)})
            return

        # ── POST /api/files/locked/upload-folder-seal ─────────
        # Archive all files in a staging session as a single encrypted .7z.
        if path == '/api/files/locked/upload-folder-seal':
            try:
                body = json.loads(self._read_body())
            except json.JSONDecodeError:
                self._send_json(400, {'error': 'Invalid JSON'})
                return
            session_id = body.get('session', '')
            folder_name = body.get('folderName', 'archive')
            password = body.get('password', '')
            if not session_id or not password:
                self._send_json(400, {'error': 'session and password required'})
                return
            if not _master_password_verify(password):
                self._send_json(403, {'error': 'Wrong master password'})
                return
            staging_dir = os.path.join(_tmp_dir(), f'stage-{session_id}')
            if not os.path.isdir(staging_dir):
                self._send_json(404, {'error': 'Session not found or expired'})
                return
            # Sanitize folder name
            safe_name = ''.join(c for c in folder_name if c.isalnum() or c in '-_ .').strip()
            if not safe_name:
                safe_name = 'archive'
            archive_name = safe_name + '.7z'
            dest = os.path.join(_locked_dir(), archive_name)
            # Use 7zz to archive the entire staging directory
            zz = _get_7zz_path()
            if not os.path.isfile(zz):
                self._send_json(500, {'error': '7-Zip binary not found'})
                return
            try:
                # Archive all contents of staging_dir
                result = _subprocess.run(
                    [zz, 'a', '-t7z', f'-p{password}', '-mhe=on', '-mx=1',
                     dest, '.'],
                    capture_output=True, text=True, timeout=600,
                    cwd=staging_dir
                )
                if result.returncode != 0:
                    self._send_json(500, {'error': result.stderr or 'Archive creation failed'})
                    return
                # Clean up staging directory
                shutil.rmtree(staging_dir, ignore_errors=True)
                self._send_json(200, {
                    'ok': True,
                    'filename': archive_name,
                    'size': os.path.getsize(dest),
                })
            except _subprocess.TimeoutExpired:
                self._send_json(500, {'error': 'Encryption timed out'})
            except Exception as e:
                self._send_json(500, {'error': str(e)})
            return

        # ── POST /api/files/locked/decrypt ────────────────────
        # Decrypt a .7z file and return its contents
        if path == '/api/files/locked/decrypt':
            try:
                body = json.loads(self._read_body())
            except json.JSONDecodeError:
                self._send_json(400, {'error': 'Invalid JSON'})
                return
            fname = body.get('filename', '').strip()
            password = body.get('password', '')
            if not fname or not password:
                self._send_json(400, {'error': 'filename and password required'})
                return
            # Sanitize path for nested locked files
            dec_parts = [p for p in fname.replace('\\', '/').split('/') if p and p not in ('.', '..')]
            if not dec_parts:
                self._send_json(400, {'error': 'Invalid file path'})
                return
            encrypted_path = os.path.join(_locked_dir(), *dec_parts)
            if not os.path.isfile(encrypted_path):
                self._send_json(404, {'error': 'File not found'})
                return
            # Decrypt to temp dir
            tmp = _tmp_dir()
            extract_dir = os.path.join(tmp, f'_dec_{uuid.uuid4().hex[:8]}')
            os.makedirs(extract_dir, exist_ok=True)
            ok, err = _decrypt_file_7z(encrypted_path, extract_dir, password)
            if not ok:
                shutil.rmtree(extract_dir, ignore_errors=True)
                self._send_json(403 if 'password' in (err or '').lower() else 500,
                                {'error': err})
                return
            # Find the extracted file(s) and serve the first one
            extracted = []
            for root, dirs, fnames in os.walk(extract_dir):
                for ef in fnames:
                    extracted.append(os.path.join(root, ef))
            if not extracted:
                shutil.rmtree(extract_dir, ignore_errors=True)
                self._send_json(500, {'error': 'No files found in encrypted container'})
                return
            target_file = extracted[0]
            ctype = mimetypes.guess_type(target_file)[0] or 'application/octet-stream'
            try:
                with open(target_file, 'rb') as f:
                    data = f.read()
                self.send_response(200)
                self.send_header('Content-Type', ctype)
                self.send_header('Content-Length', str(len(data)))
                self.send_header('Content-Disposition',
                                 f'inline; filename="{os.path.basename(target_file)}"')
                self.end_headers()
                self.wfile.write(data)
            except Exception as e:
                self._send_json(500, {'error': str(e)})
            finally:
                # Always clean up decrypted temp files
                shutil.rmtree(extract_dir, ignore_errors=True)
            return

        # ── POST /api/files/locked/decrypt-to-temp ────────────
        # Decrypt a locked file to a temp session for viewer access
        if path == '/api/files/locked/decrypt-to-temp':
            try:
                body = json.loads(self._read_body())
            except json.JSONDecodeError:
                self._send_json(400, {'error': 'Invalid JSON'})
                return
            fname = body.get('filename', '').strip()
            password = body.get('password', '')
            if not fname or not password:
                self._send_json(400, {'error': 'filename and password required'})
                return
            # Sanitize path for nested locked files
            dec_parts = [p for p in fname.replace('\\', '/').split('/') if p and p not in ('.', '..')]
            if not dec_parts:
                self._send_json(400, {'error': 'Invalid file path'})
                return
            encrypted_path = os.path.join(_locked_dir(), *dec_parts)
            if not os.path.isfile(encrypted_path):
                self._send_json(404, {'error': 'File not found'})
                return
            # Create a unique session directory
            session_id = uuid.uuid4().hex[:12]
            session_dir = os.path.join(_tmp_dir(), session_id)
            os.makedirs(session_dir, exist_ok=True)
            ok, err = _decrypt_file_7z(encrypted_path, session_dir, password)
            if not ok:
                shutil.rmtree(session_dir, ignore_errors=True)
                self._send_json(403 if 'password' in (err or '').lower() else 500,
                                {'error': err})
                return
            # Find extracted file(s)
            extracted = []
            for root, dirs, fnames in os.walk(session_dir):
                for ef in fnames:
                    extracted.append(ef)
            if not extracted:
                shutil.rmtree(session_dir, ignore_errors=True)
                self._send_json(500, {'error': 'No files found in encrypted container'})
                return
            target_name = extracted[0]
            self._send_json(200, {
                'ok': True,
                'session': session_id,
                'filename': target_name,
                'tempPath': f'api/files/temp/{session_id}/{target_name}',
            })
            return

        # ── /api/conversations/save ──────────────────────────
        if path == '/api/conversations/save':
            try:
                body = json.loads(self._read_body())
            except json.JSONDecodeError:
                self._send_json(400, {'error': 'invalid JSON'})
                return
            messages = body.get('messages', [])
            encrypted_messages = body.get('encryptedMessages', None)
            if not isinstance(messages, list) or (len(messages) == 0 and not encrypted_messages):
                self._send_json(400, {'error': 'messages array is required and must not be empty'})
                return
            raw_title = body.get('title')
            title = str(raw_title).strip()[:120] if raw_title else ''
            # Use provided ID or generate a new one
            conv_id = str(body.get('id', '')).strip() or str(uuid.uuid4())
            # Client sends messageCount for encrypted convos (messages array is empty)
            msg_count = body.get('messageCount', None)
            conv = _save_conversation(DRIVE_DIR, conv_id, title, messages,
                                      encrypted_messages=encrypted_messages,
                                      message_count_override=msg_count)
            self._send_json(200, {
                'ok': True,
                'id': conv['id'],
                'title': conv['title'],
                'created_at': conv['created_at'],
                'updated_at': conv['updated_at'],
                'message_count': conv['message_count'],
            })
            return

        # ── /api/perf-log ────────────────────────────────────
        # Accepts performance telemetry from the client and writes
        # it to data/logs/perf.log. Persists metrics to the USB drive
        # so they survive when unplugged (browser console.log doesn't).
        if path == '/api/perf-log':
            if not _debug_mode:
                self._send_json(200, {'ok': True, 'skipped': True})
                return
            try:
                body = json.loads(self._read_body())
            except json.JSONDecodeError:
                self._send_json(400, {'error': 'invalid JSON'})
                return
            # Write to perf.log (append mode)
            perf_log = os.path.join(_debug_log_dir, 'perf.log')
            ts = datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')
            ttft = body.get('ttft', '?')
            tps = body.get('tokPerSec', '?')
            tokens = body.get('tokens', '?')
            total = body.get('totalTime', '?')
            prompt = (body.get('prompt', '') or '')[:80]
            try:
                with open(perf_log, 'a', encoding='utf-8') as f:
                    f.write(f'{ts} | TTFT:{ttft}s | {tps} tok/s | {tokens} tokens | {total}s total | "{prompt}"\n')
                _logger.debug(f'[PERF] TTFT:{ttft}s | {tps} tok/s | {tokens} tokens | {total}s')
            except OSError:
                pass
            self._send_json(200, {'ok': True})
            return

        # ── POST /api/settings/tier ──────────────────────────
        # Hot-swap engine tier: saves override, rebuilds Modelfile, reloads model
        if path == '/api/settings/tier':
            try:
                body = json.loads(self._read_body())
            except json.JSONDecodeError:
                self._send_json(400, {'error': 'invalid JSON'})
                return
            tier = str(body.get('tier', 'auto')).lower().strip()
            if tier not in ('auto', 'base', 'max'):
                self._send_json(400, {'error': 'tier must be auto, base, or max'})
                return
            override_path = os.path.join(DRIVE_DIR, '_system', 'data', 'tier_override.json')
            os.makedirs(os.path.dirname(override_path), exist_ok=True)
            if tier == 'auto':
                try:
                    os.remove(override_path)
                except OSError:
                    pass
            else:
                with open(override_path, 'w', encoding='utf-8') as f:
                    json.dump({'tier': tier}, f)

            # Respond immediately so the UI can show "Switching engines..."
            self._send_json(200, {'ok': True, 'tier': tier, 'swapping': True})

            # Hot-swap in a background thread so the HTTP response isn't blocked
            def _hot_swap():
                try:
                    script_dir = os.path.join(DRIVE_DIR, '_system')
                    model_setup = os.path.join(script_dir, 'model_setup.py')

                    # Step 1: Regenerate Modelfile.generated for the new tier
                    _subprocess.run(
                        [sys.executable, model_setup, script_dir,
                         '--generate-modelfile', '--auto-detect'],
                        capture_output=True, text=True, timeout=30
                    )

                    # Step 2: Rebuild the Ollama model manifest
                    modelfile_path = os.path.join(script_dir, 'Modelfile.generated')
                    if os.path.isfile(modelfile_path):
                        _subprocess.run(
                            ['ollama', 'create', 'blackout-beacon',
                             '-f', modelfile_path],
                            capture_output=True, text=True, timeout=120
                        )

                    _logger.info(f'Hot-swap complete: tier={tier}')
                except Exception as e:
                    _logger.error(f'Hot-swap failed: {e}')

            threading.Thread(target=_hot_swap, daemon=True).start()
            return



    # ── PUT handler ──────────────────────────────────────────────

    # Allowed system files for editing (relative to SCRIPT_DIR)
    _SYSTEM_EDITABLE_FILES = {
        # UI files — safe
        'ui/style.css', 'ui/index.html', 'ui/config.js', 'ui/prompts.js',
        'ui/help.js', 'ui/icons.js',
        # Config files — safe
        'config.json', 'content/prompts.json',
        # Core UI files — editable but dangerous
        'ui/app.js', 'ui/library.js', 'ui/myfiles.js', 'ui/api.js',
        'ui/crypto.js', 'ui/diagnostics.js', 'ui/workspace.js',
        # Server — dangerous
        'server.py', 'model_setup.py',
        # Boot scripts — dangerous
        'START_MAC.command', 'START_LINUX.sh', 'START_WINDOWS.bat',
        'STOP_BEACON.bat', 'STOP_BEACON.command',
        # AI configuration — dangerous
        'Modelfile.generated', 'models.json',
        'config.sh', 'config.bat',
    }

    _SYSTEM_SAFE_FILES = {
        'ui/style.css', 'ui/index.html', 'ui/config.js', 'ui/prompts.js',
        'ui/help.js', 'ui/icons.js', 'config.json', 'content/prompts.json',
    }

    def do_PUT(self):
        parsed = urllib.parse.urlparse(self.path)
        path   = parsed.path

        # ── PUT /api/files/unlocked/<path> ──────────────────
        # Save edited content back to a user file
        if path.startswith('/api/files/unlocked/'):
            rel = path[len('/api/files/unlocked/'):]
            rel = urllib.parse.unquote(rel)
            parts = [p for p in rel.split('/') if p and p not in ('.', '..')]
            if not parts:
                self._send_json(400, {'error': 'Invalid file path'})
                return
            dest = os.path.join(_unlocked_dir(), *parts)
            abs_dest = os.path.realpath(dest)
            if not abs_dest.startswith(os.path.realpath(_unlocked_dir())):
                self._send_json(403, {'error': 'Path outside unlocked directory'})
                return
            try:
                content_len = int(self.headers.get('Content-Length', 0))
                body = self.rfile.read(content_len) if content_len else b''
                os.makedirs(os.path.dirname(dest), exist_ok=True)
                with open(dest, 'wb') as f:
                    f.write(body)
                self._send_json(200, {'ok': True, 'path': '/'.join(parts), 'size': len(body)})
            except Exception as e:
                self._send_json(500, {'error': str(e)})
            return

        # ── PUT /api/system/files/<path> ────────────────────
        # Save edited content to a system file (with auto-backup)
        if path.startswith('/api/system/files/'):
            rel = path[len('/api/system/files/'):]
            rel = urllib.parse.unquote(rel)
            # Validate against whitelist
            if rel not in self._SYSTEM_EDITABLE_FILES:
                self._send_json(403, {'error': 'File not in editable whitelist'})
                return
            src = os.path.join(SCRIPT_DIR, rel)
            abs_src = os.path.realpath(src)
            if not abs_src.startswith(os.path.realpath(SCRIPT_DIR)):
                self._send_json(403, {'error': 'Path outside system directory'})
                return
            try:
                content_len = int(self.headers.get('Content-Length', 0))
                body = self.rfile.read(content_len) if content_len else b''
                # Create auto-backup before overwriting
                backup_dir = os.path.join(SCRIPT_DIR, '_backups',
                    _time.strftime('%Y-%m-%dT%H-%M-%S'))
                backup_path = os.path.join(backup_dir, rel)
                os.makedirs(os.path.dirname(backup_path), exist_ok=True)
                if os.path.isfile(src):
                    shutil.copy2(src, backup_path)
                # Write the new content
                with open(src, 'wb') as f:
                    f.write(body)
                category = 'safe' if rel in self._SYSTEM_SAFE_FILES else 'core'
                self._send_json(200, {
                    'ok': True, 'path': rel, 'size': len(body),
                    'category': category,
                    'backup': _time.strftime('%Y-%m-%dT%H:%M:%S'),
                })
            except Exception as e:
                self._send_json(500, {'error': str(e)})
            return

        self.send_error(404, 'Not found')

    # ── DELETE handler ─────────────────────────────────────────

    def do_DELETE(self):
        parsed = urllib.parse.urlparse(self.path)
        path   = parsed.path
        qs     = urllib.parse.parse_qs(parsed.query)

        # ── DELETE /api/files?path=... ───────────────────────
        if path == '/api/files':
            rel = (qs.get('path', [None])[0] or '').strip()
            if not rel:
                self._send_json(400, {'error': 'path query param required'})
                return
            full = self._safe_path(rel)
            if not full:
                self._send_json(403, {'error': 'forbidden path'})
                return
            if not os.path.isfile(full):
                self._send_json(404, {'error': 'file not found'})
                return
            try:
                os.remove(full)
                write_manifest(DRIVE_DIR)

                self._send_json(200, {'ok': True, 'removed': rel})
            except OSError as e:
                self._send_json(500, {'error': str(e)})
            return

        # ── DELETE /api/download/<jobId> — cancel ────────────
        if path.startswith('/api/download/'):
            job_id = urllib.parse.unquote(path[len('/api/download/'):])
            with _jobs_lock:
                job = _download_jobs.get(job_id)
                if job:
                    job['cancel_flag'] = True
            self._send_json(200, {'ok': True})
            return

        # ── DELETE /api/conversations/<id> ───────────────────
        if path.startswith('/api/conversations/'):
            conv_id = urllib.parse.unquote(path[len('/api/conversations/'):])
            deleted = _delete_conversation(DRIVE_DIR, conv_id)
            if deleted:
                self._send_json(200, {'ok': True, 'deleted': conv_id})
            else:
                self._send_json(404, {'error': 'conversation not found'})
            return

        # ── DELETE /api/files/unlocked/<path> ─────────────────
        if path.startswith('/api/files/unlocked/'):
            fname = urllib.parse.unquote(path[len('/api/files/unlocked/'):])
            parts = [p for p in fname.split('/') if p and p not in ('.', '..')]
            if not parts:
                self._send_json(400, {'error': 'Invalid path'})
                return
            fpath = os.path.join(_unlocked_dir(), *parts)
            if os.path.isfile(fpath):
                try:
                    os.remove(fpath)
                    self._send_json(200, {'ok': True, 'deleted': '/'.join(parts)})
                except OSError as e:
                    self._send_json(500, {'error': str(e)})
            elif os.path.isdir(fpath):
                try:
                    shutil.rmtree(fpath)
                    self._send_json(200, {'ok': True, 'deleted': '/'.join(parts)})
                except OSError as e:
                    self._send_json(500, {'error': str(e)})
            else:
                self._send_json(404, {'error': 'File not found'})
            return

        # ── DELETE /api/files/locked/<path> ───────────────────
        if path.startswith('/api/files/locked/'):
            fname = urllib.parse.unquote(path[len('/api/files/locked/'):])
            parts = [p for p in fname.split('/') if p and p not in ('.', '..')]
            if not parts:
                self._send_json(400, {'error': 'Invalid path'})
                return
            fpath = os.path.join(_locked_dir(), *parts)
            if os.path.isfile(fpath):
                try:
                    os.remove(fpath)
                    self._send_json(200, {'ok': True, 'deleted': '/'.join(parts)})
                except OSError as e:
                    self._send_json(500, {'error': str(e)})
            elif os.path.isdir(fpath):
                try:
                    shutil.rmtree(fpath)
                    self._send_json(200, {'ok': True, 'deleted': '/'.join(parts)})
                except OSError as e:
                    self._send_json(500, {'error': str(e)})
            else:
                self._send_json(404, {'error': 'File not found'})
            return

        # ── DELETE /api/files/temp/<session> ──────────────────
        # Clean up a temp session directory after viewer is closed
        if path.startswith('/api/files/temp/'):
            session_id = urllib.parse.unquote(path[len('/api/files/temp/'):]).strip('/')
            if '..' in session_id or '/' in session_id:
                self._send_json(400, {'error': 'Invalid session ID'})
                return
            session_path = os.path.join(_tmp_dir(), session_id)
            if os.path.isdir(session_path):
                shutil.rmtree(session_path, ignore_errors=True)
            self._send_json(200, {'ok': True, 'cleaned': session_id})
            return

        # ── DELETE /api/files/user-content/<filename> ─────────
        # Remove a file from USER_DATA/content/ (library copy only).
        # Does NOT touch the original in USER_DATA/unlocked/.
        if path.startswith('/api/files/user-content/'):
            fname = urllib.parse.unquote(path[len('/api/files/user-content/'):])
            # Strict sanitize: filename only, no slashes, no traversal
            safe_name = os.path.basename(fname)
            if not safe_name or safe_name in ('.', '..'):
                self._send_json(400, {'error': 'Invalid filename'})
                return
            fpath = os.path.join(USER_DATA_DIR, 'content', safe_name)
            if not os.path.isfile(fpath):
                self._send_json(404, {'error': 'File not found in library'})
                return
            try:
                os.remove(fpath)
                _logger.info(f'Removed from library: {safe_name}')
                self._send_json(200, {'ok': True, 'removed': safe_name})
            except OSError as e:
                self._send_json(500, {'error': str(e)})
            return

        self.send_error(404, 'Not found')

    # ── OPTIONS (CORS preflight) ───────────────────────────────

    def do_OPTIONS(self):
        self.send_response(200)
        self._cors_headers()
        self.end_headers()


# ── Heartbeat Watchdog Thread ──────────────────────────────────────────────────

def _watchdog_thread():
    """Background thread: monitors browser heartbeats.
    
    Once the browser sends its first heartbeat, the watchdog activates.
    If no heartbeat is received for WATCHDOG_TIMEOUT seconds, the server
    shuts down cleanly — killing Ollama and exiting the process.
    
    This ensures closing the browser tab eventually stops the entire system,
    without requiring the user to press a key in the CMD window.
    """
    while True:
        _time.sleep(5)  # check every 5 seconds
        with _heartbeat_lock:
            if not _heartbeat_active:
                continue  # haven't received first heartbeat yet — stay idle
            elapsed = _time.time() - _last_heartbeat
        
        if elapsed > WATCHDOG_TIMEOUT:
            _logger.warning(f'No heartbeat for {int(elapsed)}s — initiating shutdown')
            print(f'\n  [WATCHDOG] No browser heartbeat for {int(elapsed)}s — shutting down...', flush=True)
            # Write sentinel file so the launcher script knows to exit
            try:
                sentinel = os.path.join(DRIVE_DIR, '_system', 'data', '.shutdown_sentinel')
                os.makedirs(os.path.dirname(sentinel), exist_ok=True)
                with open(sentinel, 'w') as f:
                    f.write('shutdown')
            except OSError:
                pass
            # Kill Ollama
            try:
                if sys.platform == 'win32':
                    _subprocess.run(['taskkill', '/f', '/im', 'ollama.exe'],
                                    capture_output=True, timeout=5)
                else:
                    _subprocess.run(['pkill', '-f', 'ollama'], capture_output=True, timeout=5)
            except Exception:
                pass
            print('  [WATCHDOG] System offline. All data remains on your drive.', flush=True)
            # Shut down the HTTP server
            if _server_ref:
                _server_ref.shutdown()
            # Force exit after a short delay (in case shutdown blocks)
            _time.sleep(2)
            os._exit(0)


# ── Entry Point ────────────────────────────────────────────────────────────────

if __name__ == '__main__':
    # Automatically rebuild the manifest on boot to prevent "ghost" files
    # if the user manually modified the drive's contents while it was off.
    write_manifest(DRIVE_DIR)
    
    server = ThreadingHTTPServer(('127.0.0.1', PORT), BlackoutDriveHandler)
    server.daemon_threads = True  # Threads die when main thread exits
    _server_ref = server
    print(f'  The Blackout Drive server → http://127.0.0.1:{PORT}/_system/ui/', flush=True)
    print(f'  Serving from: {DRIVE_DIR}', flush=True)
    if _debug_mode:
        print(f'  Debug logging: {os.path.join(_debug_log_dir, "server.log")}', flush=True)
        _logger.info(f'Server bound to 127.0.0.1:{PORT}')
        _logger.info(f'Manifest rebuilt on boot')

    # Start the heartbeat watchdog in a daemon thread
    wd = threading.Thread(target=_watchdog_thread, daemon=True)
    wd.start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()

