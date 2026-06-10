import sys
sys.path.insert(0, 'drive/_system')
sys.path.insert(0, 'drive/_system/vendor')
import time
# pyrefly: ignore [missing-import]
from comms.dispatch import DispatchEngine
from collections import namedtuple

# Mock structures
class MockNode:
    def __init__(self, nid, name, lat, lng, battery=None):
        self.nid = nid
        self.name = name
        self.lat = lat
        self.lng = lng
        self.battery = battery
        self.time = time.time() - 420 # 7 mins ago

    def get(self, key, default=None):
        if key == 'info':
            Info = namedtuple('Info', ['long_name'])
            return Info(self.name)
        if key == 'position':
            if self.lat is None: return None
            Pos = namedtuple('Pos', ['latitude_i', 'longitude_i', 'altitude', 'time'])
            return Pos(int(self.lat*1e7), int(self.lng*1e7), 107, self.time)
        if key == 'telemetry':
            if self.battery is None: return None
            Tel = namedtuple('Tel', ['battery_level', 'voltage'])
            return Tel(self.battery, 4.7)
        if key == 'last_heard':
            return self.time
        if key == 'position_updated':
            return self.time
        return default

nodes = {
    '!bbbbbbbb': MockNode('!bbbbbbbb', 'Blackout Basecamp', None, None, 101)._asdict() if hasattr(MockNode, '_asdict') else None,
    '!ffffffff': MockNode('!ffffffff', 'Blackout Field Unit 01', 32.47964, -90.09889, None)._asdict() if hasattr(MockNode, '_asdict') else None,
}

# The class expects a real dict with these keys for nodes. Let's just build the raw dicts to match what the system provides.
nodes_raw = {
    '!bbbbbbbb': {
        'info': namedtuple('Info', ['long_name'])('Blackout Basecamp'),
        'last_heard': time.time() - 420,
        'telemetry': namedtuple('Tel', ['battery_level', 'voltage'])(101, 4.7)
    },
    '!ffffffff': {
        'info': namedtuple('Info', ['long_name'])('Blackout Field Unit 01'),
        'last_heard': time.time() - 420,
        'position': namedtuple('Pos', ['latitude_i', 'longitude_i', 'altitude', 'time'])(int(32.47964*1e7), int(-90.09889*1e7), 107, time.time() - 420),
        'position_updated': time.time() - 420
    }
}

engine = DispatchEngine('!bbbbbbbb', lambda: nodes_raw)
prompt = engine._assemble_context('!ffffffff', 'where are you')
print("=== ASSEMBLED PROMPT ===")
print(prompt)
