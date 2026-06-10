"""
comms/filecrypt.py - V3 Segmented AEAD file encryption for the Blackout Drive.

Unified cryptographic pipeline: every encrypted file on this drive — from
the 2KB vault manifest to a 50GB database — uses the same V3 architecture.

File format: .bkv (Blackout Vault) V3

  Offset  Size    Field
  ──────  ────    ─────
  0       4       Magic: "BKVF" (0x424B5646)
  4       1       Version: 0x03
  5       32      Salt (random, for PBKDF2 key derivation)
  37      8       Base Nonce (random, first 8 bytes of per-segment nonce)
  45      ...     Segment stream (concatenated segments)

  Each segment:
    [4 bytes]  Segment header: bit 31 = final flag, bits 0-30 = plaintext length
    [N bytes]  Ciphertext (same length as plaintext — GCM is CTR-based)
    [16 bytes] GCM authentication tag

  Per-segment nonce (12 bytes):
    Bytes 0-7:   base_nonce (from file header)
    Bytes 8-11:  segment_counter (big-endian uint32)

  Per-segment AAD (5 bytes):
    [4 bytes] segment_counter (big-endian uint32)
    [1 byte]  final flag (0x00 or 0x01)

  Anti-tampering properties:
    - Truncation:  Final flag in AAD — last segment must have final=1
    - Reordering:  Counter in nonce+AAD — swapping segments breaks GCM auth
    - Duplication:  Monotonic counter — duplicate positions fail auth
    - Bit-flip:    Per-segment GCM tag — corruption detected at exact segment
    - Wrong key:   Segment 0 auth fails immediately — fast rejection

  Payload structure:
    Segment 0 contains: {"name":"filename.ext","size":<int>}\\n[file data...]
    Remaining segments contain raw file data.

  Maximum file size: 2^31 segments × 64KB = 128TB

Copyright (c) 2026 Hutton Technologies LLC — Licensed under BSL 1.1
"""

import json
import logging
import os
import struct

from .crypto_core import (
    derive_key,
    aes_gcm_encrypt_segment, aes_gcm_decrypt_segment,
    GCM_TAG_LEN, V3_SEGMENT_SIZE, V3_BASE_NONCE_LEN,
)

_log = logging.getLogger('filecrypt')

# ── Constants ─────────────────────────────────────────────────
_MAGIC = b'BKVF'
_VERSION_V3 = 0x03
_SALT_LEN = 32

# V3 file header: magic(4) + version(1) + salt(32) + base_nonce(8) = 45 bytes
_V3_HEADER_LEN = 4 + 1 + _SALT_LEN + V3_BASE_NONCE_LEN

# Segment header: uint32 with bit 31 as final flag
_FINAL_FLAG = 0x80000000

# Min valid .bkv size: header(45) + 1 segment with 1 byte plaintext:
#   seg_header(4) + ciphertext(1) + tag(16) = 21
_BKV_MIN_SIZE = _V3_HEADER_LEN + 4 + 1 + GCM_TAG_LEN


# ── Nonce / AAD Derivation ───────────────────────────────────

def _v3_segment_nonce(base_nonce, counter):
    """Derive the 12-byte GCM nonce for a segment.
    base_nonce[8] || counter[4 big-endian]"""
    return base_nonce + struct.pack('>I', counter)


def _v3_segment_aad(counter, is_final):
    """Build the 5-byte AAD for a segment.
    counter[4 big-endian] || final_flag[1]"""
    return struct.pack('>I', counter) + (b'\x01' if is_final else b'\x00')


# ── Atomic File Safety ───────────────────────────────────────

def _safe_bkv_replace(tmp_path, dest_path):
    """Validate a .tmp .bkv file before atomic replace.
    Checks file exists, meets minimum size, and has correct magic bytes.
    Raises OSError if validation fails (preserving the original file)."""
    if not os.path.isfile(tmp_path):
        raise OSError(f'BKV replace failed: {tmp_path} does not exist')
    size = os.path.getsize(tmp_path)
    if size < _BKV_MIN_SIZE:
        try:
            os.remove(tmp_path)
        except OSError:
            pass
        raise OSError(f'BKV replace aborted: {tmp_path} is {size} bytes (min {_BKV_MIN_SIZE})')
    # Verify magic bytes
    with open(tmp_path, 'rb') as f:
        magic = f.read(4)
    if magic != _MAGIC:
        try:
            os.remove(tmp_path)
        except OSError:
            pass
        raise OSError(f'BKV replace aborted: {tmp_path} has wrong magic {magic!r}')
    os.replace(tmp_path, dest_path)


# ══════════════════════════════════════════════════════════════
# V3: STREAMING SEGMENTED AEAD ENCRYPTION
# ══════════════════════════════════════════════════════════════

def _encrypt_v3_stream(input_iter, dest_path, password, filename, file_size):
    """Streaming V3 Segmented AEAD encryption.

    Reads plaintext from input_iter in arbitrary-sized chunks, buffers them
    into 64KB segments, encrypts each with AES-256-GCM, and writes segments
    directly to disk. Peak memory: ~256KB regardless of file size.

    Args:
        input_iter: iterable yielding bytes chunks (any size)
        dest_path: output .bkv file path
        password: master password string
        filename: original filename (stored in encrypted metadata header)
        file_size: total file size in bytes (for metadata header)
    """
    salt = os.urandom(_SALT_LEN)
    key = derive_key(salt, password)
    base_nonce = os.urandom(V3_BASE_NONCE_LEN)

    # Build the JSON metadata header (first bytes of the payload)
    header_line = json.dumps({
        'name': filename,
        'size': file_size,
    }, separators=(',', ':')).encode('utf-8') + b'\n'

    tmp_path = dest_path + '.tmp'
    counter = 0
    buf = bytearray(header_line)
    input_exhausted = False

    try:
        with open(tmp_path, 'wb') as f:
            # Write file header
            f.write(_MAGIC)
            f.write(bytes([_VERSION_V3]))
            f.write(salt)
            f.write(base_nonce)

            while True:
                # Fill buffer to segment size from input
                while len(buf) < V3_SEGMENT_SIZE and not input_exhausted:
                    try:
                        chunk = next(input_iter)
                        if chunk:
                            buf.extend(chunk)
                    except StopIteration:
                        input_exhausted = True

                if not buf:
                    break

                # Extract one segment's worth of plaintext
                segment_data = bytes(buf[:V3_SEGMENT_SIZE])
                del buf[:V3_SEGMENT_SIZE]

                is_final = input_exhausted and len(buf) == 0

                # Encrypt segment
                nonce = _v3_segment_nonce(base_nonce, counter)
                aad = _v3_segment_aad(counter, is_final)
                ct, tag = aes_gcm_encrypt_segment(key, nonce, segment_data, aad)

                # Write segment: header(4) + ciphertext(N) + tag(16)
                seg_hdr = len(segment_data) | (_FINAL_FLAG if is_final else 0)
                f.write(struct.pack('>I', seg_hdr))
                f.write(ct)
                f.write(tag)

                counter += 1

                if is_final:
                    break

            f.flush()
            os.fsync(f.fileno())

        _safe_bkv_replace(tmp_path, dest_path)

    except Exception:
        # Clean up temp file on any failure
        try:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
        except OSError:
            pass
        raise


# ══════════════════════════════════════════════════════════════
# V3: STREAMING SEGMENTED AEAD DECRYPTION
# ══════════════════════════════════════════════════════════════

def _decrypt_v3_stream(src_path, salt, password):
    """Streaming V3 Segmented AEAD decryption — O(1) memory.

    Returns (header: dict, chunk_generator).
    The generator yields plaintext bytes in segment-sized chunks.
    Each segment is independently authenticated before any plaintext
    is released — no Release of Unverified Plaintext (RUP).

    Args:
        src_path: path to the .bkv v3 file
        salt: 32-byte salt (already read from file header)
        password: master password string

    Returns:
        (header: dict, data_chunks_generator)

    Raises:
        ValueError on wrong password, corrupt file, or tampered data
    """
    key = derive_key(salt, password)

    # Read base nonce from file header
    with open(src_path, 'rb') as f:
        f.seek(4 + 1 + _SALT_LEN)  # past magic + version + salt
        base_nonce = f.read(V3_BASE_NONCE_LEN)

    if len(base_nonce) != V3_BASE_NONCE_LEN:
        raise ValueError('Corrupt V3 file (truncated base nonce)')

    def _segment_iter():
        """Iterate over segments, yielding (plaintext, is_final) tuples."""
        counter = 0
        with open(src_path, 'rb') as f:
            f.seek(_V3_HEADER_LEN)
            while True:
                # Read segment header
                seg_hdr_bytes = f.read(4)
                if len(seg_hdr_bytes) == 0:
                    raise ValueError('Corrupt V3 file — unexpected EOF (no final segment)')
                if len(seg_hdr_bytes) < 4:
                    raise ValueError('Corrupt V3 file (truncated segment header)')

                seg_hdr = struct.unpack('>I', seg_hdr_bytes)[0]
                is_final = bool(seg_hdr & _FINAL_FLAG)
                pt_len = seg_hdr & ~_FINAL_FLAG

                if pt_len > V3_SEGMENT_SIZE:
                    raise ValueError(
                        f'Corrupt V3 file (segment {counter} claims {pt_len} bytes, '
                        f'max {V3_SEGMENT_SIZE})')
                if pt_len == 0 and not is_final:
                    raise ValueError(
                        f'Corrupt V3 file (empty non-final segment {counter})')

                # Read ciphertext + tag
                ct = f.read(pt_len)
                if len(ct) != pt_len:
                    raise ValueError(
                        f'Corrupt V3 file (truncated ciphertext at segment {counter})')
                tag = f.read(GCM_TAG_LEN)
                if len(tag) != GCM_TAG_LEN:
                    raise ValueError(
                        f'Corrupt V3 file (truncated tag at segment {counter})')

                # Decrypt and authenticate
                nonce = _v3_segment_nonce(base_nonce, counter)
                aad = _v3_segment_aad(counter, is_final)
                try:
                    plaintext = aes_gcm_decrypt_segment(key, nonce, ct, tag, aad)
                except ValueError:
                    if counter == 0:
                        raise ValueError('Wrong password')
                    raise ValueError(
                        f'Segment {counter} authentication failed — tampered data')

                yield plaintext, is_final

                if is_final:
                    return
                counter += 1

    # Parse the JSON metadata header from the first segment's plaintext
    seg_iter = _segment_iter()
    try:
        first_pt, first_is_final = next(seg_iter)
    except StopIteration:
        raise ValueError('Corrupt V3 file — no segments found')

    nl_idx = first_pt.find(b'\n')
    if nl_idx < 0:
        raise ValueError('Corrupt V3 payload — no header line found')

    header = json.loads(first_pt[:nl_idx].decode('utf-8'))
    leftover = first_pt[nl_idx + 1:]

    def data_chunks():
        """Yield file data chunks, stripping the metadata header."""
        if leftover:
            yield leftover
        if first_is_final:
            return
        for pt, is_final in seg_iter:
            yield pt
            if is_final:
                return

    return header, data_chunks()


# ══════════════════════════════════════════════════════════════
# BKV HEADER READER
# ══════════════════════════════════════════════════════════════

def _read_bkv_header(src_path):
    """Read and validate the .bkv file header. Returns (version, salt)."""
    with open(src_path, 'rb') as f:
        magic = f.read(4)
        if magic != _MAGIC:
            raise ValueError('Not a valid .bkv file (wrong magic)')
        version = f.read(1)
        if len(version) == 0:
            raise ValueError('Corrupt .bkv file (truncated)')
        salt = f.read(_SALT_LEN)
        if len(salt) != _SALT_LEN:
            raise ValueError('Corrupt .bkv file (truncated salt)')
    return version[0], salt


# ══════════════════════════════════════════════════════════════
# PUBLIC API — Unified V3 Pipeline
# ══════════════════════════════════════════════════════════════

def encrypt_stream(input_iter, dest_path, password, filename, file_size):
    """Streaming encryption — the primary API for large files.

    Encrypts data from an input iterator directly to a .bkv file on disk.
    Peak memory: ~256KB regardless of file size.

    Args:
        input_iter: iterable yielding bytes chunks (any size)
        dest_path: output .bkv file path
        password: master password string
        filename: original filename (stored in encrypted metadata)
        file_size: total file size in bytes

    Returns:
        (success: bool, error: str|None)
    """
    try:
        _encrypt_v3_stream(input_iter, dest_path, password, filename, file_size)
        _log.info('Encrypted stream (v3): %s → %s (%d bytes)',
                  filename, os.path.basename(dest_path),
                  os.path.getsize(dest_path))
        return True, None

    except Exception as e:
        for p in [dest_path + '.tmp', dest_path]:
            try:
                if os.path.exists(p):
                    os.remove(p)
            except OSError:
                pass
        _log.error('Stream encryption failed: %s', e)
        return False, str(e)


def encrypt_bytes(data, filename, dest_path, password):
    """Encrypt raw bytes to .bkv format.

    Convenience wrapper around encrypt_stream for in-memory data.
    Used for small payloads like the vault manifest.

    Args:
        data: bytes to encrypt
        filename: original filename (stored in encrypted metadata)
        dest_path: output .bkv path
        password: master password

    Returns:
        (success: bool, error: str|None)
    """
    def _data_iter():
        offset = 0
        while offset < len(data):
            yield data[offset:offset + V3_SEGMENT_SIZE]
            offset += V3_SEGMENT_SIZE

    return encrypt_stream(_data_iter(), dest_path, password, filename, len(data))


def encrypt_file(src_path, dest_path, password):
    """Encrypt a single file to .bkv format.

    Streams the source file from disk — O(1) memory.

    Args:
        src_path: path to the source file to encrypt
        dest_path: path for the output .bkv file
        password: master password string

    Returns:
        (success: bool, error: str|None)
    """
    try:
        file_size = os.path.getsize(src_path)
        filename = os.path.basename(src_path)

        def _file_iter():
            with open(src_path, 'rb') as f:
                while True:
                    chunk = f.read(V3_SEGMENT_SIZE)
                    if not chunk:
                        break
                    yield chunk

        return encrypt_stream(_file_iter(), dest_path, password, filename, file_size)

    except Exception as e:
        _log.error('File encryption failed: %s', e)
        return False, str(e)


def decrypt_to_stream(src_path, password):
    """Streaming decryption — O(1) memory for any file size.

    Args:
        src_path: path to the .bkv file
        password: master password string

    Returns:
        (header: dict, file_size: int, chunk_generator)
        chunk_generator yields plaintext bytes in ~64KB chunks.

    Raises:
        ValueError on wrong password, corrupt file, or format error
    """
    try:
        ver, salt = _read_bkv_header(src_path)
        if ver != _VERSION_V3:
            raise ValueError(
                f'Unsupported .bkv version: 0x{ver:02x}. '
                f'Only V3 (0x03) is supported. '
                f'This file may be from an older version of the drive.')
        header, chunks = _decrypt_v3_stream(src_path, salt, password)
        file_size = header.get('size', 0)
        return header, file_size, chunks
    except ValueError:
        raise
    except Exception as e:
        raise ValueError(f'Decryption failed: {e}')


def decrypt_to_bytes(src_path, password):
    """Decrypt a .bkv file and return raw bytes + metadata.

    Convenience wrapper for small files. For large files,
    prefer decrypt_to_stream().

    Args:
        src_path: path to the .bkv file
        password: master password string

    Returns:
        (file_data: bytes, header: dict)

    Raises:
        ValueError on wrong password, corrupt file, or format error
    """
    header, _, chunks = decrypt_to_stream(src_path, password)
    data = b''.join(chunks)
    return data, header


def decrypt_file(src_path, out_dir, password):
    """Decrypt a .bkv file to a directory (writes to disk).

    Uses streaming decryption — O(1) memory.

    Args:
        src_path: path to the .bkv file
        out_dir: directory to write the decrypted file into
        password: master password string

    Returns:
        (success: bool, error: str|None)
    """
    try:
        header, _, chunks = decrypt_to_stream(src_path, password)
        filename = header.get('name', 'decrypted_file')
        os.makedirs(out_dir, exist_ok=True)
        dest = os.path.join(out_dir, filename)
        bytes_written = 0
        with open(dest, 'wb') as f:
            for chunk in chunks:
                f.write(chunk)
                bytes_written += len(chunk)
        _log.info('Decrypted file (v3): %s → %s (%d bytes)',
                  os.path.basename(src_path), filename, bytes_written)
        return True, None
    except ValueError as e:
        return False, str(e)
    except Exception as e:
        _log.error('File decryption failed: %s', e)
        return False, str(e)
