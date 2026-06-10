#!/usr/bin/env python3
"""Diagnostic: dump live node_db and capture incoming packets for 60s.

Connects to the running server's /api/comms/status and also checks
if we can see position packets in the log. Run this while the remote
node is sending position data.

Usage: python3 scripts/diagnose_position.py
"""
import json, time, urllib.request, sys

SERVER = 'http://127.0.0.1:8080'

def get_status():
    try:
        with urllib.request.urlopen(f'{SERVER}/api/comms/status', timeout=5) as r:
            return json.loads(r.read())
    except Exception as e:
        print(f"ERROR: Can't reach server: {e}")
        sys.exit(1)

def main():
    print("=" * 70)
    print("POSITION DATA DIAGNOSTIC")
    print("=" * 70)

    status = get_status()
    nodes = status.get('nodes', [])

    print(f"\nNodes on mesh: {len(nodes)}")
    print(f"GPS Position toggle: {status.get('gps_position')}")
    print(f"Radio Telemetry toggle: {status.get('radio_telemetry')}")
    print(f"Basecamp manual position: {status.get('basecamp_position')}")
    print()

    for n in nodes:
        name = n.get('long_name') or n.get('user_id', '?')
        uid = n.get('user_id', '?')
        print(f"── {name} ({uid}) ──")
        print(f"   last_heard_ago: {n.get('last_heard_ago')}s")

        pos = n.get('position')
        if pos:
            lat, lng = pos.get('lat', 0), pos.get('lng', 0)
            alt = pos.get('alt', 0)
            updated = pos.get('updated', 0)
            age = int(time.time() - updated) if updated else 'never'
            print(f"   POSITION: lat={lat}, lng={lng}, alt={alt}")
            print(f"   position_updated: {updated} ({age}s ago)")
            src = pos.get('source', 'radio')
            print(f"   source: {src}")
        else:
            print(f"   POSITION: *** NONE ***")
            print(f"   ⚠ No position data stored for this node!")

        telem = n.get('telemetry')
        if telem:
            print(f"   TELEMETRY: battery={telem.get('battery')}%, "
                  f"voltage={telem.get('voltage')}V, "
                  f"uptime={telem.get('uptime')}s")
        else:
            print(f"   TELEMETRY: None")

        print(f"   SNR: {n.get('snr')}, Hops: {n.get('hops')}")
        print()

    # Now poll for changes for 60 seconds
    print("=" * 70)
    print("MONITORING for position changes (60 seconds)...")
    print("Ensure the remote node has GPS enabled and is sharing position.")
    print("=" * 70)

    initial_positions = {}
    for n in nodes:
        uid = n.get('user_id', '?')
        initial_positions[uid] = n.get('position')

    for i in range(60):
        time.sleep(1)
        status = get_status()
        for n in status.get('nodes', []):
            uid = n.get('user_id', '?')
            name = n.get('long_name') or uid
            pos = n.get('position')
            old_pos = initial_positions.get(uid)

            if pos and not old_pos:
                print(f"\n  ✅ [{i+1}s] NEW POSITION for {name}: "
                      f"lat={pos['lat']}, lng={pos['lng']}")
                initial_positions[uid] = pos
            elif pos and old_pos:
                if pos.get('updated', 0) != old_pos.get('updated', 0):
                    print(f"\n  🔄 [{i+1}s] POSITION UPDATE for {name}: "
                          f"lat={pos['lat']}, lng={pos['lng']}")
                    initial_positions[uid] = pos

        if (i + 1) % 10 == 0:
            print(f"  ... {i+1}s elapsed, still monitoring")

    print("\n" + "=" * 70)
    print("FINAL STATE:")
    print("=" * 70)
    status = get_status()
    for n in status.get('nodes', []):
        name = n.get('long_name') or n.get('user_id', '?')
        pos = n.get('position')
        print(f"  {name}: position={'YES' if pos else '*** NONE ***'}")

    # Diagnosis
    print("\n" + "=" * 70)
    print("DIAGNOSIS:")
    print("=" * 70)
    remote_nodes = [n for n in status.get('nodes', [])
                    if n.get('user_id') != status.get('serial', {}).get('node_id')]
    for n in remote_nodes:
        name = n.get('long_name') or n.get('user_id', '?')
        pos = n.get('position')
        telem = n.get('telemetry')
        if telem and not pos:
            print(f"  ⚠ {name}: HAS telemetry but NO position.")
            print(f"    This means:")
            print(f"    1. Telemetry packets (PORTNUM=67) ARE being decoded")
            print(f"    2. Position packets (PORTNUM=3) are either:")
            print(f"       a) NOT being sent by the remote node")
            print(f"       b) Arriving encrypted and can't be decrypted")
            print(f"       c) Decoded but have latitude_i=0 (no GPS fix)")
            print(f"    Check the remote node's Meshtastic app:")
            print(f"    - Is 'GPS Mode' set to something other than 'Disabled'?")
            print(f"    - Does the Meshtastic app show a GPS fix for this node?")
            print(f"    - Is position sharing enabled in the Meshtastic app?")
        elif pos:
            print(f"  ✅ {name}: Position data present.")

if __name__ == '__main__':
    main()
