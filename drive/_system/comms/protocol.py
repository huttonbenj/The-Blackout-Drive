"""
The Blackout Drive — Meshtastic Protocol Handler
Copyright (c) 2026 Hutton Technologies LLC — Licensed under BSL 1.1
================================================================
Minimal, hand-rolled Protobuf wire format codec + Meshtastic message
wrappers. Zero third-party dependencies — no google.protobuf runtime.

Why hand-rolled:
  - We need exactly 6 message types from the Meshtastic schema
  - Eliminates the entire google.protobuf vendor tree (~2MB)
  - Wire format is simple: varints + length-delimited + fixed32
  - Full control over encode/decode with zero abstraction leaks

Protobuf wire types:
  0 = Varint (uint32, int32, bool, enum)
  1 = 64-bit (fixed64, double) — not used
  2 = Length-delimited (bytes, string, embedded messages)
  5 = 32-bit (fixed32, float)

Meshtastic serial framing:
  [0x94] [0xC3] [LEN_MSB] [LEN_LSB] [PROTOBUF_PAYLOAD...]
================================================================
"""

import logging
import struct
from collections import namedtuple

_log = logging.getLogger('protocol')

# ── Constants ─────────────────────────────────────────────────

SERIAL_MAGIC = b'\x94\xc3'
MAX_FRAME_SIZE = 512  # Max protobuf payload we'll accept

# Meshtastic PortNum enum (only the ones we care about)
PORTNUM_UNKNOWN       = 0
PORTNUM_TEXT_MESSAGE   = 1
PORTNUM_POSITION       = 3
PORTNUM_NODEINFO       = 4
PORTNUM_ROUTING        = 5    # ROUTING_APP — ACK/NAK delivery reports
PORTNUM_ADMIN          = 6
PORTNUM_REPLY          = 32   # REPLY_APP (was incorrectly labeled ROUTING)
PORTNUM_TELEMETRY      = 67
PORTNUM_TRACEROUTE     = 70
PORTNUM_NEIGHBORINFO   = 71

# Meshtastic Routing.Error enum (delivery failure reasons)
ROUTING_ERROR_NONE           = 0
ROUTING_ERROR_NO_ROUTE       = 1
ROUTING_ERROR_GOT_NAK        = 2
ROUTING_ERROR_TIMEOUT        = 3
ROUTING_ERROR_NO_INTERFACE   = 4
ROUTING_ERROR_MAX_RETRANSMIT = 5
ROUTING_ERROR_NO_CHANNEL     = 6
ROUTING_ERROR_TOO_LARGE      = 7
ROUTING_ERROR_NO_RESPONSE    = 8
ROUTING_ERROR_DUTY_CYCLE     = 9

ROUTING_ERROR_NAMES = {
    ROUTING_ERROR_NONE:           'OK',
    ROUTING_ERROR_NO_ROUTE:       'NO ROUTE',
    ROUTING_ERROR_GOT_NAK:        'GOT NAK',
    ROUTING_ERROR_TIMEOUT:        'TIMEOUT',
    ROUTING_ERROR_NO_INTERFACE:   'NO INTERFACE',
    ROUTING_ERROR_MAX_RETRANSMIT: 'MAX RETRANSMIT',
    ROUTING_ERROR_NO_CHANNEL:     'NO CHANNEL',
    ROUTING_ERROR_TOO_LARGE:      'TOO LARGE',
    ROUTING_ERROR_NO_RESPONSE:    'NO RESPONSE',
    ROUTING_ERROR_DUTY_CYCLE:     'DUTY CYCLE LIMIT',
}

# Broadcast address
BROADCAST_ADDR = 0xFFFFFFFF


# ══════════════════════════════════════════════════════════════
# PROTOBUF WIRE FORMAT — MINIMAL CODEC
# ══════════════════════════════════════════════════════════════

def _encode_varint(value):
    """Encode an unsigned integer as a protobuf varint."""
    out = bytearray()
    while value > 0x7F:
        out.append((value & 0x7F) | 0x80)
        value >>= 7
    out.append(value & 0x7F)
    return bytes(out)


def _decode_varint(data, offset):
    """Decode a varint from data at offset. Returns (value, new_offset)."""
    result = 0
    shift = 0
    while offset < len(data):
        byte = data[offset]
        offset += 1
        result |= (byte & 0x7F) << shift
        if not (byte & 0x80):
            return result, offset
        shift += 7
        if shift >= 64:
            raise ValueError("Varint too long")
    raise ValueError("Unexpected end of data in varint")


def _encode_field_varint(field_num, value):
    """Encode a varint field: tag + value."""
    tag = (field_num << 3) | 0  # wire type 0
    return _encode_varint(tag) + _encode_varint(value)


def _encode_field_fixed32(field_num, value):
    """Encode a fixed32 field: tag + 4 bytes little-endian."""
    tag = (field_num << 3) | 5  # wire type 5
    return _encode_varint(tag) + struct.pack('<I', value)


def _encode_field_bytes(field_num, value):
    """Encode a length-delimited field: tag + length + bytes."""
    tag = (field_num << 3) | 2  # wire type 2
    return _encode_varint(tag) + _encode_varint(len(value)) + value


def _encode_field_bool(field_num, value):
    """Encode a bool field (varint 0 or 1)."""
    return _encode_field_varint(field_num, 1 if value else 0)


def decode_fields(data):
    """
    Decode a protobuf message into a dict of {field_num: value}.

    Returns dict where:
      - Varint fields (wire 0): value is int
      - Fixed32 fields (wire 5): value is int (unsigned)
      - Length-delimited fields (wire 2): value is bytes
      - Fixed64 fields (wire 1): value is int (unsigned)

    If a field number appears multiple times, only the last value is kept.
    """
    fields = {}
    offset = 0
    while offset < len(data):
        tag, offset = _decode_varint(data, offset)
        field_num = tag >> 3
        wire_type = tag & 0x07

        if wire_type == 0:  # Varint
            value, offset = _decode_varint(data, offset)
            fields[field_num] = value

        elif wire_type == 1:  # 64-bit
            if offset + 8 > len(data):
                break
            value = struct.unpack_from('<Q', data, offset)[0]
            offset += 8
            fields[field_num] = value

        elif wire_type == 2:  # Length-delimited
            length, offset = _decode_varint(data, offset)
            if offset + length > len(data):
                break
            fields[field_num] = data[offset:offset + length]
            offset += length

        elif wire_type == 5:  # 32-bit
            if offset + 4 > len(data):
                break
            value = struct.unpack_from('<I', data, offset)[0]
            offset += 4
            fields[field_num] = value

        else:
            # Unknown wire type — skip (shouldn't happen in valid data)
            break

    return fields


# ══════════════════════════════════════════════════════════════
# MESHTASTIC MESSAGE TYPES
# ══════════════════════════════════════════════════════════════

# Named tuples for clean, immutable message representations

DataPayload = namedtuple('DataPayload', [
    'portnum',       # int (PortNum enum)
    'payload',       # bytes
    'want_response', # bool
    'reply_id',      # int (fixed32) or 0
])

MeshPacket = namedtuple('MeshPacket', [
    'from_id',    # int (fixed32) — sender node number
    'to_id',      # int (fixed32) — destination (or BROADCAST_ADDR)
    'channel',    # int — local channel index (0–7)
    'decoded',    # DataPayload or None
    'encrypted',  # bytes or None (raw encrypted payload)
    'packet_id',  # int (fixed32) — unique packet ID
    'hop_limit',  # int — remaining hop budget
    'want_ack',   # bool
    'priority',   # int (enum)
    'rx_snr',     # float — received signal-to-noise ratio (dB)
    'hop_start',  # int — original hop limit (hops_taken = hop_start - hop_limit)
])

MyNodeInfo = namedtuple('MyNodeInfo', [
    'my_node_num',  # int (uint32)
])

NodeInfo = namedtuple('NodeInfo', [
    'num',            # int — node number
    'user_id',        # str — e.g. "!a1b2c3d4"
    'long_name',      # str
    'short_name',     # str
    'position',       # Position or None — last known GPS from config dump
    'snr',            # float — signal-to-noise ratio from config dump
    'last_heard',     # int — epoch timestamp from firmware (not our clock)
    'device_metrics', # DeviceTelemetry or None — battery/voltage from config dump
])
NodeInfo.__new__.__defaults__ = (None, 0.0, 0, None)  # defaults for position..device_metrics

Position = namedtuple('Position', [
    'latitude_i',    # int — lat × 1e7 (e.g. 388977000 = 38.8977°)
    'longitude_i',   # int — lng × 1e7 (e.g. -770365000 = -77.0365°)
    'altitude',      # int — meters above sea level
    'time',          # int — GPS epoch timestamp
])
Position.__new__.__defaults__ = (0, 0)  # defaults for altitude, time

DeviceTelemetry = namedtuple('DeviceTelemetry', [
    'battery_level',        # int — 0–100%
    'voltage',              # float — battery voltage
    'uptime_seconds',       # int
    'channel_utilization',  # float — local channel busy % (0–100)
    'air_util_tx',          # float — local TX air utilization % (0–100)
])
DeviceTelemetry.__new__.__defaults__ = (0, 0.0, 0, 0.0, 0.0)  # all fields have safe defaults

EnvironmentTelemetry = namedtuple('EnvironmentTelemetry', [
    'temperature',          # float — degrees Celsius
    'relative_humidity',    # float — 0–100%
    'barometric_pressure',  # float — hPa
    'gas_resistance',       # float — Ohms (air quality)
    'iaq',                  # int — Indoor Air Quality index (0–500)
])
EnvironmentTelemetry.__new__.__defaults__ = (0.0, 0.0, 0.0, 0.0, 0)



# ── Decoders ──────────────────────────────────────────────────

def decode_data_payload(data_bytes):
    """Decode a Data protobuf message from raw bytes."""
    f = decode_fields(data_bytes)
    return DataPayload(
        portnum=f.get(1, PORTNUM_UNKNOWN),
        payload=f.get(2, b''),
        want_response=bool(f.get(3, 0)),   # field 3 per mesh.proto
        reply_id=f.get(7, 0),
    )


def decode_mesh_packet(data_bytes):
    """Decode a MeshPacket protobuf message from raw bytes."""
    f = decode_fields(data_bytes)

    # Field 4 = decoded (Data), field 5 = encrypted (bytes)
    decoded = None
    encrypted = None
    if 4 in f and isinstance(f[4], bytes):
        decoded = decode_data_payload(f[4])
    if 5 in f and isinstance(f[5], bytes):
        encrypted = f[5]

    # rx_snr: field 8, float (wire type 5 = fixed32 on the wire)
    # decode_fields returns fixed32 as unsigned int — reinterpret as float.
    # Defensive: if wire type is bytes (unexpected), skip instead of crashing.
    rx_snr = 0.0
    if 8 in f and isinstance(f[8], int):
        rx_snr = struct.unpack('<f', struct.pack('<I', f[8]))[0]

    # hop_start: field 16 (uint32). Defensive int() cast in case wire type is
    # unexpected (bytes) — this would crash downstream comparisons.
    hop_start_raw = f.get(16, 0)
    hop_start_val = int(hop_start_raw) if isinstance(hop_start_raw, int) else 0

    return MeshPacket(
        from_id=f.get(1, 0),
        to_id=f.get(2, 0),
        channel=f.get(3, 0),
        decoded=decoded,
        encrypted=encrypted,
        packet_id=f.get(6, 0),
        hop_limit=f.get(9, 0),         # field 9 per mesh.proto
        want_ack=bool(f.get(10, 0)),   # field 10 per mesh.proto
        priority=f.get(11, 0),
        rx_snr=rx_snr,                 # field 8 per mesh.proto
        hop_start=hop_start_val,       # field 16 per mesh.proto — original hop budget
    )


def decode_my_node_info(data_bytes):
    """Decode MyNodeInfo from raw bytes."""
    f = decode_fields(data_bytes)
    return MyNodeInfo(my_node_num=f.get(1, 0))


def decode_node_info(data_bytes):
    """Decode NodeInfo from raw bytes.

    Extracts all fields from the Meshtastic NodeInfo protobuf:
      field 1 = num           (uint32) — node number
      field 2 = user          (User)   — embedded message with id, long_name, short_name
      field 3 = position      (Position) — last known GPS coordinates
      field 4 = snr           (float)  — signal-to-noise ratio (wire type 5 = fixed32)
      field 5 = last_heard    (fixed32) — epoch timestamp of last contact
      field 7 = device_metrics (DeviceMetrics) — battery, voltage, uptime
    """
    f = decode_fields(data_bytes)
    num = f.get(1, 0)

    # ── Field 2: User (embedded message) ──────────────────────
    user_id = ''
    long_name = ''
    short_name = ''
    if 2 in f and isinstance(f[2], bytes):
        uf = decode_fields(f[2])
        user_id = uf.get(1, b'').decode('utf-8', errors='replace') if isinstance(uf.get(1), bytes) else ''
        long_name = uf.get(2, b'').decode('utf-8', errors='replace') if isinstance(uf.get(2), bytes) else ''
        short_name = uf.get(3, b'').decode('utf-8', errors='replace') if isinstance(uf.get(3), bytes) else ''

    # ── Field 3: Position (embedded message) ──────────────────
    position = None
    if 3 in f and isinstance(f[3], bytes):
        try:
            position = decode_position(f[3])
            # Treat (0, 0) as "no position" — firmware sends zeros when GPS
            # has never acquired a fix.
            if position.latitude_i == 0 and position.longitude_i == 0:
                position = None
        except Exception:
            pass  # Malformed position data — leave as None

    # ── Field 4: SNR (float, wire type 5 = fixed32) ───────────
    snr = 0.0
    if 4 in f:
        try:
            snr = struct.unpack('<f', struct.pack('<I', f[4]))[0]
        except Exception:
            pass

    # ── Field 5: last_heard (fixed32 epoch timestamp) ─────────
    last_heard = f.get(5, 0)

    # ── Field 7: DeviceMetrics (embedded Telemetry message) ───
    # In NodeInfo, field 7 is DeviceMetrics directly (NOT wrapped
    # in a Telemetry envelope like PORTNUM_TELEMETRY packets).
    # DeviceMetrics fields: 1=battery, 2=voltage, 3=chan_util,
    # 4=air_util, 5=uptime
    device_metrics = None
    if 7 in f and isinstance(f[7], bytes):
        try:
            mf = decode_fields(f[7])
            voltage = 0.0
            if 2 in mf:
                voltage = struct.unpack('<f', struct.pack('<I', mf[2]))[0]
            chan_util = 0.0
            if 3 in mf:
                chan_util = struct.unpack('<f', struct.pack('<I', mf[3]))[0]
            air_util = 0.0
            if 4 in mf:
                air_util = struct.unpack('<f', struct.pack('<I', mf[4]))[0]
            device_metrics = DeviceTelemetry(
                battery_level=mf.get(1, 0),
                voltage=voltage,
                uptime_seconds=mf.get(5, 0),
                channel_utilization=round(chan_util, 1),
                air_util_tx=round(air_util, 1),
            )
        except Exception:
            pass  # Malformed telemetry — leave as None

    return NodeInfo(
        num=num,
        user_id=user_id,
        long_name=long_name,
        short_name=short_name,
        position=position,
        snr=snr,
        last_heard=last_heard,
        device_metrics=device_metrics,
    )


def decode_position(data_bytes):
    """Decode a Position protobuf from raw bytes.

    Field numbers per meshtastic/mesh.proto Position:
      1 = latitude_i  (sfixed32) — lat × 1e7
      2 = longitude_i (sfixed32) — lng × 1e7
      3 = altitude     (int32)   — meters above MSL
      4 = time        (fixed32)  — GPS epoch timestamp
    """
    f = decode_fields(data_bytes)
    # latitude_i and longitude_i are sfixed32 (wire type 5).
    # Our decode_fields returns fixed32 as unsigned — reinterpret as signed.
    lat_raw = f.get(1, 0)
    lng_raw = f.get(2, 0)
    if lat_raw > 0x7FFFFFFF:
        lat_raw -= 0x100000000
    if lng_raw > 0x7FFFFFFF:
        lng_raw -= 0x100000000
    return Position(
        latitude_i=lat_raw,
        longitude_i=lng_raw,
        altitude=f.get(3, 0),
        time=f.get(4, 0),
    )


def decode_device_telemetry(data_bytes):
    """Decode Telemetry → DeviceMetrics from raw bytes.

    Telemetry message: field 2 = device_metrics (embedded DeviceMetrics).
    DeviceMetrics fields per meshtastic/telemetry.proto:
      1 = battery_level   (uint32, 0–100%)
      2 = voltage         (float, wire type 5 = fixed32)
      3 = channel_utilization (float)
      4 = air_util_tx     (float)
      5 = uptime_seconds  (uint32)

    Returns DeviceTelemetry or None if no device_metrics present.
    """
    f = decode_fields(data_bytes)
    # Field 2 = device_metrics (embedded message)
    if 2 not in f or not isinstance(f[2], bytes):
        return None
    mf = decode_fields(f[2])
    # Voltage is protobuf 'float' = wire type 5 (fixed32).
    # decode_fields returns the raw 4 bytes as unsigned int — reinterpret.
    voltage = 0.0
    if 2 in mf:
        voltage = struct.unpack('<f', struct.pack('<I', mf[2]))[0]
    # Channel utilization + air TX utilization (also floats, fields 3 & 4)
    chan_util = 0.0
    if 3 in mf:
        chan_util = struct.unpack('<f', struct.pack('<I', mf[3]))[0]
    air_util = 0.0
    if 4 in mf:
        air_util = struct.unpack('<f', struct.pack('<I', mf[4]))[0]
    return DeviceTelemetry(
        battery_level=mf.get(1, 0),
        voltage=voltage,
        uptime_seconds=mf.get(5, 0),
        channel_utilization=round(chan_util, 1),
        air_util_tx=round(air_util, 1),
    )


def decode_environment_telemetry(data_bytes):
    """Decode Telemetry → EnvironmentMetrics from raw bytes.

    Telemetry message: field 3 = environment_metrics (embedded).
    EnvironmentMetrics fields per meshtastic/telemetry.proto:
      1 = temperature         (float)
      2 = relative_humidity   (float)
      3 = barometric_pressure (float)
      4 = gas_resistance      (float)
      5 = voltage             (float) — not used here, belongs to PowerMetrics
      6 = current             (float) — not used here
      7 = iaq                 (uint32)

    Returns EnvironmentTelemetry or None if no env metrics present.
    """
    f = decode_fields(data_bytes)
    # Field 3 = environment_metrics (embedded message)
    if 3 not in f or not isinstance(f[3], bytes):
        return None
    mf = decode_fields(f[3])

    def _float(field_num):
        v = mf.get(field_num)
        if v is None:
            return 0.0
        return struct.unpack('<f', struct.pack('<I', v))[0]

    return EnvironmentTelemetry(
        temperature=round(_float(1), 1),
        relative_humidity=round(_float(2), 1),
        barometric_pressure=round(_float(3), 1),
        gas_resistance=round(_float(4), 1),
        iaq=mf.get(7, 0),
    )



def decode_from_radio(data_bytes):
    """
    Decode a FromRadio envelope. Returns (msg_type, message) where:
      msg_type: 'packet' | 'my_info' | 'node_info' | 'channel' |
                'config_complete' | 'rebooted' |
                'config' | 'log_record' | 'module_config' |
                'queue_status' | 'xmodem' | 'metadata' |
                'mqtt_proxy' | 'file_info' | 'client_notification' |
                'deviceui_config' | 'lockdown_status' | 'unknown'
      message:  Decoded object | raw bytes | int | None

    Field mapping per meshtastic/mesh.proto FromRadio:
      1  = id (uint32) — packet ID for FIFO tracking
      2  = MeshPacket (packet)
      3  = MyNodeInfo (my_info)
      4  = NodeInfo (node_info)
      5  = Config (radio/device config during dump)
      6  = LogRecord (debug console output)
      7  = config_complete_id (uint32)
      8  = rebooted (bool)
      9  = ModuleConfig (module settings during dump)
      10 = Channel (channel config during dump)
      11 = QueueStatus (TX queue feedback)
      12 = XModem (file transfer chunk)
      13 = DeviceMetadata (firmware version, capabilities)
      14 = MqttClientProxyMessage
      15 = FileInfo (filesystem manifest)
      16 = ClientNotification (alerts to client)
      17 = DeviceUIConfig (persistent UI state)
      18 = LockdownStatus (hardened firmware auth)
    """
    f = decode_fields(data_bytes)

    # Field 2 = MeshPacket — live radio traffic
    if 2 in f and isinstance(f[2], bytes):
        return ('packet', decode_mesh_packet(f[2]))

    # Field 3 = MyNodeInfo — our own node identity
    if 3 in f and isinstance(f[3], bytes):
        return ('my_info', decode_my_node_info(f[3]))

    # Field 4 = NodeInfo — one per known node in the mesh
    if 4 in f and isinstance(f[4], bytes):
        return ('node_info', decode_node_info(f[4]))

    # Field 10 = Channel — one per channel slot (0–7)
    if 10 in f and isinstance(f[10], bytes):
        return ('channel', decode_channel(f[10]))

    # Field 7 = config_complete_id — marks end of config dump
    if 7 in f and isinstance(f[7], int):
        return ('config_complete', f[7])

    # Field 8 = rebooted — firmware just restarted
    if 8 in f:
        return ('rebooted', f[8])

    # ── Config dump fields (not decoded but properly labeled) ──
    # Field 5 = Config (radio settings, device config, etc.)
    if 5 in f:
        return ('config', f[5])

    # Field 9 = ModuleConfig (telemetry intervals, canned msgs, etc.)
    if 9 in f:
        return ('module_config', f[9])

    # ── Informational fields ──
    # Field 6 = LogRecord (firmware debug output)
    if 6 in f:
        return ('log_record', f[6])

    # Field 11 = QueueStatus (TX queue free/max/result)
    if 11 in f:
        return ('queue_status', f[11])

    # Field 13 = DeviceMetadata (firmware version, hw model, capabilities)
    if 13 in f:
        return ('metadata', f[13])

    # Field 15 = FileInfo (filesystem manifest entry)
    if 15 in f:
        return ('file_info', f[15])

    # Field 16 = ClientNotification (alerts, key verification, etc.)
    if 16 in f:
        return ('client_notification', f[16])

    # ── Rarely used fields ──
    # Field 12 = XModem (file transfer)
    if 12 in f:
        return ('xmodem', f[12])

    # Field 14 = MqttClientProxyMessage
    if 14 in f:
        return ('mqtt_proxy', f[14])

    # Field 17 = DeviceUIConfig
    if 17 in f:
        return ('deviceui_config', f[17])

    # Field 18 = LockdownStatus (hardened firmware auth state)
    if 18 in f:
        return ('lockdown_status', f[18])

    return ('unknown', None)


# ── Encoders ──────────────────────────────────────────────────

def encode_data_payload(portnum, payload_bytes, want_response=False, reply_id=0):
    """Encode a Data protobuf message.

    Field numbers per meshtastic/mesh.proto Data message:
      1 = portnum (PortNum)    2 = payload (bytes)
      3 = want_response (bool) 4 = dest (fixed32)
      5 = source (fixed32)     6 = request_id (fixed32)
      7 = reply_id (fixed32)   8 = emoji (fixed32)
    """
    out = bytearray()
    out += _encode_field_varint(1, portnum)
    out += _encode_field_bytes(2, payload_bytes)
    if want_response:
        out += _encode_field_bool(3, True)           # field 3, NOT 5
    if reply_id:
        out += _encode_field_fixed32(7, reply_id)
    return bytes(out)


def encode_telemetry_request():
    """Encode a Telemetry protobuf payload for a device_metrics request.

    The Meshtastic firmware requires a proper Telemetry protobuf (not empty
    bytes) in the want_response payload. Without this, the firmware ACKs the
    request but does NOT respond with telemetry data.

    Structure (per meshtastic/telemetry.proto):
      Telemetry {
        field 1 = time (fixed32) — set to current epoch
        field 2 = device_metrics (embedded DeviceMetrics) — empty sub-msg
      }

    The empty DeviceMetrics sub-message signals "I want device metrics."
    """
    import time as _time
    now = int(_time.time())
    inner = bytearray()
    # field 1 = time (fixed32)
    inner += _encode_field_fixed32(1, now)
    # field 2 = device_metrics — empty embedded message (zero-length bytes)
    # An empty embedded message = just the field header + length 0
    inner += _encode_field_bytes(2, b'')
    return bytes(inner)


def encode_position_request():
    """Encode a Position protobuf payload for a position request.

    The Meshtastic firmware requires a proper Position protobuf (not empty
    bytes) in the want_response payload. Without this, the firmware ACKs the
    request but does NOT respond with position data — the exact same issue
    that was found and fixed for telemetry requests.

    Structure (per meshtastic/mesh.proto Position):
      Position {
        field 4 = time (fixed32) — set to current epoch
      }

    The time field signals "I want your current position."
    """
    import time as _time
    now = int(_time.time())
    inner = bytearray()
    # field 4 = time (fixed32)
    inner += _encode_field_fixed32(4, now)
    return bytes(inner)


def encode_mesh_packet(from_id, to_id, channel, decoded_bytes, packet_id,
                       hop_limit=3, want_ack=False, priority=0):
    """Encode a MeshPacket protobuf message.

    Field numbers per meshtastic/mesh.proto:
      1 = from (fixed32)     2 = to (fixed32)       3 = channel (uint32)
      4 = decoded (bytes)    5 = encrypted (bytes)   6 = id (fixed32)
      7 = rx_time (fixed32)  8 = rx_snr (float)      9 = hop_limit (uint32)
     10 = want_ack (bool)   11 = priority (enum)
    """
    out = bytearray()
    out += _encode_field_fixed32(1, from_id)
    out += _encode_field_fixed32(2, to_id)
    if channel:
        out += _encode_field_varint(3, channel)
    out += _encode_field_bytes(4, decoded_bytes)     # decoded = field 4
    out += _encode_field_fixed32(6, packet_id)
    if hop_limit:
        out += _encode_field_varint(9, hop_limit)    # field 9, NOT 10
    if want_ack:
        out += _encode_field_bool(10, True)          # field 10, NOT 7
    if priority:
        out += _encode_field_varint(11, priority)
    return bytes(out)


def encode_to_radio_want_config(config_id):
    """Encode a ToRadio message requesting config dump."""
    # ToRadio field 3 = want_config_id (varint)
    inner = _encode_field_varint(3, config_id)
    return bytes(inner)


def encode_to_radio_packet(mesh_packet_bytes):
    """Encode a ToRadio message wrapping a MeshPacket."""
    # ToRadio field 1 = packet (embedded MeshPacket)
    return _encode_field_bytes(1, mesh_packet_bytes)


# ══════════════════════════════════════════════════════════════
# SERIAL FRAMING
# ══════════════════════════════════════════════════════════════

def frame_for_serial(protobuf_bytes):
    """
    Wrap a protobuf payload in Meshtastic serial framing.
    Returns: [0x94] [0xC3] [LEN_MSB] [LEN_LSB] [payload...]
    """
    length = len(protobuf_bytes)
    if length > MAX_FRAME_SIZE:
        raise ValueError(f"Payload too large for serial frame: {length} > {MAX_FRAME_SIZE}")
    return SERIAL_MAGIC + struct.pack('>H', length) + protobuf_bytes


class FrameDecoder:
    """
    Stateful serial frame decoder. Feed raw bytes, get protobuf payloads.

    Usage:
        decoder = FrameDecoder()
        for payload in decoder.feed(raw_bytes):
            msg_type, msg = decode_from_radio(payload)
    """

    # Maximum buffer size before forced reset. Prevents unbounded growth
    # when the firmware dumps non-framed boot/debug output (e.g., after
    # a reboot) that coincidentally contains magic-like byte sequences.
    _MAX_BUF = 4096

    def __init__(self):
        self._buf = bytearray()

    def reset(self):
        """Clear the internal buffer. Call after a firmware reboot to
        discard any partial/corrupt data from the boot sequence."""
        self._buf.clear()

    def feed(self, data):
        """
        Feed raw serial bytes. Yields complete protobuf payloads.
        Handles partial frames, resynchronization, and garbage bytes.
        """
        self._buf.extend(data)

        # Safety: if the buffer has grown past the limit without yielding
        # a frame, the decoder is stuck on garbage. Discard and resync.
        if len(self._buf) > self._MAX_BUF:
            _log.warning("FrameDecoder buffer overflow (%d bytes) — "
                         "discarding and resyncing", len(self._buf))
            self._buf.clear()
            return

        while True:
            # Scan for magic bytes
            idx = self._buf.find(SERIAL_MAGIC)
            if idx < 0:
                # No magic found — keep last byte in case it's 0x94
                if len(self._buf) > 1:
                    self._buf = self._buf[-1:]
                return
            if idx > 0:
                # Discard bytes before magic (debug/garbage output from board)
                del self._buf[:idx]

            # Need at least 4 bytes for header (2 magic + 2 length)
            if len(self._buf) < 4:
                return

            # Read payload length (big-endian 16-bit)
            length = struct.unpack_from('>H', self._buf, 2)[0]
            if length > MAX_FRAME_SIZE:
                # Corrupted length — skip this magic and resync
                del self._buf[:2]
                continue

            # Wait for full payload
            total = 4 + length
            if len(self._buf) < total:
                return

            # Extract payload
            payload = bytes(self._buf[4:total])
            del self._buf[:total]
            yield payload


# ══════════════════════════════════════════════════════════════
# UTILITY — Node ID formatting
# ══════════════════════════════════════════════════════════════

def node_id_to_hex(node_num):
    """Convert a numeric node ID to the Meshtastic hex string format: !a1b2c3d4"""
    return f"!{node_num:08x}"

def hex_to_node_id(hex_str):
    """Convert a Meshtastic hex string like '!a1b2c3d4' to an integer."""
    return int(hex_str.lstrip('!'), 16)


# ══════════════════════════════════════════════════════════════
# ADMIN MESSAGE ENCODERS
# Hardware-enforced config changes. These encode the correct
# Meshtastic AdminMessage protobuf to command the firmware to
# physically enable/disable GPS and telemetry emission.
#
# Packet chain:
#   ToRadio (field 1: MeshPacket)
#     └─ MeshPacket (from=0, to=our_node, portnum=ADMIN)
#         └─ Data (portnum=6, payload=AdminMessage)
#             └─ AdminMessage (field 34: set_config → Config)
#                 └─ Config (field 2: PositionConfig)
#                     └─ PositionConfig (gps_mode, broadcast_secs...)
#
# Reference: meshtastic/admin.proto, meshtastic/config.proto,
#            meshtastic/module_config.proto
# ══════════════════════════════════════════════════════════════

# GpsMode enum (Config.PositionConfig.GpsMode)
GPS_MODE_DISABLED    = 0
GPS_MODE_ENABLED     = 1
GPS_MODE_NOT_PRESENT = 2


def encode_position_config(gps_mode=GPS_MODE_DISABLED,
                           position_broadcast_secs=0,
                           position_broadcast_smart_enabled=False):
    """Encode a Config.PositionConfig protobuf message.

    Field numbers per meshtastic/config.proto PositionConfig:
      1 = position_broadcast_secs (uint32)
      2 = position_broadcast_smart_enabled (bool)
      13 = gps_mode (GpsMode enum)
    """
    out = bytearray()
    out += _encode_field_varint(1, position_broadcast_secs)
    out += _encode_field_bool(2, position_broadcast_smart_enabled)
    out += _encode_field_varint(13, gps_mode)
    return bytes(out)


def encode_telemetry_module_config(device_update_interval=0,
                                   environment_update_interval=0,
                                   environment_measurement_enabled=False,
                                   device_telemetry_enabled=False):
    """Encode a ModuleConfig.TelemetryConfig protobuf message.

    Field numbers per meshtastic/module_config.proto TelemetryConfig:
      1 = device_update_interval (uint32)   — 0 = disabled
      2 = environment_update_interval (uint32)
      3 = environment_measurement_enabled (bool)
     14 = device_telemetry_enabled (bool)  — controls mesh broadcast
    """
    out = bytearray()
    out += _encode_field_varint(1, device_update_interval)
    out += _encode_field_varint(2, environment_update_interval)
    out += _encode_field_bool(3, environment_measurement_enabled)
    out += _encode_field_bool(14, device_telemetry_enabled)
    return bytes(out)


def encode_config_with_position(position_config_bytes):
    """Wrap a PositionConfig in a Config envelope.

    Config.payload_variant oneof:
      field 2 = position (PositionConfig) — per config.proto
    """
    return _encode_field_bytes(2, position_config_bytes)


def encode_config_with_lora(lora_config_bytes):
    """Wrap a LoRaConfig in a Config envelope.

    Config.payload_variant oneof:
      field 6 = lora (LoRaConfig) — per config.proto

    Used during provisioning to set the radio's LoRa region.
    Without this, a factory-fresh radio has Region=UNSET and
    the firmware will refuse to transmit any packets.
    """
    return _encode_field_bytes(6, lora_config_bytes)


def encode_module_config_with_telemetry(telemetry_config_bytes):
    """Wrap a TelemetryConfig in a ModuleConfig envelope.

    ModuleConfig.payload_variant oneof:
      field 6 = telemetry (TelemetryConfig) — per module_config.proto
    """
    return _encode_field_bytes(6, telemetry_config_bytes)


def encode_admin_set_config(config_bytes):
    """Encode an AdminMessage with set_config.

    AdminMessage.payload_variant oneof:
      field 34 = set_config (Config) — per admin.proto
    """
    return _encode_field_bytes(34, config_bytes)


def encode_admin_set_module_config(module_config_bytes):
    """Encode an AdminMessage with set_module_config.

    AdminMessage.payload_variant oneof:
      field 35 = set_module_config (ModuleConfig) — per admin.proto
    """
    return _encode_field_bytes(35, module_config_bytes)


# ══════════════════════════════════════════════════════════════
# CHANNEL CONFIGURATION ENCODERS / DECODERS
# Used by the auto-provisioning engine to create a private
# BEACON channel on a Meshtastic radio and generate QR codes
# for second-node pairing.
#
# Proto references:
#   meshtastic/channel.proto    — Channel, ChannelSettings
#   meshtastic/config.proto     — Config.LoRaConfig
#   meshtastic/admin.proto      — AdminMessage.set_channel (field 32)
#   meshtastic/apponly.proto    — ChannelSet (QR code payload)
# ══════════════════════════════════════════════════════════════

# Channel.Role enum (per channel.proto)
CHANNEL_ROLE_DISABLED  = 0
CHANNEL_ROLE_PRIMARY   = 1
CHANNEL_ROLE_SECONDARY = 2

# Config.LoRaConfig.RegionCode enum (per config.proto)
LORA_REGION_UNSET   = 0
LORA_REGION_US      = 1
LORA_REGION_EU_433  = 2
LORA_REGION_EU_868  = 3

# Config.LoRaConfig.ModemPreset enum (per config.proto)
MODEM_PRESET_LONG_FAST = 0


# ── Channel namedtuples ──────────────────────────────────────

ChannelSettings = namedtuple('ChannelSettings', [
    'psk',       # bytes — AES key (0, 16, or 32 bytes)
    'name',      # str — channel display name
    'id',        # int — fixed32 hash for global uniqueness
])

ChannelInfo = namedtuple('ChannelInfo', [
    'index',     # int — channel index 0–7
    'settings',  # ChannelSettings or None
    'role',      # int — DISABLED=0, PRIMARY=1, SECONDARY=2
])


# ── Decoders ─────────────────────────────────────────────────

def decode_channel_settings(data_bytes):
    """Decode a ChannelSettings protobuf message.

    Field numbers per meshtastic/channel.proto ChannelSettings:
      2 = psk (bytes)         3 = name (string)
      4 = id (fixed32)
    """
    f = decode_fields(data_bytes)
    psk = f.get(2, b'')
    if isinstance(psk, int):
        psk = bytes([psk])
    name = f.get(3, b'')
    if isinstance(name, bytes):
        name = name.decode('utf-8', errors='replace')
    ch_id = f.get(4, 0)
    return ChannelSettings(psk=psk, name=name, id=ch_id)


def decode_channel(data_bytes):
    """Decode a Channel protobuf message.

    Field numbers per meshtastic/channel.proto Channel:
      1 = index (int32)       2 = settings (ChannelSettings)
      3 = role (Role enum)
    """
    f = decode_fields(data_bytes)
    index = f.get(1, 0)
    settings = None
    if 2 in f and isinstance(f[2], bytes):
        settings = decode_channel_settings(f[2])
    role = f.get(3, CHANNEL_ROLE_DISABLED)
    return ChannelInfo(index=index, settings=settings, role=role)


# ── Encoders ─────────────────────────────────────────────────

def encode_channel_settings(psk, name):
    """Encode a ChannelSettings protobuf message.

    Field numbers per meshtastic/channel.proto ChannelSettings:
      2 = psk (bytes)         3 = name (string)
    We omit field 4 (id) — the firmware auto-generates it from the hash.
    """
    out = bytearray()
    if psk:
        out += _encode_field_bytes(2, psk)
    if name:
        out += _encode_field_bytes(3, name.encode('utf-8'))
    return bytes(out)


def encode_channel(index, settings_bytes, role=CHANNEL_ROLE_SECONDARY):
    """Encode a Channel protobuf message.

    Field numbers per meshtastic/channel.proto Channel:
      1 = index (int32)       2 = settings (ChannelSettings)
      3 = role (Role enum)
    """
    out = bytearray()
    out += _encode_field_varint(1, index)
    if settings_bytes:
        out += _encode_field_bytes(2, settings_bytes)
    out += _encode_field_varint(3, role)
    return bytes(out)


def encode_admin_set_channel(channel_bytes):
    """Encode an AdminMessage with set_channel.

    AdminMessage.payload_variant oneof:
      field 33 = set_channel (Channel) — per admin.proto
      (field 32 = set_owner — used for renaming the node)
    """
    return _encode_field_bytes(33, channel_bytes)


def encode_user(long_name, short_name):
    """Encode a User protobuf message for node renaming.

    Field numbers per meshtastic/mesh.proto User:
      1 = id (string)          — e.g. "!02eb94a0" (firmware auto-fills)
      2 = long_name (string)   — display name, max 39 chars
      3 = short_name (string)  — 4-char abbreviated name
      4 = macaddr (bytes)      — firmware auto-fills
      6 = hw_model (enum)      — firmware auto-fills
      7 = is_licensed (bool)   — ham license status
      8 = role (DeviceRole)    — firmware auto-fills

    We only set fields 2 and 3. The firmware preserves all other fields.
    """
    out = bytearray()
    if long_name:
        out += _encode_field_bytes(2, long_name.encode('utf-8'))
    if short_name:
        out += _encode_field_bytes(3, short_name[:4].encode('utf-8'))
    return bytes(out)


def encode_admin_set_owner(user_bytes):
    """Encode an AdminMessage with set_owner.

    AdminMessage.payload_variant oneof:
      field 32 = set_owner (User) — per admin.proto

    Used during provisioning to rename the Basecamp radio.
    """
    return _encode_field_bytes(32, user_bytes)


def encode_lora_config(region=LORA_REGION_US,
                       modem_preset=MODEM_PRESET_LONG_FAST,
                       use_preset=True, tx_enabled=True,
                       hop_limit=3, bandwidth=250,
                       spread_factor=11, coding_rate=5,
                       tx_power=30):
    """Encode a Config.LoRaConfig protobuf message.

    Field numbers per meshtastic/config.proto LoRaConfig:
      1  = use_preset (bool)        2  = modem_preset (ModemPreset enum)
      3  = bandwidth (uint32, kHz)  4  = spread_factor (uint32)
      5  = coding_rate (uint32)     6  = frequency_offset (float, omitted)
      7  = region (RegionCode)      8  = hop_limit (uint32)
      9  = tx_enabled (bool)        10 = tx_power (int32, dBm; 0 = max legal)

    Default values match the LONG_FAST preset on US radios.
    All fields MUST be included when generating QR codes because the
    Meshtastic app creates a default all-zeros LoRaConfig for any
    missing field, causing destructive 'value → 0' comparisons.
    tx_power=30 matches the firmware's default for US region (30dBm).
    """
    out = bytearray()
    out += _encode_field_bool(1, use_preset)
    if modem_preset:  # 0 = LONG_FAST (proto default, skip if 0)
        out += _encode_field_varint(2, modem_preset)
    if bandwidth:
        out += _encode_field_varint(3, bandwidth)
    if spread_factor:
        out += _encode_field_varint(4, spread_factor)
    if coding_rate:
        out += _encode_field_varint(5, coding_rate)
    out += _encode_field_varint(7, region)
    if hop_limit:
        out += _encode_field_varint(8, hop_limit)
    out += _encode_field_bool(9, tx_enabled)
    if tx_power:
        out += _encode_field_varint(10, tx_power)
    return bytes(out)


def encode_channel_set(channel_settings_list, lora_config_bytes=None):
    """Encode a ChannelSet protobuf for QR code generation.

    Per meshtastic/apponly.proto ChannelSet:
      field 1 = repeated ChannelSettings (length-delimited)
      field 2 = LoRaConfig (length-delimited)

    channel_settings_list: list of raw ChannelSettings protobuf bytes
    lora_config_bytes: raw LoRaConfig protobuf bytes (optional —
      but MUST be included for QR codes or the Meshtastic app will
      create a default all-zeros config that bricks the radio)
    """
    out = bytearray()
    for cs_bytes in channel_settings_list:
        out += _encode_field_bytes(1, cs_bytes)
    if lora_config_bytes:
        out += _encode_field_bytes(2, lora_config_bytes)
    return bytes(out)

