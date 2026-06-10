#!/usr/bin/env python3

"""
The Blackout Drive — Local HTTP Server
Copyright (c) 2026 Hutton Technologies LLC — Licensed under BSL 1.1
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
    GET  /api/update/check           → check for OTA software updates
    GET  /api/update/status          → poll update download progress
    POST /api/update/download        → download + stage software update
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
import tempfile
import zipfile
import io
import threading
import datetime
import mimetypes
import urllib.request
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# Register MIME types not always in default mimetypes DB
mimetypes.add_type('application/epub+zip', '.epub')
mimetypes.add_type('application/wasm', '.wasm')
mimetypes.add_type('application/octet-stream', '.onnx')
mimetypes.add_type('application/octet-stream', '.data')

# ── Configuration ─────────────────────────────────────────────────────────────

DEFAULT_PORT = 8080
SCRIPT_DIR   = os.path.dirname(os.path.abspath(__file__))

# Ensure SCRIPT_DIR is on sys.path so 'from comms import ...' works.
# On Windows, when launched via 'start /min cmd /c', the bundled Python
# does not always add the script's directory to sys.path automatically.
if SCRIPT_DIR not in sys.path:
    sys.path.insert(0, SCRIPT_DIR)
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
    # In production, log WARNING+ to stderr so critical operational messages
    # (provisioning steps, errors) are visible in the terminal.
    # Configure the ROOT logger so all modules (comms.serial, comms.provisioning,
    # etc.) also emit warnings, not just the 'blackout' named logger.
    _stderr_handler = _logging.StreamHandler()
    _stderr_handler.setFormatter(_logging.Formatter(
        '%(asctime)s [%(name)s] %(levelname)s %(message)s', datefmt='%H:%M:%S'
    ))
    _stderr_handler.setLevel(_logging.WARNING)
    _logging.root.addHandler(_stderr_handler)
    _logging.root.setLevel(_logging.WARNING)
    _logger.addHandler(_stderr_handler)
    _logger.setLevel(_logging.WARNING)

# ── Ollama Executable Resolution ───────────────────────────────────────────────
# Resolve the path to the Ollama binary so hot-swap and other subprocess calls
# work on all platforms.  The boot scripts launch Ollama from the bundled runtime
# directory, but server.py may need to call it too (e.g. `ollama create`).
# Check bundled paths first, fall back to bare 'ollama' on PATH.

def _resolve_ollama_exe():
    """Find the Ollama executable — bundled runtime first, then PATH."""
    runtime_dir = os.path.join(DRIVE_DIR, '_system', 'runtime')
    candidates = []
    if sys.platform == 'win32':
        candidates.append(os.path.join(runtime_dir, 'ollama-windows', 'ollama.exe'))
    elif sys.platform == 'darwin':
        import platform as _pf
        if _pf.machine() == 'arm64':
            candidates.append(os.path.join(runtime_dir, 'ollama-mac-arm', 'ollama'))
        else:
            candidates.append(os.path.join(runtime_dir, 'ollama-mac-intel', 'ollama'))
    else:
        candidates.append(os.path.join(runtime_dir, 'ollama-linux-amd64', 'ollama'))

    for path in candidates:
        if os.path.isfile(path):
            return path

    # Fall back to system PATH
    return 'ollama'

_OLLAMA_EXE = _resolve_ollama_exe()
_logger.info(f'Ollama executable: {_OLLAMA_EXE}')

# ── Download Job Tracking ──────────────────────────────────────────────────────
# { job_id: { progress, total, done, error, thread, cancel_flag } }
_download_jobs = {}
_jobs_lock = threading.Lock()
_job_counter = 0

# ── Engine Hot-Swap Status Tracking (FRAG-006) ────────────────────────────────
# Allows the UI to poll for completion instead of a blind 12s wait.
_hot_swap_status = {'state': 'idle', 'tier': None, 'error': None}

# ── OTA Software Update State ─────────────────────────────────────────────────
# state: 'idle' | 'checking' | 'downloading' | 'staged' | 'error'
_update_state = {
    'state': 'idle',
    'progress': 0,       # bytes downloaded
    'total': 0,          # total bytes to download
    'remote_version': None,
    'changelog': None,
    'error': None,
}
_update_lock = threading.Lock()
_UPDATE_MANIFEST_URL = 'https://updates.theblackoutdrive.com/manifest.json'

# ── Atomic Config Writer ───────────────────────────────────────────────────────
# Thread-safe config.json access. Prevents corruption from concurrent HTTP
# threads (ThreadingMixIn) and slow USB flash write latency.
_config_lock = threading.Lock()
_CONFIG_PATH = os.path.join(USER_DATA_DIR, 'config.json')

def _safe_atomic_replace(tmp_path, final_path, validate_json=False, min_size=2):
    """Validate a .tmp file before atomically replacing the original.

    Prevents the Storage Choke scenario: if the drive is full, the .tmp
    file may be 0-byte or truncated. This function verifies integrity
    BEFORE calling os.replace(), so the original file is never destroyed.

    Args:
        tmp_path: Path to the temporary file to validate
        final_path: Path to the destination file to replace
        validate_json: If True, parse .tmp as JSON to verify structure
        min_size: Minimum acceptable file size in bytes (default 2)

    Raises:
        OSError: If .tmp file is missing, too small, or fails validation
    """
    if not os.path.isfile(tmp_path):
        raise OSError(f'Atomic replace failed: {tmp_path} does not exist')
    size = os.path.getsize(tmp_path)
    if size < min_size:
        try:
            os.remove(tmp_path)
        except OSError:
            pass
        raise OSError(
            f'Atomic replace aborted: {tmp_path} is {size} bytes '
            f'(min {min_size}). Original file preserved.'
        )
    if validate_json:
        try:
            with open(tmp_path, 'r', encoding='utf-8') as f:
                json.load(f)
        except (json.JSONDecodeError, UnicodeDecodeError) as e:
            try:
                os.remove(tmp_path)
            except OSError:
                pass
            raise OSError(
                f'Atomic replace aborted: {tmp_path} is not valid JSON ({e}). '
                f'Original file preserved.'
            )
    os.replace(tmp_path, final_path)


def _atomic_write_config(cfg_path, cfg_dict):
    """Write config atomically: tmp file → fsync → validate → rename.

    Even if the process crashes mid-write, the original file survives
    because os.replace() is the last operation (atomic on POSIX,
    near-atomic on NTFS, safe on FAT32/exFAT).
    """
    tmp_path = cfg_path + '.tmp'
    with open(tmp_path, 'w', encoding='utf-8') as f:
        json.dump(cfg_dict, f, indent=2)
        f.write('\n')
        f.flush()
        os.fsync(f.fileno())          # Force to physical media (critical for USB)
    _safe_atomic_replace(tmp_path, cfg_path, validate_json=True)


def _read_modify_write_config(modifier_fn, cfg_path=None):
    """Thread-safe config modification.

    Args:
        modifier_fn: callable(cfg_dict) — mutates cfg_dict in-place.
        cfg_path: Override config path (defaults to _CONFIG_PATH).

    Acquires the global config lock, reads config.json, calls modifier_fn
    to apply changes, then writes atomically.
    """
    if cfg_path is None:
        cfg_path = _CONFIG_PATH
    with _config_lock:
        try:
            with open(cfg_path, 'r', encoding='utf-8') as f:
                cfg = json.load(f)
        except (json.JSONDecodeError, FileNotFoundError, OSError) as e:
            _logger.error('Config read failed (%s), attempting backup recovery', e)
            bak_path = cfg_path + '.bak'
            if os.path.isfile(bak_path):
                shutil.copy2(bak_path, cfg_path)
                with open(cfg_path, 'r', encoding='utf-8') as f:
                    cfg = json.load(f)
                _logger.warning('Config recovered from backup')
            else:
                # Bootstrap: file and backup both missing (first run or
                # after USER_DATA migration).  Start from empty dict so
                # the modifier can populate it and the atomic writer creates
                # the file for the first time.
                cfg = {}
                _logger.warning('Config file and backup both missing — '
                                'bootstrapping empty config')
        modifier_fn(cfg)
        _atomic_write_config(cfg_path, cfg)


# ── EULA / Disclaimer Acceptance Gate ──────────────────────────────────────────
# Server-side enforcement: functional API routes are gated until the user
# accepts the EULA via the UI clickwrap. Persisted to config.json so it
# survives reboots. Cached in memory for zero-overhead per-request checks.
_eula_accepted = False

def _init_eula():
    """Read EULA acceptance state from config.json at boot."""
    global _eula_accepted
    try:
        with open(_CONFIG_PATH, 'r', encoding='utf-8') as f:
            cfg = json.load(f)
        _eula_accepted = cfg.get('eula_accepted', False)
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        _eula_accepted = False

# Routes EXEMPT from EULA gate (must work before acceptance):
_EULA_EXEMPT_ROUTES = frozenset({
    '/api/heartbeat',
    '/api/eula/status',
    '/api/eula/accept',
    '/api/status',
    # Password setup fires immediately after EULA accept (fire-and-forget POST).
    # Without exemption, the async EULA POST may not have completed yet.
    '/api/master-password/status',
    '/api/master-password/setup',
    '/api/master-password/hint',
})


# ── COMMS Subsystem ────────────────────────────────────────────────────────────
# Initialized at server boot. Handles serial radio connection + @BEACON Dispatch.
_comms_manager = None  # Set in __main__ after config is loaded

# ── Heartbeat Watchdog ─────────────────────────────────────────────────────────
# The browser sends a heartbeat every 30 seconds. If no heartbeat is received
# for WATCHDOG_TIMEOUT seconds after the first one, the server shuts down
# and kills Ollama. This ensures closing the browser stops the system.
import time as _time
import subprocess as _subprocess

_heartbeat_lock = threading.Lock()
_last_heartbeat = 0.0       # timestamp of last heartbeat (0 = never received)
_heartbeat_active = False   # becomes True after first heartbeat
WATCHDOG_TIMEOUT = 45       # seconds without heartbeat before shutdown
_server_ref = None          # set at startup, used by watchdog to shut down

# Brute-force protection for master password verification
# Persisted to disk so server restarts can't reset the counter (F-06)
_PW_LOCKOUT_FILE = os.path.join(os.path.realpath(os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'USER_DATA')),
    '.pw_lockout.json')

def _load_lockout_state():
    """Load brute-force lockout state from disk."""
    try:
        with open(_PW_LOCKOUT_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return {'count': 0, 'until': 0.0}

def _save_lockout_state(state):
    """Persist brute-force lockout state to disk."""
    try:
        tmp = _PW_LOCKOUT_FILE + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(state, f)
        os.replace(tmp, _PW_LOCKOUT_FILE)
    except Exception:
        pass  # Non-fatal — worst case the counter resets

def _check_pw_lockout():
    """Check if password attempts are locked out.
    Returns (is_locked_out, seconds_remaining)."""
    state = _load_lockout_state()
    if _time.time() < state.get('until', 0):
        return True, int(state['until'] - _time.time()) + 1
    return False, 0

def _record_pw_failure():
    """Increment failure count and apply exponential backoff."""
    state = _load_lockout_state()
    state['count'] = state.get('count', 0) + 1
    if state['count'] >= 5:
        state['until'] = _time.time() + min(30 * (2 ** (state['count'] - 5)), 300)
    _save_lockout_state(state)

def _reset_pw_lockout():
    """Reset lockout counter on successful authentication."""
    _save_lockout_state({'count': 0, 'until': 0.0})

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
    """Return the conversations directory inside USER_DATA/."""
    new_dir = os.path.join(USER_DATA_DIR, 'conversations')
    os.makedirs(new_dir, exist_ok=True)
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


def _pick_export_directory() -> str:
    """Open a native OS directory picker dialog and return the selected path.

    Cross-platform:
      - macOS:   Uses osascript (AppleScript) — works without tkinter
      - Windows: Uses tkinter (shipped with bundled Python runtime)
      - Linux:   Tries zenity → kdialog → tkinter fallback chain

    Returns the selected directory path, or '' if cancelled.
    Runs synchronously — blocks until the user picks or cancels.
    """
    import subprocess as _sp

    if sys.platform == 'darwin':
        # macOS: osascript choose folder.
        # IMPORTANT: do NOT use "tell application System Events" — unnecessary
        # and causes Accessibility permission issues.
        script = (
            'set theFolder to choose folder with prompt "Export to:"\n'
            'return POSIX path of (theFolder as string)'
        )
        try:
            result = _sp.run(
                ['osascript', '-e', script],
                capture_output=True, text=True, timeout=120
            )
            path = result.stdout.strip().rstrip('/')
            return path if result.returncode == 0 and path else ''
        except Exception as e:
            _logger.error("macOS directory picker failed: %s", e)
            return ''

    elif sys.platform == 'win32':
        # Windows: use tkinter which ships with the bundled Python
        try:
            import tkinter as tk
            from tkinter import filedialog
            root = tk.Tk()
            root.withdraw()
            root.attributes('-topmost', True)
            path = filedialog.askdirectory(title='Export to:')
            root.destroy()
            return path or ''
        except Exception as e:
            _logger.error("Windows directory picker failed: %s", e)
            return ''

    else:
        # Linux: try zenity → kdialog → tkinter
        for cmd in (['zenity', '--file-selection', '--directory', '--title=Export to:'],
                     ['kdialog', '--getexistingdirectory', '.', '--title', 'Export to:']):
            try:
                result = _sp.run(cmd, capture_output=True, text=True, timeout=120)
                if result.returncode == 0 and result.stdout.strip():
                    return result.stdout.strip()
            except FileNotFoundError:
                continue
            except Exception:
                continue

        # Fallback: tkinter
        try:
            import tkinter as tk
            from tkinter import filedialog
            root = tk.Tk()
            root.withdraw()
            root.attributes('-topmost', True)
            path = filedialog.askdirectory(title='Export to:')
            root.destroy()
            return path or ''
        except Exception as e:
            _logger.error("Linux directory picker failed: %s", e)
            return ''


def _pick_save_file(suggested_name: str, default_dir: str = '') -> str:
    """Open a native OS 'Save As' file dialog and return the selected path.

    Cross-platform:
      - macOS:   Uses osascript (AppleScript) — works without tkinter
      - Windows: Uses tkinter (shipped with bundled Python runtime)
      - Linux:   Tries zenity → kdialog → tkinter fallback chain

    Returns the full save path, or '' if cancelled.
    Runs synchronously — blocks until the user picks or cancels.
    """
    import subprocess as _sp

    if sys.platform == 'darwin':
        # macOS: osascript choose file name.
        # IMPORTANT: do NOT use "tell application System Events" — unnecessary
        # and causes Accessibility permission issues.
        # IMPORTANT: must cast result as string before POSIX path, otherwise
        # macOS raises error -1700 on non-existing save paths.
        default_clause = f' default name "{suggested_name}"' if suggested_name else ''
        location_clause = ''
        if default_dir and os.path.isdir(default_dir):
            location_clause = f' default location POSIX file "{default_dir}"'
        script = (
            f'set theFile to choose file name with prompt "Save as:"{default_clause}{location_clause}\n'
            'return POSIX path of (theFile as string)'
        )
        try:
            result = _sp.run(
                ['osascript', '-e', script],
                capture_output=True, text=True, timeout=120
            )
            path = result.stdout.strip()
            return path if result.returncode == 0 and path else ''
        except Exception as e:
            _logger.error("macOS save dialog failed: %s", e)
            return ''

    elif sys.platform == 'win32':
        try:
            import tkinter as tk
            from tkinter import filedialog
            root = tk.Tk()
            root.withdraw()
            root.attributes('-topmost', True)
            path = filedialog.asksaveasfilename(
                title='Save as:',
                initialfile=suggested_name,
                initialdir=default_dir or None,
            )
            root.destroy()
            return path or ''
        except Exception as e:
            _logger.error("Windows save dialog failed: %s", e)
            return ''

    else:
        # Linux: try zenity → kdialog → tkinter
        for cmd in (
            ['zenity', '--file-selection', '--save', '--confirm-overwrite',
             '--title=Save as:', '--filename=' + suggested_name],
            ['kdialog', '--getsavefilename', suggested_name, '--title', 'Save as:', '--overwrite'],
        ):
            try:
                result = _sp.run(cmd, capture_output=True, text=True, timeout=120)
                if result.returncode == 0 and result.stdout.strip():
                    return result.stdout.strip()
            except FileNotFoundError:
                continue
            except Exception:
                continue

        # Fallback: tkinter
        try:
            import tkinter as tk
            from tkinter import filedialog
            root = tk.Tk()
            root.withdraw()
            root.attributes('-topmost', True)
            path = filedialog.asksaveasfilename(
                title='Save as:',
                initialfile=suggested_name,
                initialdir=default_dir or None,
            )
            root.destroy()
            return path or ''
        except Exception as e:
            _logger.error("Linux save dialog failed: %s", e)
            return ''

# ── Collision-safe destination paths ─────────────────────────────────────────

def _safe_dest_path(dest: str) -> str:
    """Return a collision-safe destination path.

    If *dest* already exists (file or directory), appends an incrementing
    counter before the extension to prevent silent overwrites:

        report.pdf       -> report 2.pdf    -> report 3.pdf
        data.zip.bkv     -> data 2.zip.bkv  -> data 3.zip.bkv
        MyFolder/        -> MyFolder 2/     -> MyFolder 3/

    Returns *dest* unchanged when it does not already exist.
    """
    if not os.path.exists(dest):
        return dest

    parent = os.path.dirname(dest)
    basename = os.path.basename(dest)

    # For compound extensions like .zip.bkv or .tar.gz, split at the first dot
    # after the human-readable stem.  Simple heuristic: split on the first '.'.
    dot_idx = basename.find('.')
    if dot_idx > 0:
        stem = basename[:dot_idx]
        ext = basename[dot_idx:]     # e.g. '.pdf' or '.zip.bkv'
    else:
        stem = basename
        ext = ''

    counter = 2
    while True:
        candidate = os.path.join(parent, f"{stem} {counter}{ext}")
        if not os.path.exists(candidate):
            return candidate
        counter += 1


# ── Library Bookmarks ────────────────────────────────────────────────────────
# Bookmarks are references from the Library to Workspace files.
# No file duplication — the Library reads directly from unlocked/ or locked/.

_BOOKMARKS_FILE = os.path.join(USER_DATA_DIR, 'library_bookmarks.json')

def _load_bookmarks() -> dict:
    """Load library bookmarks from JSON. Returns {'bookmarks': [...]}."""
    try:
        with open(_BOOKMARKS_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)
        if 'bookmarks' not in data:
            data['bookmarks'] = []
        return data
    except (FileNotFoundError, json.JSONDecodeError):
        return {'bookmarks': []}


def _save_bookmarks(data: dict):
    """Save library bookmarks to JSON with atomic write."""
    tmp = _BOOKMARKS_FILE + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2)
    os.replace(tmp, _BOOKMARKS_FILE)


def _remove_bookmarks_for_path(source: str, path: str):
    """Remove all bookmarks matching a given source and path (or under a directory path).
    Called when a workspace file is deleted so stale bookmarks are auto-cleaned."""
    data = _load_bookmarks()
    before = len(data['bookmarks'])
    data['bookmarks'] = [
        b for b in data['bookmarks']
        if not (b.get('source') == source and
                (b.get('path') == path or b.get('path', '').startswith(path + '/')))
    ]
    after = len(data['bookmarks'])
    if after < before:
        _save_bookmarks(data)
        _logger.info(f'Auto-removed {before - after} library bookmark(s) for deleted {source} path: {path}')
    return before - after



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


# ── Native File Encryption (V3 Segmented AEAD) ────────────────────────────────
# Each file encrypted individually with per-segment AES-256-GCM.
# Directory structure stored in encrypted manifest. UUID filenames on disk
# prevent OPSEC leakage. Streaming I/O — no file size limits.
from comms.filecrypt import decrypt_to_bytes as _decrypt_to_bytes
from comms.filecrypt import decrypt_to_stream as _decrypt_to_stream
from comms.filecrypt import encrypt_bytes as _encrypt_bytes
from comms.filecrypt import encrypt_stream as _encrypt_stream


# ── Vault Manifest System (1:1 Encrypted Storage) ─────────────────────────────
# The vault manifest maps UUID filenames to original paths/metadata.
# Stored encrypted as .vault_manifest.bkv in the locked directory.
# Structure: {"version":1,"files":{"<uuid>":{"path":"dir/file.txt","size":123,"mtime":...}}}

_vault_manifest_cache = None  # In-memory cache of decrypted manifest
_vault_manifest_lock = threading.Lock()  # Thread-safety for manifest cache (FRAG-005)


def _vault_manifest_path():
    return os.path.join(_locked_dir(), '.vault_manifest.bkv')


def _vault_load_manifest(password):
    """Load and decrypt the vault manifest. Caches in memory.
    Thread-safe: uses _vault_manifest_lock to prevent concurrent corruption."""
    global _vault_manifest_cache
    with _vault_manifest_lock:
        if _vault_manifest_cache is not None:
            return _vault_manifest_cache

        mpath = _vault_manifest_path()
        if not os.path.isfile(mpath):
            _vault_manifest_cache = {"version": 1, "files": {}}
            return _vault_manifest_cache

        try:
            data, _ = _decrypt_to_bytes(mpath, password)
            manifest = json.loads(data.decode('utf-8'))

            # ── Ghost Purge: boot-time integrity check ──
            # Cross-reference manifest entries against actual .bkv files.
            # Remove entries that reference non-existent files (ghost entries
            # from interrupted uploads, USB yank, or corruption).
            locked = _locked_dir()
            ghosts = []
            for uid, info in manifest.get('files', {}).items():
                bkv_path = os.path.join(locked, uid + '.bkv')
                if not os.path.isfile(bkv_path):
                    ghosts.append(uid)
                elif os.path.getsize(bkv_path) < 38:
                    # Truncated file — too small to be valid BKV
                    ghosts.append(uid)
            if ghosts:
                for uid in ghosts:
                    del manifest['files'][uid]
                # Re-save the cleaned manifest (inline — can't call
                # _vault_save_manifest here as we already hold the lock)
                try:
                    save_data = json.dumps(manifest, separators=(',', ':')).encode('utf-8')
                    _encrypt_bytes(save_data, 'vault_manifest.json',
                                   _vault_manifest_path(), password)
                except Exception:
                    pass  # Non-fatal — ghost entries simply won't appear
                print(f'  Vault integrity: purged {len(ghosts)} ghost entries')

            _vault_manifest_cache = manifest
            return manifest
        except Exception as e:
            raise ValueError(f'Failed to load vault manifest: {e}')


def _vault_save_manifest(manifest, password):
    """Encrypt and save the vault manifest to disk.
    Thread-safe: uses _vault_manifest_lock to prevent concurrent corruption."""
    global _vault_manifest_cache
    with _vault_manifest_lock:
        data = json.dumps(manifest, separators=(',', ':')).encode('utf-8')
        ok, err = _encrypt_bytes(data, 'vault_manifest.json',
                                  _vault_manifest_path(), password)
        if not ok:
            raise IOError(f'Failed to save vault manifest: {err}')
        _vault_manifest_cache = manifest


def _vault_invalidate_cache():
    """Clear the cached manifest (called on lock/auth change).
    Thread-safe: uses _vault_manifest_lock to prevent concurrent corruption."""
    global _vault_manifest_cache
    with _vault_manifest_lock:
        _vault_manifest_cache = None


def _vault_list_dir(manifest, path=''):
    """List directory contents at a given path from the manifest."""
    path = path.strip('/')
    entries = {}
    for uid, info in manifest.get('files', {}).items():
        fpath = info['path']
        if path:
            if not fpath.startswith(path + '/'):
                continue
            rel = fpath[len(path) + 1:]
        else:
            rel = fpath
        parts = rel.split('/')
        if len(parts) == 1:
            entries[parts[0]] = {
                'name': parts[0],
                'is_dir': False,
                'size': info.get('size', 0),
                '_uuid': uid,
            }
        else:
            dirname = parts[0]
            if dirname not in entries:
                entries[dirname] = {
                    'name': dirname,
                    'is_dir': True,
                    'type': 'directory',
                }
    return sorted(entries.values(), key=lambda e: (not e.get('is_dir', False), e['name']))


def _vault_build_tree(manifest, path=''):
    """Build recursive tree from manifest for IDE explorer.
    Returns paths relative to VAULT ROOT (consistent with _build_file_tree
    which returns paths relative to its root_dir, not relative to subtree)."""
    path = path.strip('/')
    result = []
    children_dirs = {}

    for uid, info in manifest.get('files', {}).items():
        fpath = info['path']
        if path:
            if not fpath.startswith(path + '/'):
                continue
            rel = fpath[len(path) + 1:]
        else:
            rel = fpath
        parts = rel.split('/')
        if len(parts) == 1:
            # Full vault-root-relative path so the IDE can resolve it correctly
            result.append({'name': parts[0], 'path': fpath, 'type': 'file'})
        else:
            children_dirs[parts[0]] = True

    for dirname in sorted(children_dirs.keys()):
        child_path = f"{path}/{dirname}" if path else dirname
        result.append({
            'name': dirname,
            'path': child_path,  # Full path from vault root
            'type': 'directory',
            'children': _vault_build_tree(manifest, child_path),
        })

    result.sort(key=lambda x: (0 if x['type'] == 'directory' else 1, x['name']))
    return result


def _vault_find_uuid(manifest, filepath):
    """Find the UUID for a given filepath in the manifest."""
    filepath = filepath.strip('/')
    for uid, info in manifest.get('files', {}).items():
        if info['path'] == filepath:
            return uid
    return None


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
        with open(path, 'r', encoding='utf-8') as f:
            cfg = json.load(f)
        return bool(cfg.get('verifier') and cfg.get('salt'))
    except Exception:
        return False

def _master_password_setup(password: str, hint: str = '') -> bool:
    """Create a new master password. Stores PBKDF2 verifier + salt.
    Optionally stores a plaintext password hint (max 100 chars)."""
    import secrets
    salt = secrets.token_hex(32)  # 32 bytes = 64 hex chars
    verifier = _hashlib.pbkdf2_hmac(
        'sha256', password.encode('utf-8'), bytes.fromhex(salt), 600000
    ).hex()
    cfg = {'salt': salt, 'verifier': verifier, 'version': 1}
    if hint:
        cfg['hint'] = hint[:100]  # Plaintext hint, capped at 100 chars
    try:
        # Atomic write with fsync to prevent corruption on USB pull
        tmp_path = _ecosystem_key_path() + '.tmp'
        with open(tmp_path, 'w', encoding='utf-8') as f:
            json.dump(cfg, f)
            f.flush()
            os.fsync(f.fileno())
        _safe_atomic_replace(tmp_path, _ecosystem_key_path(), validate_json=True)
        return True
    except Exception:
        return False

def _master_password_verify(password: str) -> bool:
    """Verify a password against the stored verifier hash.
    Uses hmac.compare_digest for constant-time comparison to prevent
    timing side-channel attacks (BUG-002 remediation)."""
    import hmac as _hmac
    path = _ecosystem_key_path()
    if not os.path.isfile(path):
        return False
    try:
        with open(path, 'r', encoding='utf-8') as f:
            cfg = json.load(f)
        salt = cfg['salt']
        expected = cfg['verifier']
        actual = _hashlib.pbkdf2_hmac(
            'sha256', password.encode('utf-8'), bytes.fromhex(salt), 600000
        ).hex()
        return _hmac.compare_digest(actual, expected)
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
            with open(path, encoding='utf-8') as f:
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
    # Atomic write with fsync to prevent corruption on USB pull
    tmp_path = path + '.tmp'
    with open(tmp_path, 'w', encoding='utf-8') as f:
        json.dump(conv, f, indent=2, ensure_ascii=False)
        f.flush()
        os.fsync(f.fileno())
    _safe_atomic_replace(tmp_path, path, validate_json=True)
    return conv


def _auto_title(messages: list) -> str:
    """Generate a title from the first user message (first 60 chars)."""
    for msg in messages:
        if msg.get('role') == 'user':
            text = msg.get('content', '').strip()
            return (text[:57] + '...') if len(text) > 57 else text
    return 'Conversation'


def _list_conversations(drive_dir: str) -> list:
    """Return list of conversation metadata dicts, sorted newest first.

    Chrono-Break resilience: if the system clock resets to 1970 (dead CMOS
    battery), new conversations get timestamps that sort below real ones.
    We use filesystem mtime as a fallback sort key when timestamps are
    suspiciously old (pre-2024).
    """
    conv_dir = _conversations_dir(drive_dir)
    convs = []
    for fname in os.listdir(conv_dir):
        if not fname.endswith('.json'):
            continue
        path = os.path.join(conv_dir, fname)
        try:
            with open(path, encoding='utf-8') as f:
                data = json.load(f)
            ts = data.get('last_message_at', data.get('updated_at', ''))
            # Chrono-Break guard: if timestamp is before 2024 (likely clock
            # reset to 1970), use file mtime as a more reliable signal
            sort_key = ts
            if not ts or ts < '2024':
                try:
                    mtime = os.path.getmtime(path)
                    mtime_iso = datetime.datetime.fromtimestamp(
                        mtime, tz=datetime.timezone.utc
                    ).strftime('%Y-%m-%dT%H:%M:%SZ')
                    sort_key = max(ts, mtime_iso) if ts else mtime_iso
                except OSError:
                    pass
            # Return metadata only (no messages array) for the list view
            convs.append({
                'id': data.get('id'),
                'title': data.get('title', 'Untitled'),
                'created_at': data.get('created_at'),
                'updated_at': data.get('updated_at'),
                'last_message_at': data.get('last_message_at', data.get('updated_at')),
                'message_count': data.get('message_count', 0),
                'encrypted': bool(data.get('encryptedMessages')),
                '_sort_key': sort_key,
            })
        except Exception:
            continue
    # Sort by _sort_key (chrono-break resilient), then remove internal field
    convs.sort(key=lambda c: c.get('_sort_key', ''), reverse=True)
    for c in convs:
        c.pop('_sort_key', None)
    return convs


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
        # Write atomically via temp file + fsync to prevent corruption
        tmp_path = path + '.tmp'
        with open(tmp_path, 'w', encoding='utf-8') as f:
            json.dump(manifest, f, indent=2)
            f.flush()
            os.fsync(f.fileno())
        _safe_atomic_replace(tmp_path, path, validate_json=True)
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
        headers = {'User-Agent': 'Mozilla/5.0'}
        request = urllib.request.Request(url, headers=headers)
        req = urllib.request.urlopen(request, timeout=60)
        try:
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
        finally:
            req.close()

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
        if self.command != 'HEAD':
            self.wfile.write(body)

    def _cors_headers(self):
        self.send_header('Access-Control-Allow-Origin', f'http://127.0.0.1:{PORT}')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, X-File-Path, X-Password, X-Upload-Session')

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

    def _require_eula(self, path: str) -> bool:
        """Check EULA acceptance. Returns True if request was BLOCKED (403 sent).
        Returns False if request should proceed normally."""
        if _eula_accepted:
            return False  # EULA accepted, proceed
        if path in _EULA_EXEMPT_ROUTES:
            return False  # Exempt route, proceed
        if path.startswith('/_system/ui/') or not path.startswith('/api/'):
            return False  # Static files and non-API routes always allowed
        # EULA not accepted — block with 403
        self._send_json(403, {
            'error': 'EULA not accepted',
            'message': 'You must accept the Terms of Service before using this device.'
        })
        return True

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
        if self.command == 'HEAD':
            return
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

        # ── EULA Gate ───────────────────────────────────────
        if self._require_eula(path):
            return

        # ── / → redirect to /_system/ui/ (where the web UI lives) ──
        if path in ('/', ''):
            self.send_response(302)
            self.send_header('Location', '/_system/ui/')
            self.end_headers()
            return

        # ── /api/eula/status ────────────────────────────────
        if path == '/api/eula/status':
            self._send_json(200, {'accepted': _eula_accepted})
            return

        # ── /api/heartbeat ──────────────────────────────────
        if path == '/api/heartbeat':
            global _last_heartbeat, _heartbeat_active
            with _heartbeat_lock:
                _last_heartbeat = _time.time()
                if not _heartbeat_active:
                    _heartbeat_active = True
                    _logger.info('First heartbeat received -- watchdog activated')
                else:
                    _logger.debug('Heartbeat received (watchdog reset)')
            self._send_json(200, {'ok': True})
            return

        # ── /api/comms/status ────────────────────────────────
        if path == '/api/comms/status':
            if _comms_manager:
                status = _comms_manager.get_status()
                status['store_unlocked'] = _comms_manager.is_store_unlocked()
                status['initializing'] = False
                self._send_json(200, status)
            else:
                # COMMS subsystem not yet initialized — server is still
                # starting up. The 'initializing' flag tells the UI to show
                # a "loading" screen instead of the misleading
                # "CONNECT A RADIO" screen.
                self._send_json(200, {
                    'initializing': True,
                    'scanning': True,
                    'radio_silence': False,
                    'store_unlocked': False,
                    'serial': {'connected': False, 'port': None, 'node_id': None,
                               'nodes_seen': 0, 'tx_queue_depth': 0},
                    'dispatch': {'enabled': False, 'role': 'off', 'channel': 1,
                                 'active_job': False, 'queue_depth': 0, 'stats': {}},
                })
            return

        # ── /api/comms/messages ──────────────────────────────
        if path == '/api/comms/messages':
            try:
                since_id = int(qs.get('since_id', ['0'])[0])
            except (ValueError, TypeError):
                since_id = 0
            if _comms_manager:
                locked = not _comms_manager.is_store_unlocked()
                self._send_json(200, {
                    'messages': _comms_manager.get_messages(since_id),
                    'locked': locked,
                })
            else:
                self._send_json(200, {'messages': [], 'locked': True})
            return

        # ── /api/comms/provision/status ─────────────────────
        if path == '/api/comms/provision/status':
            if _comms_manager:
                self._send_json(200, _comms_manager.get_provisioning_status())
            else:
                self._send_json(200, {
                    'state': 'unprovisioned',
                    'radio_connected': False,
                    'qr_available': False,
                })
            return

        # ── /api/status ─────────────────────────────────────
        if path == '/api/status':
            content_size = 0
            try:
                free = shutil.disk_usage(DRIVE_DIR).free
            except OSError:
                free = 0
            # Read version from config.json
            version = '1.0.0'
            edition = 'standard'
            try:
                cfg_path = os.path.join(DRIVE_DIR, '_system', 'config.json')
                with open(cfg_path, encoding='utf-8') as f:
                    cfg = json.load(f)
                version = cfg.get('app', {}).get('version', version)
                edition = cfg.get('app', {}).get('edition', edition)
            except Exception:
                pass
            # Live hardware detection (never trust stale files)
            from hardware import get_hardware_info
            hw = get_hardware_info()

            self._send_json(200, {
                'status': 'ok',
                'version': version,
                'edition': edition,
                'content_size_bytes': content_size,
                'free_bytes': free,
                'engine': {
                    'aiDisabled': hw['ai_disabled'],
                    'aiDisabledReason': hw['ai_disabled_reason'],
                    'detectedRamGB': hw['ram_gb'],
                    'gpuName': hw['gpu_name'],
                }
            })
            return

        # ── /api/update/check ────────────────────────────────
        # Fetches remote manifest and compares versions.
        if path == '/api/update/check':
            global _update_state
            try:
                # Read current version
                current_version = '1.0.0'
                try:
                    cfg_path = os.path.join(DRIVE_DIR, '_system', 'config.json')
                    with open(cfg_path, encoding='utf-8') as f:
                        cfg = json.load(f)
                    current_version = cfg.get('app', {}).get('version', current_version)
                except Exception:
                    pass

                # Check if already staged
                staging_manifest = os.path.join(DRIVE_DIR, '_system', '_update_staging', 'update_manifest.json')
                if os.path.isfile(staging_manifest):
                    try:
                        with open(staging_manifest, encoding='utf-8') as f:
                            sm = json.load(f)
                        with _update_lock:
                            _update_state = {
                                'state': 'staged',
                                'progress': 0,
                                'total': 0,
                                'remote_version': sm.get('version'),
                                'changelog': sm.get('changelog'),
                                'error': None,
                            }
                        self._send_json(200, {
                            'current_version': current_version,
                            'latest_version': sm.get('version'),
                            'update_available': False,
                            'update_staged': True,
                            'changelog': sm.get('changelog'),
                        })
                        return
                    except Exception:
                        pass

                # Fetch remote manifest
                req = urllib.request.Request(_UPDATE_MANIFEST_URL, headers={
                    'User-Agent': f'BlackoutDrive/{current_version}',
                })
                with urllib.request.urlopen(req, timeout=15) as resp:
                    remote = json.loads(resp.read().decode('utf-8'))

                latest = remote.get('latest_version', '0.0.0')
                # Simple version comparison (semver tuple)
                def _parse_ver(v):
                    parts = v.split('.')
                    return tuple(int(p) for p in parts[:3])

                has_update = _parse_ver(latest) > _parse_ver(current_version)

                self._send_json(200, {
                    'current_version': current_version,
                    'latest_version': latest,
                    'update_available': has_update,
                    'update_staged': False,
                    'changelog': remote.get('changelog', ''),
                    'download_size': remote.get('packages', {}).get('core', {}).get('size_bytes', 0),
                })
            except Exception as e:
                self._send_json(200, {
                    'current_version': current_version,
                    'latest_version': None,
                    'update_available': False,
                    'update_staged': False,
                    'error': str(e),
                })
            return

        # ── /api/update/status ───────────────────────────────
        if path == '/api/update/status':
            with _update_lock:
                state_copy = dict(_update_state)
            self._send_json(200, state_copy)
            return

        # ── /api/manifest ────────────────────────────────────
        if path == '/api/manifest':
            mf_path = os.path.join(DRIVE_DIR, '_system', 'content', 'manifest.json')
            if not os.path.isfile(mf_path):
                self._send_json(404, {'error': 'manifest not found'})
                return
            with open(mf_path, encoding='utf-8') as f:
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
        # List library bookmarks — references to workspace files
        if path == '/api/user-files':
            IMAGE_EXTS = {'.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.ico', '.tiff', '.tif'}
            TEXT_EXTS = {'.txt', '.md'}
            data = _load_bookmarks()
            files = []
            stale_ids = []  # Track stale bookmarks for auto-cleanup

            for bm in data.get('bookmarks', []):
                bm_source = bm.get('source', 'unlocked')
                bm_path = bm.get('path', '')
                bm_id = bm.get('id', '')
                filename = os.path.basename(bm_path)
                ext = os.path.splitext(filename)[1].lower()

                # Resolve actual file to check existence and get size
                if bm_source == 'unlocked':
                    parts = [p for p in bm_path.split('/') if p and p not in ('.', '..')]
                    if not parts:
                        continue
                    actual_path = os.path.join(_unlocked_dir(), *parts)
                    if not os.path.isfile(actual_path):
                        stale_ids.append(bm_id)
                        continue
                    try:
                        size = os.path.getsize(actual_path)
                    except OSError:
                        size = 0
                elif bm_source == 'locked':
                    # For locked files, we can't easily get size without decrypting
                    # but we can check if the bookmark path exists in the vault metadata
                    size = bm.get('size', 0)
                    # We trust that it exists — stale locked bookmarks are cleaned
                    # when the vault file is deleted
                else:
                    continue

                # Determine file type
                if ext == '.pdf':
                    ftype = 'pdf'
                elif ext == '.epub':
                    ftype = 'epub'
                elif ext == '.csv':
                    ftype = 'csv'
                elif ext in TEXT_EXTS:
                    ftype = 'text'
                elif ext in IMAGE_EXTS:
                    ftype = 'image'
                else:
                    ftype = 'file'

                display_name = os.path.splitext(filename)[0].replace('_', ' ').replace('-', ' ')
                files.append({
                    'id': bm_id,
                    'name': display_name,
                    'path': bm_path,
                    'source': bm_source,
                    'type': ftype,
                    'size': size,
                    'readable': ext in TEXT_EXTS or ext in ('.epub', '.pdf', '.csv') or ext in IMAGE_EXTS,
                    'added': bm.get('added', ''),
                })

            # Auto-prune stale bookmarks (unlocked files that were deleted)
            if stale_ids:
                data['bookmarks'] = [b for b in data['bookmarks'] if b.get('id') not in stale_ids]
                _save_bookmarks(data)
                _logger.info(f'Auto-pruned {len(stale_ids)} stale library bookmark(s)')

            self._send_json(200, {
                'files': files,
                'count': len(files),
            })
            return

        # ── /api/master-password/status ────────────────────────
        if path == '/api/master-password/status':
            self._send_json(200, {'established': _is_master_password_set()})
            return

        # ── /api/master-password/hint ─────────────────────────
        if path == '/api/master-password/hint':
            hint = ''
            try:
                kp = _ecosystem_key_path()
                if os.path.isfile(kp):
                    with open(kp, encoding='utf-8') as f:
                        cfg = json.load(f)
                    hint = cfg.get('hint', '')
            except Exception:
                pass
            self._send_json(200, {'hint': hint, 'hasHint': bool(hint)})
            return

        # ── /api/files/export ──────────────────────────────────
        # Stream a ZIP of files for download. Supports both locked and unlocked.
        # Query params:
        #   type=locked|unlocked (required)
        #   path=folder/name (optional — export subfolder; omit for entire root)
        # For locked exports, X-Password header is required.
        if path == '/api/files/export':
            export_type = (qs.get('type', [''])[0]).strip()
            export_path = (qs.get('path', [''])[0]).strip().strip('/')
            if export_type not in ('locked', 'unlocked'):
                self._send_json(400, {'error': 'type param must be "locked" or "unlocked"'})
                return

            if export_type == 'locked':
                pw = self.headers.get('X-Password', '')
                if not pw:
                    self._send_json(401, {'error': 'X-Password header required'})
                    return
                if not _master_password_verify(pw):
                    self._send_json(403, {'error': 'Wrong password'})
                    return
                try:
                    manifest = _vault_load_manifest(pw)
                except ValueError as e:
                    self._send_json(500, {'error': str(e)})
                    return

                # Collect all files under export_path
                matched = []
                for uid, info in manifest.get('files', {}).items():
                    fpath = info['path']
                    if export_path:
                        if fpath == export_path or fpath.startswith(export_path + '/'):
                            matched.append((uid, fpath, info))
                    else:
                        matched.append((uid, fpath, info))

                if not matched:
                    self._send_json(404, {'error': 'No files found at that path'})
                    return

                # Build ZIP in memory — stream-decrypt each file into the ZIP.
                # Uses zf.open() to write decrypted chunks directly into ZIP entries
                # without loading entire files into RAM. Peak memory: ~128KB per file
                # regardless of file size (OOM-safe for multi-GB vault exports).
                zip_buffer = io.BytesIO()
                with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zf:
                    for uid, fpath, info in matched:
                        bkv_path = os.path.join(_locked_dir(), uid + '.bkv')
                        if not os.path.isfile(bkv_path):
                            continue
                        try:
                            header, file_size, chunks = _decrypt_to_stream(bkv_path, pw)
                            # Stream decrypted chunks directly into the ZIP entry —
                            # never holds more than one 64KB chunk in memory at a time
                            with zf.open(fpath, 'w') as entry:
                                for chunk in chunks:
                                    entry.write(chunk)
                        except Exception as e:
                            _logger.warning("Export: failed to decrypt %s: %s", fpath, e)

                zip_data = zip_buffer.getvalue()
                zip_name = (export_path.replace('/', '_') if export_path else 'Locked_Vault') + '.zip'

            else:
                # Unlocked export — read files from disk
                base = os.path.abspath(_unlocked_dir())
                target = os.path.join(base, export_path) if export_path else base
                target = os.path.abspath(target)
                if not target.startswith(base):
                    self._send_json(403, {'error': 'Path traversal blocked'})
                    return

                if os.path.isfile(target):
                    # Single file export as ZIP
                    file_list = [(target, os.path.basename(target))]
                elif os.path.isdir(target):
                    file_list = []
                    for dirpath, dirnames, filenames in os.walk(target):
                        # Skip hidden dirs
                        dirnames[:] = [d for d in dirnames if not d.startswith('.')]
                        for fname in filenames:
                            if fname.startswith('.'):
                                continue
                            abs_file = os.path.join(dirpath, fname)
                            rel = os.path.relpath(abs_file, target)
                            file_list.append((abs_file, rel.replace('\\', '/')))
                else:
                    self._send_json(404, {'error': 'Path not found'})
                    return

                if not file_list:
                    self._send_json(404, {'error': 'No files found at that path'})
                    return

                zip_buffer = io.BytesIO()
                with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zf:
                    for abs_file, arc_name in file_list:
                        try:
                            zf.write(abs_file, arc_name)
                        except Exception as e:
                            _logger.warning("Export: failed to add %s: %s", arc_name, e)

                zip_data = zip_buffer.getvalue()
                zip_name = (export_path.replace('/', '_') if export_path else 'Unlocked_Files') + '.zip'

            # Send the ZIP
            self.send_response(200)
            self.send_header('Content-Type', 'application/zip')
            self.send_header('Content-Length', str(len(zip_data)))
            self.send_header('Content-Disposition', f'attachment; filename="{zip_name}"')
            self.end_headers()
            self.wfile.write(zip_data)
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
                # Locked tree uses vault manifest (1:1 model)
                pw = self.headers.get('X-Password', '')
                if not pw:
                    self._send_json(401, {'error': 'X-Password header required'})
                    return
                try:
                    manifest = _vault_load_manifest(pw)
                except ValueError:
                    self._send_json(403, {'error': 'Wrong password'})
                    return
                target_rel = sub_path[len('locked'):].strip('/')
                tree = _vault_build_tree(manifest, target_rel)
                self._send_json(200, {'tree': tree, 'path': sub_path})
                return
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
        # List locked storage via encrypted vault manifest (1:1 model)
        if path == '/api/files/locked':
            sub_path = (qs.get('path', [''])[0]).strip()
            pw = self.headers.get('X-Password', '')
            if not pw:
                self._send_json(401, {'error': 'X-Password header required'})
                return
            if not _master_password_verify(pw):
                self._send_json(403, {'error': 'Wrong password'})
                return
            try:
                manifest = _vault_load_manifest(pw)
            except ValueError as e:
                self._send_json(500, {'error': str(e)})
                return
            files = _vault_list_dir(manifest, sub_path)
            # Strip internal _uuid from response
            clean = []
            for f in files:
                entry = {k: v for k, v in f.items() if not k.startswith('_')}
                clean.append(entry)
            self._send_json(200, {'files': clean, 'count': len(clean), 'path': sub_path})
            return

        # ── /api/files/locked/<path> ──────────────────────────
        # Serve a locked file by decrypting in memory (zero temp writes)
        if path.startswith('/api/files/locked/'):
            rel_path = urllib.parse.unquote(path[len('/api/files/locked/'):])
            # Skip sub-API routes
            if rel_path.startswith(('upload', 'decrypt', 'view')):
                pass  # Fall through to POST handlers below
            else:
                pw = self.headers.get('X-Password', '')
                if not pw:
                    self._send_json(401, {'error': 'X-Password header required'})
                    return
                parts = [p for p in rel_path.split('/') if p and p not in ('.', '..')]
                if not parts:
                    self._send_json(400, {'error': 'Invalid file path'})
                    return
                filepath = '/'.join(parts)
                try:
                    manifest = _vault_load_manifest(pw)
                except ValueError:
                    self._send_json(403, {'error': 'Wrong password'})
                    return
                uid = _vault_find_uuid(manifest, filepath)
                if not uid:
                    self._send_json(404, {'error': 'File not found in vault'})
                    return
                bkv_path = os.path.join(_locked_dir(), uid + '.bkv')
                if not os.path.isfile(bkv_path):
                    self._send_json(404, {'error': 'Encrypted file missing from disk'})
                    return
                try:
                    header, file_size, chunks = _decrypt_to_stream(bkv_path, pw)
                except ValueError as e:
                    self._send_json(403, {'error': str(e)})
                    return
                orig_name = header.get('name', parts[-1])
                ctype = mimetypes.guess_type(orig_name)[0] or 'application/octet-stream'
                self.send_response(200)
                self.send_header('Content-Type', ctype)
                if file_size > 0:
                    self.send_header('Content-Length', str(file_size))
                # RFC 5987: percent-encode non-ASCII filename for Content-Disposition
                safe_name = orig_name.encode('ascii', 'replace').decode('ascii')
                encoded_name = urllib.parse.quote(orig_name, safe='')
                self.send_header('Content-Disposition',
                    f"inline; filename=\"{safe_name}\"; filename*=UTF-8''{encoded_name}")
                self.end_headers()
                if self.command != 'HEAD':
                    # Stream decrypted data in chunks — O(1) memory for large files
                    for chunk in chunks:
                        self.wfile.write(chunk)
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
                file_size = os.path.getsize(fpath)
                # Use filename basename for Content-Disposition (not the full path)
                disp_name = parts[-1] if parts else fname
                self.send_response(200)
                self.send_header('Content-Type', ctype)
                self.send_header('Content-Length', str(file_size))
                # RFC 5987: percent-encode non-ASCII filename for Content-Disposition
                safe_disp = disp_name.encode('ascii', 'replace').decode('ascii')
                encoded_disp = urllib.parse.quote(disp_name, safe='')
                self.send_header('Content-Disposition',
                    f"inline; filename=\"{safe_disp}\"; filename*=UTF-8''{encoded_disp}")
                self.end_headers()
                if self.command != 'HEAD':
                    # Stream in 64KB chunks to prevent OOM on large files
                    # (FRAG-003 remediation — locked files already stream)
                    with open(fpath, 'rb') as f:
                        while True:
                            chunk = f.read(65536)
                            if not chunk:
                                break
                            self.wfile.write(chunk)
            except Exception as e:
                self._send_json(500, {'error': str(e)})
            return

        # (Temp session endpoints removed — 1:1 model decrypts in memory)


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

        # ── /api/settings/tier/status ──────────────────────────
        # GET: poll hot-swap progress (FRAG-006 remediation)
        if path == '/api/settings/tier/status':
            self._send_json(200, dict(_hot_swap_status))
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

            # User content (lives at USER_DATA/unlocked/ and USER_DATA/locked/)
            user_dirs = [os.path.join(USER_DATA_DIR, 'unlocked'), os.path.join(USER_DATA_DIR, 'locked')]
            user_files = 0
            user_bytes = 0
            for udir in user_dirs:
                if os.path.isdir(udir):
                    for dp, _, fnames in os.walk(udir):
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
                with open(os.path.join(DRIVE_DIR, '_system', 'config.json'), encoding='utf-8') as f:
                    cfg = json.load(f)
                version = cfg.get('app', {}).get('version', version)
                edition = cfg.get('app', {}).get('edition', edition)
            except Exception:
                pass

            # Live hardware detection + model tier info
            from hardware import get_hardware_info
            hw = get_hardware_info()

            # Read active_tier.json for model-level info (tier, modelKey, etc.)
            # but override hardware fields with live detection
            active_tier = None
            tier_path = os.path.join(DRIVE_DIR, '_system', 'data', 'active_tier.json')
            if os.path.isfile(tier_path):
                try:
                    with open(tier_path, encoding='utf-8') as f:
                        active_tier = json.load(f)
                except Exception:
                    pass

            # Build engine info: model data from file + hardware from live detection
            engine_info = dict(active_tier) if active_tier else {}
            engine_info['aiDisabled'] = hw['ai_disabled']
            engine_info['aiDisabledReason'] = hw['ai_disabled_reason']
            engine_info['detectedRamGB'] = hw['ram_gb']
            engine_info['hasGpu'] = hw['has_gpu']
            engine_info['gpuName'] = hw['gpu_name']

            # Ollama health check (non-blocking, 2s timeout per request)
            # SKIP when AI is disabled — Ollama was never started, so probing
            # it just wastes ~4 seconds (2 requests × 2s timeout each).
            ollama_running = False
            ollama_model_loaded = False
            ollama_model_name = None
            ollama_version = None
            if not hw['ai_disabled']:
                # Read Ollama port from config.json (single source of truth)
                ollama_port = 11434
                try:
                    cfg_path_d = os.path.join(DRIVE_DIR, '_system', 'config.json')
                    with open(cfg_path_d, encoding='utf-8') as f_d:
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
                'engine': engine_info,
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

        # ── EULA Gate ───────────────────────────────────────
        if self._require_eula(path):
            return

        # ── /api/eula/accept ────────────────────────────────
        if path == '/api/eula/accept':
            global _eula_accepted
            _eula_accepted = True
            def _set_eula(cfg):
                cfg['eula_accepted'] = True
            try:
                _read_modify_write_config(_set_eula)
            except Exception as e:
                _logger.error('Failed to persist EULA acceptance: %s', e)
            self._send_json(200, {'ok': True, 'accepted': True})
            return

        # ── /api/system/export-archive ────────────────────────
        # Exports the entire Blackout Drive state (frontend config, conversations,
        # locked vault, and unlocked files) as a single encrypted .blackout archive.
        if path == '/api/system/export-archive':
            try:
                raw = self.rfile.read(int(self.headers.get('Content-Length', 0)))
                body = json.loads(raw.decode('utf-8')) if raw else {}
            except Exception:
                self._send_json(400, {'error': 'Invalid JSON'})
                return

            pw = self.headers.get('X-Password', '')
            if not pw or not _master_password_verify(pw):
                self._send_json(403, {'error': 'Wrong master password'})
                return

            dest_dir = _pick_export_directory()
            if not dest_dir:
                self._send_json(200, {'ok': False, 'cancelled': True})
                return


            try:
                with tempfile.TemporaryDirectory() as td:
                    # 1. Save frontend state
                    state_path = os.path.join(td, 'frontend_state.json')
                    with open(state_path, 'w', encoding='utf-8') as f:
                        json.dump(body.get('frontend_state', {}), f)
                    
                    # 2. Copy USER_DATA_DIR
                    data_dst = os.path.join(td, 'USER_DATA')
                    shutil.copytree(USER_DATA_DIR, data_dst, dirs_exist_ok=True)
                    
                    # 3. Zip
                    archive_name = 'BlackoutDrive_Archive_' + datetime.datetime.now().strftime('%Y-%m-%d_%H-%M-%S')
                    zip_path = os.path.join(td, 'archive')
                    shutil.make_archive(zip_path, 'zip', td)
                    zip_file = zip_path + '.zip'
                    
                    # 4. Encrypt (collision-safe)
                    dest = _safe_dest_path(os.path.join(dest_dir, archive_name + '.blackout'))
                    def _zip_chunks():
                        with open(zip_file, 'rb') as f:
                            while True:
                                c = f.read(65536)
                                if not c: break
                                yield c
                    ok, err = _encrypt_stream(_zip_chunks(), dest, pw, archive_name + '.zip', os.path.getsize(zip_file))
                    if not ok:
                        raise Exception(err)
                        
                self._send_json(200, {'ok': True, 'destination': dest_dir})
            except Exception as e:
                _logger.error("Master Archive export failed: %s", e)
                self._send_json(500, {'error': str(e)})
            return

        # ── /api/system/import-archive ────────────────────────
        if path == '/api/system/import-archive':
            pw = self.headers.get('X-Password', '')
            if not pw or not _master_password_verify(pw):
                self._send_json(403, {'error': 'Wrong master password'})
                return
            
            content_length = int(self.headers.get('Content-Length', 0))
            if content_length == 0:
                self._send_json(400, {'error': 'Empty request'})
                return

            try:
                with tempfile.TemporaryDirectory() as td:
                    # 1. Stream the encrypted body to a temp file
                    enc_path = os.path.join(td, 'archive.blackout')
                    with open(enc_path, 'wb') as f:
                        remaining = content_length
                        while remaining > 0:
                            chunk = self.rfile.read(min(65536, remaining))
                            if not chunk: break
                            f.write(chunk)
                            remaining -= len(chunk)

                    # 2. Decrypt the archive
                    zip_path = os.path.join(td, 'archive.zip')
                    header, file_size, chunks = _decrypt_to_stream(enc_path, pw)
                    with open(zip_path, 'wb') as f:
                        for chunk in chunks:
                            f.write(chunk)

                    # 3. Unzip
                    extract_dir = os.path.join(td, 'extracted')
                    shutil.unpack_archive(zip_path, extract_dir)

                    # 4. Restore USER_DATA
                    src_data = os.path.join(extract_dir, 'USER_DATA')
                    if os.path.exists(src_data):
                        # Wipe current USER_DATA_DIR contents safely (except config maybe? No, restore everything)
                        if os.path.exists(USER_DATA_DIR):
                            shutil.rmtree(USER_DATA_DIR)
                        shutil.copytree(src_data, USER_DATA_DIR)

                    # 5. Read frontend state
                    state_path = os.path.join(extract_dir, 'frontend_state.json')
                    frontend_state = {}
                    if os.path.exists(state_path):
                        with open(state_path, 'r', encoding='utf-8') as f:
                            frontend_state = json.load(f)

                self._send_json(200, {'ok': True, 'frontend_state': frontend_state})
            except Exception as e:
                _logger.error("Master Archive import failed: %s", e)
                self._send_json(500, {'error': str(e)})
            return

        # ── /api/files/export-to ──────────────────────────────
        # Opens a native OS directory picker, then copies the requested
        # file or folder to the chosen location. Works cross-platform.
        # Body: { "type": "locked"|"unlocked", "path": "relative/path" }
        # For locked files, requires X-Password header.
        if path == '/api/files/export-to':
            try:
                raw = self.rfile.read(int(self.headers.get('Content-Length', 0)))
                body = json.loads(raw.decode('utf-8')) if raw else {}
            except Exception:
                body = {}

            export_type = body.get('type', '').strip()
            export_path = body.get('path', '').strip().strip('/')
            should_encrypt = body.get('encrypt', False)

            if export_type not in ('locked', 'unlocked'):
                self._send_json(400, {'error': 'type must be "locked" or "unlocked"'})
                return

            pw = self.headers.get('X-Password', '')
            if (export_type == 'locked' or should_encrypt) and not pw:
                self._send_json(401, {'error': 'X-Password header required for encrypted exports'})
                return
            if (export_type == 'locked' or should_encrypt) and not _master_password_verify(pw):
                self._send_json(403, {'error': 'Wrong password'})
                return

            # Open native directory picker dialog
            dest_dir = _pick_export_directory()
            if not dest_dir:
                self._send_json(200, {'ok': False, 'cancelled': True})
                return

            try:
                if export_type == 'unlocked':
                    base = os.path.abspath(_unlocked_dir())
                    source = os.path.join(base, export_path) if export_path else base
                    source = os.path.abspath(source)
                    if not source.startswith(base):
                        self._send_json(403, {'error': 'Path traversal blocked'})
                        return

                    if os.path.isfile(source):
                        if should_encrypt:
                            dest = _safe_dest_path(os.path.join(dest_dir, os.path.basename(source) + '.bkv'))
                            def _file_chunks():
                                with open(source, 'rb') as f:
                                    while True:
                                        c = f.read(65536)
                                        if not c: break
                                        yield c
                            _encrypt_stream(_file_chunks(), dest, pw, os.path.basename(source), os.path.getsize(source))
                        else:
                            dest = _safe_dest_path(os.path.join(dest_dir, os.path.basename(source)))
                            shutil.copy2(source, dest)
                        self._send_json(200, {'ok': True, 'exported': os.path.basename(source),
                                              'destination': dest_dir, 'count': 1})
                    elif os.path.isdir(source):
                        folder_name = os.path.basename(source.rstrip('/')) or 'Unlocked_Files'
                        
                        if should_encrypt:
                            with tempfile.TemporaryDirectory() as td:
                                zip_path = os.path.join(td, folder_name)
                                shutil.make_archive(zip_path, 'zip', source)
                                zip_file = zip_path + '.zip'
                                dest = _safe_dest_path(os.path.join(dest_dir, folder_name + '.zip.bkv'))
                                def _zip_chunks():
                                    with open(zip_file, 'rb') as f:
                                        while True:
                                            c = f.read(65536)
                                            if not c: break
                                            yield c
                                _encrypt_stream(_zip_chunks(), dest, pw, folder_name + '.zip', os.path.getsize(zip_file))
                            self._send_json(200, {'ok': True, 'exported': folder_name,
                                                  'destination': dest_dir, 'count': 1})
                        else:
                            dest = _safe_dest_path(os.path.join(dest_dir, folder_name))
                            shutil.copytree(source, dest, dirs_exist_ok=False)
                            count = sum(len(f) for _, _, f in os.walk(dest))
                            self._send_json(200, {'ok': True, 'exported': folder_name,
                                                  'destination': dest_dir, 'count': count})
                    else:
                        self._send_json(404, {'error': 'File or folder not found'})

                elif export_type == 'locked':
                    pw = self.headers.get('X-Password', '')
                    if not pw:
                        self._send_json(401, {'error': 'X-Password header required'})
                        return
                    if not _master_password_verify(pw):
                        self._send_json(403, {'error': 'Wrong password'})
                        return

                    manifest = _vault_load_manifest(pw)
                    matched = []
                    for uid, info in manifest.get('files', {}).items():
                        fpath = info['path']
                        if export_path:
                            if fpath == export_path or fpath.startswith(export_path + '/'):
                                matched.append((uid, fpath, info))
                        else:
                            matched.append((uid, fpath, info))

                    if not matched:
                        self._send_json(404, {'error': 'No files found at that path'})
                        return

                    exported = 0
                    for uid, fpath, info in matched:
                        bkv_path = os.path.join(_locked_dir(), uid + '.bkv')
                        if not os.path.isfile(bkv_path):
                            _logger.warning("Export-to: .bkv file not found for uid=%s path=%s", uid, bkv_path)
                            continue
                        try:
                            if should_encrypt:
                                # Export raw .bkv file, rename to original.ext.bkv
                                out_path = _safe_dest_path(os.path.join(dest_dir, fpath + '.bkv'))
                                os.makedirs(os.path.dirname(out_path), exist_ok=True)
                                # Use shutil.copy (not copy2) — copy2 tries to preserve
                                # metadata which can fail on cross-filesystem copies
                                # (e.g. USB/exFAT → APFS)
                                shutil.copy(bkv_path, out_path)
                                exported += 1
                            else:
                                header, file_size, chunks = _decrypt_to_stream(bkv_path, pw)
                                out_path = _safe_dest_path(os.path.join(dest_dir, fpath))
                                os.makedirs(os.path.dirname(out_path), exist_ok=True)
                                with open(out_path, 'wb') as out_f:
                                    for chunk in chunks:
                                        out_f.write(chunk)
                                exported += 1
                        except Exception as e:
                            _logger.warning("Export-to: failed on %s (uid=%s): %s", fpath, uid, e, exc_info=True)

                    name = export_path.split('/')[-1] if export_path else 'Locked Vault'
                    self._send_json(200, {'ok': True, 'exported': name,
                                          'destination': dest_dir, 'count': exported})

            except Exception as e:
                _logger.error("Export-to failed: %s", e)
                self._send_json(500, {'error': str(e)})
            return

        # ── /api/update/download ─────────────────────────────
        # Downloads and stages the software update in a background thread.
        if path == '/api/update/download':
            global _update_state

            with _update_lock:
                if _update_state['state'] in ('downloading',):
                    self._send_json(409, {'error': 'Download already in progress'})
                    return
                _update_state = {
                    'state': 'downloading',
                    'progress': 0,
                    'total': 0,
                    'remote_version': None,
                    'changelog': None,
                    'error': None,
                }

            def _do_update_download():
                try:
                    # 1. Fetch the remote manifest
                    current_version = '1.0.0'
                    try:
                        cfg_path = os.path.join(DRIVE_DIR, '_system', 'config.json')
                        with open(cfg_path, encoding='utf-8') as f:
                            cfg = json.load(f)
                        current_version = cfg.get('app', {}).get('version', current_version)
                    except Exception:
                        pass

                    req = urllib.request.Request(_UPDATE_MANIFEST_URL, headers={
                        'User-Agent': f'BlackoutDrive/{current_version}',
                    })
                    with urllib.request.urlopen(req, timeout=15) as resp:
                        remote = json.loads(resp.read().decode('utf-8'))

                    latest = remote.get('latest_version', '0.0.0')
                    core_pkg = remote.get('packages', {}).get('core', {})
                    pkg_url = core_pkg.get('url')
                    pkg_sha = core_pkg.get('sha256', '')
                    pkg_size = core_pkg.get('size_bytes', 0)
                    changelog = remote.get('changelog', '')

                    if not pkg_url:
                        raise ValueError('No download URL in remote manifest')

                    with _update_lock:
                        _update_state['total'] = pkg_size
                        _update_state['remote_version'] = latest
                        _update_state['changelog'] = changelog

                    # 2. Download the package
                    staging_dir = os.path.join(DRIVE_DIR, '_system', '_update_staging')
                    os.makedirs(staging_dir, exist_ok=True)
                    zip_path = os.path.join(staging_dir, 'update.zip')

                    dl_req = urllib.request.Request(pkg_url, headers={
                        'User-Agent': f'BlackoutDrive/{current_version}',
                    })
                    sha_hash = hashlib.sha256()
                    downloaded = 0

                    with urllib.request.urlopen(dl_req, timeout=120) as resp:
                        with open(zip_path, 'wb') as f:
                            while True:
                                chunk = resp.read(65536)  # 64KB chunks
                                if not chunk:
                                    break
                                f.write(chunk)
                                sha_hash.update(chunk)
                                downloaded += len(chunk)
                                with _update_lock:
                                    _update_state['progress'] = downloaded

                    # 3. Verify SHA-256
                    actual_sha = sha_hash.hexdigest()
                    if pkg_sha and actual_sha != pkg_sha:
                        raise ValueError(
                            f'SHA-256 mismatch: expected {pkg_sha[:16]}..., '
                            f'got {actual_sha[:16]}...'
                        )

                    # 4. Extract ZIP into staging directory
                    with zipfile.ZipFile(zip_path, 'r') as zf:
                        zf.extractall(staging_dir)
                    os.remove(zip_path)  # Clean up the zip

                    # 5. Write the staging manifest (launcher reads this on boot)
                    staging_manifest = {
                        'version': latest,
                        'changelog': changelog,
                        'sha256': actual_sha,
                        'applied': False,
                        'staged_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                    }
                    manifest_path = os.path.join(staging_dir, 'update_manifest.json')
                    with open(manifest_path, 'w', encoding='utf-8') as f:
                        json.dump(staging_manifest, f, indent=2)

                    with _update_lock:
                        _update_state['state'] = 'staged'

                    _logger.info(f'Update v{latest} staged successfully.')

                except Exception as e:
                    _logger.error(f'Update download failed: {e}')
                    # Clean up partial staging on failure
                    staging_dir = os.path.join(DRIVE_DIR, '_system', '_update_staging')
                    if os.path.isdir(staging_dir):
                        shutil.rmtree(staging_dir, ignore_errors=True)
                    with _update_lock:
                        _update_state['state'] = 'error'
                        _update_state['error'] = str(e)

            t = threading.Thread(target=_do_update_download, daemon=True)
            t.start()
            self._send_json(200, {'ok': True, 'message': 'Update download started'})
            return

        # ── /api/comms/unlock ────────────────────────────────
        if path == '/api/comms/unlock':
            # Brute-force protection (F-03) — same lockout as /verify
            locked_out, remaining = _check_pw_lockout()
            if locked_out:
                self._send_json(429, {'error': f'Too many attempts. Try again in {remaining}s', 'retry_after': remaining})
                return
            try:
                body = json.loads(self._read_body())
            except json.JSONDecodeError:
                self._send_json(400, {'error': 'Invalid JSON'})
                return
            password = body.get('password', '')
            if not password or not _master_password_verify(password):
                _record_pw_failure()
                self._send_json(403, {'error': 'Wrong password'})
                return
            _reset_pw_lockout()
            if _comms_manager:
                ok = _comms_manager.unlock_store(password)
                self._send_json(200, {'ok': ok})
            else:
                self._send_json(200, {'ok': False, 'error': 'COMMS not initialized'})
            return

        # ── /api/comms/lock ──────────────────────────────────
        # SECURITY NOTE (F-04): This endpoint is intentionally unauthenticated.
        # Requiring a password to lock would be circular. CORS restricts to
        # 127.0.0.1:{PORT}, and on a single-user air-gapped device, any local
        # process already has full disk access. Locking only wipes the key
        # from RAM — no data is destroyed.
        if path == '/api/comms/lock':
            if _comms_manager:
                _comms_manager.lock_store()
            self._send_json(200, {'ok': True})
            return

        # ── /api/open-drive-root ───────────────────────────────
        # Opens the drive root folder in the OS file manager.
        # Used by the COMMS "OPEN DRIVE FOLDER" button for driver install.
        if path == '/api/open-drive-root':
            import subprocess as _subprocess
            drive_root = os.path.dirname(os.path.dirname(_SYSTEM_DIR))
            try:
                if sys.platform == 'win32':
                    _subprocess.Popen(['explorer', drive_root])
                elif sys.platform == 'darwin':
                    _subprocess.Popen(['open', drive_root])
                else:
                    _subprocess.Popen(['xdg-open', drive_root])
                self._send_json(200, {'ok': True})
            except Exception as e:
                self._send_json(500, {'error': str(e)})
            return

        # ── /api/comms/send ────────────────────────────────────
        if path == '/api/comms/send':
            if not _comms_manager:
                self._send_json(503, {'error': 'COMMS subsystem not initialized'})
                return
            try:
                body = json.loads(self._read_body())
            except json.JSONDecodeError:
                self._send_json(400, {'error': 'invalid JSON'})
                return
            text = body.get('text', '').strip()
            channel = body.get('channel', 0)
            dest = body.get('dest', None)  # Optional DM target (hex node ID)
            if not text:
                self._send_json(400, {'error': 'text is required'})
                return
            status = _comms_manager.get_status()
            if not status['serial']['connected']:
                self._send_json(503, {'error': 'Radio not connected'})
                return
            if status['radio_silence']:
                self._send_json(403, {'error': 'Radio Silence is active'})
                return
            try:
                msg_id = _comms_manager.send_text(channel, text, dest=dest)
                self._send_json(200, {'ok': True, 'msg_id': msg_id})
            except Exception as e:
                self._send_json(500, {'error': str(e)})
            return

        # ── /api/rag/index ────────────────────────────────────────
        # Trigger indexing for a library/content file. Returns chunk count.
        if path == '/api/rag/index':
            try:
                body = json.loads(self._read_body())
            except json.JSONDecodeError:
                self._send_json(400, {'error': 'Invalid JSON'})
                return
            file_rel = body.get('file', '')
            force = body.get('force', False)
            if not file_rel:
                self._send_json(400, {'error': 'Missing "file" parameter'})
                return
            # Resolve against drive root (handles content/ → _system/content/ rewrite)
            file_abs = self._safe_path(file_rel)
            if not file_abs:
                self._send_json(403, {'error': 'Path traversal denied'})
                return
            # Import RAG engine (lazy — only when needed)
            try:
                from rag_engine import index_file, RAGSecurityError
            except ImportError as e:
                self._send_json(500, {'error': f'RAG engine not available: {e}'})
                return
            # Get embedding model and Ollama port from config
            # NOTE: Chat models (blackout-beacon/Qwen3) do NOT support /api/embed.
            # We use a dedicated lightweight embedding model (all-minilm, ~274MB).
            _rag_model = 'nomic-embed-text'
            _rag_port = 11434
            try:
                with open(_CONFIG_PATH, 'r', encoding='utf-8') as cf:
                    _rag_cfg = json.load(cf)
                    _rag_port = _rag_cfg.get('network', {}).get('ollamaPort', 11434)
            except Exception:
                pass
            try:
                result = index_file(file_abs, _rag_model, _rag_port, force=force)
                self._send_json(200, result)
            except RAGSecurityError as e:
                self._send_json(403, {'error': str(e)})
            except Exception as e:
                _logger.error('RAG index error: %s', e)
                self._send_json(500, {'error': str(e)})
            return

        # ── /api/rag/query ────────────────────────────────────────
        # Search a file's index for relevant chunks.
        if path == '/api/rag/query':
            try:
                body = json.loads(self._read_body())
            except json.JSONDecodeError:
                self._send_json(400, {'error': 'Invalid JSON'})
                return
            file_rel = body.get('file', '')
            question = body.get('question', '')
            if not file_rel or not question:
                self._send_json(400, {'error': 'Missing "file" or "question" parameter'})
                return
            file_abs = self._safe_path(file_rel)
            if not file_abs:
                self._send_json(403, {'error': 'Path traversal denied'})
                return
            try:
                from rag_engine import query_file
            except ImportError as e:
                self._send_json(500, {'error': f'RAG engine not available: {e}'})
                return
            _rag_model = 'nomic-embed-text'
            _rag_port = 11434
            try:
                with open(_CONFIG_PATH, 'r', encoding='utf-8') as cf:
                    _rag_cfg = json.load(cf)
                    _rag_port = _rag_cfg.get('network', {}).get('ollamaPort', 11434)
            except Exception:
                pass
            try:
                result = query_file(file_abs, question, _rag_model, _rag_port)
                self._send_json(200, result)
            except Exception as e:
                _logger.error('RAG query error: %s', e)
                self._send_json(500, {'error': str(e)})
            return

        # ── /api/comms/config ──────────────────────────────────
        if path == '/api/comms/config':
            try:
                body = json.loads(self._read_body())
            except json.JSONDecodeError:
                self._send_json(400, {'error': 'invalid JSON'})
                return
            # Update runtime settings
            if _comms_manager:
                # Radio Silence — server-side enforcement
                if 'radio_silence' in body:
                    _comms_manager.radio_silence = bool(body['radio_silence'])
                    _logger.info('Radio Silence set to %s', _comms_manager.radio_silence)
                # GPS Position Sharing — hardware-enforced via firmware admin command
                if 'gps_position' in body:
                    _comms_manager.set_gps_position(bool(body['gps_position']))
                    _logger.info('GPS Position Sharing set to %s', body['gps_position'])
                # Radio Telemetry — hardware-enforced via firmware admin command
                if 'radio_telemetry' in body:
                    _comms_manager.set_radio_telemetry(bool(body['radio_telemetry']))
                    _logger.info('Radio Telemetry set to %s', body['radio_telemetry'])
                # Manual basecamp position — operator-provided GPS fallback
                if 'basecamp_position' in body:
                    bp = body['basecamp_position']
                    if bp is None:
                        _comms_manager.set_basecamp_position(None)
                        _logger.info('Manual basecamp position cleared')
                    elif isinstance(bp, dict) and 'lat' in bp and 'lng' in bp:
                        lat = float(bp['lat'])
                        lng = float(bp['lng'])
                        if -90 <= lat <= 90 and -180 <= lng <= 180:
                            _comms_manager.set_basecamp_position(bp)
                            _logger.info('Manual basecamp position set: %.5f, %.5f', lat, lng)
                        else:
                            self._send_json(400, {'error': 'Invalid coordinates: lat must be -90..90, lng must be -180..180'})
                            return
                    else:
                        self._send_json(400, {'error': 'basecamp_position must be {lat, lng, alt} or null'})
                        return
                # Dispatch config
                _comms_manager.update_dispatch_config(body)
            # Persist COMMS settings to config.json (all emission controls + dispatch)
            # Uses atomic writer: Lock → read → modify → tmp → fsync → rename
            persist_keys = {k: body[k] for k in (
                'dispatch_enabled', 'dispatch_channel', 'dispatch_role',
                'radio_silence', 'gps_position', 'radio_telemetry',
            ) if k in body}
            # Basecamp position needs special handling (object or null)
            persist_bp = 'basecamp_position' in body
            if persist_keys or persist_bp:
                try:
                    def _apply_comms(cfg):
                        if 'comms' not in cfg:
                            cfg['comms'] = {}
                        cfg['comms'].update(persist_keys)
                        if persist_bp:
                            bp_val = body['basecamp_position']
                            if bp_val is None:
                                cfg['comms'].pop('basecamp_position', None)
                            else:
                                cfg['comms']['basecamp_position'] = {
                                    'lat': float(bp_val['lat']),
                                    'lng': float(bp_val['lng']),
                                    'alt': int(bp_val.get('alt', 0)),
                                }
                    _read_modify_write_config(_apply_comms)
                except Exception as e:
                    _logger.warning('Failed to persist comms config: %s', e)
            self._send_json(200, {'ok': True})
            return

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
            hint = (body.get('hint', '') or '').strip()[:100]
            if not password or len(password) < 8:
                self._send_json(400, {'error': 'Password must be at least 8 characters'})
                return
            if _is_master_password_set():
                self._send_json(409, {'error': 'Master password already set'})
                return
            if _master_password_setup(password, hint):
                self._send_json(200, {'ok': True})
            else:
                self._send_json(500, {'error': 'Failed to save password configuration'})
            return

        # ── POST /api/master-password/verify ──────────────────
        if path == '/api/master-password/verify':
            # Brute-force protection: disk-persisted exponential backoff (F-06)
            locked_out, remaining = _check_pw_lockout()
            if locked_out:
                self._send_json(429, {'error': f'Too many attempts. Try again in {remaining}s', 'retry_after': remaining})
                return
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
                _reset_pw_lockout()
                self._send_json(200, {'ok': True})
            else:
                _record_pw_failure()
                self._send_json(403, {'error': 'Wrong password'})
            return

        # (Moved to do_GET — frontend calls this as GET)

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
                        with open(fpath, 'r', encoding='utf-8') as f:
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
            # 4. Delete COMMS log (encrypted with old password key)
            # The canonical format is .bkv. Legacy code may have left .enc.
            for comms_ext in ('comms_log.bkv', 'comms_log.enc'):
                comms_log = os.path.join(USER_DATA_DIR, comms_ext)
                if os.path.isfile(comms_log):
                    os.remove(comms_log)
                    _logger.info('Password reset: deleted %s', comms_ext)
            # 4b. Delete COMMS provisioning artifacts (PSK encrypted with old key)
            for prov_file in ['comms_channel_key.bkv', 'comms_provisioned.json']:
                prov_path = os.path.join(USER_DATA_DIR, prov_file)
                if os.path.isfile(prov_path):
                    os.remove(prov_path)
                    _logger.info('Password reset: deleted orphaned %s', prov_file)
            # 5. Lock COMMS store in memory + invalidate vault manifest cache
            if _comms_manager:
                _comms_manager.lock_store()
            _vault_invalidate_cache()
            _logger.info(f'Master password reset: {deleted_convs} encrypted conversations, '
                 f'{deleted_files} locked files deleted')
            self._send_json(200, {
                'ok': True,
                'deleted_conversations': deleted_convs,
                'deleted_files': deleted_files
            })
            return

        # ── POST /api/comms/provision ───────────────────────
        # BUG-01 fix: Returns immediately. Provisioning runs in a
        # background thread. Frontend polls /api/comms/provision/status
        # to track progress.
        if path == '/api/comms/provision':
            # BUG-07 fix: enforce brute-force lockout
            locked_out, remaining = _check_pw_lockout()
            if locked_out:
                self._send_json(429, {'error': f'Too many attempts. Try again in {remaining}s', 'retry_after': remaining})
                return
            pw = self.headers.get('X-Password', '')
            if not pw:
                self._send_json(401, {'error': 'X-Password header required'})
                return
            if not _master_password_verify(pw):
                _record_pw_failure()
                self._send_json(403, {'error': 'Wrong master password'})
                return
            _reset_pw_lockout()
            if not _comms_manager:
                self._send_json(500, {'error': 'COMMS subsystem not initialized'})
                return
            result = _comms_manager.start_provisioning(pw)
            status_code = 200 if result.get('started') else 500
            self._send_json(status_code, result)
            return

        # ── POST /api/comms/provision/qr ────────────────────
        if path == '/api/comms/provision/qr':
            # BUG-07 fix: enforce brute-force lockout
            locked_out, remaining = _check_pw_lockout()
            if locked_out:
                self._send_json(429, {'error': f'Too many attempts. Try again in {remaining}s', 'retry_after': remaining})
                return
            pw = self.headers.get('X-Password', '')
            if not pw:
                self._send_json(401, {'error': 'X-Password header required'})
                return
            if not _master_password_verify(pw):
                _record_pw_failure()
                self._send_json(403, {'error': 'Wrong master password'})
                return
            _reset_pw_lockout()
            if not _comms_manager:
                self._send_json(500, {'error': 'COMMS subsystem not initialized'})
                return
            qr_url = _comms_manager.get_qr_url(pw)
            if qr_url:
                self._send_json(200, {'qr_url': qr_url})
            else:
                self._send_json(404, {'error': 'Radio not provisioned'})
            return

        # ── POST /api/comms/provision/clear ──────────────────
        # Frontend calls this after acknowledging a completed/failed
        # provisioning job to clear the job state.
        if path == '/api/comms/provision/clear':
            if _comms_manager:
                _comms_manager.clear_provisioning_job()
            self._send_json(200, {'ok': True})
            return

        # ── POST /api/comms/wipe ──────────────────────────────
        if path == '/api/comms/wipe':
            # Require master password for destructive operation
            pw = self.headers.get('X-Password', '')
            if not pw:
                self._send_json(401, {'error': 'X-Password header required'})
                return
            if not _master_password_verify(pw):
                self._send_json(403, {'error': 'Wrong master password'})
                return
            # Clean up comms log (canonical .bkv + legacy .enc orphan)
            for comms_ext in ('comms_log.bkv', 'comms_log.enc'):
                comms_log = os.path.join(USER_DATA_DIR, comms_ext)
                if os.path.isfile(comms_log):
                    os.remove(comms_log)
            if _comms_manager:
                _comms_manager.lock_store()  # This will force a new, empty log if reopened
            _logger.info('Comms log wiped successfully.')
            self._send_json(200, {'ok': True})
            return

        # ── POST /api/factory-wipe ────────────────────────────
        if path == '/api/factory-wipe':
            # Parse request body
            try:
                raw = self.rfile.read(int(self.headers.get('Content-Length', 0)))
                body = json.loads(raw.decode('utf-8')) if raw else {}
            except Exception:
                self._send_json(400, {'error': 'Invalid JSON'})
                return
            # Require explicit confirmation to prevent accidental triggers
            if body.get('confirm') != 'FACTORY_WIPE':
                self._send_json(400, {'error': 'Confirmation required: send {"confirm": "FACTORY_WIPE"}'})
                return
            try:
                import glob
                # 1. Delete all conversations
                conv_dir = _conversations_dir(DRIVE_DIR)
                if os.path.isdir(conv_dir):
                    for f in glob.glob(os.path.join(conv_dir, '*.json')):
                        os.remove(f)
                
                # 2. Delete all locked and unlocked files
                for d in ['locked', 'unlocked']:
                    dpath = os.path.join(USER_DATA_DIR, d)
                    if os.path.isdir(dpath):
                        for root, dirs, files in os.walk(dpath, topdown=False):
                            for name in files:
                                if name != 'README.txt':
                                    os.remove(os.path.join(root, name))
                            for name in dirs:
                                os.rmdir(os.path.join(root, name))

                # 3. Delete master password
                key_path = _ecosystem_key_path()
                if os.path.isfile(key_path):
                    os.remove(key_path)

                # 4. Delete config, bookmarks, comms log, and related files
                # User config lives in USER_DATA/ (not _system/) since migration.
                for f in ['config.json', 'config.json.bak', 'config.json.tmp',
                           'library_bookmarks.json', '.pw_lockout.json']:
                    fp = os.path.join(USER_DATA_DIR, f)
                    if os.path.isfile(fp):
                        os.remove(fp)
                # Canonical format is .bkv. Legacy code may have left .enc.
                for comms_ext in ('comms_log.bkv', 'comms_log.enc'):
                    comms_log = os.path.join(USER_DATA_DIR, comms_ext)
                    if os.path.isfile(comms_log):
                        os.remove(comms_log)

                # 4b. Delete COMMS provisioning artifacts (PSK + state)
                for prov_file in ['comms_channel_key.bkv', 'comms_provisioned.json']:
                    prov_path = os.path.join(USER_DATA_DIR, prov_file)
                    if os.path.isfile(prov_path):
                        os.remove(prov_path)

                # 5. Invalidate caches + reset in-memory state
                if _comms_manager:
                    _comms_manager.lock_store()
                    # Reset dispatch engine to defaults so next config POST
                    # from the reloaded frontend takes effect cleanly.
                    _comms_manager.update_dispatch_config({
                        'dispatch_enabled': True,
                        'dispatch_role': 'primary',
                        'dispatch_channel': 1,
                    })
                _vault_invalidate_cache()

                # Reset EULA so the first-run gate re-triggers
                # (global _eula_accepted already declared at top of do_POST)
                _eula_accepted = False

                _logger.info('Factory wipe executed successfully.')
                self._send_json(200, {'ok': True})
            except Exception as e:
                _logger.error(f"Factory wipe failed: {e}")
                self._send_json(500, {'error': str(e)})
            return

        # ── POST /api/master-password/change ──────────────────
        # Non-destructive password change: verify old, re-encrypt files, update hash
        if path == '/api/master-password/change':
            # Brute-force protection
            locked_out, remaining = _check_pw_lockout()
            if locked_out:
                self._send_json(429, {'error': f'Too many attempts. Try again in {remaining}s', 'retry_after': remaining})
                return
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
            if len(new_pw) < 8:
                self._send_json(400, {'error': 'New password must be at least 8 characters'})
                return
            if not _master_password_verify(current_pw):
                _record_pw_failure()
                self._send_json(403, {'error': 'Current password is incorrect'})
                return
            _reset_pw_lockout()

            # 1. Re-encrypt all locked .bkv files using atomic two-phase commit.
            #    Phase 1: Decrypt with old key → encrypt with new key to .rekey.bkv
            #    Phase 2: Atomically promote all .rekey.bkv → .bkv
            #    If ANY file fails Phase 1, ALL temporaries are cleaned up and
            #    the operation is aborted — original files remain untouched.
            #    This prevents orphaned files encrypted with the old key on power loss.
            re_encrypted_files = 0
            rekey_targets = []  # [(tmp_path, final_path), ...]
            rekey_failed = False
            locked = os.path.join(USER_DATA_DIR, 'locked')
            if os.path.isdir(locked):
                for fname in os.listdir(locked):
                    fpath = os.path.join(locked, fname)
                    if not os.path.isfile(fpath) or not fname.endswith('.bkv'):
                        continue
                    if fname == '.vault_manifest.bkv':
                        continue  # Re-encrypt manifest separately after
                    try:
                        # Stream-decrypt with old password → stream-encrypt with new.
                        # O(1) memory — handles files of any size.
                        header, file_size, chunks = _decrypt_to_stream(fpath, current_pw)
                        orig_name = header.get('name', fname)
                        rekey_path = fpath + '.rekey.bkv'
                        ok, err = _encrypt_stream(
                            chunks, rekey_path, new_pw, orig_name, file_size)
                        if ok:
                            rekey_targets.append((rekey_path, fpath))
                        else:
                            _logger.error(f'Re-encryption failed for {fname}: {err}')
                            rekey_failed = True
                            break
                    except Exception as e:
                        _logger.error(f'Re-encryption error for {fname}: {e}')
                        rekey_failed = True
                        break

                if rekey_failed:
                    # Rollback: clean up ALL .rekey.bkv temporaries
                    for tmp_path, _ in rekey_targets:
                        try:
                            os.remove(tmp_path)
                        except OSError:
                            pass
                    self._send_json(500, {
                        'error': 'Password change aborted — some files could not be re-encrypted. '
                                 'Your current password has not been changed.'
                    })
                    return

                # Phase 2: Atomically promote all re-keyed files
                # os.replace() is atomic on POSIX and Windows NTFS.
                # On exFAT (USB), it's as atomic as the filesystem allows.
                for tmp_path, final_path in rekey_targets:
                    _safe_atomic_replace(tmp_path, final_path, min_size=49)  # min .bkv header = 49 bytes
                    re_encrypted_files += 1

                # Re-encrypt manifest with new password
                try:
                    manifest = _vault_load_manifest(current_pw)
                    _vault_invalidate_cache()
                    _vault_save_manifest(manifest, new_pw)
                except Exception as e:
                    _logger.warning(f'Manifest re-encryption warning: {e}')

            # 2. Re-key COMMS store (Section 6 — prevents silent history loss)
            if _comms_manager:
                try:
                    _comms_manager.rekey_store(current_pw, new_pw)
                except Exception as e:
                    _logger.warning('COMMS rekey during password change failed: %s', e)

            # 2b. Re-key COMMS provisioning PSK (mesh channel encryption key)
            if _comms_manager:
                try:
                    _comms_manager.rekey_provisioning(current_pw, new_pw)
                except Exception as e:
                    _logger.warning('COMMS provisioning rekey during password change failed: %s', e)

            # 3. Find encrypted conversation IDs (for client-side re-encryption)
            encrypted_conv_ids = []
            conv_dir = _conversations_dir(DRIVE_DIR)
            if os.path.isdir(conv_dir):
                for fname in os.listdir(conv_dir):
                    if not fname.endswith('.json'):
                        continue
                    fpath = os.path.join(conv_dir, fname)
                    try:
                        with open(fpath, 'r', encoding='utf-8') as f:
                            conv = json.load(f)
                        if conv.get('encryptedMessages'):
                            encrypted_conv_ids.append(conv.get('id', fname[:-5]))
                    except Exception:
                        pass

            # 4. Update ecosystem_key.json — preserve existing hint (F-08)
            existing_hint = ''
            try:
                with open(_ecosystem_key_path(), 'r', encoding='utf-8') as f:
                    existing_hint = json.load(f).get('hint', '')
            except Exception:
                pass
            new_hint = body.get('hint', existing_hint)
            if _master_password_setup(new_pw, hint=new_hint):
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

        # ── POST /api/library/bookmark ─────────────────────────
        # Add a library bookmark (reference to a workspace file).
        # No file copy — Library reads directly from workspace storage.
        if path == '/api/library/bookmark':
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
            if source not in ('unlocked', 'locked'):
                self._send_json(400, {'error': 'source must be unlocked or locked'})
                return

            # Validate extension is library-compatible
            LIBRARY_EXTS = {'.epub', '.pdf', '.txt', '.md', '.csv',
                            '.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'}
            ext = os.path.splitext(rel_path)[1].lower()
            if ext not in LIBRARY_EXTS:
                self._send_json(400, {
                    'error': f'File type "{ext}" is not supported in the library. '
                             f'Supported: epub, pdf, txt, md, and images.'
                })
                return

            # Verify the file actually exists
            parts = [p for p in rel_path.split('/') if p and p not in ('.', '..')]
            if not parts:
                self._send_json(400, {'error': 'Invalid path'})
                return

            file_size = 0
            if source == 'unlocked':
                src_path = os.path.join(_unlocked_dir(), *parts)
                if not os.path.isfile(src_path):
                    self._send_json(404, {'error': 'File not found'})
                    return
                try:
                    file_size = os.path.getsize(src_path)
                except OSError:
                    pass
            elif source == 'locked':
                # For locked files, verify the path exists in the vault manifest
                pw = self.headers.get('X-Password', '')
                if not pw:
                    self._send_json(401, {'error': 'X-Password header required'})
                    return
                if not _master_password_verify(pw):
                    self._send_json(403, {'error': 'Wrong password'})
                    return
                try:
                    manifest = _vault_load_manifest(pw)
                    filepath = '/'.join(parts)
                    found = False
                    for uid, info in manifest.get('files', {}).items():
                        if info['path'] == filepath:
                            found = True
                            file_size = info.get('size', 0)
                            break
                    if not found:
                        self._send_json(404, {'error': 'File not found in vault'})
                        return
                except ValueError:
                    self._send_json(403, {'error': 'Wrong password'})
                    return

            # Check for duplicate bookmark
            data = _load_bookmarks()
            for bm in data['bookmarks']:
                if bm.get('source') == source and bm.get('path') == rel_path:
                    self._send_json(200, {'ok': True, 'duplicate': True,
                                          'message': 'Already in library'})
                    return

            # Add bookmark
            import uuid as _uuid
            bookmark = {
                'id': str(_uuid.uuid4())[:8],
                'source': source,
                'path': rel_path,
                'size': file_size,
                'added': datetime.datetime.now().isoformat(),
            }
            data['bookmarks'].append(bookmark)
            _save_bookmarks(data)
            _logger.info(f'Library bookmark added: {source}/{rel_path}')
            self._send_json(200, {'ok': True, 'bookmark': bookmark})
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
        # 1:1 Encrypted Upload: encrypt each file individually with UUID name,
        # update the encrypted vault manifest. No tarballs, no staging.
        if path == '/api/files/locked/upload':
            raw_path = self.headers.get('X-File-Path', '')
            filepath = urllib.parse.unquote(raw_path).replace('\\', '/')
            raw_pw = self.headers.get('X-Password', '')
            password = urllib.parse.unquote(raw_pw)
            if not filepath or not password:
                self._send_json(400, {'error': 'X-File-Path and X-Password headers required'})
                return
            if not _master_password_verify(password):
                self._send_json(403, {'error': 'Wrong master password'})
                return
            # Sanitize path
            parts = [p for p in filepath.split('/') if p and p not in ('.', '..')]
            if not parts:
                self._send_json(400, {'error': 'Invalid file path'})
                return
            # Stream HTTP body directly through V3 Segmented AEAD to disk.
            # O(1) memory — no file size limit.
            content_length = int(self.headers.get('Content-Length', 0))
            file_size = content_length

            def _body_chunks():
                """Yield the HTTP request body in 64KB chunks."""
                remaining = content_length
                while remaining > 0:
                    to_read = min(65536, remaining)
                    chunk = self.rfile.read(to_read)
                    if not chunk:
                        break
                    remaining -= len(chunk)
                    yield chunk

            # Generate UUID and encrypt via streaming pipeline
            file_uuid = uuid.uuid4().hex[:12]
            bkv_dest = os.path.join(_locked_dir(), file_uuid + '.bkv')
            ok, err = _encrypt_stream(
                _body_chunks(), bkv_dest, password, parts[-1], file_size)
            if not ok:
                self._send_json(500, {'error': err or 'Encryption failed'})
                return
            # Update manifest
            try:
                manifest = _vault_load_manifest(password)
                manifest['files'][file_uuid] = {
                    'path': '/'.join(parts),
                    'size': file_size,
                    'mtime': int(_time.time()),
                }
                _vault_save_manifest(manifest, password)
            except Exception as e:
                # Encryption succeeded but manifest update failed — clean up
                try:
                    os.remove(bkv_dest)
                except OSError:
                    pass
                self._send_json(500, {'error': f'Manifest update failed: {e}'})
                return
            self._send_json(200, {
                'ok': True,
                'path': '/'.join(parts),
                'size': os.path.getsize(bkv_dest),
            })
            return

        # ── POST /api/files/locked/import-bkv ─────────────────
        # Import a previously exported .bkv file into the vault.
        # Decrypts with source password → re-encrypts with vault password
        # to normalize all vault files to the same master password.
        # Streaming pipeline — O(1) memory, no file size limit.
        if path == '/api/files/locked/import-bkv':
            vault_pw = urllib.parse.unquote(self.headers.get('X-Password', ''))
            source_pw = urllib.parse.unquote(self.headers.get('X-Source-Password', ''))
            if not vault_pw or not source_pw:
                self._send_json(400, {'error': 'X-Password and X-Source-Password headers required'})
                return
            if not _master_password_verify(vault_pw):
                self._send_json(403, {'error': 'Wrong master password'})
                return
            content_length = int(self.headers.get('Content-Length', 0))
            if content_length == 0:
                self._send_json(400, {'error': 'Empty request'})
                return

            try:
                with tempfile.TemporaryDirectory() as td:
                    # 1. Stream the .bkv body to a temp file
                    src_bkv = os.path.join(td, 'import.bkv')
                    with open(src_bkv, 'wb') as f:
                        remaining = content_length
                        while remaining > 0:
                            chunk = self.rfile.read(min(65536, remaining))
                            if not chunk:
                                break
                            f.write(chunk)
                            remaining -= len(chunk)

                    # 2. Validate .bkv magic/version
                    try:
                        from comms.filecrypt import _read_bkv_header
                        ver, salt = _read_bkv_header(src_bkv)
                    except ValueError as e:
                        self._send_json(400, {'error': str(e)})
                        return

                    # 3. Streaming decrypt with source password → re-encrypt with vault password
                    try:
                        header, file_size, chunks = _decrypt_to_stream(src_bkv, source_pw)
                    except ValueError as e:
                        self._send_json(403, {'error': str(e)})
                        return

                    orig_name = header.get('name', 'imported_file')
                    orig_size = header.get('size', file_size)

                    # Generate new UUID and re-encrypt
                    new_uid = uuid.uuid4().hex[:12]
                    bkv_dest = os.path.join(_locked_dir(), new_uid + '.bkv')
                    ok, err = _encrypt_stream(
                        chunks, bkv_dest, vault_pw, orig_name, orig_size)
                    if not ok:
                        self._send_json(500, {'error': err or 'Re-encryption failed'})
                        return

                    # 4. Update vault manifest
                    manifest = _vault_load_manifest(vault_pw)
                    manifest['files'][new_uid] = {
                        'path': orig_name,
                        'size': orig_size,
                        'mtime': int(_time.time()),
                    }
                    _vault_save_manifest(manifest, vault_pw)

                self._send_json(200, {
                    'ok': True,
                    'name': orig_name,
                    'uid': new_uid,
                    'size': orig_size,
                })
            except Exception as e:
                _logger.error("BKV import failed: %s", e, exc_info=True)
                self._send_json(500, {'error': str(e)})
            return
        # ── POST /api/save-to-disk ─────────────────────────────
        # Universal download endpoint. Opens a native OS "Save As"
        # dialog and writes data directly to the user's filesystem.
        # Replaces all blob URL download patterns (which Chrome
        # silently fails to persist to disk).
        #
        # Mode A — Raw data:
        #   POST body = file bytes
        #   Headers: X-Filename (suggested name)
        #
        # Mode B — Server reference:
        #   POST body = JSON { source: "locked"|"unlocked", path: "..." }
        #   Headers: X-Password (for locked files)
        if path == '/api/save-to-disk':
            content_type = self.headers.get('Content-Type', '')
            content_length = int(self.headers.get('Content-Length', 0))

            if 'application/json' in content_type:
                # Mode B: server reference
                try:
                    raw = self.rfile.read(content_length)
                    body = json.loads(raw.decode('utf-8'))
                except Exception:
                    self._send_json(400, {'error': 'Invalid JSON'})
                    return

                source = body.get('source', '')
                file_path = body.get('path', '').strip().strip('/')
                if not source or not file_path:
                    self._send_json(400, {'error': 'source and path required'})
                    return

                suggested_name = file_path.split('/')[-1] if '/' in file_path else file_path

                if source == 'unlocked':
                    base = os.path.abspath(_unlocked_dir())
                    full_path = os.path.abspath(os.path.join(base, file_path))
                    if not full_path.startswith(base):
                        self._send_json(403, {'error': 'Path traversal blocked'})
                        return
                    if not os.path.isfile(full_path):
                        self._send_json(404, {'error': 'File not found'})
                        return

                    dest = _pick_save_file(suggested_name)
                    if not dest:
                        self._send_json(200, {'ok': False, 'cancelled': True})
                        return
                    try:
                        shutil.copy(full_path, dest)
                        self._send_json(200, {'ok': True, 'path': dest})
                    except Exception as e:
                        self._send_json(500, {'error': str(e)})
                    return

                elif source == 'locked':
                    pw = self.headers.get('X-Password', '')
                    if not pw:
                        self._send_json(401, {'error': 'X-Password required'})
                        return
                    if not _master_password_verify(pw):
                        self._send_json(403, {'error': 'Wrong password'})
                        return

                    manifest = _vault_load_manifest(pw)
                    # Find the file in the manifest by path
                    target_uid = None
                    for uid, info in manifest.get('files', {}).items():
                        if info.get('path') == file_path:
                            target_uid = uid
                            break
                    if not target_uid:
                        self._send_json(404, {'error': 'File not found in vault'})
                        return

                    bkv_path = os.path.join(_locked_dir(), target_uid + '.bkv')
                    if not os.path.isfile(bkv_path):
                        self._send_json(404, {'error': 'Encrypted file not found on disk'})
                        return

                    dest = _pick_save_file(suggested_name)
                    if not dest:
                        self._send_json(200, {'ok': False, 'cancelled': True})
                        return

                    try:
                        header, file_size, chunks = _decrypt_to_stream(bkv_path, pw)
                        with open(dest, 'wb') as out_f:
                            for chunk in chunks:
                                out_f.write(chunk)
                        self._send_json(200, {'ok': True, 'path': dest})
                    except ValueError as e:
                        self._send_json(403, {'error': str(e)})
                    except Exception as e:
                        self._send_json(500, {'error': str(e)})
                    return

                else:
                    self._send_json(400, {'error': 'source must be "locked" or "unlocked"'})
                    return

            else:
                # Mode A: raw data in POST body
                suggested_name = urllib.parse.unquote(
                    self.headers.get('X-Filename', 'download'))

                dest = _pick_save_file(suggested_name)
                if not dest:
                    self._send_json(200, {'ok': False, 'cancelled': True})
                    return

                try:
                    with open(dest, 'wb') as out_f:
                        remaining = content_length
                        while remaining > 0:
                            chunk = self.rfile.read(min(65536, remaining))
                            if not chunk:
                                break
                            out_f.write(chunk)
                            remaining -= len(chunk)
                    self._send_json(200, {'ok': True, 'path': dest})
                except Exception as e:
                    self._send_json(500, {'error': str(e)})
                return

        # ── POST /api/tools/encrypt-text ──────────────────────
        # Cipher Studio: encrypt plaintext to Base64-encoded BKV.
        # Body: JSON { text, password }
        # Returns: { ok, encrypted } where encrypted is Base64 string.
        if path == '/api/tools/encrypt-text':
            try:
                raw = self.rfile.read(int(self.headers.get('Content-Length', 0)))
                body = json.loads(raw.decode('utf-8'))
            except Exception:
                self._send_json(400, {'error': 'Invalid JSON'})
                return

            text = body.get('text', '')
            password = body.get('password', '')
            if not text:
                self._send_json(400, {'error': 'text is required'})
                return
            if not password:
                self._send_json(400, {'error': 'password is required'})
                return

            try:
                import base64 as _b64
                with tempfile.TemporaryDirectory() as td:
                    # Write text to temp file
                    src = os.path.join(td, 'plaintext.txt')
                    with open(src, 'wb') as f:
                        f.write(text.encode('utf-8'))
                    # Encrypt to .bkv
                    bkv = os.path.join(td, 'output.bkv')
                    def _chunks():
                        with open(src, 'rb') as f:
                            while True:
                                c = f.read(65536)
                                if not c: break
                                yield c
                    ok, err = _encrypt_stream(
                        _chunks(), bkv, password, 'message.txt',
                        os.path.getsize(src))
                    if not ok:
                        self._send_json(500, {'error': err or 'Encryption failed'})
                        return
                    # Read .bkv and Base64 encode
                    with open(bkv, 'rb') as f:
                        encrypted_b64 = _b64.b64encode(f.read()).decode('ascii')
                    self._send_json(200, {'ok': True, 'encrypted': encrypted_b64})
            except Exception as e:
                _logger.error("encrypt-text failed: %s", e, exc_info=True)
                self._send_json(500, {'error': str(e)})
            return

        # ── POST /api/tools/decrypt-text ──────────────────────
        # Cipher Studio: decrypt Base64-encoded BKV back to plaintext.
        # Body: JSON { encrypted, password }
        # Returns: { ok, text }
        if path == '/api/tools/decrypt-text':
            try:
                raw = self.rfile.read(int(self.headers.get('Content-Length', 0)))
                body = json.loads(raw.decode('utf-8'))
            except Exception:
                self._send_json(400, {'error': 'Invalid JSON'})
                return

            encrypted_b64 = body.get('encrypted', '')
            password = body.get('password', '')
            if not encrypted_b64:
                self._send_json(400, {'error': 'encrypted is required'})
                return
            if not password:
                self._send_json(400, {'error': 'password is required'})
                return

            try:
                import base64 as _b64
                with tempfile.TemporaryDirectory() as td:
                    # Decode Base64 to .bkv file
                    bkv = os.path.join(td, 'input.bkv')
                    with open(bkv, 'wb') as f:
                        f.write(_b64.b64decode(encrypted_b64))
                    # Decrypt
                    header, file_size, chunks = _decrypt_to_stream(bkv, password)
                    plaintext_bytes = b''.join(chunks)
                    text = plaintext_bytes.decode('utf-8')
                    self._send_json(200, {'ok': True, 'text': text})
            except ValueError as e:
                self._send_json(403, {'error': str(e)})
            except UnicodeDecodeError:
                self._send_json(400, {'error': 'Decrypted data is not text — this may be an encrypted file, not text.'})
            except Exception as e:
                _logger.error("decrypt-text failed: %s", e, exc_info=True)
                self._send_json(500, {'error': str(e)})
            return

        # ── POST /api/tools/encrypt-file ──────────────────────
        # Cipher Studio: encrypt any file to .bkv format.
        # Uses an independent password (not the vault master password).
        # Saves result to disk via native Save As dialog. O(1) memory.
        if path == '/api/tools/encrypt-file':
            password = urllib.parse.unquote(self.headers.get('X-Password', ''))
            raw_name = self.headers.get('X-File-Name', '')
            filename = urllib.parse.unquote(raw_name) if raw_name else 'encrypted_file'
            if not password:
                self._send_json(400, {'error': 'X-Password header required'})
                return
            content_length = int(self.headers.get('Content-Length', 0))
            if content_length == 0:
                self._send_json(400, {'error': 'Empty request'})
                return

            try:
                with tempfile.TemporaryDirectory() as td:
                    # 1. Stream body to temp file
                    src_path = os.path.join(td, 'plaintext')
                    with open(src_path, 'wb') as f:
                        remaining = content_length
                        while remaining > 0:
                            chunk = self.rfile.read(min(65536, remaining))
                            if not chunk:
                                break
                            f.write(chunk)
                            remaining -= len(chunk)

                    # 2. Encrypt to .bkv
                    bkv_path = os.path.join(td, 'output.bkv')

                    def _file_chunks():
                        with open(src_path, 'rb') as f:
                            while True:
                                chunk = f.read(65536)
                                if not chunk:
                                    break
                                yield chunk

                    ok, err = _encrypt_stream(
                        _file_chunks(), bkv_path, password, filename, content_length)
                    if not ok:
                        self._send_json(500, {'error': err or 'Encryption failed'})
                        return

                    # 3. Save the .bkv via native Save As dialog
                    dl_name = filename + '.bkv'
                    dest = _pick_save_file(dl_name)
                    if not dest:
                        self._send_json(200, {'ok': False, 'cancelled': True})
                        return
                    shutil.copy(bkv_path, dest)
                    self._send_json(200, {
                        'ok': True,
                        'path': dest,
                        'name': dl_name,
                        'size': os.path.getsize(dest),
                    })
            except Exception as e:
                _logger.error("Tool encrypt-file failed: %s", e, exc_info=True)
                self._send_json(500, {'error': str(e)})
            return

        # ── POST /api/tools/decrypt-file ──────────────────────
        # Cipher Studio: decrypt a .bkv file back to the original.
        # Uses an independent password (not the vault master password).
        # Saves result to disk via native Save As dialog. O(1) memory.
        # If decrypted content is a .zip, offers folder extraction.
        if path == '/api/tools/decrypt-file':
            password = urllib.parse.unquote(self.headers.get('X-Password', ''))
            if not password:
                self._send_json(400, {'error': 'X-Password header required'})
                return
            content_length = int(self.headers.get('Content-Length', 0))
            if content_length == 0:
                self._send_json(400, {'error': 'Empty request'})
                return

            try:
                with tempfile.TemporaryDirectory() as td:
                    # 1. Stream .bkv body to temp file
                    bkv_path = os.path.join(td, 'input.bkv')
                    with open(bkv_path, 'wb') as f:
                        remaining = content_length
                        while remaining > 0:
                            chunk = self.rfile.read(min(65536, remaining))
                            if not chunk:
                                break
                            f.write(chunk)
                            remaining -= len(chunk)

                    # 2. Validate and decrypt
                    try:
                        header, file_size, chunks = _decrypt_to_stream(bkv_path, password)
                    except ValueError as e:
                        self._send_json(403, {'error': str(e)})
                        return

                    orig_name = header.get('name', 'decrypted_file')

                    # 3. Write decrypted data to temp file first
                    decrypted_path = os.path.join(td, orig_name)
                    with open(decrypted_path, 'wb') as out_f:
                        for chunk in chunks:
                            out_f.write(chunk)

                    # 4. Check if it's a zip (folder encryption)
                    is_zip = orig_name.lower().endswith('.zip')
                    if is_zip:
                        # Folder mode: extract to user-chosen directory
                        dest_dir = _pick_export_directory()
                        if not dest_dir:
                            self._send_json(200, {'ok': False, 'cancelled': True})
                            return
                        import zipfile
                        with zipfile.ZipFile(decrypted_path, 'r') as zf:
                            # Detect root structure to prevent accidental overwrites
                            namelist = zf.namelist()
                            root_dirs = set()
                            root_files = set()
                            for name in namelist:
                                parts = name.split('/')
                                if len(parts) > 1 and parts[0]:
                                    root_dirs.add(parts[0])
                                elif name and not name.endswith('/'):
                                    root_files.add(name)

                            # Case 1: Single root folder (e.g., "Gemini/" with files inside)
                            if len(root_dirs) == 1 and len(root_files) == 0:
                                root_folder = list(root_dirs)[0]
                                target_path = os.path.join(dest_dir, root_folder)
                                
                                if os.path.exists(target_path):
                                    counter = 2
                                    while os.path.exists(os.path.join(dest_dir, f"{root_folder} {counter}")):
                                        counter += 1
                                    unique_root = f"{root_folder} {counter}"
                                    
                                    # Rename the root folder on the fly
                                    for info in zf.infolist():
                                        parts = info.filename.split('/')
                                        if parts[0] == root_folder:
                                            parts[0] = unique_root
                                        new_name = '/'.join(parts)
                                        if not new_name: continue
                                        
                                        target_file = os.path.join(dest_dir, new_name)
                                        if info.is_dir():
                                            os.makedirs(target_file, exist_ok=True)
                                        else:
                                            os.makedirs(os.path.dirname(target_file), exist_ok=True)
                                            with zf.open(info) as src, open(target_file, 'wb') as dst:
                                                shutil.copyfileobj(src, dst)
                                            # Restore original zip timestamp
                                            dt = datetime.datetime(*info.date_time)
                                            ts = dt.timestamp()
                                            os.utime(target_file, (ts, ts))
                                    final_path = os.path.join(dest_dir, unique_root)
                                else:
                                    zf.extractall(dest_dir)
                                    final_path = target_path
                            else:
                                # Case 2: Flat files or multiple roots. Check for ANY collision.
                                collision = False
                                for name in namelist:
                                    if os.path.exists(os.path.join(dest_dir, name)):
                                        collision = True
                                        break
                                
                                if collision:
                                    base_name = orig_name.replace('.zip', '')
                                    unique_dir = f"{base_name} (Decrypted)"
                                    counter = 1
                                    while os.path.exists(os.path.join(dest_dir, unique_dir)):
                                        unique_dir = f"{base_name} (Decrypted) {counter}"
                                        counter += 1
                                    safe_path = os.path.join(dest_dir, unique_dir)
                                    os.makedirs(safe_path, exist_ok=True)
                                    zf.extractall(safe_path)
                                    final_path = safe_path
                                else:
                                    zf.extractall(dest_dir)
                                    final_path = dest_dir

                        # Count files in the final extracted directory
                        file_count = 0
                        for root_d, _, files in os.walk(final_path):
                            file_count += len(files)

                        self._send_json(200, {
                            'ok': True,
                            'path': final_path,
                            'name': os.path.basename(final_path) or orig_name.replace('.zip', ''),
                            'isFolder': True,
                            'count': file_count,
                        })
                    else:
                        # Single file mode: Save As dialog
                        dest = _pick_save_file(orig_name)
                        if not dest:
                            self._send_json(200, {'ok': False, 'cancelled': True})
                            return
                        shutil.copy(decrypted_path, dest)
                        self._send_json(200, {
                            'ok': True,
                            'path': dest,
                            'name': orig_name,
                            'size': os.path.getsize(dest),
                        })
            except ValueError as e:
                self._send_json(403, {'error': str(e)})
            except Exception as e:
                _logger.error("Tool decrypt-file failed: %s", e, exc_info=True)
                self._send_json(500, {'error': str(e)})
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

            # Hot-swap in a background thread so the HTTP response isn't blocked.
            # Uses _hot_swap_status dict so the UI can poll for completion.
            _hot_swap_status['state'] = 'swapping'
            _hot_swap_status['tier'] = tier
            _hot_swap_status['error'] = None

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
                            [_OLLAMA_EXE, 'create', 'blackout-beacon',
                             '-f', modelfile_path],
                            capture_output=True, text=True, timeout=120
                        )

                    _hot_swap_status['state'] = 'done'
                    _logger.info(f'Hot-swap complete: tier={tier}')
                except Exception as e:
                    _hot_swap_status['state'] = 'error'
                    _hot_swap_status['error'] = str(e)
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
            # Require master password for non-safe (core) system files
            if rel not in self._SYSTEM_SAFE_FILES:
                auth_pw = self.headers.get('X-Password', '')
                if auth_pw:
                    auth_pw = urllib.parse.unquote(auth_pw)
                if not auth_pw or not _master_password_verify(auth_pw):
                    self._send_json(403, {'error': 'Master password required for system file edits'})
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
                # ── Purge sibling .beacon-index if it exists ──
                _beacon_idx = full + '.beacon-index'
                if os.path.isfile(_beacon_idx):
                    try:
                        os.remove(_beacon_idx)
                        _logger.info('Purged orphaned index: %s', _beacon_idx)
                    except OSError:
                        pass
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
                    # Auto-clean library bookmarks referencing this file
                    removed_bm = _remove_bookmarks_for_path('unlocked', '/'.join(parts))
                    self._send_json(200, {'ok': True, 'deleted': '/'.join(parts),
                                          'bookmarks_removed': removed_bm})
                except OSError as e:
                    self._send_json(500, {'error': str(e)})
            elif os.path.isdir(fpath):
                try:
                    shutil.rmtree(fpath)
                    # Auto-clean library bookmarks under this directory
                    removed_bm = _remove_bookmarks_for_path('unlocked', '/'.join(parts))
                    self._send_json(200, {'ok': True, 'deleted': '/'.join(parts),
                                          'bookmarks_removed': removed_bm})
                except OSError as e:
                    self._send_json(500, {'error': str(e)})
            else:
                self._send_json(404, {'error': 'File not found'})
            return

        # ── DELETE /api/files/locked/<path> ───────────────────
        # Delete a locked file via manifest lookup + UUID file removal
        if path.startswith('/api/files/locked/'):
            fname = urllib.parse.unquote(path[len('/api/files/locked/'):])
            parts = [p for p in fname.split('/') if p and p not in ('.', '..')]
            if not parts:
                self._send_json(400, {'error': 'Invalid path'})
                return
            pw = self.headers.get('X-Password', '')
            if not pw:
                self._send_json(401, {'error': 'X-Password header required'})
                return
            if not _master_password_verify(pw):
                self._send_json(403, {'error': 'Wrong password'})
                return
            filepath = '/'.join(parts)
            try:
                manifest = _vault_load_manifest(pw)
            except ValueError:
                self._send_json(403, {'error': 'Wrong password'})
                return
            # Find all UUIDs matching this path (or under this directory)
            to_delete = []
            for uid, info in list(manifest.get('files', {}).items()):
                if info['path'] == filepath or info['path'].startswith(filepath + '/'):
                    to_delete.append(uid)
            if not to_delete:
                self._send_json(404, {'error': 'File not found in vault'})
                return
            # Delete .bkv files from disk and remove from manifest
            for uid in to_delete:
                bkv_path = os.path.join(_locked_dir(), uid + '.bkv')
                try:
                    os.remove(bkv_path)
                except OSError:
                    pass
                del manifest['files'][uid]
            try:
                _vault_save_manifest(manifest, pw)
            except Exception as e:
                self._send_json(500, {'error': f'Manifest update failed: {e}'})
                return
            # Auto-clean library bookmarks referencing this locked file
            removed_bm = _remove_bookmarks_for_path('locked', filepath)
            self._send_json(200, {'ok': True, 'deleted': filepath, 'count': len(to_delete),
                                  'bookmarks_removed': removed_bm})
            return

        # ── DELETE /api/library/bookmark/<id> ─────────────────
        # Remove a bookmark from the library. Does NOT delete the original file.
        if path.startswith('/api/library/bookmark/'):
            bm_id = urllib.parse.unquote(path[len('/api/library/bookmark/'):])
            if not bm_id:
                self._send_json(400, {'error': 'Bookmark ID required'})
                return
            data = _load_bookmarks()
            before = len(data['bookmarks'])
            data['bookmarks'] = [b for b in data['bookmarks'] if b.get('id') != bm_id]
            if len(data['bookmarks']) < before:
                _save_bookmarks(data)
                _logger.info(f'Library bookmark removed: {bm_id}')
                self._send_json(200, {'ok': True, 'removed': bm_id})
            else:
                self._send_json(404, {'error': 'Bookmark not found'})
            return

        self.send_error(404, 'Not found')

    # ── HEAD (RFC 9110 §9.3.2) ─────────────────────────────────
    # HEAD MUST return the same headers as GET but without the body.
    # All body-write paths check self.command != 'HEAD' to suppress payload.

    def do_HEAD(self):
        self.do_GET()

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
                continue  # haven't received first heartbeat yet -- stay idle
            elapsed = _time.time() - _last_heartbeat

        _logger.debug('Watchdog check: last heartbeat %.0fs ago (timeout=%ds)',
                       elapsed, WATCHDOG_TIMEOUT)

        if elapsed > WATCHDOG_TIMEOUT:
            _logger.warning('WATCHDOG TRIGGERED: No heartbeat for %ds -- shutting down', int(elapsed))
            print(f'\n  [WATCHDOG] No browser heartbeat for {int(elapsed)}s -- shutting down...', flush=True)
            # Write sentinel file so the launcher script knows to exit
            try:
                sentinel_name = '.shutdown_win' if sys.platform == 'win32' else '.shutdown_sentinel'
                sentinel = os.path.join(DRIVE_DIR, '_system', 'data', sentinel_name)
                os.makedirs(os.path.dirname(sentinel), exist_ok=True)
                with open(sentinel, 'w', encoding='utf-8') as f:
                    f.write('shutdown')
                _logger.info('Sentinel written to %s', sentinel)
            except OSError:
                pass
            # Cancel active downloads to prevent orphaned .ddtmp files
            try:
                with _jobs_lock:
                    for jid, job in _download_jobs.items():
                        if not job.get('done'):
                            job['cancel_flag'] = True
                _time.sleep(1)  # Let workers clean up temp files
            except Exception:
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
            _logger.info('Watchdog shutdown complete -- exiting process')
            print('  [WATCHDOG] System offline. All data remains on your drive.', flush=True)
            # Flush all log handlers before exit
            for h in _logger.handlers:
                h.flush()
            # Shut down the HTTP server
            if _server_ref:
                _server_ref.shutdown()
            # Force exit after a short delay (in case shutdown blocks)
            _time.sleep(2)
            os._exit(0)


# ── Entry Point ────────────────────────────────────────────────────────────────

if __name__ == '__main__':
  try:
    # Automatically rebuild the manifest on boot to prevent "ghost" files
    # if the user manually modified the drive's contents while it was off.
    _logger.info('Building manifest...')
    write_manifest(DRIVE_DIR)
    _logger.info('Manifest built OK')

    server = ThreadingHTTPServer(('127.0.0.1', PORT), BlackoutDriveHandler)
    server.daemon_threads = True  # Threads die when main thread exits
    _server_ref = server
    print(f'  The Blackout Drive server -> http://127.0.0.1:{PORT}/_system/ui/', flush=True)
    print(f'  Serving from: {DRIVE_DIR}', flush=True)
    if _debug_mode:
        print(f'  Debug logging: {os.path.join(_debug_log_dir, "server.log")}', flush=True)
        _logger.info(f'Server bound to 127.0.0.1:{PORT}')
        _logger.info('Manifest rebuilt on boot')
        _logger.info('Server starting on port %d', PORT)

    # Clean any stale sentinel file
    try:
        sentinel_name = '.shutdown_win' if sys.platform == 'win32' else '.shutdown_sentinel'
        sentinel = os.path.join(DRIVE_DIR, '_system', 'data', sentinel_name)
        if os.path.exists(sentinel):
            os.remove(sentinel)
            _logger.info('Cleared stale sentinel file during startup')
    except OSError:
        pass

    # Start the heartbeat watchdog in a daemon thread
    wd = threading.Thread(target=_watchdog_thread, daemon=True)
    wd.start()

    # ── exFAT boot-time recovery ───────────────────────────────
    # On exFAT/FAT32, os.replace() is not truly atomic. If the USB
    # was pulled mid-write, we may have a valid .tmp file but a
    # missing or corrupt primary file. Detect and recover.
    _recovery_targets = [
        _CONFIG_PATH,
        os.path.join(USER_DATA_DIR, 'comms_log.bkv'),
    ]
    for _target in _recovery_targets:
        _tmp = _target + '.tmp'
        if os.path.isfile(_tmp):
            # .tmp exists — was an atomic write interrupted?
            if not os.path.isfile(_target) or os.path.getsize(_target) == 0:
                # Primary file missing or zero-byte: promote .tmp
                try:
                    os.replace(_tmp, _target)
                    print(f'  Recovery: promoted {os.path.basename(_tmp)} -> '
                          f'{os.path.basename(_target)}', flush=True)
                except OSError as _re:
                    print(f'  Recovery: failed for {os.path.basename(_target)}: '
                          f'{_re}', flush=True)
            else:
                # Both exist and primary is non-zero: discard stale .tmp
                try:
                    os.remove(_tmp)
                except OSError:
                    pass

    # ── Config.json boot-time backup ─────────────────────────
    # Snapshot known-good config before any runtime modifications.
    # If config.json is corrupted, auto-recover from backup.
    _logger.info('Config backup starting...')
    try:
        if os.path.isfile(_CONFIG_PATH):
            # Validate JSON integrity before backing up
            try:
                with open(_CONFIG_PATH, 'r', encoding='utf-8') as _cf:
                    json.load(_cf)
            except (json.JSONDecodeError, ValueError):
                # Config is corrupt — recover from backup if available
                _bak = _CONFIG_PATH + '.bak'
                if os.path.isfile(_bak):
                    shutil.copy2(_bak, _CONFIG_PATH)
                    print('  Config: RECOVERED from backup (corrupt JSON detected)',
                          flush=True)
                else:
                    print('  Config: WARNING — corrupt JSON, no backup available',
                          flush=True)
            else:
                shutil.copy2(_CONFIG_PATH, _CONFIG_PATH + '.bak')
                print('  Config: backed up to config.json.bak', flush=True)
    except OSError as _bak_err:
        print(f'  Config: backup failed ({_bak_err})', flush=True)
    _logger.info('Config backup done')

    # ── Load EULA acceptance state ─────────────────────────
    _init_eula()
    if _eula_accepted:
        print('  EULA: accepted', flush=True)
    else:
        print('  EULA: not yet accepted — API gated until first-run consent', flush=True)
    _logger.info('EULA state loaded: %s', _eula_accepted)

    # ── Start COMMS subsystem ──────────────────────────────
    _logger.info('COMMS subsystem init starting...')
    try:
        # Load config for COMMS settings (using lock for consistency)
        _comms_full_config = {}
        with _config_lock:
            try:
                with open(_CONFIG_PATH, 'r', encoding='utf-8') as _cf:
                    _comms_full_config = json.load(_cf)
            except (json.JSONDecodeError, FileNotFoundError, OSError):
                # Attempt recovery from backup
                _bak = _CONFIG_PATH + '.bak'
                if os.path.isfile(_bak):
                    shutil.copy2(_bak, _CONFIG_PATH)
                    with open(_CONFIG_PATH, 'r', encoding='utf-8') as _cf:
                        _comms_full_config = json.load(_cf)
                    print('  Config: RECOVERED from backup', flush=True)
        _comms_ollama_port = _comms_full_config.get('network', {}).get('ollamaPort', 11434)

        # Callback to persist dispatch role changes (auto-demotion) to config.json
        def _persist_dispatch_role(role):
            def _modifier(cfg):
                cfg.setdefault('comms', {})['dispatch_role'] = role
            _read_modify_write_config(_modifier)
            _logger.info('Dispatch role persisted to config.json: %s', role)

        _comms_data_dir = USER_DATA_DIR

        from comms import CommsManager
        _comms_manager = CommsManager(
            _comms_full_config, _comms_ollama_port,
            data_dir=_comms_data_dir,
            persist_role_fn=_persist_dispatch_role,
        )
        _comms_manager.start()
        print('  COMMS subsystem: scanning for radio...', flush=True)
    except Exception as _comms_err:
        print(f'  COMMS subsystem: init failed ({_comms_err})', flush=True)
        _comms_manager = None
    _logger.info('COMMS subsystem init complete')

    _logger.info('Server entering serve_forever loop')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        # Stop COMMS subsystem
        if _comms_manager:
            try:
                _comms_manager.stop()
            except Exception:
                pass
        server.server_close()

  except Exception:
    # Master crash handler — write traceback to log file so we can
    # always see why the server died, even on Windows with /min.
    import traceback
    tb = traceback.format_exc()
    print(f'\n  [FATAL] Server crashed:\n{tb}', flush=True)
    _logger.critical('FATAL SERVER CRASH:\n%s', tb)
    # Also write to a crash file directly in case logger isn't set up
    try:
        _crash_dir = os.path.join(DRIVE_DIR, '_system', 'data', 'logs')
        os.makedirs(_crash_dir, exist_ok=True)
        with open(os.path.join(_crash_dir, 'crash.log'), 'w', encoding='utf-8') as _cf:
            _cf.write(f'FATAL SERVER CRASH\n{tb}\n')
    except Exception:
        pass
    sys.exit(1)

