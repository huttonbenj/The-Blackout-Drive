"""
The Blackout Drive — Scoped RAG Engine
Copyright (c) 2026 Hutton Technologies LLC — Licensed under BSL 1.1
================================================================
Zero-dependency document ingestion, embedding, and retrieval for the
Chat UI's "Ask BEACON" feature.

Architecture:
  - Per-file .beacon-index JSON files (not a monolithic vector DB)
  - Text extraction: TXT, EPUB (zipfile + html.parser), PDF (bundled pdftotext)
  - Embeddings: Ollama native /api/embed endpoint
  - Search: Pure Python cosine similarity (O(1ms) for typical documents)

SECURITY CONSTRAINT:
  This engine MUST NEVER index encrypted (.bkv, .7z) or locked files.
  The index_file() function raises SecurityError for any encrypted file
  or any file path containing '/locked/'.
================================================================
"""

import os
import re
import sys
import json
import math
import time
import logging
import zipfile
import urllib.request
from html.parser import HTMLParser

_log = logging.getLogger('blackout.rag')

# ── Constants ─────────────────────────────────────────────────

CHUNK_SIZE = 400         # Target tokens per chunk (~1600 chars)
CHUNK_OVERLAP = 50       # Overlap tokens between chunks (~200 chars)
CHARS_PER_TOKEN = 4      # Rough estimate for tokenizer
MAX_CHUNKS_PER_FILE = 500  # Safety cap — prevent runaway indexing
TOP_K = 3                # Number of chunks to return from search
INDEX_VERSION = 1        # Schema version for .beacon-index files
MAX_FILE_SIZE = 50 * 1024 * 1024  # 50 MB — skip files larger than this to prevent OOM

# Blocked file extensions and path patterns (SECURITY)
BLOCKED_EXTENSIONS = frozenset({'.bkv', '.7z', '.zip', '.rar', '.gpg', '.pgp', '.enc'})
BLOCKED_PATH_PATTERNS = ('/locked/', '/locked\\', '\\locked\\')

# Magic byte signatures for encrypted archive formats.
# Used to catch extension-spoofed files (e.g. secret.7z renamed to fake.txt).
# Each entry: (byte_signature, format_name)
ENCRYPTED_MAGIC_BYTES = [
    (b'BKVF',                'bkv'),       # Blackout Vault (native AES-256-GCM)
    (b'7z\xbc\xaf\x27\x1c', '7z'),        # 7-Zip archive (legacy)
    (b'PK\x03\x04',         'zip'),       # ZIP archive (also EPUB, but caught by context)
    (b'Rar!\x1a\x07',       'rar'),       # RAR archive
]

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))


# ══════════════════════════════════════════════════════════════
# SECURITY GATE — Must be called before ANY indexing operation
# ══════════════════════════════════════════════════════════════

class RAGSecurityError(Exception):
    """Raised when an indexing operation violates security constraints."""
    pass


def _security_check(file_path):
    """Validate that a file is safe to index. Raises RAGSecurityError if not.

    Rules:
      1. NEVER index .bkv files (encrypted vaults)
      2. NEVER index files in any 'locked' directory
      3. NEVER index files with other encrypted-archive extensions (.7z, .rar, etc.)
      4. NEVER index files whose binary header matches known encrypted
         archive signatures (catches extension-spoofed files)
    """
    path_lower = file_path.lower()
    _, ext = os.path.splitext(path_lower)

    if ext in BLOCKED_EXTENSIONS:
        raise RAGSecurityError(
            f"SECURITY VIOLATION: Cannot index encrypted file '{os.path.basename(file_path)}'. "
            f"Extension '{ext}' is blocked. Indexing encrypted files would write "
            f"decrypted text to disk, bypassing the AES-256 security model."
        )

    for pattern in BLOCKED_PATH_PATTERNS:
        if pattern in path_lower:
            raise RAGSecurityError(
                f"SECURITY VIOLATION: Cannot index file in locked directory: "
                f"'{file_path}'. Files in the locked vault are encrypted and "
                f"must never have plaintext indexes written to disk."
            )

    # Magic byte signature check — catches extension-spoofed files
    # Only read if the file actually exists on disk (skip for path-only checks)
    if os.path.isfile(file_path):
        _, check_ext = os.path.splitext(file_path.lower())
        try:
            with open(file_path, 'rb') as f:
                header = f.read(8)  # 8 bytes covers all signatures
            for sig, fmt in ENCRYPTED_MAGIC_BYTES:
                if header.startswith(sig):
                    # EPUBs are ZIP-based by design — PK\x03\x04 header is expected.
                    # Don't flag legitimate EPUB files as spoofed archives.
                    if fmt == 'zip' and check_ext == '.epub':
                        continue
                    raise RAGSecurityError(
                        f"SECURITY VIOLATION: File '{os.path.basename(file_path)}' has a "
                        f"spoofed extension but contains {fmt} archive magic bytes. "
                        f"Actual format: {fmt}. Indexing encrypted archives is blocked "
                        f"regardless of file extension."
                    )
        except RAGSecurityError:
            raise  # Re-raise security errors
        except Exception:
            pass  # File read errors are handled downstream



# ══════════════════════════════════════════════════════════════
# TEXT EXTRACTORS
# ══════════════════════════════════════════════════════════════

class _HTMLTextExtractor(HTMLParser):
    """Minimal HTML-to-text parser. Strips all tags, keeps text content."""

    def __init__(self):
        super().__init__()
        self._text = []
        self._skip = False

    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style', 'head'):
            self._skip = True

    def handle_endtag(self, tag):
        if tag in ('script', 'style', 'head'):
            self._skip = False
        if tag in ('p', 'div', 'br', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'tr'):
            self._text.append('\n')

    def handle_data(self, data):
        if not self._skip:
            self._text.append(data)

    def get_text(self):
        return ''.join(self._text)


def extract_txt(file_path):
    """Extract text from a plain text file."""
    _security_check(file_path)
    with open(file_path, 'r', encoding='utf-8', errors='replace') as f:
        return f.read()


def extract_epub(file_path):
    """Extract text from an EPUB file using zipfile + html.parser.

    EPUBs are ZIP archives containing XHTML content files.
    We read the OPF manifest to find content documents, then
    strip HTML to get raw text.
    """
    _security_check(file_path)
    texts = []
    try:
        with zipfile.ZipFile(file_path, 'r') as zf:
            # Find the OPF file (rootfile in META-INF/container.xml)
            opf_path = None
            try:
                container = zf.read('META-INF/container.xml').decode('utf-8', errors='replace')
                # Extract rootfile full-path attribute
                m = re.search(r'rootfile[^>]+full-path="([^"]+)"', container)
                if m:
                    opf_path = m.group(1)
            except (KeyError, Exception):
                pass

            # Fallback: find any .opf file
            if not opf_path:
                for name in zf.namelist():
                    if name.endswith('.opf'):
                        opf_path = name
                        break

            if not opf_path:
                # Last resort: just grab all HTML/XHTML files
                for name in sorted(zf.namelist()):
                    if name.endswith(('.html', '.xhtml', '.htm')):
                        raw = zf.read(name).decode('utf-8', errors='replace')
                        parser = _HTMLTextExtractor()
                        parser.feed(raw)
                        texts.append(parser.get_text())
                return '\n\n'.join(texts)

            # Parse OPF to get spine order
            opf_dir = os.path.dirname(opf_path) + '/' if '/' in opf_path else ''
            opf_content = zf.read(opf_path).decode('utf-8', errors='replace')

            # Extract manifest items: id → href
            manifest = {}
            for m in re.finditer(r'<item[^>]+id="([^"]+)"[^>]+href="([^"]+)"', opf_content):
                manifest[m.group(1)] = m.group(2)
            # Also handle reversed attribute order
            for m in re.finditer(r'<item[^>]+href="([^"]+)"[^>]+id="([^"]+)"', opf_content):
                manifest[m.group(2)] = m.group(1)

            # Extract spine order
            spine_ids = re.findall(r'<itemref[^>]+idref="([^"]+)"', opf_content)

            # Read content in spine order
            for item_id in spine_ids:
                href = manifest.get(item_id)
                if not href:
                    continue
                # Resolve relative path
                full_path = opf_dir + href if not href.startswith('/') else href[1:]
                try:
                    raw = zf.read(full_path).decode('utf-8', errors='replace')
                    parser = _HTMLTextExtractor()
                    parser.feed(raw)
                    text = parser.get_text().strip()
                    if text:
                        texts.append(text)
                except (KeyError, Exception):
                    continue

    except zipfile.BadZipFile:
        _log.error("Bad EPUB file (not a valid ZIP): %s", file_path)
        return ''
    except Exception as e:
        _log.error("EPUB extraction failed for %s: %s", file_path, e)
        return ''

    return '\n\n'.join(texts)


def extract_pdf(file_path):
    """Extract text from a PDF.

    Strategy (ordered by quality):
      1. Use bundled pdftotext binary if available (best output)
      2. Fall back to pure-Python PDF parser (stdlib-only, zero deps)
    """
    _security_check(file_path)

    # ── Strategy 1: bundled pdftotext binary ──
    pdftotext = _get_pdftotext_path()
    if os.path.isfile(pdftotext):
        import subprocess
        try:
            result = subprocess.run(
                [pdftotext, '-layout', file_path, '-'],
                capture_output=True, text=True, timeout=60
            )
            if result.returncode == 0 and result.stdout.strip():
                return result.stdout
            _log.warning("pdftotext returned no output (rc=%d), trying fallback",
                         result.returncode)
        except subprocess.TimeoutExpired:
            _log.warning("pdftotext timed out for %s, trying fallback", file_path)
        except Exception as e:
            _log.warning("pdftotext error for %s: %s, trying fallback", file_path, e)

    # ── Strategy 2: pure-Python PDF text extraction ──
    _log.info("Using pure-Python PDF extractor for %s", file_path)
    return _extract_pdf_fallback(file_path)


def _extract_pdf_fallback(file_path):
    """Pure-Python PDF text extraction. Zero external dependencies.

    Parses PDF content streams, decompresses FlateDecode streams,
    and extracts text from Tj/TJ/' operators.

    Handles most text-based PDFs. Does NOT handle:
      - Scanned/image-only PDFs (no text to extract)
      - CIDFont ToUnicode mappings (rare, complex CJK fonts)
      - Type3 fonts with custom glyph encodings
    """
    import zlib
    import struct

    try:
        with open(file_path, 'rb') as f:
            raw = f.read()
    except Exception as e:
        _log.error("Failed to read PDF %s: %s", file_path, e)
        return ''

    # Validate PDF header
    if not raw.startswith(b'%PDF'):
        _log.error("Not a valid PDF file: %s", file_path)
        return ''

    texts = []

    # Find all stream...endstream blocks
    stream_re = re.compile(rb'stream\r?\n(.+?)endstream', re.DOTALL)

    for match in stream_re.finditer(raw):
        stream_data = match.group(1)

        # Try to decompress (most PDF streams are FlateDecode)
        content = None
        try:
            content = zlib.decompress(stream_data)
        except zlib.error:
            # Not compressed or different compression — try raw
            content = stream_data

        if not content:
            continue

        # Extract text from PDF text operators:
        #   (text) Tj          — show string
        #   [(text) num ...] TJ — show with kerning
        #   (text) '           — move to next line and show
        #   (text) "           — set spacing, move, show

        # Extract Tj strings: (text) Tj
        for tj_match in re.finditer(rb'\(([^)]*)\)\s*Tj', content):
            text = _pdf_decode_string(tj_match.group(1))
            if text.strip():
                texts.append(text)

        # Extract TJ arrays: [(text) num (text) ...] TJ
        for tj_match in re.finditer(rb'\[([^\]]+)\]\s*TJ', content):
            array_content = tj_match.group(1)
            parts = []
            for s in re.finditer(rb'\(([^)]*)\)', array_content):
                decoded = _pdf_decode_string(s.group(1))
                parts.append(decoded)
            combined = ''.join(parts)
            if combined.strip():
                texts.append(combined)

        # Extract ' operator: (text) '
        for q_match in re.finditer(rb"\(([^)]*)\)\s*'", content):
            text = _pdf_decode_string(q_match.group(1))
            if text.strip():
                texts.append('\n' + text)

    result = ' '.join(texts)

    if not result.strip():
        _log.warning("No text extracted from PDF %s (may be image-only)", file_path)
        return ''

    _log.info("Pure-Python PDF extractor: %d chars from %s", len(result), file_path)
    return result


def _pdf_decode_string(raw_bytes):
    """Decode a PDF string literal, handling escape sequences."""
    # PDF escape sequences: \\n, \\r, \\t, \\(, \\), \\\\, \\NNN (octal)
    result = bytearray()
    i = 0
    while i < len(raw_bytes):
        if raw_bytes[i:i+1] == b'\\' and i + 1 < len(raw_bytes):
            c = raw_bytes[i+1:i+2]
            if c == b'n':
                result.append(0x0A)
                i += 2
            elif c == b'r':
                result.append(0x0D)
                i += 2
            elif c == b't':
                result.append(0x09)
                i += 2
            elif c in (b'(', b')', b'\\'):
                result.append(c[0])
                i += 2
            elif c.isdigit():
                # Octal escape: up to 3 digits
                octal = b''
                for j in range(3):
                    if i + 1 + j < len(raw_bytes) and raw_bytes[i+1+j:i+2+j].isdigit():
                        octal += raw_bytes[i+1+j:i+2+j]
                    else:
                        break
                if octal:
                    result.append(int(octal, 8) & 0xFF)
                    i += 1 + len(octal)
                else:
                    result.append(raw_bytes[i])
                    i += 1
            else:
                result.append(raw_bytes[i])
                i += 1
        else:
            result.append(raw_bytes[i])
            i += 1

    try:
        return result.decode('utf-8', errors='replace')
    except Exception:
        return result.decode('latin-1', errors='replace')


def _get_pdftotext_path():
    """Return the path to the platform-specific bundled pdftotext binary."""
    import platform
    tools_dir = os.path.join(SCRIPT_DIR, 'tools')
    if sys.platform == 'darwin':
        return os.path.join(tools_dir, 'pdftotext-mac')
    elif sys.platform == 'win32':
        return os.path.join(tools_dir, 'pdftotext-windows.exe')
    else:
        arch = platform.machine().lower()
        if 'aarch64' in arch or 'arm64' in arch:
            return os.path.join(tools_dir, 'pdftotext-linux-arm64')
        return os.path.join(tools_dir, 'pdftotext-linux-x64')


def extract_text(file_path):
    """Auto-detect file type and extract text. Returns string or empty."""
    _security_check(file_path)  # Security gate — always first

    # Guard against oversized files that could OOM low-RAM systems
    try:
        file_size = os.path.getsize(file_path)
        if file_size > MAX_FILE_SIZE:
            _log.warning(
                "File too large for indexing (%d MB, max %d MB): %s",
                file_size // (1024 * 1024),
                MAX_FILE_SIZE // (1024 * 1024),
                file_path
            )
            return ''
    except OSError:
        pass  # File size check is non-critical; let extraction handle errors

    _, ext = os.path.splitext(file_path.lower())
    if ext == '.txt':
        return extract_txt(file_path)
    elif ext == '.epub':
        return extract_epub(file_path)
    elif ext == '.pdf':
        return extract_pdf(file_path)
    else:
        _log.warning("Unsupported file type for RAG indexing: %s", ext)
        return ''


# ══════════════════════════════════════════════════════════════
# CHUNKING
# ══════════════════════════════════════════════════════════════

def chunk_text(text, chunk_size=CHUNK_SIZE, overlap=CHUNK_OVERLAP):
    """Split text into overlapping chunks of approximately `chunk_size` tokens.

    Uses word-boundary splitting. Each chunk overlaps with the previous
    by `overlap` tokens worth of text for context continuity.

    Returns list of dicts: [{'text': str, 'index': int}, ...]
    """
    if not text or not text.strip():
        return []

    # Normalize whitespace
    text = re.sub(r'\s+', ' ', text).strip()
    words = text.split()

    if not words:
        return []

    # Estimate: 1 token ≈ 0.75 words for English text
    words_per_chunk = int(chunk_size * 0.75)
    overlap_words = int(overlap * 0.75)

    if words_per_chunk < 10:
        words_per_chunk = 10
    if overlap_words < 0:
        overlap_words = 0

    chunks = []
    start = 0
    idx = 0

    while start < len(words):
        end = min(start + words_per_chunk, len(words))
        chunk_text_str = ' '.join(words[start:end])
        if chunk_text_str.strip():
            chunks.append({'text': chunk_text_str, 'index': idx})
            idx += 1

        if idx >= MAX_CHUNKS_PER_FILE:
            _log.warning("Chunk cap reached (%d) — truncating", MAX_CHUNKS_PER_FILE)
            break

        # Advance with overlap
        start = end - overlap_words
        if start >= end:
            break  # Prevent infinite loop on tiny texts

    return chunks


# ══════════════════════════════════════════════════════════════
# EMBEDDINGS — Ollama /api/embed
# ══════════════════════════════════════════════════════════════

def get_embeddings(texts, model_name, ollama_port=11434):
    """Get embeddings for a list of texts via Ollama /api/embed.

    Batches requests to avoid payload-size limits on the embedding model.

    Args:
        texts: List of strings to embed
        model_name: Ollama model name (e.g. 'all-minilm')
        ollama_port: Ollama HTTP port

    Returns:
        List of embedding vectors (list of floats), or empty list on failure.
    """
    if not texts:
        return []

    url = f'http://127.0.0.1:{ollama_port}/api/embed'
    BATCH_SIZE = 32  # Safe batch size for embedding models
    all_embeddings = []

    for batch_start in range(0, len(texts), BATCH_SIZE):
        batch = texts[batch_start:batch_start + BATCH_SIZE]
        try:
            body = json.dumps({
                'model': model_name,
                'input': batch,
            }).encode('utf-8')

            req = urllib.request.Request(
                url,
                data=body,
                headers={'Content-Type': 'application/json'},
                method='POST',
            )

            with urllib.request.urlopen(req, timeout=120) as resp:
                data = json.loads(resp.read().decode('utf-8'))
                embeddings = data.get('embeddings', [])
                if len(embeddings) != len(batch):
                    _log.error(
                        "Embedding count mismatch in batch %d-%d: sent %d texts, got %d embeddings",
                        batch_start, batch_start + len(batch), len(batch), len(embeddings)
                    )
                    return []
                all_embeddings.extend(embeddings)

        except Exception as e:
            _log.error("Embedding request failed for batch %d-%d: %s",
                       batch_start, batch_start + len(batch), e)
            return []

    return all_embeddings


# ══════════════════════════════════════════════════════════════
# COSINE SIMILARITY — Pure Python, stdlib only
# ══════════════════════════════════════════════════════════════

def _cosine_similarity(vec_a, vec_b):
    """Compute cosine similarity between two vectors. Returns float [-1, 1]."""
    dot = sum(a * b for a, b in zip(vec_a, vec_b))
    mag_a = math.sqrt(sum(a * a for a in vec_a))
    mag_b = math.sqrt(sum(b * b for b in vec_b))
    if mag_a == 0 or mag_b == 0:
        return 0.0
    return dot / (mag_a * mag_b)


def search_index(query_embedding, index_data, top_k=TOP_K):
    """Search a .beacon-index for the most relevant chunks.

    Args:
        query_embedding: Embedding vector for the user's question
        index_data: Parsed .beacon-index JSON dict
        top_k: Number of results to return

    Returns:
        List of dicts: [{'text': str, 'score': float, 'index': int}, ...]
        Sorted by score descending.
    """
    chunks = index_data.get('chunks', [])
    embeddings = index_data.get('embeddings', [])

    if not chunks or not embeddings or len(chunks) != len(embeddings):
        return []

    scored = []
    for i, emb in enumerate(embeddings):
        score = _cosine_similarity(query_embedding, emb)
        scored.append({
            'text': chunks[i]['text'],
            'score': score,
            'index': chunks[i].get('index', i),
        })

    scored.sort(key=lambda x: x['score'], reverse=True)
    return scored[:top_k]


# ══════════════════════════════════════════════════════════════
# INDEX FILE I/O — .beacon-index JSON
# ══════════════════════════════════════════════════════════════

def _index_path(file_path):
    """Return the .beacon-index path for a given content file."""
    return file_path + '.beacon-index'


def load_index(file_path):
    """Load a .beacon-index file. Returns dict or None if not found/corrupt."""
    idx_path = _index_path(file_path)
    if not os.path.isfile(idx_path):
        return None
    try:
        with open(idx_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        if data.get('version') != INDEX_VERSION:
            _log.info("Index version mismatch for %s — re-index needed", file_path)
            return None
        return data
    except (json.JSONDecodeError, OSError) as e:
        _log.error("Failed to load index %s: %s", idx_path, e)
        return None


def save_index(file_path, chunks, embeddings, file_mtime):
    """Save a .beacon-index file for a content file.

    SECURITY: This function calls _security_check before writing.
    """
    _security_check(file_path)
    idx_path = _index_path(file_path)
    data = {
        'version': INDEX_VERSION,
        'file': os.path.basename(file_path),
        'file_mtime': file_mtime,
        'indexed_at': time.time(),
        'chunk_count': len(chunks),
        'chunks': chunks,
        'embeddings': embeddings,
    }
    try:
        with open(idx_path, 'w', encoding='utf-8') as f:
            json.dump(data, f)
        _log.info("Saved index: %s (%d chunks)", idx_path, len(chunks))
    except OSError as e:
        _log.error("Failed to save index %s: %s", idx_path, e)


# ══════════════════════════════════════════════════════════════
# HIGH-LEVEL API — Index + Query
# ══════════════════════════════════════════════════════════════

def index_file(file_path, model_name, ollama_port=11434, force=False):
    """Index a single file: extract → chunk → embed → save .beacon-index.

    Args:
        file_path: Absolute path to the content file
        model_name: Ollama model name for embeddings
        ollama_port: Ollama HTTP port
        force: If True, re-index even if .beacon-index exists and is fresh

    Returns:
        dict with 'ok', 'chunks', and optional 'error' key.

    Raises:
        RAGSecurityError: If the file is encrypted or in a locked directory.
    """
    # ── SECURITY GATE — FIRST CHECK, ALWAYS ──
    _security_check(file_path)

    if not os.path.isfile(file_path):
        return {'ok': False, 'error': f'File not found: {file_path}', 'chunks': 0}

    # Check if index is already fresh
    if not force:
        existing = load_index(file_path)
        if existing:
            file_mtime = os.path.getmtime(file_path)
            if existing.get('file_mtime') == file_mtime:
                _log.info("Index is fresh for %s — skipping", file_path)
                return {'ok': True, 'chunks': existing['chunk_count'], 'cached': True}

    _log.info("Indexing file: %s", file_path)

    # Extract text
    text = extract_text(file_path)
    if not text or not text.strip():
        return {'ok': False, 'error': 'No text extracted from file', 'chunks': 0}

    # Chunk
    chunks = chunk_text(text)
    if not chunks:
        return {'ok': False, 'error': 'No chunks generated', 'chunks': 0}

    _log.info("Chunked into %d pieces", len(chunks))

    # Embed — batch all chunk texts
    chunk_texts = [c['text'] for c in chunks]
    embeddings = get_embeddings(chunk_texts, model_name, ollama_port)
    if not embeddings:
        return {'ok': False, 'error': 'Embedding generation failed', 'chunks': 0}

    # Save
    file_mtime = os.path.getmtime(file_path)
    save_index(file_path, chunks, embeddings, file_mtime)

    return {'ok': True, 'chunks': len(chunks)}


def query_file(file_path, question, model_name, ollama_port=11434, top_k=TOP_K):
    """Query a file's .beacon-index with a natural language question.

    Args:
        file_path: Absolute path to the content file
        question: User's question string
        model_name: Ollama model name for query embedding
        ollama_port: Ollama HTTP port
        top_k: Number of chunks to return

    Returns:
        dict with 'ok', 'results' (list of {text, score}), and optional 'error'.
    """
    # Load index
    index = load_index(file_path)
    if not index:
        return {'ok': False, 'error': 'No index found. Index the file first.', 'results': []}

    # Embed the question
    q_embeddings = get_embeddings([question], model_name, ollama_port)
    if not q_embeddings:
        return {'ok': False, 'error': 'Failed to embed query', 'results': []}

    # Search
    results = search_index(q_embeddings[0], index, top_k=top_k)
    return {'ok': True, 'results': results}


def cleanup_orphaned_indexes(directory):
    """Remove .beacon-index files whose source content file no longer exists.

    Walks `directory` recursively, finds all *.beacon-index files, and deletes
    any whose corresponding source file (filename minus '.beacon-index') is gone.

    Returns dict: {'removed': int, 'kept': int, 'errors': int}
    """
    removed = 0
    kept = 0
    errors = 0

    for dirpath, _, filenames in os.walk(directory):
        for fname in filenames:
            if not fname.endswith('.beacon-index'):
                continue
            idx_path = os.path.join(dirpath, fname)
            # Source file = strip '.beacon-index' suffix
            source_path = idx_path[:-len('.beacon-index')]
            if not os.path.isfile(source_path):
                try:
                    os.remove(idx_path)
                    _log.info("Removed orphaned index: %s", idx_path)
                    removed += 1
                except OSError as e:
                    _log.error("Failed to remove orphaned index %s: %s", idx_path, e)
                    errors += 1
            else:
                kept += 1

    return {'removed': removed, 'kept': kept, 'errors': errors}
