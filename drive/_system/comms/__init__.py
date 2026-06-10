"""
The Blackout Drive — COMMS Manager
Copyright (c) 2026 Hutton Technologies LLC — Licensed under BSL 1.1
================================================================
Top-level entry point for the mesh communications subsystem.

Manages:
  - Serial I/O lifecycle (connect, reconnect, disconnect)
  - Dispatch Engine initialization
  - Ollama inference bridge
  - Message history for COMMS UI feed
  - Status API aggregation

Thread Safety:
  - Generation counter prevents orphan threads from stale connections
  - TX callback uses local reference capture (immune to reconnect nulling)
  - Ordered disconnect: cancel engine → increment gen → disconnect serial → null

Usage from server.py:
    from comms import CommsManager
    comms = CommsManager(config, ollama_port)
    comms.start()
    ...
    comms.stop()
================================================================
"""

import datetime
import os
import random
import time
import json
import logging
import threading
import urllib.request

from .serial_io import SerialIO
from .dispatch import DispatchEngine
from .store import CommsStore
from . import protocol as proto
from . import provisioning as prov

_log = logging.getLogger('blackout.comms')

# ── COMMS Diagnostic File Logger ──────────────────────────────
# Write ALL comms warning+ messages to a file on the drive so
# diagnostics are always accessible (terminal may not be visible).
def _setup_comms_file_log(data_dir):
    """Attach a file handler to the blackout logger subtree."""
    log_dir = os.path.join(data_dir, 'logs')
    os.makedirs(log_dir, exist_ok=True)
    log_path = os.path.join(log_dir, 'comms_diag.log')
    fh = logging.FileHandler(log_path, encoding='utf-8')
    fh.setFormatter(logging.Formatter(
        '%(asctime)s [%(name)s] %(levelname)s %(message)s',
        datefmt='%H:%M:%S',
    ))
    fh.setLevel(logging.WARNING)
    # Attach to the 'blackout' parent so serial/comms/provisioning all write
    parent = logging.getLogger('blackout')
    parent.addHandler(fh)
    parent.setLevel(logging.WARNING)
    parent.propagate = False  # B2 fix: prevent duplicate lines (parent → root)
    _log.warning("COMMS diagnostic log: %s", log_path)

# Max messages to keep in the UI feed history (RAM cache)
MAX_MESSAGE_HISTORY = 100

# Reconnect scan interval when no radio is connected
RECONNECT_INTERVAL_SEC = 5

# TTL for pending ACK tracking (seconds). If no ACK/NAK arrives within this
# window, the message is marked as delivery failed (radio likely disconnected).
PENDING_ACK_TTL_SEC = 120

# Periodic node data sweep: how often (seconds) to check if any node's data is
# stale and request fresh updates. This ensures we don't wait 15+ minutes for
# a node's passive broadcast cycle.
NODE_DATA_SWEEP_SEC = 60

# How old (seconds) a node's position/telemetry must be before we re-request it.
# This prevents flooding the mesh with redundant requests when data is still fresh.
NODE_DATA_STALE_SEC = 300  # 5 minutes

import re as _re

# ── Message Classification Engine ─────────────────────────────
# Rule-based keyword tagging for tactical message categorization.
# Order matters: first match wins. BEACON checked by flag, not keywords.

_CLASSIFY_RULES = [
    ('ALERT', _re.compile(
        r'\b(emergency|danger|sos|mayday|warning|evacuate|threat|hostile|'
        r'contact|under fire|casualty report|cas(evac)?|help|critical)\b', _re.I)),
    ('MEDICAL', _re.compile(
        r'\b(medic|medical|wound|bleeding|tourniquet|casualty|cpr|fracture|'
        r'trauma|triage|bandage|splint|airway|pulse|seizure|allergic|'
        r'anaphyla|burn|heat stroke|hypotherm|poison|overdose|narcan)\b', _re.I)),
    ('LOCATION', _re.compile(
        r'\b(grid|coordinate|position|bearing|azimuth|recon|target|'
        r'observation|movement|patrol|perimeter|sector|flank|'
        r'\d{1,3}\.\d+°?\s*[NSEW])\b', _re.I)),
    ('LOGISTICS', _re.compile(
        r'\b(supply|resupply|ammo|ammunition|water|fuel|ration|food|'
        r'transport|eta|pickup|drop|extract|cache|inventory|battery)\b', _re.I)),
]

def _classify_message(text, is_dispatch=False):
    """Classify a message text into a tactical category.

    Returns one of: BEACON, ALERT, MEDICAL, LOCATION, LOGISTICS, GENERAL.
    BEACON is set by flag (dispatch responses or @beacon queries),
    not by keyword matching.
    """
    if is_dispatch or text.lower().startswith('@beacon'):
        return 'BEACON'
    for tag, pattern in _CLASSIFY_RULES:
        if pattern.search(text):
            return tag
    return 'GENERAL'


def _data_source_label(was_grounded=False):
    """Return a data source label for AI responses.

    Replaces the old confidence percentage bar which was visually
    misleading (neon green 85% bar implies mathematical certainty).

    Returns a string:
      - was_grounded=True  → 'Live Mesh' (context was injected, model had real data)
      - was_grounded=False → 'Internal AI' (no context available, model knowledge only)
    """
    return 'Live Mesh' if was_grounded else 'Internal AI'


class CommsManager:
    """
    Top-level COMMS subsystem manager.

    Responsibilities:
      - Start/stop serial connection + dispatch engine
      - Bridge between Dispatch Engine and Ollama for inference
      - Maintain message history for the COMMS UI panel
      - Provide aggregated status for /api/comms/status

    Thread Safety Model:
      - _generation: monotonically increasing int, incremented on every connect/
        disconnect cycle. All spawned threads capture this value at creation.
        Before performing I/O, threads compare their captured gen to the current
        one — if stale, they exit silently. This prevents orphan threads from
        previous connections from corrupting the new connection.
    """

    def __init__(self, config, ollama_port=11434, data_dir=None,
                 persist_role_fn=None):
        """
        Args:
            config: Full config dict from config.json
            ollama_port: Ollama API port
            data_dir: Directory for persistent data (encrypted COMMS log).
                      Defaults to <_system>/data/
            persist_role_fn: Optional callable(role_str) to persist
                             dispatch_role changes to config.json atomically.
        """
        self._config = config
        self._ollama_port = ollama_port
        self._model_name = config.get('model', {}).get('name', 'blackout-beacon')
        self._persist_role_fn = persist_role_fn

        # Dispatch settings from config
        self._dispatch_config = {
            'dispatch_enabled': config.get('comms', {}).get('dispatch_enabled', True),
            'dispatch_channel': config.get('comms', {}).get('dispatch_channel', 1),
            'dispatch_role': config.get('comms', {}).get('dispatch_role', 'primary'),
        }

        # Components (initialized on start)
        self._serial = None
        self._dispatch = None

        # Generation counter — prevents orphan threads from stale connections
        self._generation = 0
        self._gen_lock = threading.Lock()

        # Message history for UI (RAM cache, backed by encrypted store)
        self._messages = []
        self._messages_lock = threading.Lock()
        self._msg_counter = 0  # monotonic ID for dedup

        # ── Encrypted persistent store (password-protected, starts locked) ──
        if data_dir is None:
            data_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'data')
        log_path = os.path.join(data_dir, 'comms_log.bkv')
        try:
            self._store = CommsStore(log_path)
            # Store starts locked — hydration happens in unlock_store()
        except Exception as e:
            _log.error('Failed to initialize encrypted COMMS store: %s', e)
            self._store = None

        # Data directory for provisioning artifacts (PSK, state file)
        self._data_dir = data_dir
        _setup_comms_file_log(data_dir)

        # Async provisioning job state (BUG-01 fix)
        self._provisioning_job = None
        self._provisioning_lock = threading.Lock()

        # V-03: Track outbound DM packet_ids awaiting ACK.
        # Maps radio packet_id (int) → (msg_id, timestamp) for delivery state updates.
        self._pending_acks = {}
        self._pending_acks_lock = threading.Lock()

        # Reconnect thread
        self._reconnect_thread = None
        self._running = False
        self._first_scan_complete = False  # True after first serial scan attempt

        # Radio silence flag (from Settings) — persisted across reboots
        self.radio_silence = config.get('comms', {}).get('radio_silence', False)

        # Hardware emission flags — backed by firmware admin commands — persisted
        # Default=True matches Meshtastic firmware defaults. When config is
        # missing/wiped, we assume firmware is in its default state (broadcasting).
        # This prevents unnecessary admin commands that trigger firmware reboots.
        self._radio_telemetry = config.get('comms', {}).get('radio_telemetry', True)
        self._gps_position = config.get('comms', {}).get('gps_position', True)

        # Manual basecamp position — operator-provided fallback when GPS is
        # unavailable. Only used for our own node, only when hardware position
        # is None. Stored in config.json under comms.basecamp_position.
        bp = config.get('comms', {}).get('basecamp_position')
        if bp and isinstance(bp, dict) and 'lat' in bp and 'lng' in bp:
            self._basecamp_position = {
                'lat': float(bp['lat']),
                'lng': float(bp['lng']),
                'alt': int(bp.get('alt', 0)),
            }
        else:
            self._basecamp_position = None

    def unlock_store(self, password: str) -> bool:
        """Unlock the COMMS log with the user's master password.
        Merges persisted messages with any received before unlock."""
        if not self._store:
            return False
        ok = self._store.unlock(password)
        if ok:
            persisted = self._store.load_all()
            if persisted:
                max_persisted_id = max(m.get('msg_id', 0) for m in persisted)
                # Preserve messages received between server boot and unlock
                pre_unlock = [m for m in self._messages
                              if m.get('msg_id', 0) > max_persisted_id]
                self._messages = persisted + pre_unlock
                self._msg_counter = max(
                    max_persisted_id,
                    max((m.get('msg_id', 0) for m in pre_unlock), default=0)
                )
                _log.info('COMMS store unlocked — hydrated %d persisted + '
                          '%d pre-unlock messages (counter=%d)',
                          len(persisted), len(pre_unlock), self._msg_counter)
                # Persist newly merged messages so they survive a restart
                for m in pre_unlock:
                    self._store.append(m)
            else:
                # No persisted data — keep whatever we have in RAM
                _log.info('COMMS store unlocked — no persisted data, '
                          'keeping %d RAM messages', len(self._messages))
        return ok

    def lock_store(self):
        """Lock the COMMS log — clears the encryption key from memory."""
        with self._messages_lock:
            self._messages = []
            self._msg_counter = 0
        if self._store:
            self._store.lock()

    def is_store_unlocked(self) -> bool:
        """Check if the COMMS log is unlocked and ready for read/write."""
        return self._store.is_unlocked() if self._store else False

    def rekey_store(self, old_password, new_password):
        """Re-encrypt the COMMS log with a new password-derived key.
        Called during password change to prevent silent history loss."""
        if self._store:
            return self._store.rekey(old_password, new_password)
        return False

    def start(self):
        """Start the COMMS subsystem. Begins scanning for radio."""
        if self._running:
            return

        _log.info("COMMS subsystem starting...")
        self._running = True

        # Initialize serial I/O with our callback
        self._serial = SerialIO(on_from_radio=self._on_from_radio)

        # Start reconnect loop (handles initial connection too)
        self._reconnect_thread = threading.Thread(
            target=self._reconnect_loop,
            daemon=True,
            name='comms-reconnect'
        )
        self._reconnect_thread.start()

    def stop(self):
        """Stop the COMMS subsystem. Disconnects radio."""
        _log.info("COMMS subsystem stopping...")
        self._running = False
        self._graceful_disconnect()

    def _graceful_disconnect(self):
        """Ordered disconnect sequence. Order is critical for thread safety.

        1. Cancel dispatch engine FIRST (stops new TX attempts, signals threads)
        2. Increment generation (orphan threads will see stale gen and exit)
        3. Disconnect serial (kills reader/writer threads)
        4. Null references LAST (any thread checking sees None)
        """
        # Step 1: Cancel dispatch engine
        if self._dispatch:
            try:
                self._dispatch.cancel()
            except Exception:
                pass

        # Step 2: Increment generation
        with self._gen_lock:
            self._generation += 1
            _log.info("Generation incremented to %d", self._generation)

        # Step 3: Disconnect serial
        if self._serial:
            try:
                self._serial.disconnect()
            except Exception:
                pass

        # Step 4: Null references
        self._dispatch = None
        # Note: do NOT null self._serial — the reconnect loop needs it for reconnection

    def _reconnect_loop(self):
        """Background thread: scan for radio, connect, reconnect on disconnect."""
        while self._running:
            if not self._serial or not self._serial.connected:
                # Try to connect
                if self._serial and self._serial.connect():
                    self._first_scan_complete = True
                    self._on_connected()
                else:
                    self._first_scan_complete = True
                    time.sleep(RECONNECT_INTERVAL_SEC)
                    continue

            # Monitor connection health
            time.sleep(RECONNECT_INTERVAL_SEC)

            # Check if serial port is still valid
            if self._serial and self._serial._serial:
                try:
                    if not self._serial._serial.is_open:
                        _log.warning("Serial port closed — reconnecting...")
                        self._graceful_disconnect()
                except Exception:
                    pass

    def _on_connected(self):
        """Called when serial connection is established."""
        _log.info("Radio connected — initializing Dispatch Engine")

        # Increment generation for this new connection
        with self._gen_lock:
            self._generation += 1
            gen = self._generation

        # Create dispatch engine with our node ID, TX callback, and context accessors
        self._dispatch = DispatchEngine(
            our_node_id=self._serial.our_node_id,
            config=self._dispatch_config,
            tx_callback=self._tx_callback,
            node_db_fn=lambda: self._serial.nodes if self._serial else {},
            messages_fn=lambda: list(self._messages[-20:]),
            persist_role_fn=self._persist_role_fn,
        )

        # Wire up inference function
        self._dispatch.set_inference_fn(self._do_inference)
        # Wire manual basecamp position for context assembly
        self._dispatch._basecamp_position = self._basecamp_position

        self._add_system_message(
            f"Radio connected on {self._serial.port_name}. "
            f"Node: {proto.node_id_to_hex(self._serial.our_node_id)}"
        )

        # Start persistent data sweep loop — requests stale data from all nodes
        # on a recurring cadence so we never wait for passive broadcasts.
        threading.Thread(target=self._node_data_sweep_loop, args=(gen,),
                        daemon=True, name='node-data-sweep').start()

    def _node_data_sweep_loop(self, gen):
        """Persistent background loop that keeps all node data fresh.

        Runs every NODE_DATA_SWEEP_SEC. For each remote node, checks if
        position, telemetry, or nodeinfo data is stale (older than
        NODE_DATA_STALE_SEC) and sends a want_response request for the
        stale fields. Also sweeps stale pending ACKs.

        Exits when generation changes (new connection established).
        """
        # Initial delay: let config dump finish populating the node DB
        time.sleep(5)

        while self._running:
            # Check generation hasn't changed (reconnection happened)
            with self._gen_lock:
                if self._generation != gen:
                    _log.info("Data sweep loop exiting (generation changed)")
                    return

            serial = self._serial
            if not serial or not serial.connected:
                time.sleep(NODE_DATA_SWEEP_SEC)
                continue

            if self.radio_silence:
                time.sleep(NODE_DATA_SWEEP_SEC)
                continue

            now = time.time()
            our_id = serial.our_node_id

            for nid in list(serial.nodes.keys()):
                if nid == our_id or nid == 0:
                    continue

                # Check generation again before each node request
                with self._gen_lock:
                    if self._generation != gen:
                        return

                node = serial.nodes.get(nid, {})

                # B4 fix: Skip ghosts (last_heard=0 = never directly heard).
                # For nodes with stale firmware-reported last_heard (>30 min),
                # allow ONE sweep probe to check if they're still alive.
                # Without this, nodes from the config dump never get refreshed
                # because the sweep skips them → no probe → no ACK → last_heard
                # never updates → deadlock. Track via 'sweep_attempted' flag.
                last_heard = node.get('last_heard', 0)
                if last_heard == 0:
                    continue  # True ghost — never heard at all
                if (now - last_heard > 1800):
                    # Stale node. Allow one probe attempt per boot.
                    if node.get('sweep_attempted', False):
                        continue  # Already tried, no response — skip
                    node['sweep_attempted'] = True

                # Check position freshness
                pos = node.get('position')
                pos_updated = node.get('position_updated', 0)
                if pos is None or (now - pos_updated > NODE_DATA_STALE_SEC):
                    _log.info("Sweep: requesting position from %s (age=%ds)",
                              proto.node_id_to_hex(nid),
                              int(now - pos_updated) if pos_updated else -1)
                    try:
                        self.request_node_position(nid)
                    except Exception as e:
                        _log.warning("Sweep position request failed for %s: %s",
                                     proto.node_id_to_hex(nid), e)
                    time.sleep(0.5)

                # Check telemetry freshness
                telem = node.get('telemetry')
                telem_updated = node.get('telemetry_updated', 0)
                if telem is None or (now - telem_updated > NODE_DATA_STALE_SEC):
                    _log.info("Sweep: requesting telemetry from %s (age=%ds)",
                              proto.node_id_to_hex(nid),
                              int(now - telem_updated) if telem_updated else -1)
                    try:
                        self.request_node_telemetry(nid)
                    except Exception as e:
                        _log.warning("Sweep telemetry request failed for %s: %s",
                                     proto.node_id_to_hex(nid), e)
                    time.sleep(0.5)

                # Check nodeinfo freshness
                info = node.get('info')
                info_updated = node.get('info_updated', 0)
                if info is None or (now - info_updated > NODE_DATA_STALE_SEC):
                    _log.info("Sweep: requesting nodeinfo from %s (age=%ds)",
                              proto.node_id_to_hex(nid),
                              int(now - info_updated) if info_updated else -1)
                    try:
                        self.request_node_info(nid)
                    except Exception as e:
                        _log.warning("Sweep nodeinfo request failed for %s: %s",
                                     proto.node_id_to_hex(nid), e)
                    time.sleep(0.5)

                # Pace between nodes to avoid flooding
                time.sleep(1)

            # Sweep stale ACKs on every tick (not just on message add)
            self._sweep_stale_acks()

            # Sleep until next sweep
            time.sleep(NODE_DATA_SWEEP_SEC)

    def _on_from_radio(self, msg_type, message):
        """Callback from serial reader thread for each FromRadio message."""

        # ── V-03: Handle routing errors (ACK failures from firmware) ──
        if msg_type == 'routing_error' and isinstance(message, dict):
            reply_id = message.get('reply_id')
            error_name = message.get('error_name', 'UNKNOWN')
            if reply_id and reply_id in self._pending_acks:
                with self._pending_acks_lock:
                    entry = self._pending_acks.pop(reply_id, None)
                if entry is None:
                    return
                failed_msg_id, _ack_ts = entry
                _log.warning(
                    "Marking msg_id %d as delivery failed: %s",
                    failed_msg_id, error_name
                )
                # Mark the original message as failed in the history buffer
                with self._messages_lock:
                    for msg in self._messages:
                        if msg.get('msg_id') == failed_msg_id:
                            msg['delivery_failed'] = True
                            msg['delivery_error'] = error_name
                            break
                # Inject a system notification so the operator sees it
                self._add_system_message(
                    "DELIVERY FAILED: Message to %s — %s" % (
                        self._get_msg_dest_name(failed_msg_id), error_name
                    )
                )
            return

        # ── Handle successful delivery ACKs ──────────────────────
        # The firmware confirms our outbound DM was received by the target.
        # Clear the pending_ack entry so _sweep_stale_acks won't mark it
        # as TIMEOUT. Also mark the message as confirmed for the UI.
        if msg_type == 'delivery_ack' and isinstance(message, dict):
            reply_id = message.get('reply_id')
            if reply_id and reply_id in self._pending_acks:
                with self._pending_acks_lock:
                    entry = self._pending_acks.pop(reply_id, None)
                if entry:
                    confirmed_msg_id, _ = entry
                    _log.info(
                        "Delivery confirmed: pkt %08x → msg_id %d",
                        reply_id, confirmed_msg_id
                    )
                    with self._messages_lock:
                        for msg in self._messages:
                            if msg.get('msg_id') == confirmed_msg_id:
                                msg['confirmed'] = True
                                break
                    # Inject visible confirmation — mirrors the failure path
                    self._add_system_message(
                        "✓ Delivered to %s" % self._get_msg_dest_name(confirmed_msg_id)
                    )
            return

        if msg_type == 'packet' and isinstance(message, proto.MeshPacket):
            # ── Self-echo filter ──────────────────────────────────
            # When we send a packet via serial, the Meshtastic firmware echoes
            # it back as a fromRadio MeshPacket. Our send_message() already
            # adds the TX to message history, so we must suppress the echo
            # to avoid duplicates. We still let non-text portnums through
            # (position/telemetry from our own node are handled by serial_io).
            our_id = self._serial.our_node_id if self._serial else 0
            if message.from_id == our_id and our_id != 0:
                # Still forward to dispatch for BEACON self-echo tracking,
                # but do NOT add to message history (already added by TX path).
                _log.debug(
                    "Self-echo suppressed: pkt=%d, portnum=%s",
                    message.packet_id,
                    message.decoded.portnum if message.decoded else 'N/A',
                )
                return

            # ── Privacy gate: discard third-party DMs ─────────────
            # LoRa is broadcast RF — we may intercept DMs between other
            # nodes. Never store, display, or forward these to dispatch.
            is_dm = message.to_id != proto.BROADCAST_ADDR
            if is_dm and message.to_id != our_id and message.from_id != our_id:
                _log.debug(
                    "Discarding third-party DM: %s → %s (we are %s)",
                    proto.node_id_to_hex(message.from_id),
                    proto.node_id_to_hex(message.to_id),
                    proto.node_id_to_hex(our_id),
                )
                return  # Silent drop — never enters history or dispatch

            # Add to message history if it's a text message
            if message.decoded and message.decoded.portnum == proto.PORTNUM_TEXT_MESSAGE:
                try:
                    text = message.decoded.payload.decode('utf-8', errors='replace')
                    sender = proto.node_id_to_hex(message.from_id)
                    dest = proto.node_id_to_hex(message.to_id)

                    node_entry = self._serial.nodes.get(message.from_id) if self._serial else None
                    sender_name = sender
                    if node_entry and isinstance(node_entry, dict):
                        info = node_entry.get('info')
                        if info and info.long_name:
                            sender_name = info.long_name
                    elif node_entry and hasattr(node_entry, 'long_name') and node_entry.long_name:
                        sender_name = node_entry.long_name

                    _log.info(
                        "RX: from=%s (%s), to=%s (%s), ch=%d, pkt=%d: %s",
                        sender, sender_name, dest,
                        'DM' if is_dm else 'broadcast',
                        message.channel, message.packet_id,
                        text[:60],
                    )

                    self._add_message({
                        'type': 'rx',
                        'from': sender,
                        'from_name': sender_name,
                        'to': dest,
                        'is_dm': is_dm,
                        'channel': message.channel,
                        'text': text,
                        'packet_id': message.packet_id,
                        'timestamp': time.time(),
                        'is_dispatch': text.startswith('[BEACON]'),
                        'classification': _classify_message(text, is_dispatch=text.startswith('[BEACON]')),
                        'encryption': 'pki' if is_dm else ('aes256' if message.channel > 0 else 'default'),
                        'data_source': _data_source_label(was_grounded=False) if text.startswith('[BEACON]') else None,
                    })
                except Exception as e:
                    _log.error("Error processing text message: %s", e)

            # Forward to dispatch engine (if not radio silent)
            # Capture local reference — immune to concurrent _graceful_disconnect()
            dispatch = self._dispatch
            if dispatch and not self.radio_silence:
                try:
                    dispatch.on_packet(message)
                except Exception as e:
                    _log.error("Dispatch error: %s", e)

    def _tx_callback(self, channel, to_node_id, payload_bytes):
        """
        TX callback for the Dispatch Engine.
        Sends a text message via serial.

        Thread Safety:
          - Captures local reference to self._serial BEFORE the check.
            Even if _graceful_disconnect() nulls self._serial 1μs later,
            our local 'serial' variable still holds the old object.
          - Wraps send_text() in broad try/except — serial exceptions from
            a yanked cable are caught and logged, never crash the thread.

        Local-only routing (Exposure 2 fix):
          - When to_node_id == 0, the dispatch response was triggered by
            a synthetic local query (operator typed @beacon in the UI).
            The answer is added to message history for the local UI
            but is NOT transmitted over RF.
        """
        if self.radio_silence:
            _log.info("TX suppressed — Radio Silence active")
            return

        # Capture local reference — immune to reconnect loop nulling self._serial
        serial = self._serial
        if serial is None or not serial.connected:
            _log.warning("TX dropped — radio not connected")
            return

        # ── Exposure 2 fix: local-only dispatch responses ─────────
        # to_node_id == 0 means this is a response to a synthetic local
        # query. Route to local UI only — never transmit over RF.
        is_local_only = (to_node_id == 0)

        if not is_local_only:
            try:
                serial.send_text(
                    channel=channel,
                    to_node_id=to_node_id,
                    text_bytes=payload_bytes,
                )
            except Exception as e:
                _log.warning("TX failed (disconnected?): %s", e)
                return  # Don't crash — let dispatch thread continue to _advance_queue
        else:
            _log.info("Local-only dispatch response (not transmitted over RF)")

        # Add to message history
        try:
            text = payload_bytes.decode('utf-8', errors='replace')
            node_id = serial.our_node_id if serial else 0
            node_hex = proto.node_id_to_hex(node_id)
            # Local-only responses (earpiece mode) came from a DM @beacon query.
            # Route them to the Basecamp DM view (is_dm=True, to=our own hex),
            # not to the channel view.
            self._add_message({
                'type': 'tx',
                'from': node_hex,
                'from_name': 'BEACON',
                'channel': channel,
                'to': node_hex if is_local_only else proto.node_id_to_hex(to_node_id),
                'is_dm': True if is_local_only else (to_node_id != proto.BROADCAST_ADDR),
                'text': text,
                'timestamp': time.time(),
                'is_dispatch': True,
                'classification': 'BEACON',
                'encryption': 'local' if is_local_only else ('aes256' if channel > 0 else 'default'),
                'data_source': _data_source_label(was_grounded=True),
            })
        except Exception:
            pass

    def _do_inference(self, prompt, system_prompt, options):
        """
        Bridge to Ollama /api/generate for Dispatch queries.

        Args:
            prompt: User query prompt string
            system_prompt: Dispatch system prompt
            options: Ollama generation options dict

        Returns:
            Response text string, or None on failure/timeout.
        """
        url = f"http://127.0.0.1:{self._ollama_port}/api/generate"
        body = json.dumps({
            'model': self._model_name,
            'system': system_prompt,
            'prompt': prompt,
            'stream': False,
            'options': options,
        }).encode('utf-8')

        req = urllib.request.Request(
            url,
            data=body,
            headers={'Content-Type': 'application/json'},
            method='POST',
        )

        try:
            # A7 fix: Use dispatch.INFERENCE_TIMEOUT_SEC (30s) instead of
            # the hardcoded 120s. On a fire-and-forget radio channel,
            # waiting 2 minutes for a response is operationally useless.
            from .dispatch import INFERENCE_TIMEOUT_SEC
            with urllib.request.urlopen(req, timeout=INFERENCE_TIMEOUT_SEC) as resp:
                data = json.loads(resp.read().decode('utf-8'))
                response = data.get('response', '').strip()
                if response:
                    _log.info("Inference complete: %d chars", len(response))
                    return response
                else:
                    _log.warning("Empty response from Ollama")
                    return None

        except Exception as e:
            _log.error("Inference failed: %s", e)
            return None

    # ── Message history ───────────────────────────────────────

    def _add_message(self, msg):
        """Add a message to the UI history ring buffer.

        Each message gets a monotonically increasing ``msg_id`` so the
        frontend can poll by ID instead of timestamp, eliminating
        duplicate-message bugs caused by clock skew or re-renders.

        Returns the assigned msg_id.
        """
        with self._messages_lock:
            self._msg_counter += 1
            msg['msg_id'] = self._msg_counter
            self._messages.append(msg)
            if len(self._messages) > MAX_MESSAGE_HISTORY:
                self._messages = self._messages[-MAX_MESSAGE_HISTORY:]

        # Persist to encrypted store (outside lock to avoid blocking)
        if self._store:
            try:
                self._store.append(msg)
            except Exception as e:
                _log.error('Failed to persist message to encrypted store: %s', e)

        # Sweep stale pending ACKs opportunistically
        self._sweep_stale_acks()

        return msg['msg_id']

    def _sweep_stale_acks(self):
        """Expire pending ACK entries older than PENDING_ACK_TTL_SEC.

        If a DM's ACK never arrives (radio disconnected, firmware crash),
        the entry would grow forever. This sweep marks orphaned messages
        as delivery_failed with a TIMEOUT reason so the operator sees
        the failure in the UI instead of a perpetual 'sending' state.
        """
        if not self._pending_acks:
            return

        now = time.time()
        expired = []
        with self._pending_acks_lock:
            for pkt_id, (msg_id, ts) in list(self._pending_acks.items()):
                if now - ts > PENDING_ACK_TTL_SEC:
                    expired.append((pkt_id, msg_id))
            for pkt_id, _ in expired:
                self._pending_acks.pop(pkt_id, None)

        # Mark expired messages as failed (outside _pending_acks_lock
        # to avoid holding two locks simultaneously)
        for pkt_id, msg_id in expired:
            _log.warning(
                "Pending ACK expired (TTL %ds): pkt %08x → msg_id %d",
                PENDING_ACK_TTL_SEC, pkt_id, msg_id
            )
            with self._messages_lock:
                for msg in self._messages:
                    if msg.get('msg_id') == msg_id:
                        msg['delivery_failed'] = True
                        msg['delivery_error'] = 'TIMEOUT'
                        break

    def _add_system_message(self, text):
        """Add a system notification to the message history.

        Deduplicates consecutive identical system messages (e.g. repeated
        'Radio connected on ...' from the reconnect loop).
        """
        with self._messages_lock:
            if self._messages and self._messages[-1].get('type') == 'system' \
                    and self._messages[-1].get('text') == text:
                return  # skip duplicate
        self._add_message({
            'type': 'system',
            'text': text,
            'timestamp': time.time(),
        })

    def _get_msg_dest_name(self, msg_id):
        """Look up the destination display name for a message by msg_id.
        Used by V-03 to generate human-readable delivery failure notifications."""
        with self._messages_lock:
            for msg in self._messages:
                if msg.get('msg_id') == msg_id:
                    return msg.get('to', 'unknown')
        return 'unknown'

    def get_messages(self, since_id=0, max_batch=100):
        """
        Get messages after a given msg_id. For polling from the COMMS UI.
        Also supports legacy ``since`` (timestamp) for backwards compat.
        Returns list of message dicts, capped to max_batch per call
        to prevent frontend lockups during mesh flood events.
        """
        with self._messages_lock:
            if since_id:
                result = [m for m in self._messages if m.get('msg_id', 0) > since_id]
                return result[-max_batch:]  # Cap to prevent flood lockup
            return list(self._messages[-max_batch:])

    # ── Status API ────────────────────────────────────────────

    def get_status(self):
        """Aggregated status for /api/comms/status endpoint."""
        serial_status = self._serial.get_status() if self._serial else {
            'connected': False, 'port': None, 'node_id': None,
            'nodes_seen': 0, 'tx_queue_depth': 0,
        }

        dispatch_status = self._dispatch.get_status() if self._dispatch else {
            'enabled': self._dispatch_config.get('dispatch_enabled', True),
            'role': self._dispatch_config.get('dispatch_role', 'primary'),
            'channel': self._dispatch_config.get('dispatch_channel', 1),
            'active_job': False, 'queue_depth': 0, 'stats': {},
        }

        # Build full node list for the UI — includes position, telemetry, last_heard
        # Node storage is: {node_num: {'info': NodeInfo|None, 'position': ..., ...}}
        nodes_list = []
        now = time.time()
        our_node_id = self._serial.our_node_id if self._serial else 0
        if self._serial and hasattr(self._serial, 'nodes'):
            for node_num, entry in self._serial.nodes.items():
                if not isinstance(entry, dict):
                    continue
                info = entry.get('info')

                node_data = {
                    'num': int(info.num) if info else int(node_num),
                    'user_id': info.user_id if info else proto.node_id_to_hex(node_num),
                    'long_name': info.long_name if info else None,
                    'short_name': info.short_name if info else None,
                    'last_heard': entry.get('last_heard', 0),
                    'last_heard_ago': int(now - entry['last_heard']) if entry.get('last_heard') else None,
                }

                # Position data (from PORTNUM_POSITION broadcasts)
                pos = entry.get('position')
                if pos and pos.latitude_i != 0:
                    node_data['position'] = {
                        'lat': pos.latitude_i / 1e7,
                        'lng': pos.longitude_i / 1e7,
                        'alt': pos.altitude,
                        'time': pos.time,
                        'updated': entry.get('position_updated', 0),
                    }
                elif (node_num == our_node_id and self._basecamp_position):
                    # Fallback: operator-provided manual position for Basecamp
                    node_data['position'] = {
                        'lat': self._basecamp_position['lat'],
                        'lng': self._basecamp_position['lng'],
                        'alt': self._basecamp_position.get('alt', 0),
                        'time': 0,
                        'updated': 0,
                        'source': 'manual',
                    }
                else:
                    node_data['position'] = None

                # Telemetry data (from PORTNUM_TELEMETRY broadcasts)
                telem = entry.get('telemetry')
                if telem is not None:
                    node_data['telemetry'] = {
                        'battery': min(100, telem.battery_level),
                        'voltage': round(telem.voltage, 2) if telem.voltage else 0,
                        'uptime': telem.uptime_seconds,
                        'channel_utilization': telem.channel_utilization,
                        'air_util_tx': telem.air_util_tx,
                    }
                else:
                    node_data['telemetry'] = None

                # Environment data (temp, humidity, pressure — from env sensors)
                env = entry.get('environment')
                if env is not None:
                    node_data['environment'] = {
                        'temperature': env.temperature,
                        'humidity': env.relative_humidity,
                        'pressure': env.barometric_pressure,
                        'iaq': env.iaq,
                    }
                else:
                    node_data['environment'] = None

                # Signal quality (from last received packet)
                node_data['snr'] = entry.get('last_snr', 0.0)
                node_data['hops'] = entry.get('last_hops', 0)

                nodes_list.append(node_data)

        # Build radio channel list from config dump cache
        channels_list = []
        if self._serial and hasattr(self._serial, '_channels'):
            for idx in sorted(self._serial._channels.keys()):
                ch = self._serial._channels[idx]
                ch_entry = {
                    'index': ch.index,
                    'role': ch.role,
                    'role_name': {0: 'DISABLED', 1: 'PRIMARY', 2: 'SECONDARY'}.get(ch.role, 'UNKNOWN'),
                }
                if ch.settings:
                    ch_entry['name'] = ch.settings.name or ''
                    ch_entry['has_psk'] = len(ch.settings.psk) > 0 if ch.settings.psk else False
                    ch_entry['psk_len'] = len(ch.settings.psk) if ch.settings.psk else 0
                channels_list.append(ch_entry)

        return {
            'radio_silence': self.radio_silence,
            'radio_telemetry': self._radio_telemetry,
            'gps_position': self._gps_position,
            'basecamp_position': self._basecamp_position,
            'serial': serial_status,
            'dispatch': dispatch_status,
            'nodes': nodes_list,
            'channels': channels_list,
            'store_unlocked': self.is_store_unlocked(),
            'scanning': not self._first_scan_complete,
        }

    # ── Public API (called from server.py endpoints) ──────────

    def send_text(self, channel, text, dest=None):
        """Send a text message on the given channel.

        Args:
            channel: Channel index (0-7)
            text: Message text
            dest: Optional DM target as hex node ID string (e.g. '!04332878').
                  If None, sends as broadcast.

        Returns the msg_id assigned to the message in the history buffer.
        """
        if not self._serial or not self._serial.connected:
            raise RuntimeError('Radio not connected')
        if self.radio_silence:
            raise RuntimeError('Radio Silence active')

        # Resolve destination: hex string → numeric node ID
        if dest:
            to_node_id = proto.hex_to_node_id(dest)
        else:
            to_node_id = proto.BROADCAST_ADDR

        is_dm = to_node_id != proto.BROADCAST_ADDR

        text_bytes = text.encode('utf-8')
        radio_packet_id = self._serial.send_text(
            channel=channel,
            to_node_id=to_node_id,
            text_bytes=text_bytes,
        )

        # Add to message history
        msg_id = self._add_message({
            'type': 'tx',
            'from': proto.node_id_to_hex(self._serial.our_node_id),
            'from_name': 'You',
            'to': proto.node_id_to_hex(to_node_id) if is_dm else None,
            'is_dm': is_dm,
            'channel': channel,
            'text': text,
            'timestamp': time.time(),
            'is_dispatch': False,
            'classification': _classify_message(text),
            'encryption': 'pki' if is_dm else ('aes256' if channel > 0 else 'default'),
            'data_source': None,
        })

        # V-03: Track DM packet_ids for ACK failure reporting
        if is_dm and radio_packet_id:
            with self._pending_acks_lock:
                self._pending_acks[radio_packet_id] = (msg_id, time.time())
            _log.debug("Tracking DM packet %08x → msg_id %d", radio_packet_id, msg_id)

        # ── Intercom vs. Earpiece: Public/Private AI routing ──────
        # The dispatch engine determines broadcast vs. DM routing by checking
        # packet.to_id == BROADCAST_ADDR (was_broadcast). We must mirror
        # the original message's routing intent in the synthetic packet:
        #
        #   Public channel (broadcast):  to_id = BROADCAST_ADDR
        #     → dispatch sets was_broadcast=True → response broadcast to mesh
        #
        #   Direct Message:              to_id = our_node_id
        #     → dispatch sets was_broadcast=False → response to sender (from_id=0)
        #     → _tx_callback sees to_node_id=0 → local-only (earpiece mode)
        dispatch = self._dispatch
        if dispatch and text.lower().startswith('@beacon'):
            try:
                synthetic_data = proto.DataPayload(
                    portnum=proto.PORTNUM_TEXT_MESSAGE,
                    payload=text_bytes,
                    want_response=False,
                    reply_id=0,
                )

                # Mirror the routing: broadcast queries → broadcast replies
                # DM queries → local-only replies (earpiece mode)
                synthetic_to_id = proto.BROADCAST_ADDR if not is_dm else self._serial.our_node_id

                synthetic = proto.MeshPacket(
                    from_id=0,  # Synthetic local origin — bypass self-echo filter
                    to_id=synthetic_to_id,
                    channel=channel,
                    decoded=synthetic_data,
                    encrypted=None,
                    packet_id=int(time.time() * 1000) & 0xFFFFFFFF,
                    hop_limit=0,
                    want_ack=False,
                    priority=0,
                    rx_snr=0.0,  # Local message — no RF signal
                    hop_start=0,
                )
                dispatch.on_packet(synthetic)
            except Exception as e:
                _log.warning("Failed to feed local message to dispatch: %s", e)

        return msg_id

    def update_dispatch_config(self, updates):
        """
        Update dispatch settings at runtime. Called from POST /api/comms/config.
        Keys: dispatch_enabled (bool), dispatch_role (str), dispatch_channel (int).
        """
        for key in ('dispatch_enabled', 'dispatch_channel', 'dispatch_role'):
            if key in updates:
                self._dispatch_config[key] = updates[key]

        # Apply to live dispatch engine if it exists
        if self._dispatch:
            if 'dispatch_enabled' in updates:
                self._dispatch.dispatch_enabled = bool(updates['dispatch_enabled'])
            if 'dispatch_role' in updates:
                self._dispatch.dispatch_role = str(updates['dispatch_role'])
            if 'dispatch_channel' in updates:
                self._dispatch.dispatch_channel = int(updates['dispatch_channel'])

        _log.info("Dispatch config updated: %s", self._dispatch_config)

    # ── Active Node Data Requests ─────────────────────────────

    def request_node_position(self, node_id):
        """Request position from a specific node.

        Sends a POSITION_APP packet with a proper Position protobuf payload
        and want_response=True, which tells the target node to reply with
        its current position. The payload must contain a time field so the
        firmware responds with actual position data (empty payloads only
        get an ACK — the same issue that was found and fixed for telemetry).

        Args:
            node_id: numeric node ID (int) or hex string like '!02eac65c'
        """
        if isinstance(node_id, str) and node_id.startswith('!'):
            node_id = int(node_id[1:], 16)

        serial = self._serial
        if serial is None or not serial.connected:
            _log.warning("Cannot request position — radio not connected")
            return

        # Build a proper Position protobuf payload (not empty bytes)
        position_payload = proto.encode_position_request()

        data = proto.encode_data_payload(
            portnum=proto.PORTNUM_POSITION,
            payload_bytes=position_payload,
            want_response=True,
        )
        packet_id = random.randint(1, 0xFFFFFFFF)
        mesh_pkt = proto.encode_mesh_packet(
            from_id=0,
            to_id=node_id,
            channel=0,  # Position requests go on primary channel
            decoded_bytes=data,
            packet_id=packet_id,
            hop_limit=3,
            want_ack=True,
        )
        to_radio = proto.encode_to_radio_packet(mesh_pkt)
        serial.send_to_radio(to_radio)
        _log.warning("DIAG Requested position from %s (pkt=%08x)",
                     proto.node_id_to_hex(node_id), packet_id)

    def request_node_telemetry(self, node_id):
        """Request telemetry from a specific node.

        Sends a TELEMETRY_APP packet with a proper Telemetry protobuf payload
        and want_response=True. The payload must contain an empty DeviceMetrics
        sub-message so the firmware knows to respond with device metrics.
        An empty payload causes the firmware to ACK but never send data.

        Args:
            node_id: numeric node ID (int) or hex string like '!02eac65c'
        """
        if isinstance(node_id, str) and node_id.startswith('!'):
            node_id = int(node_id[1:], 16)

        serial = self._serial
        if serial is None or not serial.connected:
            _log.warning("Cannot request telemetry — radio not connected")
            return

        # Build a proper Telemetry protobuf payload (not empty bytes)
        telemetry_payload = proto.encode_telemetry_request()

        data = proto.encode_data_payload(
            portnum=proto.PORTNUM_TELEMETRY,
            payload_bytes=telemetry_payload,
            want_response=True,
        )
        packet_id = random.randint(1, 0xFFFFFFFF)
        mesh_pkt = proto.encode_mesh_packet(
            from_id=0,
            to_id=node_id,
            channel=0,
            decoded_bytes=data,
            packet_id=packet_id,
            hop_limit=3,
            want_ack=True,
        )
        to_radio = proto.encode_to_radio_packet(mesh_pkt)
        serial.send_to_radio(to_radio)
        _log.warning("DIAG Requested telemetry from %s (pkt=%08x)",
                     proto.node_id_to_hex(node_id), packet_id)

    def request_node_info(self, node_id):
        """Request nodeinfo (identity/user data) from a specific node.

        Sends an empty NODEINFO_APP packet with want_response=True,
        which tells the target node to reply with its User info
        (long name, short name, hardware model).

        Args:
            node_id: numeric node ID (int) or hex string like '!02eac65c'
        """
        if isinstance(node_id, str) and node_id.startswith('!'):
            node_id = int(node_id[1:], 16)

        serial = self._serial
        if serial is None or not serial.connected:
            _log.warning("Cannot request nodeinfo — radio not connected")
            return

        data = proto.encode_data_payload(
            portnum=proto.PORTNUM_NODEINFO,
            payload_bytes=b'',
            want_response=True,
        )
        packet_id = random.randint(1, 0xFFFFFFFF)
        mesh_pkt = proto.encode_mesh_packet(
            from_id=0,
            to_id=node_id,
            channel=0,
            decoded_bytes=data,
            packet_id=packet_id,
            hop_limit=3,
            want_ack=True,
        )
        to_radio = proto.encode_to_radio_packet(mesh_pkt)
        serial.send_to_radio(to_radio)
        _log.warning("DIAG Requested nodeinfo from %s (pkt=%08x)",
                     proto.node_id_to_hex(node_id), packet_id)

    def traceroute_node(self, node_id):
        """Send a traceroute request to discover the mesh path to a node.

        Sends an empty TRACEROUTE_APP packet with want_response=True.
        The firmware records each hop and returns the full route.

        Args:
            node_id: numeric node ID (int) or hex string like '!02eac65c'
        """
        if isinstance(node_id, str) and node_id.startswith('!'):
            node_id = int(node_id[1:], 16)

        serial = self._serial
        if serial is None or not serial.connected:
            _log.warning("Cannot traceroute — radio not connected")
            return

        data = proto.encode_data_payload(
            portnum=proto.PORTNUM_TRACEROUTE,
            payload_bytes=b'',
            want_response=True,
        )
        packet_id = random.randint(1, 0xFFFFFFFF)
        mesh_pkt = proto.encode_mesh_packet(
            from_id=0,
            to_id=node_id,
            channel=0,
            decoded_bytes=data,
            packet_id=packet_id,
            hop_limit=3,
            want_ack=True,
        )
        to_radio = proto.encode_to_radio_packet(mesh_pkt)
        serial.send_to_radio(to_radio)
        _log.warning("DIAG Traceroute sent to %s (pkt=%08x)",
                     proto.node_id_to_hex(node_id), packet_id)

    def request_all_node_data(self, node_id):
        """Request position, telemetry, and nodeinfo from a specific node.

        Convenience method that sends all three request types with
        pacing to avoid flooding the mesh.

        Args:
            node_id: numeric node ID (int) or hex string like '!02eac65c'
        """
        self.request_node_position(node_id)
        time.sleep(0.5)
        self.request_node_telemetry(node_id)
        time.sleep(0.5)
        self.request_node_info(node_id)

    # ── Hardware Emission Control ─────────────────────────────

    def set_gps_position(self, enabled):
        """
        Enable or disable GPS position broadcasting at the firmware level.

        When disabled: Sends AdminMessage → Config.PositionConfig with
        gps_mode=DISABLED and position_broadcast_secs=0. The Heltec
        firmware physically stops acquiring GPS and broadcasting position
        packets to the mesh.

        When enabled: Sends AdminMessage → Config.PositionConfig with
        gps_mode=ENABLED and position_broadcast_secs=900 (15 min default).

        Dedup: Skips the firmware admin command if the requested state
        matches the current state. This prevents unnecessary firmware
        reboots (Meshtastic reboots to apply config changes).
        """
        wanted = bool(enabled)
        if wanted == self._gps_position:
            _log.debug("GPS position already %s — skipping admin command",
                       'ENABLED' if wanted else 'DISABLED')
            return
        self._gps_position = wanted

        serial = self._serial
        if serial is None or not serial.connected:
            _log.warning("GPS config deferred — radio not connected")
            return

        try:
            if wanted:
                pos_cfg = proto.encode_position_config(
                    gps_mode=proto.GPS_MODE_ENABLED,
                    position_broadcast_secs=900,
                    position_broadcast_smart_enabled=True,
                )
            else:
                pos_cfg = proto.encode_position_config(
                    gps_mode=proto.GPS_MODE_DISABLED,
                    position_broadcast_secs=0,
                    position_broadcast_smart_enabled=False,
                )

            config = proto.encode_config_with_position(pos_cfg)
            admin_msg = proto.encode_admin_set_config(config)
            serial.send_admin(admin_msg)
            _log.info("GPS position sharing %s — admin command sent to firmware",
                      'ENABLED' if wanted else 'DISABLED')
        except Exception as e:
            _log.error("Failed to send GPS config to firmware: %s", e)

    def set_basecamp_position(self, pos):
        """Set or clear the manual basecamp position.

        Args:
            pos: dict with 'lat', 'lng', and optional 'alt', or None to clear.
        """
        if pos and isinstance(pos, dict) and 'lat' in pos and 'lng' in pos:
            self._basecamp_position = {
                'lat': float(pos['lat']),
                'lng': float(pos['lng']),
                'alt': int(pos.get('alt', 0)),
            }
            _log.info("Manual basecamp position set: %.5f, %.5f (alt %dm)",
                       self._basecamp_position['lat'],
                       self._basecamp_position['lng'],
                       self._basecamp_position['alt'])
        else:
            self._basecamp_position = None
            _log.info("Manual basecamp position cleared")
        # Propagate to dispatch engine for AI context assembly
        if self._dispatch:
            self._dispatch._basecamp_position = self._basecamp_position

    def set_radio_telemetry(self, enabled):
        """
        Enable or disable radio telemetry broadcasting at the firmware level.

        When disabled: Sends AdminMessage → ModuleConfig.TelemetryConfig
        with device_update_interval=0 and device_telemetry_enabled=False.
        The Heltec firmware stops broadcasting battery, voltage, and
        device metrics to the mesh.

        When enabled: Sends AdminMessage → ModuleConfig.TelemetryConfig
        with device_update_interval=1800 (30 min) and
        device_telemetry_enabled=True.

        Dedup: Skips the firmware admin command if the requested state
        matches the current state. This prevents unnecessary firmware
        reboots (Meshtastic reboots to apply config changes).
        """
        wanted = bool(enabled)
        if wanted == self._radio_telemetry:
            _log.debug("Radio telemetry already %s — skipping admin command",
                       'ENABLED' if wanted else 'DISABLED')
            return
        self._radio_telemetry = wanted

        serial = self._serial
        if serial is None or not serial.connected:
            _log.warning("Telemetry config deferred — radio not connected")
            return

        try:
            if wanted:
                tel_cfg = proto.encode_telemetry_module_config(
                    device_update_interval=1800,  # 30 minutes
                    environment_update_interval=1800,
                    environment_measurement_enabled=True,
                    device_telemetry_enabled=True,
                )
            else:
                tel_cfg = proto.encode_telemetry_module_config(
                    device_update_interval=0,     # Disabled
                    environment_update_interval=0,
                    environment_measurement_enabled=False,
                    device_telemetry_enabled=False,
                )

            module_config = proto.encode_module_config_with_telemetry(tel_cfg)
            admin_msg = proto.encode_admin_set_module_config(module_config)
            serial.send_admin(admin_msg)
            _log.info("Radio telemetry %s — admin command sent to firmware",
                      'ENABLED' if enabled else 'DISABLED')
        except Exception as e:
            _log.error("Failed to send telemetry config to firmware: %s", e)

    # ── Mesh Provisioning ────────────────────────────────────

    def get_provisioning_status(self):
        """Return the current provisioning state for the UI.

        Returns a dict with:
          - state: 'unprovisioned' | 'provisioned' | 'radio_swap'
          - channel_name: str (if provisioned)
          - provisioned_at: str (if provisioned)
          - qr_available: bool
          - radio_connected: bool
          - node_id_match: bool (False if connected radio differs from provisioned one)
          - job: dict | None (if async provisioning is in progress)
        """
        radio_connected = bool(self._serial and self._serial.connected)
        connected_node_id = self._serial.our_node_id if radio_connected else 0

        state_data = prov.load_provisioning_state(self._data_dir)

        # Include async job status if one is active
        with self._provisioning_lock:
            job = dict(self._provisioning_job) if self._provisioning_job else None

        if state_data is None:
            return {
                'state': 'unprovisioned',
                'radio_connected': radio_connected,
                'qr_available': False,
                'job': job,
            }

        # Check if connected radio matches the provisioned one
        provisioned_node_id = state_data.get('node_id', 0)
        node_match = (connected_node_id == provisioned_node_id) if radio_connected else True

        if radio_connected and not node_match:
            return {
                'state': 'radio_swap',
                'radio_connected': True,
                'node_id_match': False,
                'provisioned_node_id': proto.node_id_to_hex(provisioned_node_id),
                'connected_node_id': proto.node_id_to_hex(connected_node_id),
                'channel_name': state_data.get('channel_name', 'BEACON'),
                'qr_available': True,
                'job': job,
            }

        return {
            'state': 'provisioned',
            'radio_connected': radio_connected,
            'node_id_match': node_match,
            'channel_name': state_data.get('channel_name', 'BEACON'),
            'provisioned_at': state_data.get('provisioned_at', ''),
            'qr_available': True,
            'job': job,
        }

    def start_provisioning(self, password):
        """Start async provisioning in a background thread.

        Returns immediately with a status dict. The frontend polls
        get_provisioning_status() to track progress.

        Pre-flight checks (radio connected, node ID known) run
        synchronously so errors are returned immediately.

        Args:
            password: master password (required for PSK encryption)

        Returns:
            dict with:
              - started: bool
              - error: str (on immediate failure)
        """
        serial = self._serial
        if serial is None or not serial.connected:
            return {'started': False, 'error': 'Radio not connected'}

        if not serial.our_node_id:
            return {'started': False, 'error': 'Radio node ID unknown'}

        with self._provisioning_lock:
            if self._provisioning_job and self._provisioning_job.get('status') == 'running':
                return {'started': False, 'error': 'Provisioning already in progress'}
            self._provisioning_job = {
                'status': 'running',
                'step': 'generating_key',
                'error': None,
                'qr_url': None,
            }

        t = threading.Thread(
            target=self._provisioning_worker,
            args=(password, serial),
            daemon=True,
            name='provisioning-worker',
        )
        t.start()
        return {'started': True}

    def _provisioning_worker(self, password, serial):
        """Background worker for the provisioning sequence.

        Updates _provisioning_job with progress. The HTTP handler and
        frontend poll get_provisioning_status() to track state.
        """
        def _set_step(step):
            with self._provisioning_lock:
                if self._provisioning_job:
                    self._provisioning_job['step'] = step

        try:
            # Check if Channel 1 already has data
            existing_ch1 = serial.get_channel(1)
            if existing_ch1 and existing_ch1.settings and existing_ch1.settings.psk:
                ch_name = existing_ch1.settings.name or '<unnamed>'
                _log.warning(
                    "Channel 1 already has data: name=%r, role=%d — will overwrite",
                    ch_name, existing_ch1.role,
                )

            # 1. Generate PSK
            psk_bytes = prov.generate_psk()
            _log.warning("PROVISIONING [1/8] Generated 32-byte AES-256 PSK (hash=%s)",
                         prov.psk_hash(psk_bytes)[:12] + '...')

            # 2. Encrypt and store the PSK
            _set_step('encrypting_key')
            prov.save_psk_encrypted(self._data_dir, psk_bytes, password)
            _log.warning("PROVISIONING [2/8] PSK encrypted and saved to vault")

            # BUG-05 fix: Capture node_id BEFORE the reboot wait, while
            # we know it's valid. Meshtastic node IDs are MAC-derived and
            # don't change on reboot, but this is defensive.
            node_id_snapshot = serial.our_node_id

            # 3. Set LoRa config (region + radio parameters)
            # CRITICAL: A factory-fresh radio has Region=UNSET, which makes
            # the firmware physically refuse to transmit any packets. We
            # MUST set the region before programming channels, otherwise
            # the radio is a silent brick.
            _set_step('setting_lora')
            serial.send_set_lora_config(
                region=proto.LORA_REGION_US,
                # All other params use encode_lora_config defaults:
                # modem_preset=LONG_FAST, bandwidth=250, SF=11, CR=5,
                # tx_power=30, hop_limit=3, tx_enabled=True
            )
            _log.warning("PROVISIONING [3/8] LoRa config sent — region=US, "
                         "preset=LONG_FAST, tx_power=30dBm")

            # 4. Wait for LoRa config reboot
            _set_step('waiting_lora_reboot')
            _log.warning("PROVISIONING [4/8] Waiting up to 30s for LoRa config reboot...")
            rebooted_lora = serial.wait_for_provisioning_reboot(timeout=30.0)
            if not rebooted_lora:
                _log.warning("PROVISIONING [4/8] ⚠ LoRa reboot timed out — continuing")
            else:
                _log.warning("PROVISIONING [4/8] ✓ Radio rebooted after LoRa config")

            # 5. Program Channel 1 on the radio
            _set_step('programming_radio')
            serial.send_set_channel(
                index=1,
                name='BEACON',
                psk=psk_bytes,
                role=proto.CHANNEL_ROLE_SECONDARY,
            )
            _log.warning("PROVISIONING [5/8] Channel 1 (BEACON) sent to radio via serial — "
                         "node=%s, psk_len=%d, role=SECONDARY",
                         proto.node_id_to_hex(node_id_snapshot), len(psk_bytes))

            # 6. Wait for channel config reboot
            _set_step('waiting_reboot')
            _log.warning("PROVISIONING [6/8] Waiting up to 30s for channel config reboot...")
            rebooted = serial.wait_for_provisioning_reboot(timeout=30.0)
            if not rebooted:
                _log.warning("PROVISIONING [6/8] ⚠ Reboot timed out — radio may need manual restart")
            else:
                _log.warning("PROVISIONING [6/8] ✓ Radio rebooted and re-handshaked")

            # 6b. Verify channel was actually applied on the radio.
            # The config dump that just completed should have populated
            # serial._channels. If CH 1 is still DISABLED, the command
            # was lost during the reboot — retry once.
            time.sleep(1)  # Let config dump finish populating
            verified_ch1 = serial.get_channel(1)
            ch1_ok = (verified_ch1 and verified_ch1.role != proto.CHANNEL_ROLE_DISABLED
                      and verified_ch1.settings and len(verified_ch1.settings.psk or b'') >= 16)

            if not ch1_ok:
                _log.warning(
                    "PROVISIONING [6b] ⚠ CH 1 verification FAILED (role=%s, psk_len=%d) — "
                    "retrying channel program...",
                    verified_ch1.role if verified_ch1 else 'N/A',
                    len(verified_ch1.settings.psk) if verified_ch1 and verified_ch1.settings and verified_ch1.settings.psk else 0,
                )
                time.sleep(1)
                serial.send_set_channel(
                    index=1,
                    name='BEACON',
                    psk=psk_bytes,
                    role=proto.CHANNEL_ROLE_SECONDARY,
                )
                _log.warning("PROVISIONING [6b] Retry: Channel 1 re-sent to radio")
                rebooted2 = serial.wait_for_provisioning_reboot(timeout=30.0)
                if rebooted2:
                    _log.warning("PROVISIONING [6b] ✓ Retry reboot complete")
                    time.sleep(1)
                    verified_ch1 = serial.get_channel(1)
                    ch1_ok = (verified_ch1 and verified_ch1.role != proto.CHANNEL_ROLE_DISABLED
                              and verified_ch1.settings and len(verified_ch1.settings.psk or b'') >= 16)
                    if ch1_ok:
                        _log.warning("PROVISIONING [6b] ✓ CH 1 verified after retry: role=%d, psk_len=%d",
                                     verified_ch1.role, len(verified_ch1.settings.psk))
                    else:
                        _log.error("PROVISIONING [6b] ✗ CH 1 still FAILED after retry")
                else:
                    _log.error("PROVISIONING [6b] ✗ Retry reboot timed out")
            else:
                _log.warning(
                    "PROVISIONING [6b] ✓ CH 1 verified on radio: role=%d, name=%r, psk_len=%d",
                    verified_ch1.role,
                    verified_ch1.settings.name if verified_ch1.settings else '',
                    len(verified_ch1.settings.psk) if verified_ch1.settings else 0,
                )

            # 6c. Rename radio to "Basecamp"
            # Factory-fresh radios have a default name like "Meshtastic XXXX".
            # We rename the Basecamp radio so it identifies correctly on the
            # mesh and in BEACON's context window.
            _set_step('naming_basecamp')
            serial.send_set_owner(long_name='Basecamp', short_name='BC')
            _log.warning("PROVISIONING [6c] Renaming radio to 'Basecamp'")
            rebooted_rename = serial.wait_for_provisioning_reboot(timeout=30.0)
            if rebooted_rename:
                _log.warning("PROVISIONING [6c] ✓ Radio rebooted after rename")
            else:
                _log.warning("PROVISIONING [6c] ⚠ Rename reboot timed out — name may apply on next restart")

            # 7. Save provisioning state (BUG-10 fix: use timezone-aware UTC)
            _set_step('saving_state')
            prov.save_provisioning_state(self._data_dir, {
                'channel_index': 1,
                'channel_name': 'BEACON',
                'psk_hash': prov.psk_hash(psk_bytes),
                'node_id': node_id_snapshot,
                'provisioned_at': datetime.datetime.now(
                    datetime.timezone.utc).isoformat(),
                'verified': ch1_ok,
            })
            _log.warning("PROVISIONING [7/8] State saved to disk (verified=%s)", ch1_ok)

            # 8. Generate QR URL
            qr_url = prov.encode_meshtastic_qr_url(psk_bytes, 'BEACON')
            # Log LoRa config details for debugging QR scan failures
            import base64 as _b64
            try:
                b64_part = qr_url.split('#')[1]
                pad = 4 - (len(b64_part) % 4)
                if pad != 4:
                    b64_part += '=' * pad
                raw = _b64.urlsafe_b64decode(b64_part)
                # Count channels and extract LoRa fields
                offset = 0
                ch_count = 0
                lora_info = None
                while offset < len(raw):
                    tag, offset = proto._decode_varint(raw, offset)
                    field_num = tag >> 3
                    wire_type = tag & 0x07
                    if wire_type == 2:
                        length, offset = proto._decode_varint(raw, offset)
                        blob = raw[offset:offset + length]
                        if field_num == 1:
                            ch_count += 1
                        elif field_num == 2:
                            lora_info = proto.decode_fields(blob)
                        offset += length
                    elif wire_type == 0:
                        _, offset = proto._decode_varint(raw, offset)
                    else:
                        break
                _log.warning(
                    "PROVISIONING [8/8] QR URL generated — "
                    "channels=%d, has_lora=%s, lora_fields=%s, "
                    "payload_bytes=%d, url_len=%d",
                    ch_count, lora_info is not None,
                    dict(lora_info) if lora_info else 'NONE',
                    len(raw), len(qr_url),
                )
            except Exception as qr_dbg_err:
                _log.warning("PROVISIONING [8/8] QR URL generated (debug parse failed: %s)",
                             qr_dbg_err)

            self._add_system_message(
                "✅ BEACON channel provisioned. Scan the QR code to pair additional radios."
            )

            with self._provisioning_lock:
                self._provisioning_job = {
                    'status': 'complete',
                    'step': 'done',
                    'error': None,
                    'qr_url': qr_url,
                    'node_id': proto.node_id_to_hex(node_id_snapshot),
                }

        except Exception as e:
            _log.error("PROVISIONING FAILED: %s", e, exc_info=True)
            with self._provisioning_lock:
                self._provisioning_job = {
                    'status': 'failed',
                    'step': 'error',
                    'error': str(e),
                    'qr_url': None,
                }

    def clear_provisioning_job(self):
        """Clear the completed/failed provisioning job state.

        Called by the frontend after acknowledging the result.
        """
        with self._provisioning_lock:
            self._provisioning_job = None

    def get_qr_url(self, password):
        """Retrieve the QR code URL for pairing additional nodes.

        Requires the master password to decrypt the stored PSK.

        Returns:
            str — the Meshtastic QR URL, or None on error
        """
        try:
            psk_bytes = prov.load_psk_encrypted(self._data_dir, password)
            return prov.encode_meshtastic_qr_url(psk_bytes, 'BEACON')
        except FileNotFoundError:
            _log.debug('No PSK file — radio not provisioned')
            return None
        except ValueError as e:
            _log.error('Failed to decrypt PSK for QR URL: %s', e)
            return None

    def rekey_provisioning(self, old_password, new_password):
        """Re-encrypt the PSK with a new master password.

        Called during password change alongside rekey_store().
        """
        try:
            return prov.rekey_psk(self._data_dir, old_password, new_password)
        except Exception as e:
            _log.error('Provisioning rekey failed: %s', e)
            return False
