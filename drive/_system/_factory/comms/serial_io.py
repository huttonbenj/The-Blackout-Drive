"""
The Blackout Drive — Serial I/O Manager
Copyright (c) 2026 Hutton Technologies LLC — Licensed under BSL 1.1
================================================================
Manages the physical serial connection to a Meshtastic radio.

Threads:
  - _reader_thread: Reads raw bytes from serial, feeds FrameDecoder,
                    dispatches decoded FromRadio messages.
  - _writer_thread: Drains the TX queue, writes framed packets to serial
                    with pacing delays to avoid overwhelming the board.

Auto-detection:
  Scans for known Heltec V3 USB VID/PID combinations.
  Falls back to matching /dev/cu.usbserial-* or /dev/ttyUSB* patterns.

Dependencies:
  - pyserial (vendored at _system/vendor/serial/)
================================================================
"""

import os
import sys
import time
import random
import logging
import threading
import queue

# ── Vendor pyserial (pure Python, shipped on the drive) ───────
_vendor_dir = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'vendor'
)
if _vendor_dir not in sys.path:
    sys.path.insert(0, _vendor_dir)

from . import protocol as proto

_log = logging.getLogger('blackout.serial')

# ── Known USB device identifiers ─────────────────────────────

KNOWN_DEVICES = [
    (0x303A, 0x1001),  # ESP32-S3 (Heltec V3)
    (0x10C4, 0xEA60),  # CP2102 (some Heltec / ESP32 boards)
    (0x1A86, 0x55D4),  # CH9102 (common ESP32-S3 USB bridge)
    (0x1A86, 0x7523),  # CH340 (budget ESP32 boards)
]

BAUD_RATE = 115200
SERIAL_TIMEOUT = 0.1  # Read timeout in seconds (100ms)

# TX queue limits
TX_QUEUE_MAX = 16
TX_DRAIN_MS = 3000  # ms to wait between TX packets

# C11 fix: Moved to module level — was defined twice inside _handle_from_radio.
# Guard against non-epoch timestamps from radios with no GPS fix.
MIN_VALID_EPOCH = 946684800  # 2000-01-01 00:00:00 UTC


# ══════════════════════════════════════════════════════════════
# PORT SCANNER
# ══════════════════════════════════════════════════════════════

def scan_for_radio():
    """
    Scan serial ports for Meshtastic-compatible devices.
    Returns the port device string (e.g. '/dev/cu.usbserial-0001') or None.
    """
    try:
        import serial.tools.list_ports
        ports = list(serial.tools.list_ports.comports())

        # Always log all detected ports for debugging
        if ports:
            _log.info("Serial ports detected: %s",
                      ", ".join(f"[{p.device}: desc={p.description!r} VID={p.vid} PID={p.pid}]" for p in ports))
        else:
            _log.debug("No serial ports detected on this system")

        # First pass: match by VID/PID (most reliable)
        for port in ports:
            if port.vid and port.pid:
                if (port.vid, port.pid) in KNOWN_DEVICES:
                    _log.info("Found radio by VID/PID: %s (%04X:%04X)",
                              port.device, port.vid, port.pid)
                    return port.device

        # Second pass: match by device name or description pattern
        import re
        for port in ports:
            dev = port.device.lower()
            desc = (port.description or '').lower()

            # Skip Bluetooth serial ports — they are never Meshtastic radios
            if 'bluetooth' in desc:
                _log.debug("Skipping Bluetooth port: %s (%s)", port.device, port.description)
                continue

            # Mac/Linux fallback: match typical USB serial device names
            if re.search(r'(usbserial|ttyusb|ttyacm|cu\.usb)', dev):
                _log.info("Found potential radio by name: %s", port.device)
                return port.device

            # Windows fallback: match COM ports that are genuine USB devices
            # (port.vid is set only for USB devices, not motherboard/Bluetooth COM ports)
            if sys.platform == 'win32' and dev.startswith('com') and port.vid is not None:
                _log.info("Found potential radio on Windows: %s (%s, VID=%04X)",
                          port.device, port.description, port.vid)
                return port.device

        _log.debug("No radio found among %d port(s)", len(ports))

    except ImportError:
        _log.warning("pyserial not available — cannot scan for radio")
    except Exception as e:
        _log.error("Port scan failed: %s", e)

    return None


# ══════════════════════════════════════════════════════════════
# SERIAL I/O MANAGER
# ══════════════════════════════════════════════════════════════

class SerialIO:
    """
    Manages a serial connection to a Meshtastic radio.

    Lifecycle:
      1. connect() — Open port, start reader/writer threads
      2. send_to_radio(protobuf_bytes) — Queue a framed packet for TX
      3. disconnect() — Close port, stop threads

    Callbacks:
      on_from_radio(msg_type, message) — Called for each decoded FromRadio
    """

    def __init__(self, on_from_radio=None):
        """
        Args:
            on_from_radio: Callback(msg_type: str, message: Any).
                           Called from reader thread for each decoded FromRadio.
        """
        self._port = None
        self._serial = None
        self._on_from_radio = on_from_radio

        self._tx_queue = queue.Queue(maxsize=TX_QUEUE_MAX)
        self._frame_decoder = proto.FrameDecoder()

        self._reader_thread = None
        self._writer_thread = None
        self._running = False
        self._connected = False

        # Connection info
        self.port_name = None
        self.our_node_id = 0
        # node_num → dict with keys: info (NodeInfo), position (Position|None),
        # telemetry (DeviceTelemetry|None), last_heard (float), last_snr (float)
        self.nodes = {}
        self._config_complete = threading.Event()
        # Channel data received during config dump (index → ChannelInfo)
        self._channels = {}
        # Set after firmware reboot + re-handshake during provisioning.
        # Initialized as SET so the first config_complete (cold boot) doesn't
        # trigger a false-positive "provisioning reboot complete" log.
        self._provisioning_complete = threading.Event()
        self._provisioning_complete.set()

    @property
    def connected(self):
        return self._connected

    def connect(self, port=None):
        """
        Open serial connection. Auto-detects port if not specified.
        Sends want_config to initiate handshake.
        Returns True if connection successful.
        """
        if self._connected:
            return True

        if port is None:
            port = scan_for_radio()
            if port is None:
                _log.debug("No radio found")
                return False

        try:
            import serial as pyserial
            self._serial = pyserial.Serial()
            self._serial.port = port
            self._serial.baudrate = BAUD_RATE
            self._serial.timeout = SERIAL_TIMEOUT
            self._serial.write_timeout = 2.0
            
            # Help Windows CP2102/CH340 drivers avoid semaphore timeouts 
            # and prevent the ESP32 from resetting upon connection
            self._serial.dtr = False
            self._serial.rts = False
            
            self._serial.open()
            self.port_name = port
            _log.info("Serial port opened: %s @ %d baud", port, BAUD_RATE)

        except ImportError:
            _log.error("pyserial not installed — cannot open serial port")
            return False
        except Exception as e:
            _log.error("Failed to open serial port %s: %s", port, e)
            self._serial = None
            return False

        # Start threads
        self._running = True
        self._config_complete.clear()

        self._reader_thread = threading.Thread(
            target=self._reader_loop,
            daemon=True,
            name='serial-reader'
        )
        self._writer_thread = threading.Thread(
            target=self._writer_loop,
            daemon=True,
            name='serial-writer'
        )
        self._reader_thread.start()
        self._writer_thread.start()

        # Initiate config handshake
        config_id = random.randint(1, 0xFFFFFFFF)
        self._send_raw(
            proto.frame_for_serial(proto.encode_to_radio_want_config(config_id))
        )
        _log.info("Sent want_config_id=%d, waiting for config dump...", config_id)

        # Wait for config completion (timeout 10s)
        if self._config_complete.wait(timeout=10.0):
            self._connected = True
            _log.info(
                "Config complete. Our node: %s, %d nodes known",
                proto.node_id_to_hex(self.our_node_id), len(self.nodes)
            )
            return True
        else:
            _log.warning("Config handshake timed out after 10s")
            # Still consider connected — config may arrive later
            self._connected = True
            return True

    def disconnect(self):
        """Close serial connection and stop threads."""
        self._running = False
        self._connected = False

        # Unblock writer thread
        try:
            self._tx_queue.put(None, timeout=0.1)
        except queue.Full:
            pass

        if self._serial:
            try:
                self._serial.close()
            except Exception:
                pass
            self._serial = None

        self.port_name = None
        _log.info("Serial disconnected")

    def send_to_radio(self, protobuf_bytes):
        """Queue a framed protobuf message for transmission."""
        framed = proto.frame_for_serial(protobuf_bytes)
        try:
            self._tx_queue.put_nowait(framed)
        except queue.Full:
            _log.warning("TX queue full — dropping packet")

    def send_text(self, channel, to_node_id, text_bytes, from_id=None):
        """
        Send a TEXT_MESSAGE_APP packet.

        Args:
            channel: Channel index to send on
            to_node_id: Destination node (or BROADCAST_ADDR)
            text_bytes: UTF-8 encoded message bytes
            from_id: Sender node ID (0 = let firmware fill it, which is
                     the correct behavior per the official Meshtastic
                     Python library)

        Returns:
            The packet_id (int) assigned to this transmission, used for
            correlating firmware ACK/NAK routing responses.
        """
        # Per the official Meshtastic library, the 'from' field should be
        # left as 0 when sending via Serial API. The firmware populates it
        # automatically. Setting it explicitly can cause the firmware to
        # treat the packet as forwarded rather than locally-originated,
        # which breaks directed message routing and encryption.
        sender = from_id if from_id is not None else 0

        # Build Data payload
        data = proto.encode_data_payload(
            portnum=proto.PORTNUM_TEXT_MESSAGE,
            payload_bytes=text_bytes,
        )

        # Build MeshPacket
        packet_id = random.randint(1, 0xFFFFFFFF)
        mesh_pkt = proto.encode_mesh_packet(
            from_id=sender,
            to_id=to_node_id,
            channel=channel,
            decoded_bytes=data,
            packet_id=packet_id,
            hop_limit=3,
            want_ack=(to_node_id != proto.BROADCAST_ADDR),
        )

        # Wrap in ToRadio
        to_radio = proto.encode_to_radio_packet(mesh_pkt)

        self.send_to_radio(to_radio)
        _log.info(
            "TX queued: ch=%d, to=%s, from=%s, ack=%s, id=%08x, %d payload bytes",
            channel,
            proto.node_id_to_hex(to_node_id),
            proto.node_id_to_hex(sender),
            to_node_id != proto.BROADCAST_ADDR,
            packet_id,
            len(text_bytes),
        )
        return packet_id

    def send_admin(self, admin_payload_bytes):
        """
        Send an AdminMessage to the local node via serial.

        This builds a MeshPacket addressed to our own node with
        portnum=PORTNUM_ADMIN. The firmware processes admin messages
        directed to itself and applies config changes immediately.

        Args:
            admin_payload_bytes: Pre-encoded AdminMessage protobuf bytes
        """
        if not self.our_node_id:
            _log.warning("Cannot send admin — our node ID is unknown")
            return

        # Build Data payload with PORTNUM_ADMIN
        data = proto.encode_data_payload(
            portnum=proto.PORTNUM_ADMIN,
            payload_bytes=admin_payload_bytes,
            want_response=True,  # Request acknowledgement
        )

        # Build MeshPacket: from=0 (local), to=our own node
        packet_id = random.randint(1, 0xFFFFFFFF)
        mesh_pkt = proto.encode_mesh_packet(
            from_id=0,                  # Let firmware fill — local origin
            to_id=self.our_node_id,     # Addressed to ourselves
            channel=0,                  # Admin uses channel 0
            decoded_bytes=data,
            packet_id=packet_id,
            hop_limit=0,               # Local only — never forward
            want_ack=False,            # Don't ACK ourselves
        )

        # Wrap in ToRadio and queue
        to_radio = proto.encode_to_radio_packet(mesh_pkt)
        self.send_to_radio(to_radio)
        _log.info(
            "ADMIN TX queued: to=%s, id=%08x, %d admin bytes",
            proto.node_id_to_hex(self.our_node_id),
            packet_id,
            len(admin_payload_bytes),
        )

    def send_set_channel(self, index, name, psk, role=proto.CHANNEL_ROLE_SECONDARY):
        """Configure a channel on the radio.

        Encodes and sends an AdminMessage.set_channel command.
        The firmware will reboot after applying this change.

        Args:
            index: Channel index (0-7)
            name: Channel display name (e.g. 'BEACON')
            psk: bytes — AES key (16 or 32 bytes)
            role: Channel role (PRIMARY, SECONDARY, DISABLED)
        """
        settings_bytes = proto.encode_channel_settings(psk, name)
        channel_bytes = proto.encode_channel(index, settings_bytes, role)
        admin_bytes = proto.encode_admin_set_channel(channel_bytes)
        _log.info(
            "Setting channel %d: name=%r, psk_len=%d, role=%d",
            index, name, len(psk), role,
        )
        # Clear the provisioning event so we can wait for the reboot
        self._provisioning_complete.clear()
        self.send_admin(admin_bytes)

    def send_set_owner(self, long_name, short_name='BC'):
        """Rename the radio's display name.

        Encodes and sends an AdminMessage.set_owner command.
        The firmware will reboot after applying this change.

        Args:
            long_name: New display name (e.g. 'Basecamp')
            short_name: 4-char abbreviated name (e.g. 'BC')
        """
        user_bytes = proto.encode_user(long_name, short_name)
        admin_bytes = proto.encode_admin_set_owner(user_bytes)
        _log.info(
            "Setting owner: long_name=%r, short_name=%r",
            long_name, short_name,
        )
        self._provisioning_complete.clear()
        self.send_admin(admin_bytes)

    def send_set_lora_config(self, region=proto.LORA_REGION_US, **kwargs):
        """Set the LoRa configuration on the radio.

        Encodes and sends an AdminMessage.set_config(lora=...) command.
        This is CRITICAL for provisioning: a factory-fresh radio has
        Region=UNSET and the firmware physically refuses to transmit.

        The firmware will reboot after applying this change.

        Args:
            region: LoRa region code (default: US)
            **kwargs: passed through to encode_lora_config (modem_preset,
                      tx_power, bandwidth, spread_factor, coding_rate, etc.)
        """
        lora_bytes = proto.encode_lora_config(region=region, **kwargs)
        config_bytes = proto.encode_config_with_lora(lora_bytes)
        admin_bytes = proto.encode_admin_set_config(config_bytes)
        _log.info("Setting LoRa config: region=%d, kwargs=%s", region, kwargs)
        # Clear the provisioning event so we can wait for the reboot
        self._provisioning_complete.clear()
        self.send_admin(admin_bytes)

    def get_channel(self, index):
        """Return cached ChannelInfo for a given channel index, or None.

        Channel data is populated during the firmware config dump
        (sent in response to want_config during handshake).
        """
        return self._channels.get(index)

    def wait_for_provisioning_reboot(self, timeout=30.0):
        """Block until the firmware reboots and re-handshakes after provisioning.

        Returns True if the radio came back, False on timeout.
        """
        _log.info("Waiting up to %.0fs for provisioning reboot...", timeout)
        return self._provisioning_complete.wait(timeout=timeout)

    # ── Internal threads ──────────────────────────────────────

    def _send_raw(self, raw_bytes):
        """Write raw bytes directly to serial port. Used during handshake."""
        if self._serial and self._serial.is_open:
            try:
                self._serial.write(raw_bytes)
                self._serial.flush()
            except Exception as e:
                _log.error("Serial write error: %s", e)

    def _reader_loop(self):
        """Serial reader thread. Reads bytes, feeds frame decoder, dispatches."""
        _log.info("Serial reader thread started")
        while self._running:
            try:
                if not self._serial or not self._serial.is_open:
                    time.sleep(1)
                    continue

                # Read available bytes (non-blocking due to timeout)
                data = self._serial.read(256)
                if not data:
                    continue

                # Feed frame decoder
                for payload in self._frame_decoder.feed(data):
                    try:
                        msg_type, message = proto.decode_from_radio(payload)
                        # DIAG: Log every FromRadio type at warning level
                        # so we can definitively see what the firmware sends.
                        _SILENT_TYPES = {
                            'config', 'module_config', 'log_record',
                            'file_info', 'deviceui_config',
                        }
                        if msg_type == 'unknown':
                            f = proto.decode_fields(payload)
                            _log.warning(
                                "DIAG FromRadio UNKNOWN — fields present: %s "
                                "(raw hex: %s)", list(f.keys()),
                                payload[:40].hex())
                        elif msg_type not in _SILENT_TYPES:
                            _log.debug("FromRadio: %s", msg_type)
                        self._handle_from_radio(msg_type, message)
                    except Exception as e:
                        _log.error("Error decoding FromRadio: %s (payload hex: %s)",
                                   e, payload[:32].hex())

            except Exception as e:
                if self._running:
                    _log.error("Serial read error: %s", e)
                    time.sleep(1)

        _log.info("Serial reader thread stopped")

    def _writer_loop(self):
        """Serial writer thread. Drains TX queue with pacing delays."""
        _log.info("Serial writer thread started")
        while self._running:
            try:
                # Block until a packet is available (or timeout)
                framed = self._tx_queue.get(timeout=1.0)
                if framed is None:
                    continue  # Shutdown sentinel

                if self._serial and self._serial.is_open:
                    self._serial.write(framed)
                    self._serial.flush()
                    _log.debug("TX: %d bytes written to serial", len(framed))

                    # Pacing delay — give the board time to transmit over LoRa
                    time.sleep(TX_DRAIN_MS / 1000.0)

            except queue.Empty:
                continue
            except Exception as e:
                if self._running:
                    _log.error("Serial write error: %s", e)
                    time.sleep(1)

        _log.info("Serial writer thread stopped")

    def _ensure_node(self, node_num):
        """Ensure a node entry exists in the NodeDB. Returns the entry dict."""
        if node_num not in self.nodes:
            self.nodes[node_num] = {
                'info': None,
                'position': None,
                'telemetry': None,
                'last_heard': time.time(),
                'position_updated': 0,
                'last_snr': 0.0,
                'last_hops': 0,
            }
        return self.nodes[node_num]

    def _handle_from_radio(self, msg_type, message):
        """Process a decoded FromRadio message."""

        if msg_type == 'my_info':
            self.our_node_id = message.my_node_num
            _log.info("Our node ID: %s", proto.node_id_to_hex(self.our_node_id))

        elif msg_type == 'node_info':
            entry = self._ensure_node(message.num)
            entry['info'] = message

            # ── Populate from config dump ─────────────────────────
            # The firmware's initial config dump includes last-known
            # position, telemetry, SNR, and last_heard for every node.
            # Populate the entry ONLY if we don't already have live data
            # (live PORTNUM_POSITION/TELEMETRY packets are always fresher).

            # Position from config dump (field 3 of NodeInfo)
            if message.position and entry.get('position') is None:
                entry['position'] = message.position
                # Use firmware's last_heard as a proxy for when this position
                # was last broadcast — more accurate than our boot time.
                if message.last_heard and message.last_heard > MIN_VALID_EPOCH:
                    entry['position_updated'] = message.last_heard
                elif message.position.time and message.position.time > 0:
                    entry['position_updated'] = message.position.time
                else:
                    entry['position_updated'] = time.time()
                _log.warning(
                    "DIAG NodeInfo POSITION for %s (%s): lat=%.5f, lng=%.5f, alt=%dm",
                    proto.node_id_to_hex(message.num), message.long_name,
                    message.position.latitude_i / 1e7,
                    message.position.longitude_i / 1e7,
                    message.position.altitude,
                )
            else:
                has_pos = 'YES' if message.position else 'NO'
                already = 'YES' if entry.get('position') else 'NO'
                _log.warning(
                    "DIAG NodeInfo for %s (%s): position_in_dump=%s, already_have=%s",
                    proto.node_id_to_hex(message.num), message.long_name,
                    has_pos, already,
                )

            # Device metrics from config dump (field 7 of NodeInfo)
            if message.device_metrics and entry.get('telemetry') is None:
                entry['telemetry'] = message.device_metrics
                entry['telemetry_updated'] = 0  # Mark as stale so sweep replaces with live
                entry['telemetry_from_config'] = True  # May be stale
                _log.warning(
                    "DIAG NodeInfo TELEMETRY for %s: batt=%d%%, voltage=%.1fV",
                    proto.node_id_to_hex(message.num),
                    message.device_metrics.battery_level,
                    message.device_metrics.voltage,
                )

            # SNR from config dump (field 4 of NodeInfo)
            if message.snr and message.snr != 0:
                if entry.get('last_snr', 0) == 0:
                    entry['last_snr'] = round(message.snr, 1)

            # Use firmware's last_heard if available — it's the
            # actual timestamp the firmware last heard this node,
            # which is more accurate than our local clock time.
            # Guard: if the firmware's RTC hasn't been set (no GPS fix),
            # last_heard may be relative uptime, not a Unix epoch.
            # Reject values before year 2000 as non-epoch.
            if message.last_heard and message.last_heard > MIN_VALID_EPOCH:
                entry['last_heard'] = message.last_heard
            else:
                entry['last_heard'] = time.time()

            _log.debug("Node discovered: %s (%s) last_heard=%s",
                        proto.node_id_to_hex(message.num), message.long_name,
                        message.last_heard)

        elif msg_type == 'channel':
            # Channel data from firmware config dump
            ch = message  # ChannelInfo namedtuple
            self._channels[ch.index] = ch
            ch_name = ch.settings.name if ch.settings else '<empty>'
            ch_psk_len = len(ch.settings.psk) if ch.settings and ch.settings.psk else 0
            ch_role = {0: 'DISABLED', 1: 'PRIMARY', 2: 'SECONDARY'}.get(ch.role, '?')
            _log.debug("Channel %d: name=%r, role=%s, psk_len=%d",
                         ch.index, ch_name, ch_role, ch_psk_len)

        elif msg_type == 'config_complete':
            _log.info("Config dump complete (id=%d)", message)
            self._config_complete.set()
            # If we're waiting for a provisioning reboot to finish,
            # signal that the radio is ready again.
            if not self._provisioning_complete.is_set():
                self._provisioning_complete.set()
                _log.info("Provisioning reboot complete — radio ready")

        elif msg_type == 'rebooted':
            # Firmware has rebooted (e.g., after an admin config change).
            # We must re-initiate the handshake to resume live forwarding.
            _log.warning("Firmware rebooted — re-initiating config handshake")
            # Reset the frame decoder to discard any boot garbage
            self._frame_decoder.reset()
            # Clear the config_complete event so we wait for the new dump
            self._config_complete.clear()
            # Clear cached channel data — will be repopulated by the new
            # config dump. Without this, removed channels persist as stale
            # entries in _channels (BUG-09).
            self._channels.clear()
            # Send a fresh want_config_id to restart the handshake
            config_id = random.randint(1, 0xFFFFFFFF)
            try:
                self._send_raw(
                    proto.frame_for_serial(proto.encode_to_radio_want_config(config_id))
                )
                _log.info("Re-handshake sent (want_config_id=%d)", config_id)
            except Exception as e:
                _log.error("Failed to send re-handshake: %s", e)

        elif msg_type == 'packet':
            packet = message
            sender = packet.from_id

            # DIAG: Log every packet at warning level
            if packet.decoded:
                _log.warning(
                    "DIAG RX packet: from=%s to=%s ch=%d portnum=%d decoded_len=%d",
                    proto.node_id_to_hex(sender),
                    proto.node_id_to_hex(packet.to_id),
                    packet.channel,
                    packet.decoded.portnum,
                    len(packet.decoded.payload),
                )
            elif packet.encrypted:
                _log.warning(
                    "DIAG RX ENCRYPTED packet: from=%s to=%s ch=%d enc_len=%d "
                    "(radio cannot decrypt — PSK mismatch or PKI)",
                    proto.node_id_to_hex(sender),
                    proto.node_id_to_hex(packet.to_id),
                    packet.channel,
                    len(packet.encrypted),
                )

            # Update last_heard for ANY packet from ANY node (including self).
            # Previously excluded our own node, but Basecamp self-broadcasts
            # (telemetry, position) must update last_heard or it goes stale.
            if sender:
                entry = self._ensure_node(sender)
                entry['last_heard'] = time.time()
                if packet.rx_snr:
                    entry['last_snr'] = round(packet.rx_snr, 1)
                # Compute actual hops taken = hop_start - hop_limit
                # hop_start is the original hop budget, hop_limit is remaining
                hs = packet.hop_start
                hl = packet.hop_limit
                if isinstance(hs, int) and isinstance(hl, int) and hs > 0:
                    entry['last_hops'] = max(0, hs - hl)
                elif isinstance(hl, int) and hl > 0:
                    # Fallback: no hop_start (older firmware) — store raw hop_limit
                    entry['last_hops'] = hl

            # Decode and store Position packets
            if (packet.decoded and
                    packet.decoded.portnum == proto.PORTNUM_POSITION):
                try:
                    pos = proto.decode_position(packet.decoded.payload)
                    if sender:
                        if pos.latitude_i == 0 and pos.longitude_i == 0:
                            _log.warning(
                                "DIAG POSITION from %s: (0,0) — GPS has no fix, ignoring",
                                proto.node_id_to_hex(sender))
                        else:
                            node_entry = self._ensure_node(sender)
                            node_entry['position'] = pos
                            node_entry['position_updated'] = time.time()
                            _log.warning(
                                "DIAG LIVE POSITION from %s: lat=%.5f, lng=%.5f, alt=%dm",
                                proto.node_id_to_hex(sender),
                                pos.latitude_i / 1e7, pos.longitude_i / 1e7,
                                pos.altitude,
                            )
                except Exception as e:
                    _log.debug("Failed to decode position from %s: %s",
                                 proto.node_id_to_hex(sender), e)

            # Decode and store Telemetry packets
            if (packet.decoded and
                    packet.decoded.portnum == proto.PORTNUM_TELEMETRY):
                try:
                    # Try DeviceMetrics first (battery, voltage, uptime)
                    telem = proto.decode_device_telemetry(packet.decoded.payload)
                    if telem and sender:
                        node = self._ensure_node(sender)
                        node['telemetry'] = telem
                        node['telemetry_updated'] = time.time()
                        node['telemetry_from_config'] = False  # Now live
                        _log.warning(
                            "DIAG LIVE TELEMETRY from %s: battery=%d%%, voltage=%.1fV, uptime=%ds",
                            proto.node_id_to_hex(sender),
                            telem.battery_level, telem.voltage,
                            telem.uptime_seconds,
                        )
                    else:
                        # Try EnvironmentMetrics (temp, humidity, pressure)
                        env = proto.decode_environment_telemetry(packet.decoded.payload)
                        if env and sender:
                            node = self._ensure_node(sender)
                            node['environment'] = env
                            node['environment_updated'] = time.time()
                            _log.warning(
                                "DIAG LIVE ENVIRONMENT from %s: temp=%.1f°C, humidity=%.1f%%, pressure=%.1fhPa",
                                proto.node_id_to_hex(sender),
                                env.temperature, env.relative_humidity,
                                env.barometric_pressure,
                            )
                        else:
                            # Check for LocalStats (Telemetry field 6) — network
                            # stats like channel_utilization, air_util. We already
                            # get these from DeviceMetrics so just log and skip.
                            top_fields = proto.decode_fields(packet.decoded.payload)
                            if 6 in top_fields:
                                _log.debug(
                                    "DIAG LocalStats from %s (skipped — redundant)",
                                    proto.node_id_to_hex(sender),
                                )
                            elif sender:
                                _log.warning(
                                    "DIAG TELEMETRY from %s: unhandled subtype, "
                                    "fields=%s",
                                    proto.node_id_to_hex(sender),
                                    list(top_fields.keys()),
                                )
                except Exception as e:
                    _log.debug("Failed to decode telemetry from %s: %s",
                                 proto.node_id_to_hex(sender), e)

            # Decode and store live NodeInfo broadcasts (portnum=4)
            # CRITICAL: NODEINFO_APP payload is a User protobuf, NOT a full
            # NodeInfo. User fields: 1=id(str), 2=long_name, 3=short_name,
            # 4=macaddr, 5=hw_model, 6=is_licensed, 7=role
            if (packet.decoded and
                    packet.decoded.portnum == proto.PORTNUM_NODEINFO):
                try:
                    uf = proto.decode_fields(packet.decoded.payload)
                    user_id = uf.get(1, b'').decode('utf-8', errors='replace') if isinstance(uf.get(1), bytes) else ''
                    long_name = uf.get(2, b'').decode('utf-8', errors='replace') if isinstance(uf.get(2), bytes) else ''
                    short_name = uf.get(3, b'').decode('utf-8', errors='replace') if isinstance(uf.get(3), bytes) else ''

                    if sender:
                        entry = self._ensure_node(sender)
                        # Build a minimal NodeInfo for storage
                        ni = proto.NodeInfo(
                            num=sender,
                            user_id=user_id,
                            long_name=long_name,
                            short_name=short_name,
                            position=None,
                            snr=0.0,
                            last_heard=int(time.time()),
                            device_metrics=None,
                        )
                        entry['info'] = ni
                        entry['info_updated'] = time.time()
                        _log.warning(
                            "DIAG LIVE NODEINFO from %s: name=%s, short=%s",
                            proto.node_id_to_hex(sender), long_name, short_name,
                        )
                except Exception as e:
                    _log.debug("Failed to decode nodeinfo from %s: %s",
                                 proto.node_id_to_hex(sender), e)

            # ── V-03: Handle Routing (ACK/NAK) packets ────────────
            # The firmware sends PORTNUM_ROUTING packets to report delivery
            # status for our outbound DMs (want_ack=True). The payload is a
            # Routing protobuf where field 3 = error_reason enum.
            # reply_id in the Data payload links back to the original packet_id.
            if (packet.decoded and
                    packet.decoded.portnum == proto.PORTNUM_ROUTING):
                reply_id = packet.decoded.reply_id
                if reply_id:
                    # Parse routing payload: field 3 = error_reason (varint)
                    error_reason = proto.ROUTING_ERROR_NONE
                    try:
                        routing_fields = proto.decode_fields(packet.decoded.payload)
                        error_reason = routing_fields.get(3, 0)
                    except Exception:
                        pass

                    if error_reason != proto.ROUTING_ERROR_NONE:
                        error_name = proto.ROUTING_ERROR_NAMES.get(
                            error_reason, f'UNKNOWN({error_reason})')
                        _log.warning(
                            "Delivery FAILED for packet %08x: %s (error=%d)",
                            reply_id, error_name, error_reason)

                        # Forward as routing_error event to CommsManager
                        if self._on_from_radio:
                            self._on_from_radio('routing_error', {
                                'reply_id': reply_id,
                                'error_reason': error_reason,
                                'error_name': error_name,
                            })
                    else:
                        _log.debug(
                            "Delivery ACK received for packet %08x", reply_id)
                        # Forward successful ACK to CommsManager so it can
                        # clear the pending_ack entry and mark the message
                        # as confirmed. Without this, the entry stays in
                        # _pending_acks until _sweep_stale_acks marks it
                        # as TIMEOUT — even though delivery succeeded.
                        if self._on_from_radio:
                            self._on_from_radio('delivery_ack', {
                                'reply_id': reply_id,
                            })

            # Forward to callback (dispatch engine, message history)
            if self._on_from_radio:
                self._on_from_radio(msg_type, message)
            return  # Don't double-forward

        # Forward non-packet messages to callback
        if self._on_from_radio:
            self._on_from_radio(msg_type, message)

    def get_status(self):
        """Return connection status dict for the status API."""
        return {
            'connected': self._connected,
            'port': self.port_name,
            'node_id': proto.node_id_to_hex(self.our_node_id) if self.our_node_id else None,
            'nodes_seen': len(self.nodes),
            'tx_queue_depth': self._tx_queue.qsize(),
        }
