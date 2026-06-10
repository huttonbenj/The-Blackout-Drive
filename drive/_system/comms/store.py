"""
comms/store.py - V3 Segmented AEAD encrypted message store for COMMS history.

Architecture:
  - Single .bkv V3 file containing all messages as encrypted JSON.
  - Uses the same V3 Segmented AEAD format as the file vault: per-segment
    AES-256-GCM with explicit AAD for anti-tampering guarantees.
  - Key derivation: PBKDF2-HMAC-SHA256 from the user's master password.
  - Log rotation: capped at MAX_ENTRIES. On overflow, oldest messages are
    dropped and the file is atomically rewritten.
  - Thread-safe: all writes go through a lock.
  - The store starts LOCKED. Call unlock(password) to enable read/write.

File format: comms_log.bkv (V3 Segmented AEAD — same as file vault)
  All messages serialized as JSON, encrypted as a single V3 .bkv file.
  On append, the entire store is rewritten atomically.

Copyright (c) 2026 Hutton Technologies LLC — Licensed under BSL 1.1
"""

import json
import logging
import os
import threading

from .crypto_core import derive_key, KEY_LEN
from .filecrypt import encrypt_bytes, decrypt_to_bytes

_log = logging.getLogger('comms.store')

MAX_ENTRIES = 1000


# =====================================================================
# COMMS STORE — V3 Unified Pipeline
# =====================================================================

class CommsStore:
    """Encrypted message store using V3 Segmented AEAD.

    The entire message history is stored as a single V3 .bkv file.
    On each write, the full history is serialized and re-encrypted.
    This is efficient because COMMS logs are small (< 1MB typically).

    The store starts LOCKED. Call unlock(password) to derive the key
    and enable read/write operations. When locked, append() is a no-op
    and load_all() returns [].

    Thread-safe. All disk I/O goes through self._lock.
    """

    def __init__(self, log_path):
        self._path = log_path
        self._lock = threading.Lock()
        self._password = None
        self._unlocked = False
        self._messages = []  # In-memory message cache

        os.makedirs(os.path.dirname(log_path), exist_ok=True)

    def is_unlocked(self):
        """Check if the store is unlocked and ready for read/write."""
        return self._unlocked

    def unlock(self, password):
        """Unlock the store with the user's master password.
        Returns True on success, False on wrong password.
        """
        with self._lock:
            if not os.path.isfile(self._path) or os.path.getsize(self._path) == 0:
                # No existing store — create empty
                self._password = password
                self._messages = []
                self._unlocked = True
                _log.info('COMMS store unlocked (new, empty)')
                return True

            try:
                data, header = decrypt_to_bytes(self._path, password)
                self._messages = json.loads(data.decode('utf-8'))
                if not isinstance(self._messages, list):
                    self._messages = []
                self._password = password
                self._unlocked = True
                _log.info('COMMS store unlocked: %d messages loaded', len(self._messages))
                return True

            except ValueError as e:
                if 'Wrong password' in str(e):
                    _log.warning('COMMS store unlock failed: wrong password')
                    return False
                # Corrupt file — start fresh
                _log.error('COMMS store corrupt (%s) — creating new store', e)
                self._password = password
                self._messages = []
                self._unlocked = True
                return True

            except Exception as e:
                _log.error('COMMS store unlock failed: %s — creating new store', e)
                self._password = password
                self._messages = []
                self._unlocked = True
                return True

    def lock(self):
        """Lock the store — clears password and message cache from memory."""
        with self._lock:
            self._password = None
            self._messages = []
            self._unlocked = False
            _log.info('COMMS store locked')

    def rekey(self, old_password, new_password):
        """Re-encrypt the COMMS store with a new password.

        Called during password change. Decrypts with old password,
        re-encrypts with new password atomically.
        """
        with self._lock:
            if not os.path.isfile(self._path) or os.path.getsize(self._path) == 0:
                self._password = new_password
                self._messages = []
                self._unlocked = True
                return True

            try:
                # Decrypt with old password
                data, _ = decrypt_to_bytes(self._path, old_password)
                messages = json.loads(data.decode('utf-8'))
                if not isinstance(messages, list):
                    messages = []

                # Re-encrypt with new password
                payload = json.dumps(messages, separators=(',', ':')).encode('utf-8')
                ok, err = encrypt_bytes(payload, 'comms_log.json', self._path, new_password)
                if not ok:
                    raise RuntimeError(f'Re-encryption failed: {err}')

                self._password = new_password
                self._messages = messages
                self._unlocked = True
                _log.info('COMMS store re-keyed: %d messages re-encrypted', len(messages))
                return True

            except Exception as e:
                _log.error('COMMS store rekey failed: %s', e)
                return False

    def append(self, msg):
        """Encrypt and append a message to the store.
        No-op if the store is locked."""
        if not self._unlocked or not self._password:
            return
        with self._lock:
            try:
                self._messages.append(msg)

                # Enforce rotation
                if len(self._messages) > MAX_ENTRIES:
                    self._messages = self._messages[-MAX_ENTRIES:]
                    _log.info('COMMS log rotated to %d entries', MAX_ENTRIES)

                # Serialize and encrypt the full message list
                payload = json.dumps(self._messages, separators=(',', ':')).encode('utf-8')
                ok, err = encrypt_bytes(payload, 'comms_log.json', self._path, self._password)
                if not ok:
                    _log.error('Failed to save COMMS log: %s', err)
                    # Remove the message we just added since save failed
                    self._messages.pop()

            except Exception as e:
                _log.error('Failed to append to COMMS log: %s', e)

    def load_all(self):
        """Return all messages from the in-memory cache.

        Returns a list of message dicts, ordered oldest to newest.
        Returns [] if the store is locked.
        """
        if not self._unlocked:
            return []
        return list(self._messages)
