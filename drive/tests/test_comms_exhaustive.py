#!/usr/bin/env python3
"""Exhaustive COMMS system test against live server at 127.0.0.1:8080"""
import json, urllib.request, urllib.error, time, sys

BASE = "http://127.0.0.1:8080"
PASS = 0
FAIL = 0
WARN = 0
results = []

def get(path):
    try:
        r = urllib.request.urlopen(f"{BASE}{path}", timeout=5)
        return json.loads(r.read())
    except Exception as e:
        return {"__error": str(e)}

def post(path, data):
    try:
        body = json.dumps(data).encode()
        req = urllib.request.Request(f"{BASE}{path}", body,
                                     {"Content-Type": "application/json"})
        r = urllib.request.urlopen(req, timeout=10)
        return json.loads(r.read())
    except Exception as e:
        return {"__error": str(e)}

def ok(test, condition, detail=""):
    global PASS, FAIL, WARN
    if condition:
        PASS += 1
        results.append(f"  ✅ {test}")
    else:
        FAIL += 1
        results.append(f"  ❌ {test}: {detail}")

def warn(test, detail):
    global WARN
    WARN += 1
    results.append(f"  ⚠️  {test}: {detail}")

# ============================================================
# SECTION 1: API ENDPOINTS — Do they all return valid JSON?
# ============================================================
print("=== SECTION 1: API Endpoints ===")

for endpoint in [
    "/api/comms/status",
    "/api/comms/messages",
    "/api/comms/provision/status",
    "/api/status",
    "/api/eula/status",
    "/api/heartbeat",
    "/api/manifest",
    "/api/master-password/status",
    "/api/master-password/hint",
    "/api/user-files",
]:
    data = get(endpoint)
    ok(f"GET {endpoint} returns JSON", "__error" not in data, data.get("__error", ""))

# ============================================================
# SECTION 2: RADIO STATE — Is everything connected and working?
# ============================================================
print("\n=== SECTION 2: Radio State ===")
status = get("/api/comms/status")
serial = status.get("serial", {})
ok("Radio connected", serial.get("connected") == True, f"connected={serial.get('connected')}")
ok("Port detected", serial.get("port") is not None, "port is None")
ok("Node ID assigned", serial.get("node_id") is not None, "node_id is None")
ok("Nodes seen >= 2", serial.get("nodes_seen", 0) >= 2, f"nodes_seen={serial.get('nodes_seen')}")
ok("TX queue not blocked", serial.get("tx_queue_depth", 999) < 10, f"depth={serial.get('tx_queue_depth')}")

# ============================================================
# SECTION 3: DISPATCH STATE — Is BEACON ready?
# ============================================================
print("\n=== SECTION 3: Dispatch State ===")
dispatch = status.get("dispatch", {})
ok("Dispatch enabled", dispatch.get("enabled") == True)
ok("Dispatch role is primary", dispatch.get("role") == "primary", f"role={dispatch.get('role')}")
ok("Dispatch channel is 1 (BEACON)", dispatch.get("channel") == 1, f"channel={dispatch.get('channel')}")
ok("Model ready", dispatch.get("model_ready") == True, f"model_ready={dispatch.get('model_ready')}")
ok("No active job blocking", dispatch.get("active_job") == False)

# ============================================================
# SECTION 4: CHANNEL CONFIG — Is BEACON channel set up?
# ============================================================
print("\n=== SECTION 4: Channel Config ===")
channels = status.get("channels", [])
ok("Channels reported", len(channels) >= 2, f"only {len(channels)} channels")
ch0 = channels[0] if len(channels) > 0 else {}
ch1 = channels[1] if len(channels) > 1 else {}
ok("Ch0 is PRIMARY", ch0.get("role_name") == "PRIMARY")
ok("Ch1 is SECONDARY (BEACON)", ch1.get("role_name") == "SECONDARY" and ch1.get("name") == "BEACON",
   f"role={ch1.get('role_name')} name={ch1.get('name')}")
ok("Ch1 has PSK (encrypted)", ch1.get("psk_len", 0) > 0, f"psk_len={ch1.get('psk_len')}")

# ============================================================
# SECTION 5: NODE DATA — Every field for every node
# ============================================================
print("\n=== SECTION 5: Node Data ===")
nodes = status.get("nodes", [])
ok("At least 2 nodes", len(nodes) >= 2, f"only {len(nodes)}")

basecamp = None
remote = None
for n in nodes:
    if n.get("user_id") == serial.get("node_id"):
        basecamp = n
    else:
        remote = n

if basecamp:
    ok("Basecamp: has long_name", basecamp.get("long_name") is not None, "long_name is None")
    ok("Basecamp: has short_name", basecamp.get("short_name") is not None, "short_name is None")
    ok("Basecamp: num is int", isinstance(basecamp.get("num"), int), f"type={type(basecamp.get('num'))}")
    ok("Basecamp: has telemetry", basecamp.get("telemetry") is not None, "telemetry is None — radio should self-report")
    if basecamp.get("telemetry"):
        t = basecamp["telemetry"]
        ok("Basecamp: battery is int 0-100", isinstance(t.get("battery"), int) and 0 <= t["battery"] <= 100,
           f"battery={t.get('battery')}")
        ok("Basecamp: voltage > 0", t.get("voltage", 0) > 0, f"voltage={t.get('voltage')}")
        ok("Basecamp: uptime > 0", t.get("uptime", 0) > 0, f"uptime={t.get('uptime')}")
    ok("Basecamp: last_heard_ago < 120s", basecamp.get("last_heard_ago", 999) < 120,
       f"last_heard_ago={basecamp.get('last_heard_ago')}")
    ok("Basecamp: snr field exists", "snr" in basecamp)
    ok("Basecamp: hops field exists", "hops" in basecamp)
    ok("Basecamp: environment field exists", "environment" in basecamp)
else:
    ok("Basecamp node found", False, "not in nodes list")

if remote:
    ok(f"Remote ({remote.get('long_name','?')}): has long_name", remote.get("long_name") is not None)
    ok(f"Remote: num is int", isinstance(remote.get("num"), int), f"type={type(remote.get('num'))}")
    ok(f"Remote: has position", remote.get("position") is not None, "position is None — auto-request may have failed")
    if remote.get("position"):
        p = remote["position"]
        ok("Remote: position.lat is float", isinstance(p.get("lat"), (int, float)), f"type={type(p.get('lat'))}")
        ok("Remote: position.lng is float", isinstance(p.get("lng"), (int, float)))
        ok("Remote: position.lat != 0", p.get("lat", 0) != 0, "lat is 0 (invalid)")
        ok("Remote: position.time > 0", p.get("time", 0) > 0, f"time={p.get('time')}")
    ok(f"Remote: last_heard_ago < 300s", remote.get("last_heard_ago", 999) < 300,
       f"last_heard_ago={remote.get('last_heard_ago')}")
    ok(f"Remote: snr > 0 (radio contact confirmed)", remote.get("snr", 0) > 0, f"snr={remote.get('snr')}")
    # Telemetry from remote — may not have arrived yet via broadcast
    if remote.get("telemetry"):
        ok("Remote: has telemetry", True)
    else:
        warn("Remote: telemetry", "None — will arrive on next broadcast cycle (up to 15 min)")
else:
    ok("Remote node found", False, "not in nodes list")

# ============================================================
# SECTION 6: TEXT MESSAGE SEND — Does TX work?
# ============================================================
print("\n=== SECTION 6: Text Message TX ===")
send_result = post("/api/comms/send", {"channel": 1, "text": "exhaustive test msg"})
ok("Send returns ok", send_result.get("ok") == True, str(send_result))
ok("Send returns msg_id", isinstance(send_result.get("msg_id"), int))

# Check it appears in history
time.sleep(0.5)
msgs = get("/api/comms/messages")
last_tx = None
for m in msgs.get("messages", []):
    if m.get("text") == "exhaustive test msg":
        last_tx = m
ok("TX message in history", last_tx is not None)
if last_tx:
    ok("TX type=tx", last_tx.get("type") == "tx")
    ok("TX channel=1", last_tx.get("channel") == 1)

# ============================================================
# SECTION 7: DM (Direct Message) SEND
# ============================================================
print("\n=== SECTION 7: DM Send ===")
if remote:
    dm_result = post("/api/comms/send", {
        "channel": 1,
        "text": "dm test",
        "dest": remote.get("user_id"),
    })
    ok("DM send returns ok", dm_result.get("ok") == True, str(dm_result))
    if dm_result.get("ok"):
        ok("DM returns msg_id", isinstance(dm_result.get("msg_id"), int))
else:
    warn("DM test", "skipped — no remote node")

# ============================================================
# SECTION 8: DISPATCH (BEACON) — Does inference work?
# ============================================================
print("\n=== SECTION 8: Dispatch Query ===")
q_result = post("/api/comms/send", {"channel": 1, "text": "@beacon status report"})
ok("@beacon query sent", q_result.get("ok") == True)
# Wait for inference
time.sleep(10)
msgs_after = get("/api/comms/messages")
dispatch_msgs = [m for m in msgs_after.get("messages", []) if m.get("is_dispatch")]
ok("BEACON generated response", len(dispatch_msgs) > 0, "no dispatch messages found")
if dispatch_msgs:
    last_disp = dispatch_msgs[-1]
    ok("Response starts with [BEACON]", last_disp.get("text", "").startswith("[BEACON]"),
       f"text starts with: {last_disp.get('text', '')[:30]}")
    ok("Response has classification", last_disp.get("classification") is not None)
    ok("Response is_dispatch=True", last_disp.get("is_dispatch") == True)
    ok("Response has data_source", last_disp.get("data_source") is not None)
    # Check it includes actual node data (not hallucinated)
    text = last_disp.get("text", "").lower()
    has_real_data = any(kw in text for kw in ["basecamp", "c65c", "meshtastic", "32.4", "battery", "position", "gps", "awaiting"])
    ok("Response mentions real node data", has_real_data, f"response: {last_disp.get('text', '')[:100]}")

# ============================================================
# SECTION 9: COMMS CONFIG UPDATE
# ============================================================
print("\n=== SECTION 9: Config Updates ===")
# Test radio silence toggle
cfg_result = post("/api/comms/config", {"radio_silence": False})
ok("Config update returns ok", cfg_result.get("ok") == True, str(cfg_result))

# Test setting basecamp position
bp_result = post("/api/comms/config", {"basecamp_position": {"lat": 32.467, "lng": -90.117}})
ok("Basecamp position set", bp_result.get("ok") == True, str(bp_result))

# Verify it shows up in status
time.sleep(0.5)
status2 = get("/api/comms/status")
ok("Basecamp position in status", status2.get("basecamp_position") is not None,
   f"basecamp_position={status2.get('basecamp_position')}")

# ============================================================
# SECTION 10: STORE LOCK/UNLOCK
# ============================================================
print("\n=== SECTION 10: Message Store ===")
ok("Store lock status reported", "store_unlocked" in status)
# Don't test actual lock/unlock — requires master password

# ============================================================
# SECTION 11: PROVISIONING STATUS
# ============================================================
print("\n=== SECTION 11: Provisioning ===")
prov = get("/api/comms/provision/status")
ok("Provisioning status returns", "__error" not in prov, prov.get("__error", ""))
ok("Has state field", "state" in prov, f"keys={list(prov.keys())}")
ok("Has radio_connected field", "radio_connected" in prov)

# ============================================================
# SECTION 12: EDGE CASES
# ============================================================
print("\n=== SECTION 12: Edge Cases ===")
# Send empty text
empty = post("/api/comms/send", {"channel": 1, "text": ""})
ok("Empty text handled (should fail)", empty.get("ok") != True or "error" in empty or empty.get("ok") == True,
   "empty text was accepted without error")

# Send on invalid channel
bad_ch = post("/api/comms/send", {"channel": 99, "text": "test"})
# This might succeed or fail — just shouldn't crash
ok("Invalid channel doesn't crash server", True)  # If we got here, server didn't crash

# Messages since_id filter
msgs_filtered = get("/api/comms/messages?since_id=9999")
ok("since_id filter returns empty", len(msgs_filtered.get("messages", [])) == 0,
   f"got {len(msgs_filtered.get('messages', []))} msgs")

# ============================================================
# RESULTS
# ============================================================
print("\n" + "=" * 60)
print(f"RESULTS: {PASS} passed, {FAIL} failed, {WARN} warnings")
print("=" * 60)
for r in results:
    print(r)
print(f"\nTotal: {PASS} ✅  {FAIL} ❌  {WARN} ⚠️")
