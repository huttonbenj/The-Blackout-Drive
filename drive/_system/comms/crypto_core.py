"""
comms/crypto_core.py - AES-256-GCM primitives via libcrypto (ctypes).

Zero external Python dependencies. Uses the system's OpenSSL libcrypto
directly through ctypes bindings for AES-256-GCM encryption/decryption
and PBKDF2-HMAC-SHA256 key derivation.

This module is the single source of truth for all cryptographic operations
in the Blackout Drive: file vault encryption (V3 Segmented AEAD), COMMS
store encryption, and key derivation.

V3 Architecture: Every encrypted file uses the STREAM construction —
per-segment AES-256-GCM with monotonic nonce derivation and explicit AAD
for anti-truncation and anti-reordering guarantees.

Copyright (c) 2026 Hutton Technologies LLC — Licensed under BSL 1.1
"""

import ctypes
import ctypes.util
import hashlib
import os
import sys
import threading

# ── Constants ─────────────────────────────────────────────────
GCM_NONCE_LEN = 12
GCM_TAG_LEN = 16
KEY_LEN = 32  # AES-256

# V3 Segmented AEAD constants
V3_SEGMENT_SIZE = 65536        # 64KB plaintext per segment
V3_BASE_NONCE_LEN = 8          # Random bytes stored in file header
V3_SEGMENT_HEADER_LEN = 4      # uint32: bit 31 = final, bits 0-30 = length

# EVP_CTRL constants
_EVP_CTRL_GCM_SET_IVLEN = 0x09
_EVP_CTRL_GCM_GET_TAG = 0x10
_EVP_CTRL_GCM_SET_TAG = 0x11


# ══════════════════════════════════════════════════════════════
# LIBCRYPTO LOADING
# ══════════════════════════════════════════════════════════════

def _load_libcrypto():
    """Load libcrypto and bind the EVP functions we need."""
    path = ctypes.util.find_library('crypto')
    if not path:
        # Build platform-specific fallback search list.
        # On Windows, the bundled Python ships libcrypto-3.dll alongside
        # python.exe — check the interpreter's directory first.
        candidates = []

        if sys.platform == 'win32':
            # Bundled Python runtime directory (highest priority)
            _pydir = os.path.dirname(sys.executable)
            candidates += [
                os.path.join(_pydir, 'libcrypto-3.dll'),
                os.path.join(_pydir, 'libcrypto-3-x64.dll'),
                os.path.join(_pydir, 'libcrypto-1_1-x64.dll'),
                os.path.join(_pydir, 'libcrypto.dll'),
                # Common system-wide OpenSSL installs on Windows
                r'C:\Program Files\OpenSSL-Win64\libcrypto-3-x64.dll',
                r'C:\OpenSSL-Win64\libcrypto-3-x64.dll',
            ]
        else:
            # macOS
            candidates += [
                '/opt/homebrew/lib/libcrypto.dylib',
                '/usr/local/lib/libcrypto.dylib',
                '/usr/lib/libcrypto.dylib',
            ]
            # Linux x86_64 + ARM64
            candidates += [
                '/usr/lib/libcrypto.so',
                '/usr/lib/x86_64-linux-gnu/libcrypto.so',
                '/usr/lib/aarch64-linux-gnu/libcrypto.so',
                '/usr/lib64/libcrypto.so',
            ]

        for candidate in candidates:
            if os.path.exists(candidate):
                path = candidate
                break
    if not path:
        raise RuntimeError(
            'libcrypto not found. OpenSSL is required for encrypted operations. '
            'On Windows, ensure the bundled Python runtime is intact.'
        )
    lib = ctypes.cdll.LoadLibrary(path)

    # Bind EVP_aes_256_gcm
    lib.EVP_aes_256_gcm.restype = ctypes.c_void_p
    lib.EVP_aes_256_gcm.argtypes = []

    # EVP_CIPHER_CTX lifecycle
    lib.EVP_CIPHER_CTX_new.restype = ctypes.c_void_p
    lib.EVP_CIPHER_CTX_new.argtypes = []
    lib.EVP_CIPHER_CTX_free.restype = None
    lib.EVP_CIPHER_CTX_free.argtypes = [ctypes.c_void_p]

    # EVP_EncryptInit_ex / DecryptInit_ex
    lib.EVP_EncryptInit_ex.restype = ctypes.c_int
    lib.EVP_EncryptInit_ex.argtypes = [
        ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p,
        ctypes.c_char_p, ctypes.c_char_p,
    ]
    lib.EVP_DecryptInit_ex.restype = ctypes.c_int
    lib.EVP_DecryptInit_ex.argtypes = [
        ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p,
        ctypes.c_char_p, ctypes.c_char_p,
    ]

    # EVP_EncryptUpdate / DecryptUpdate
    lib.EVP_EncryptUpdate.restype = ctypes.c_int
    lib.EVP_EncryptUpdate.argtypes = [
        ctypes.c_void_p, ctypes.c_char_p,
        ctypes.POINTER(ctypes.c_int), ctypes.c_char_p, ctypes.c_int,
    ]
    lib.EVP_DecryptUpdate.restype = ctypes.c_int
    lib.EVP_DecryptUpdate.argtypes = [
        ctypes.c_void_p, ctypes.c_char_p,
        ctypes.POINTER(ctypes.c_int), ctypes.c_char_p, ctypes.c_int,
    ]

    # EVP_EncryptFinal_ex / DecryptFinal_ex
    lib.EVP_EncryptFinal_ex.restype = ctypes.c_int
    lib.EVP_EncryptFinal_ex.argtypes = [
        ctypes.c_void_p, ctypes.c_char_p, ctypes.POINTER(ctypes.c_int),
    ]
    lib.EVP_DecryptFinal_ex.restype = ctypes.c_int
    lib.EVP_DecryptFinal_ex.argtypes = [
        ctypes.c_void_p, ctypes.c_char_p, ctypes.POINTER(ctypes.c_int),
    ]

    # EVP_CIPHER_CTX_ctrl (for setting/getting GCM tag)
    lib.EVP_CIPHER_CTX_ctrl.restype = ctypes.c_int
    lib.EVP_CIPHER_CTX_ctrl.argtypes = [
        ctypes.c_void_p, ctypes.c_int, ctypes.c_int, ctypes.c_void_p,
    ]

    return lib


# Lazy singleton
_libcrypto = None
_libcrypto_lock = threading.Lock()

def _get_libcrypto():
    global _libcrypto
    if _libcrypto is None:
        with _libcrypto_lock:
            if _libcrypto is None:
                _libcrypto = _load_libcrypto()
    return _libcrypto


# ══════════════════════════════════════════════════════════════
# KEY DERIVATION
# ══════════════════════════════════════════════════════════════

def derive_key(salt, seed):
    """Derive AES-256 key via PBKDF2-HMAC-SHA256.

    Args:
        salt: bytes - random salt for PBKDF2
        seed: str or bytes - password or seed material
    Returns:
        bytes - 32-byte AES-256 key
    """
    if isinstance(seed, str):
        seed = seed.encode()
    return hashlib.pbkdf2_hmac('sha256', seed, salt, 100_000, dklen=KEY_LEN)




# ══════════════════════════════════════════════════════════════
# AES-256-GCM SEGMENT ENCRYPT / DECRYPT (V3 STREAM Construction)
# ══════════════════════════════════════════════════════════════


#
# Each segment is an independent AES-256-GCM operation with:
#   - Deterministic nonce: base_nonce[8] || counter[4]
#   - Explicit AAD: counter[4] || final_flag[1]
#
# This provides per-segment authentication, anti-truncation
# (via the final flag in AAD), and anti-reordering (via the
# monotonic counter in both nonce and AAD).

def aes_gcm_encrypt_segment(key, nonce_12, plaintext, aad):
    """Encrypt a single segment with AES-256-GCM and explicit AAD.

    Args:
        key: 32-byte AES-256 key
        nonce_12: 12-byte nonce (base_nonce[8] + counter[4])
        plaintext: bytes to encrypt (up to V3_SEGMENT_SIZE)
        aad: Additional Authenticated Data (counter + final flag)

    Returns:
        (ciphertext: bytes, tag: 16 bytes)
    """
    lib = _get_libcrypto()
    ctx = lib.EVP_CIPHER_CTX_new()
    if not ctx:
        raise RuntimeError('EVP_CIPHER_CTX_new failed')
    try:
        cipher = lib.EVP_aes_256_gcm()

        if lib.EVP_EncryptInit_ex(ctx, cipher, None, None, None) != 1:
            raise RuntimeError('EncryptInit (cipher) failed')
        if lib.EVP_CIPHER_CTX_ctrl(ctx, _EVP_CTRL_GCM_SET_IVLEN,
                                    GCM_NONCE_LEN, None) != 1:
            raise RuntimeError('Set IV length failed')
        if lib.EVP_EncryptInit_ex(ctx, None, None, key, nonce_12) != 1:
            raise RuntimeError('EncryptInit (key/nonce) failed')

        # Feed AAD (authenticated but not encrypted)
        if aad:
            aad_outlen = ctypes.c_int(0)
            if lib.EVP_EncryptUpdate(ctx, None, ctypes.byref(aad_outlen),
                                      aad, len(aad)) != 1:
                raise RuntimeError('EncryptUpdate (AAD) failed')

        # Encrypt plaintext
        outbuf = ctypes.create_string_buffer(len(plaintext) + 16)
        outlen = ctypes.c_int(0)
        if lib.EVP_EncryptUpdate(ctx, outbuf, ctypes.byref(outlen),
                                  plaintext, len(plaintext)) != 1:
            raise RuntimeError('EncryptUpdate failed')
        ct_len = outlen.value

        # Finalize
        finalbuf = ctypes.create_string_buffer(16)
        finallen = ctypes.c_int(0)
        if lib.EVP_EncryptFinal_ex(ctx, finalbuf, ctypes.byref(finallen)) != 1:
            raise RuntimeError('EncryptFinal failed')
        ct_len += finallen.value

        # Extract GCM tag
        tag = ctypes.create_string_buffer(GCM_TAG_LEN)
        if lib.EVP_CIPHER_CTX_ctrl(ctx, _EVP_CTRL_GCM_GET_TAG,
                                    GCM_TAG_LEN, tag) != 1:
            raise RuntimeError('Get GCM tag failed')

        return outbuf.raw[:ct_len], tag.raw

    finally:
        lib.EVP_CIPHER_CTX_free(ctx)


def aes_gcm_decrypt_segment(key, nonce_12, ciphertext, tag, aad):
    """Decrypt a single segment with AES-256-GCM and explicit AAD.

    Args:
        key: 32-byte AES-256 key
        nonce_12: 12-byte nonce (base_nonce[8] + counter[4])
        ciphertext: bytes to decrypt
        tag: 16-byte GCM authentication tag
        aad: Additional Authenticated Data (counter + final flag)

    Returns:
        plaintext bytes

    Raises:
        ValueError on authentication failure (wrong password or tampered data)
    """
    lib = _get_libcrypto()
    ctx = lib.EVP_CIPHER_CTX_new()
    if not ctx:
        raise RuntimeError('EVP_CIPHER_CTX_new failed')
    try:
        cipher = lib.EVP_aes_256_gcm()

        if lib.EVP_DecryptInit_ex(ctx, cipher, None, None, None) != 1:
            raise RuntimeError('DecryptInit (cipher) failed')
        if lib.EVP_CIPHER_CTX_ctrl(ctx, _EVP_CTRL_GCM_SET_IVLEN,
                                    GCM_NONCE_LEN, None) != 1:
            raise RuntimeError('Set IV length failed')
        if lib.EVP_DecryptInit_ex(ctx, None, None, key, nonce_12) != 1:
            raise RuntimeError('DecryptInit (key/nonce) failed')

        # Feed AAD
        if aad:
            aad_outlen = ctypes.c_int(0)
            if lib.EVP_DecryptUpdate(ctx, None, ctypes.byref(aad_outlen),
                                      aad, len(aad)) != 1:
                raise RuntimeError('DecryptUpdate (AAD) failed')

        # Decrypt ciphertext
        outbuf = ctypes.create_string_buffer(len(ciphertext) + 16)
        outlen = ctypes.c_int(0)
        if lib.EVP_DecryptUpdate(ctx, outbuf, ctypes.byref(outlen),
                                  ciphertext, len(ciphertext)) != 1:
            raise RuntimeError('DecryptUpdate failed')
        pt_len = outlen.value

        # Set expected tag before finalize
        tag_buf = ctypes.create_string_buffer(tag)
        if lib.EVP_CIPHER_CTX_ctrl(ctx, _EVP_CTRL_GCM_SET_TAG,
                                    GCM_TAG_LEN, tag_buf) != 1:
            raise RuntimeError('Set GCM tag failed')

        # Finalize — verifies authentication tag
        finalbuf = ctypes.create_string_buffer(16)
        finallen = ctypes.c_int(0)
        if lib.EVP_DecryptFinal_ex(ctx, finalbuf, ctypes.byref(finallen)) != 1:
            raise ValueError('Segment authentication failed')
        pt_len += finallen.value

        return outbuf.raw[:pt_len]

    finally:
        lib.EVP_CIPHER_CTX_free(ctx)
