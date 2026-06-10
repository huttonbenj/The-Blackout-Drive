"""
comms/provisioning.py - Mesh radio auto-provisioning engine.

Handles the complete lifecycle of provisioning a Meshtastic radio with
a private BEACON channel:

  1. PSK generation (32-byte AES-256 via os.urandom)
  2. Encrypted PSK storage (BKV vault pipeline)
  3. Provisioning state management (JSON metadata)
  4. Meshtastic QR code URL generation for second-node pairing

The PSK is stored encrypted at rest using the user's master password,
following the same V3 Segmented AEAD pipeline as the COMMS message store
and the file vault.

Copyright (c) 2026 Hutton Technologies LLC — Licensed under BSL 1.1
"""

import base64
import hashlib
import json
import logging
import os

from .filecrypt import encrypt_bytes, decrypt_to_bytes
from . import protocol as proto

_log = logging.getLogger('comms.provisioning')

# File names within USER_DATA/
_PSK_FILENAME       = 'comms_channel_key.bkv'
_STATE_FILENAME     = 'comms_provisioned.json'


# ══════════════════════════════════════════════════════════════
# PSK GENERATION
# ══════════════════════════════════════════════════════════════

def generate_psk():
    """Generate a 32-byte AES-256 PSK for channel encryption.

    Uses os.urandom for cryptographic-strength randomness.
    """
    return os.urandom(32)


def psk_hash(psk_bytes):
    """Compute a SHA-256 hash of the PSK for verification purposes.

    This hash is stored in the provisioning state file so we can
    verify that the stored PSK matches the one programmed on the radio,
    without ever storing the raw key in plaintext.
    """
    return hashlib.sha256(psk_bytes).hexdigest()


# ══════════════════════════════════════════════════════════════
# ENCRYPTED PSK STORAGE
# ══════════════════════════════════════════════════════════════

def save_psk_encrypted(data_dir, psk_bytes, password):
    """Encrypt and save the PSK using the master password.

    Uses the same V3 BKV pipeline as the file vault.

    Args:
        data_dir: USER_DATA directory path
        psk_bytes: raw 32-byte AES key
        password: master password string

    Returns:
        True on success, raises on failure
    """
    os.makedirs(data_dir, exist_ok=True)
    dest_path = os.path.join(data_dir, _PSK_FILENAME)
    ok, err = encrypt_bytes(psk_bytes, 'channel_key.bin', dest_path, password)
    if not ok:
        raise RuntimeError(f'Failed to encrypt PSK: {err}')
    _log.info('PSK encrypted and saved to %s', _PSK_FILENAME)
    return True


def load_psk_encrypted(data_dir, password):
    """Decrypt and load the PSK using the master password.

    Args:
        data_dir: USER_DATA directory path
        password: master password string

    Returns:
        bytes — the raw 32-byte PSK

    Raises:
        FileNotFoundError if not provisioned
        ValueError on wrong password
    """
    src_path = os.path.join(data_dir, _PSK_FILENAME)
    if not os.path.isfile(src_path):
        raise FileNotFoundError('PSK file not found — radio not provisioned')
    data, _header = decrypt_to_bytes(src_path, password)
    if len(data) not in (16, 32):
        raise ValueError(f'Invalid PSK length: {len(data)} (expected 16 or 32)')
    return data


def rekey_psk(data_dir, old_password, new_password):
    """Re-encrypt the PSK with a new master password.

    Called during password change to maintain access to the stored key.

    Args:
        data_dir: USER_DATA directory path
        old_password: current master password
        new_password: new master password

    Returns:
        True on success, False if no PSK file exists (not provisioned)
    """
    src_path = os.path.join(data_dir, _PSK_FILENAME)
    if not os.path.isfile(src_path):
        _log.debug('No PSK file to rekey — radio not provisioned')
        return False

    try:
        psk_bytes = load_psk_encrypted(data_dir, old_password)
        save_psk_encrypted(data_dir, psk_bytes, new_password)
        _log.info('PSK re-encrypted with new password')
        return True
    except Exception as e:
        _log.error('PSK rekey failed: %s', e)
        raise


# ══════════════════════════════════════════════════════════════
# PROVISIONING STATE
# ══════════════════════════════════════════════════════════════

def save_provisioning_state(data_dir, state_dict):
    """Write the provisioning state to disk.

    Args:
        data_dir: USER_DATA directory path
        state_dict: dict with keys like:
            - channel_index (int)
            - channel_name (str)
            - psk_hash (str) — SHA-256 hex digest of the PSK
            - node_id (int) — numeric node ID of the provisioned radio
            - provisioned_at (str) — ISO 8601 timestamp
    """
    os.makedirs(data_dir, exist_ok=True)
    dest_path = os.path.join(data_dir, _STATE_FILENAME)
    tmp_path = dest_path + '.tmp'
    with open(tmp_path, 'w', encoding='utf-8') as f:
        json.dump(state_dict, f, indent=2)
    os.replace(tmp_path, dest_path)
    _log.info('Provisioning state saved: %s', state_dict.get('channel_name', '?'))


def load_provisioning_state(data_dir):
    """Load the provisioning state from disk.

    Returns:
        dict with provisioning metadata, or None if not provisioned
    """
    src_path = os.path.join(data_dir, _STATE_FILENAME)
    if not os.path.isfile(src_path):
        return None
    try:
        with open(src_path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        _log.warning('Failed to read provisioning state: %s', e)
        return None


def clear_provisioning_state(data_dir):
    """Delete all provisioning artifacts (PSK + state file).

    Called by wipe_user_data to ensure fresh state for the next user.
    """
    for filename in (_PSK_FILENAME, _STATE_FILENAME):
        path = os.path.join(data_dir, filename)
        if os.path.isfile(path):
            os.remove(path)
            _log.info('Deleted provisioning file: %s', filename)


# ══════════════════════════════════════════════════════════════
# MESHTASTIC QR CODE URL GENERATION
# ══════════════════════════════════════════════════════════════

def encode_meshtastic_qr_url(psk_bytes, channel_name='BEACON',
                              region=proto.LORA_REGION_US,
                              modem_preset=proto.MODEM_PRESET_LONG_FAST):
    """Generate a Meshtastic-compatible QR code URL.

    The URL format is:
        https://meshtastic.org/e/#<base64url_encoded_channel_set>

    The ChannelSet protobuf contains:
        - repeated ChannelSettings (one per active channel)
        - LoRaConfig (REQUIRED — must match the radio's current config)

    For our use case, we include:
        - Channel 0: LongFast default (1-byte PSK = 0x01)
        - Channel 1: BEACON with the user's custom AES-256 PSK
        - LoRaConfig: Fully populated with standard preset values

    CRITICAL: The LoRaConfig MUST be included with ALL fields populated.
    If omitted, the Meshtastic app creates a default all-zeros LoRaConfig
    and compares it against the radio's current settings, resulting in
    destructive changes (Bandwidth 250→0, SpreadFactor 11→0, etc.) that
    brick the radio with "Failed to save channel configuration".

    When use_preset=true and all radio parameters match the standard
    LONG_FAST preset, the app shows ZERO LoRa changes — only the
    channel additions appear in the "Replace all Channels?" prompt.

    Args:
        psk_bytes: raw 32-byte AES key for the BEACON channel
        channel_name: channel display name (default: 'BEACON')
        region: LoRa region code (default: US)
        modem_preset: LoRa modem preset (default: LONG_FAST)

    Returns:
        str — the full Meshtastic URL
    """
    # Channel 0: LongFast default (PSK = 0x01 = "use default key")
    ch0_settings = proto.encode_channel_settings(
        psk=b'\x01',
        name='',  # Empty name = default LongFast
    )

    # Channel 1: BEACON with custom AES-256 PSK
    ch1_settings = proto.encode_channel_settings(
        psk=psk_bytes,
        name=channel_name,
    )

    # LoRaConfig: ALL fields populated to match standard radio config.
    # This ensures the Meshtastic app sees zero LoRa parameter changes
    # when scanning the QR code on a radio with default LONG_FAST settings.
    lora_config = proto.encode_lora_config(
        region=region,
        modem_preset=modem_preset,
        use_preset=True,
        tx_enabled=True,
        hop_limit=3,
        bandwidth=250,       # LONG_FAST default (kHz)
        spread_factor=11,    # LONG_FAST default
        coding_rate=5,       # LONG_FAST default (4/5)
        tx_power=30,          # US region firmware default (30dBm)
    )

    # Encode the ChannelSet protobuf (channels + LoRaConfig)
    channel_set_bytes = proto.encode_channel_set(
        channel_settings_list=[ch0_settings, ch1_settings],
        lora_config_bytes=lora_config,
    )

    # Base64url encode (no padding) per Meshtastic convention
    b64 = base64.urlsafe_b64encode(channel_set_bytes).rstrip(b'=').decode('ascii')

    return f'https://meshtastic.org/e/#{b64}'

