import urllib.request, json
prompt = """
SYSTEM:
You are BEACON. You are currently operating on the node Blackout Basecamp.
When asked about your own location or battery, use Basecamp's data.

LIVE MESH DATA:
- Blackout Basecamp [!04333018] (ASKING): heard 0s ago, GPS: no position data, Battery: 101% (4.6V)

USER:
@beacon you alive? you working? what is your battery?
"""
url = "http://127.0.0.1:11434/api/generate"
body = json.dumps({'model': 'blackout-beacon', 'prompt': prompt, 'stream': False}).encode('utf-8')
req = urllib.request.Request(url, data=body, headers={'Content-Type': 'application/json'}, method='POST')
try:
    with urllib.request.urlopen(req) as resp:
        print(json.loads(resp.read().decode('utf-8'))['response'])
except Exception as e:
    print(e)
