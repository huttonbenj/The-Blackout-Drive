#!/usr/bin/env python3
"""
The Blackout Drive — Local HTTP Server
================================================================
Replaces `python3 -m http.server` with a full-featured server
that supports file management and content downloads.

Usage:
    python3 scripts/server.py [PORT] [DRIVE_ROOT]

Default PORT: 8080
Default DRIVE_ROOT: parent directory of this script

Endpoints:
    GET  /*                  → serve static files
    GET  /api/status         → drive status + disk usage
    GET  /api/manifest       → manifest.json contents
    POST /api/download       → start background file download
    GET  /api/download/<id>  → poll download progress
    DELETE /api/download/<id>→ cancel download
    DELETE /api/files        → delete file + regenerate manifest
    OPTIONS *                → CORS preflight (for Ollama on diff port)

Security:
    - Only binds to 127.0.0.1 (localhost only)
    - All file paths normalized + checked against DRIVE_ROOT
    - Directory traversal attempts → 403
================================================================
"""

import sys
import os
import json
import hashlib
import shutil
import threading
import datetime
import mimetypes
import urllib.request
import urllib.parse
from http.server import BaseHTTPRequestHandler, HTTPServer

# ── Configuration ─────────────────────────────────────────────────────────────

DEFAULT_PORT = 8080
SCRIPT_DIR   = os.path.dirname(os.path.abspath(__file__))
DEFAULT_ROOT = os.path.dirname(SCRIPT_DIR)   # parent of scripts/ = project root

PORT       = int(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_PORT
# sys.argv[2] = DRIVE_DIR (the drive/ directory that is served).
# Defaults to sibling 'drive/' of the scripts/ directory.
_arg_root = sys.argv[2] if len(sys.argv) > 2 else os.path.join(DEFAULT_ROOT, 'drive')
DRIVE_DIR  = os.path.realpath(_arg_root)

# ── Download Job Tracking ──────────────────────────────────────────────────────
# { job_id: { progress, total, done, error, thread, cancel_flag } }
_download_jobs = {}
_jobs_lock = threading.Lock()
_job_counter = 0


def _new_job_id():
    global _job_counter
    with _jobs_lock:
        _job_counter += 1
        return f'dl_{_job_counter}'


# ── Manifest Generation ────────────────────────────────────────────────────────

def build_manifest(drive_dir: str) -> dict:
    """Scan content directory and return a manifest dict."""
    content_dir = os.path.join(drive_dir, 'content')
    files = {}
    total_bytes = 0

    if not os.path.isdir(content_dir):
        return {'schema': '1.0', 'assembled': _now_utc(),
                'file_count': 0, 'total_bytes': 0, 'files': {}}

    for root, dirs, filenames in os.walk(content_dir):
        dirs[:] = sorted(d for d in dirs if not d.startswith('.'))
        for fname in sorted(filenames):
            if fname.startswith('.') or fname in ('manifest.json', 'library.json'):
                continue
            full = os.path.join(root, fname)
            rel  = os.path.relpath(full, drive_dir).replace('\\', '/')
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


def write_manifest(drive_dir: str) -> dict:
    """Regenerate and write manifest.json. Returns the manifest dict."""
    manifest = build_manifest(drive_dir)
    path = os.path.join(drive_dir, 'content', 'manifest.json')
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w') as f:
        json.dump(manifest, f, indent=2)
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
        req = urllib.request.urlopen(url, timeout=30)
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
        with _jobs_lock:
            job['done'] = True
            job['error'] = str(e)


# ── Request Handler ────────────────────────────────────────────────────────────

class BlackoutDriveHandler(BaseHTTPRequestHandler):

    def log_message(self, fmt, *args):
        # Uncomment for debug logging:
        # print(f'[{self.address_string()}] {fmt % args}', flush=True)
        pass

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
        """Resolve a relative path, ensure it stays inside DRIVE_DIR."""
        full = os.path.realpath(os.path.join(DRIVE_DIR, rel.lstrip('/')))
        if not full.startswith(DRIVE_DIR):
            return None
        return full

    def _read_body(self) -> bytes:
        length = int(self.headers.get('Content-Length', 0))
        return self.rfile.read(length) if length else b''

    # ── File serving ──────────────────────────────────────────

    def _serve_file(self, url_path: str):
        # Map URL path to filesystem path under DRIVE_DIR
        rel = url_path.lstrip('/')

        # Root URL → redirect to /ui/ so relative paths (config.js, app.js, etc.)
        # resolve correctly. Serving ui/index.html inline at '/' would break them.
        if not rel:
            self.send_response(302)
            self.send_header('Location', '/ui/')
            self.end_headers()
            return

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
        # No-cache for JS, CSS, and JSON to prevent stale UI state
        if full.endswith(('.js', '.css', '.json')):
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

        # ── /api/status ─────────────────────────────────────
        if path == '/api/status':
            content_dir = os.path.join(DRIVE_DIR, 'content')
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
            self._send_json(200, {
                'status': 'ok',
                'version': '1.0.0',
                'content_size_bytes': content_size,
                'free_bytes': free,
            })
            return

        # ── /api/manifest ────────────────────────────────────
        if path == '/api/manifest':
            mf_path = os.path.join(DRIVE_DIR, 'content', 'manifest.json')
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

        # ── /api/library-context ─────────────────────────────
        # Returns a human-readable summary of downloaded files for LLM injection
        if path == '/api/library-context':
            mf_path = os.path.join(DRIVE_DIR, 'content', 'manifest.json')
            cat_path = os.path.join(DRIVE_DIR, 'content', 'library.json')
            files_summary = []
            try:
                with open(mf_path) as f:
                    manifest = json.load(f)
                installed = set(manifest.get('files', {}).keys())
            except Exception:
                installed = set()
            try:
                with open(cat_path) as f:
                    catalog = json.load(f)
                for cat in catalog.get('categories', []):
                    for item in cat.get('items', []):
                        if item.get('file', '') in installed or \
                           item.get('file', '').lstrip('/') in installed:
                            files_summary.append({
                                'id': item.get('id'),
                                'name': item.get('name'),
                                'category': cat.get('name'),
                                'type': item.get('type'),
                                'path': item.get('file', ''),
                            })
            except Exception:
                pass
            # Build plain-text summary for LLM injection
            if files_summary:
                lines = ['The following resources are available in the local library on this drive:']
                for f_info in files_summary:
                    lines.append(f"  • {f_info['name']} [{f_info['category']}]")
                context_str = '\n'.join(lines)
            else:
                context_str = 'No library content is currently downloaded on this drive.'
            self._send_json(200, {'context': context_str, 'files': files_summary})
            return

        # ── /api/search ──────────────────────────────────────
        # Keyword search across all downloaded text files in content/books/
        if path == '/api/search':
            query = (qs.get('q', [''])[0]).strip()
            limit = int(qs.get('limit', ['5'])[0])
            if not query:
                self._send_json(400, {'error': 'q param required'})
                return
            books_dir = os.path.join(DRIVE_DIR, 'content', 'books')
            results = []
            if os.path.isdir(books_dir):
                for fname in sorted(os.listdir(books_dir)):
                    if not fname.endswith('.txt'):
                        continue
                    fpath = os.path.join(books_dir, fname)
                    try:
                        with open(fpath, 'r', encoding='utf-8', errors='replace') as f:
                            text = f.read()
                        query_lower = query.lower()
                        text_lower = text.lower()
                        idx = 0
                        file_hits = 0
                        while file_hits < 2:  # Max 2 excerpts per file
                            pos = text_lower.find(query_lower, idx)
                            if pos < 0:
                                break
                            start = max(0, pos - 150)
                            end = min(len(text), pos + len(query) + 150)
                            excerpt = text[start:end].strip()
                            # Clean up excerpt edges at word boundaries
                            if start > 0:
                                excerpt = '…' + excerpt
                            if end < len(text):
                                excerpt = excerpt + '…'
                            results.append({
                                'file': fname,
                                'excerpt': excerpt,
                                'pos': pos,
                            })
                            file_hits += 1
                            idx = pos + 1
                            if len(results) >= limit:
                                break
                    except Exception:
                        continue
                    if len(results) >= limit:
                        break
            self._send_json(200, {'query': query, 'results': results})
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

        self.send_error(404, 'Not found')

    # ── OPTIONS (CORS preflight) ───────────────────────────────

    def do_OPTIONS(self):
        self.send_response(200)
        self._cors_headers()
        self.end_headers()


# ── Entry Point ────────────────────────────────────────────────────────────────

if __name__ == '__main__':
    server = HTTPServer(('127.0.0.1', PORT), BlackoutDriveHandler)
    print(f'  The Blackout Drive server → http://localhost:{PORT}/ui/', flush=True)
    print(f'  Serving from: {DRIVE_DIR}', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
