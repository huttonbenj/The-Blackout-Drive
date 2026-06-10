"""
COMMS Zero-Debt Verification Test Suite
========================================
Tests every behavioral fix from the dispatch persona hardening.
Run with: python3 -m pytest drive/tests/test_dispatch_hardening.py -v

Copyright (c) 2026 Hutton Technologies LLC — Licensed under BSL 1.1
"""

import os
import sys
import re
import time
import unittest

# ── Path setup ──
# tests/ lives at drive/tests/, so REPO_ROOT = drive/
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO_ROOT, '_system'))

# Import test targets
from comms.dispatch import (
    _strip_think_tags,
    _sanitize_response,
    _validate_node_references,
    DispatchEngine,
    INFERENCE_TIMEOUT_SEC,
)
from comms import protocol as proto


# ═══════════════════════════════════════════════════════════════
# HELPERS — Mock objects for dispatch engine
# ═══════════════════════════════════════════════════════════════

def _make_engine(messages=None, nodes=None, our_node_id=0x1234):
    """Create a minimal DispatchEngine for testing post-processors."""
    engine = DispatchEngine.__new__(DispatchEngine)
    engine.our_node_id = our_node_id
    engine._messages_fn = lambda: (messages or [])
    engine._node_db_fn = lambda: (nodes or {})
    engine._inference_fn = None
    engine._tx_fn = None
    engine._ai_disabled = False
    engine._ai_disabled_reason = None
    engine._gpu_name = None
    engine._ram_gb = 0
    engine._model_tier = 'max'
    engine.stats = {
        'queries': 0, 'continuations': 0,
        'emergency_detected': 0, 'fabrication_caught': 0,
    }
    return engine


def _make_message(text, from_hex='!00001234', from_name='TestUser', is_dispatch=False):
    """Create a message dict matching the format used in __init__.py."""
    return {
        'type': 'tx' if is_dispatch else 'rx',
        'from': from_hex,
        'from_name': from_name,
        'to': '!ffffffff',
        'is_dm': False,
        'channel': 1,
        'text': text,
        'timestamp': time.time(),
        'is_dispatch': is_dispatch,
        'classification': 'BEACON' if is_dispatch else 'GENERAL',
    }


# ═══════════════════════════════════════════════════════════════
# A1: Conversation context sender filtering
# ═══════════════════════════════════════════════════════════════

class TestA1ConversationContextFiltering(unittest.TestCase):
    """Verify conversation context only includes the current sender's exchanges."""

    def test_filters_out_other_senders(self):
        """Alice's Q&A should NOT appear in Bob's context."""
        messages = [
            _make_message('@beacon what is my battery?', from_hex='!0000aaaa', from_name='Alice'),
            _make_message('[BEACON] Your battery is at 85%.', from_hex='!00001234', from_name='BEACON', is_dispatch=True),
            _make_message('@beacon what is my battery?', from_hex='!0000bbbb', from_name='Bob'),
        ]
        engine = _make_engine(messages=messages, our_node_id=0x1234)
        # Bob's sender_id (0x0000bbbb)
        bob_id = 0x0000bbbb
        context = engine._assemble_context(bob_id, "what is my battery?")
        # Alice's exchange should NOT be in Bob's context
        self.assertNotIn('Alice', context, "Alice's query leaked into Bob's context")
        self.assertNotIn('85%', context, "Alice's BEACON answer leaked into Bob's context")

    def test_includes_own_sender(self):
        """Bob's own exchanges SHOULD appear in his context."""
        messages = [
            _make_message('@beacon how many nodes?', from_hex='!0000bbbb', from_name='Bob'),
            _make_message('[BEACON] There are 3 nodes on the mesh.', from_hex='!00001234', from_name='BEACON', is_dispatch=True),
            _make_message('@beacon tell me more', from_hex='!0000bbbb', from_name='Bob'),
        ]
        engine = _make_engine(messages=messages, our_node_id=0x1234)
        bob_id = 0x0000bbbb
        context = engine._assemble_context(bob_id, "tell me more")
        self.assertIn('Bob', context, "Bob's own query should be in his context")
        self.assertIn('3 nodes', context, "BEACON's answer to Bob should be in context")


# ═══════════════════════════════════════════════════════════════
# A2: Expanded duplicate detection
# ═══════════════════════════════════════════════════════════════

class TestA2DuplicateDetection(unittest.TestCase):
    """Verify duplicate detection catches cycling across last 3 responses."""

    def test_catches_immediate_duplicate(self):
        """Response identical to last BEACON message (to same sender) should be caught."""
        messages = [
            _make_message('@beacon how many nodes?', from_hex='!00005678', from_name='FieldUnit'),
            _make_message('[BEACON] The mesh has 3 nodes.', from_hex='!00001234', from_name='BEACON', is_dispatch=True),
        ]
        engine = _make_engine(messages=messages, our_node_id=0x1234)
        result = engine._post_process_response(
            "The mesh has 3 nodes.", 0x5678, "how many nodes?"
        )
        self.assertIn("already answered", result, "Immediate duplicate should be caught")

    def test_catches_second_oldest_duplicate(self):
        """Response identical to 2nd-most-recent BEACON reply to same sender should be caught."""
        messages = [
            _make_message('@beacon status?', from_hex='!00005678', from_name='FieldUnit'),
            _make_message('[BEACON] The mesh has 3 nodes.', from_hex='!00001234', from_name='BEACON', is_dispatch=True),
            _make_message('@beacon tell me more', from_hex='!00005678', from_name='FieldUnit'),
            _make_message('[BEACON] I can help with mesh questions.', from_hex='!00001234', from_name='BEACON', is_dispatch=True),
        ]
        engine = _make_engine(messages=messages, our_node_id=0x1234)
        result = engine._post_process_response(
            "The mesh has 3 nodes.", 0x5678, "status?"
        )
        self.assertIn("already answered", result, "Cycling duplicate (2nd-oldest) should be caught")

    def test_allows_novel_response(self):
        """A genuinely new response should pass through."""
        messages = [
            _make_message('@beacon status?', from_hex='!00005678', from_name='FieldUnit'),
            _make_message('[BEACON] The mesh has 3 nodes.', from_hex='!00001234', from_name='BEACON', is_dispatch=True),
        ]
        engine = _make_engine(messages=messages, our_node_id=0x1234)
        result = engine._post_process_response(
            "All nodes are healthy. Battery levels look good.", 0x5678, "status?"
        )
        self.assertNotIn("already answered", result, "Novel response should not be flagged as duplicate")

    def test_sender_isolation(self):
        """Alice's duplicate should NOT block Bob from getting the same answer."""
        messages = [
            _make_message('@beacon what is my battery?', from_hex='!0000aaaa', from_name='Alice'),
            _make_message('[BEACON] Your battery is at 85%.', from_hex='!00001234', from_name='BEACON', is_dispatch=True),
        ]
        engine = _make_engine(messages=messages, our_node_id=0x1234)
        # Bob asks the same thing — his answer shouldn't be caught as duplicate
        result = engine._post_process_response(
            "Your battery is at 85%.", 0xbbbb, "what is my battery?"
        )
        self.assertNotIn("more details", result,
                         "Bob should get his own answer even if Alice got the same one")


# ═══════════════════════════════════════════════════════════════
# A4: Basecamp strip identity bypass
# ═══════════════════════════════════════════════════════════════

class TestA4BasecampStripBypass(unittest.TestCase):
    """Verify identity queries don't strip Basecamp mentions."""

    def test_who_are_you_preserves_basecamp(self):
        """'who are you' should not strip Basecamp from response."""
        engine = _make_engine(our_node_id=0x1234)
        response = "I'm BEACON, running on Basecamp. I monitor your mesh network."
        result = engine._strip_unsolicited_basecamp(response, 0x5678, "who are you?")
        self.assertIn("Basecamp", result, "Identity query should preserve Basecamp mention")

    def test_what_can_you_do_preserves_basecamp(self):
        """'what can you do' should not strip Basecamp."""
        engine = _make_engine(our_node_id=0x1234)
        response = "I'm BEACON at Basecamp. I can report battery levels and GPS positions."
        result = engine._strip_unsolicited_basecamp(response, 0x5678, "what can you do?")
        self.assertIn("Basecamp", result, "Capability query should preserve Basecamp mention")

    def test_remote_help_strips_basecamp(self):
        """Remote 'help' query SHOULD strip unsolicited Basecamp data."""
        engine = _make_engine(our_node_id=0x1234)
        response = "I can help. Basecamp battery is at 90%. What do you need?"
        result = engine._strip_unsolicited_basecamp(response, 0x5678, "help me")
        self.assertNotIn("Basecamp battery", result, "Remote help should strip unsolicited Basecamp data")


# ═══════════════════════════════════════════════════════════════
# A5: Telemetry query detection (greedy keywords)
# ═══════════════════════════════════════════════════════════════

class TestA5TelemetryKeywords(unittest.TestCase):
    """Verify ambiguous words don't falsely classify as telemetry."""

    def test_where_should_i_camp_is_not_telemetry(self):
        """'where should I set up camp?' is NOT a telemetry query."""
        engine = _make_engine(our_node_id=0x1234)
        response = "Your battery is 85%. Your GPS shows coordinates. Find a sheltered spot."
        result = engine._strip_unsolicited_telemetry(response, "where should I set up camp?")
        # If this IS NOT treated as telemetry, the leading battery sentence gets stripped
        self.assertNotIn("battery is 85%", result,
                         "'where should I camp' should NOT be treated as telemetry passthrough")

    def test_battery_query_passes_through(self):
        """'battery' should be recognized as telemetry."""
        engine = _make_engine(our_node_id=0x1234)
        response = "Your battery is at 85%."
        result = engine._strip_unsolicited_telemetry(response, "what's my battery?")
        self.assertIn("85%", result, "'battery' query should pass through as telemetry")

    def test_mesh_status_passes_through(self):
        """'mesh status' phrase should be recognized as telemetry."""
        engine = _make_engine(our_node_id=0x1234)
        response = "There are 3 nodes online. Battery levels: Basecamp 90%, Ranger 75%."
        result = engine._strip_unsolicited_telemetry(response, "give me mesh status")
        self.assertIn("3 nodes", result, "'mesh status' should pass through as telemetry")

    def test_where_is_telemetry_phrase(self):
        """'where is Alpha-7' should be recognized as telemetry."""
        engine = _make_engine(our_node_id=0x1234)
        response = "Alpha-7's GPS shows coordinates 34.05, -118.25."
        result = engine._strip_unsolicited_telemetry(response, "where is Alpha-7?")
        self.assertIn("coordinates", result, "'where is X' should pass through as telemetry")


# ═══════════════════════════════════════════════════════════════
# A6: NATO phonetic regex false positives
# ═══════════════════════════════════════════════════════════════

class TestA6NATORegex(unittest.TestCase):
    """Verify NATO phonetic regex only matches callsigns with numbers."""

    def test_bare_echo_not_flagged(self):
        """Bare 'Echo' in normal English should NOT be flagged."""
        known = {'basecamp', 'beacon'}
        result = _validate_node_references(
            "I can echo that back to you.", known
        )
        self.assertIn("echo", result.lower(), "'echo' in normal English should survive")

    def test_bare_delta_not_flagged(self):
        """Bare 'Delta' in normal English should NOT be flagged."""
        known = {'basecamp', 'beacon'}
        result = _validate_node_references(
            "The delta in temperature is concerning.", known
        )
        self.assertIn("delta", result.lower(), "'delta' in normal English should survive")

    def test_alpha7_flagged(self):
        """'Alpha-7' (NATO + number) should be flagged as fabricated."""
        known = {'basecamp', 'beacon'}
        result = _validate_node_references(
            "Alpha-7 is reporting low battery.", known
        )
        # The sentence containing Alpha-7 should be stripped
        self.assertNotIn("Alpha-7", result, "'Alpha-7' should be flagged as fabricated node")

    def test_charlie3_flagged(self):
        """'Charlie 3' (NATO + number) should be flagged."""
        known = {'basecamp', 'beacon'}
        result = _validate_node_references(
            "Charlie 3 has lost GPS signal.", known
        )
        self.assertNotIn("Charlie 3", result, "'Charlie 3' should be flagged as fabricated node")

    def test_hotel_not_flagged(self):
        """'Hotel' in normal English should NOT be flagged."""
        known = {'basecamp', 'beacon'}
        result = _validate_node_references(
            "The hotel down the road has supplies.", known
        )
        self.assertIn("hotel", result.lower(), "'hotel' in normal English should survive")

    def test_india_not_flagged(self):
        """'India' in normal English should NOT be flagged."""
        known = {'basecamp', 'beacon'}
        result = _validate_node_references(
            "India has a large population.", known
        )
        self.assertIn("india", result.lower(), "'India' in normal English should survive")


# ═══════════════════════════════════════════════════════════════
# A7: Inference timeout constant
# ═══════════════════════════════════════════════════════════════

class TestA7InferenceTimeout(unittest.TestCase):
    """Verify the inference timeout constant is defined and sane."""

    def test_timeout_defined(self):
        """INFERENCE_TIMEOUT_SEC should exist and be 30."""
        self.assertEqual(INFERENCE_TIMEOUT_SEC, 30,
                         "INFERENCE_TIMEOUT_SEC should be 30 seconds")

    def test_timeout_used_in_inference(self):
        """The __init__.py _do_inference should reference the timeout constant."""
        init_path = os.path.join(REPO_ROOT, '_system', 'comms', '__init__.py')
        with open(init_path) as f:
            source = f.read()
        self.assertIn('INFERENCE_TIMEOUT_SEC', source,
                      "__init__.py should import and use INFERENCE_TIMEOUT_SEC")
        # Should NOT have the old hardcoded 120
        self.assertNotIn('timeout=120', source,
                         "__init__.py should not have hardcoded timeout=120")


# ═══════════════════════════════════════════════════════════════
# A9: Extended raw label patterns
# ═══════════════════════════════════════════════════════════════

class TestA9RawLabels(unittest.TestCase):
    """Verify extended raw label cleaning patterns."""

    def test_position_data_none(self):
        """'Position data: none' variant should be cleaned."""
        engine = _make_engine()
        result = engine._clean_raw_labels("Your Position data: none.")
        self.assertIn("No GPS data available", result)

    def test_heard_0s_ago(self):
        """'heard 0s ago' should become 'just heard'."""
        engine = _make_engine()
        result = engine._clean_raw_labels("Basecamp was heard 0s ago.")
        self.assertIn("just heard", result)

    def test_0v_external(self):
        """'(0.0V External)' should become '(external power)'."""
        engine = _make_engine()
        result = engine._clean_raw_labels("Battery: 100% (0.0V External)")
        self.assertIn("external power", result)

    def test_battery_101_percent(self):
        """'battery is 101%' should be normalized."""
        engine = _make_engine()
        result = engine._clean_raw_labels("Your battery is 101%.")
        self.assertIn("100%", result)
        self.assertIn("external power", result)


# ═══════════════════════════════════════════════════════════════
# A10: Module-level imports
# ═══════════════════════════════════════════════════════════════

class TestA10ModuleLevelImports(unittest.TestCase):
    """Verify no inline import re statements remain."""

    def test_no_inline_import_re(self):
        """dispatch.py should have zero 'import re' inside functions."""
        dispatch_path = os.path.join(REPO_ROOT, '_system', 'comms', 'dispatch.py')
        with open(dispatch_path) as f:
            lines = f.readlines()
        inline_imports = []
        for i, line in enumerate(lines, 1):
            stripped = line.strip()
            if stripped == 'import re' and line.startswith('    '):
                inline_imports.append(f"L{i}: {stripped}")
        self.assertEqual(inline_imports, [],
                         f"Found inline 'import re' at: {inline_imports}")


# ═══════════════════════════════════════════════════════════════
# C1: Factory sync verification
# ═══════════════════════════════════════════════════════════════

class TestC1FactorySync(unittest.TestCase):
    """Verify factory comms files are identical to live."""

    def test_factory_files_match(self):
        """All comms/*.py files should be identical to _factory/comms/*.py."""
        live_dir = os.path.join(REPO_ROOT, '_system', 'comms')
        factory_dir = os.path.join(REPO_ROOT, '_system', '_factory', 'comms')
        for fname in ['__init__.py', 'dispatch.py', 'serial_io.py', 'protocol.py', 'store.py']:
            live = os.path.join(live_dir, fname)
            factory = os.path.join(factory_dir, fname)
            if not os.path.isfile(factory):
                self.fail(f"Factory file missing: {fname}")
            with open(live, 'rb') as f:
                live_bytes = f.read()
            with open(factory, 'rb') as f:
                factory_bytes = f.read()
            self.assertEqual(
                live_bytes, factory_bytes,
                f"Factory desync: {fname} ({len(live_bytes)} vs {len(factory_bytes)} bytes)"
            )


# ═══════════════════════════════════════════════════════════════
# C2: comms_log filename verification
# ═══════════════════════════════════════════════════════════════

class TestC2CommsLogFilename(unittest.TestCase):
    """Verify the system uses .bkv as the canonical comms log format."""

    def test_canonical_format_is_bkv(self):
        """comms/__init__.py should pass comms_log.bkv to the store."""
        init_path = os.path.join(REPO_ROOT, '_system', 'comms', '__init__.py')
        with open(init_path) as f:
            source = f.read()
        self.assertIn("comms_log.bkv", source,
                      "comms/__init__.py should use comms_log.bkv")

    def test_no_enc_migration_shim(self):
        """store.py should NOT have the .enc → .bkv migration shim."""
        store_path = os.path.join(REPO_ROOT, '_system', 'comms', 'store.py')
        with open(store_path) as f:
            source = f.read()
        self.assertNotIn("Migrate legacy path", source,
                         "store.py should not have the migration shim")

    def test_crash_recovery_uses_bkv(self):
        """server.py crash recovery target should be .bkv."""
        server_path = os.path.join(REPO_ROOT, '_system', 'server.py')
        with open(server_path) as f:
            source = f.read()
        # The crash recovery list should have comms_log.bkv, not .enc
        self.assertIn("comms_log.bkv", source,
                      "server.py should reference comms_log.bkv")

    def test_cleanup_both_extensions(self):
        """server.py password reset should clean up both .bkv and .enc."""
        server_path = os.path.join(REPO_ROOT, '_system', 'server.py')
        with open(server_path) as f:
            source = f.read()
        # Both extensions should appear in the cleanup loop
        self.assertIn("comms_log.bkv", source)
        self.assertIn("comms_log.enc", source)


# ═══════════════════════════════════════════════════════════════
# C3: cleanup.sh existence
# ═══════════════════════════════════════════════════════════════

class TestC3CleanupScript(unittest.TestCase):
    """Verify cleanup.sh exists and is executable."""

    def test_cleanup_exists(self):
        cleanup = os.path.join(REPO_ROOT, '_system', 'cleanup.sh')
        self.assertTrue(os.path.isfile(cleanup), "cleanup.sh should exist")

    def test_cleanup_executable(self):
        cleanup = os.path.join(REPO_ROOT, '_system', 'cleanup.sh')
        self.assertTrue(os.access(cleanup, os.X_OK), "cleanup.sh should be executable")


# ═══════════════════════════════════════════════════════════════
# C4: Test files removed
# ═══════════════════════════════════════════════════════════════

class TestC4TestFilesRemoved(unittest.TestCase):
    """Verify dev test files are not in the drive root."""

    def test_no_test_files_in_drive_root(self):
        import glob
        test_files = glob.glob(os.path.join(REPO_ROOT, 'test_*.py'))
        self.assertEqual(test_files, [],
                         f"Test files should not exist in drive/: {test_files}")


# ═══════════════════════════════════════════════════════════════
# C11: MIN_VALID_EPOCH deduplication
# ═══════════════════════════════════════════════════════════════

class TestC11MinValidEpoch(unittest.TestCase):
    """Verify MIN_VALID_EPOCH is defined once at module level."""

    def test_single_definition(self):
        serial_path = os.path.join(REPO_ROOT, '_system', 'comms', 'serial_io.py')
        with open(serial_path) as f:
            lines = f.readlines()
        definitions = []
        for i, line in enumerate(lines, 1):
            if 'MIN_VALID_EPOCH' in line and '=' in line and 'import' not in line:
                definitions.append((i, line.strip()))
        # Should be exactly 1 module-level definition
        module_level = [d for d in definitions if not d[1].startswith(' ')]
        self.assertEqual(len(module_level), 1,
                         f"Should have exactly 1 module-level definition, got {len(module_level)}: {module_level}")
        # Should NOT have any function-level definitions
        inline = [d for d in definitions if d[1].startswith(' ') and '=' in d[1] and '946684800' in d[1]]
        self.assertEqual(len(inline), 0,
                         f"Should have 0 inline definitions, got {len(inline)}: {inline}")


# ═══════════════════════════════════════════════════════════════
# C12: Hops display threshold
# ═══════════════════════════════════════════════════════════════

class TestC12HopsThreshold(unittest.TestCase):
    """Verify hops display uses >= 1, not > 1."""

    def test_hops_threshold(self):
        js_path = os.path.join(REPO_ROOT, '_system', 'ui', 'comms.js')
        with open(js_path) as f:
            source = f.read()
        self.assertIn('node.hops >= 1', source,
                      "Should use >= 1, not > 1 for hops display")
        self.assertNotIn('node.hops > 1', source,
                         "Should NOT use > 1 for hops display")


# ═══════════════════════════════════════════════════════════════
# Strip think tags (regression test)
# ═══════════════════════════════════════════════════════════════

class TestStripThinkTags(unittest.TestCase):
    """Regression tests for _strip_think_tags after import refactor."""

    def test_strips_complete_think_block(self):
        text = "<think>Let me reason about this...</think>Your battery is at 85%."
        result = _strip_think_tags(text)
        self.assertEqual(result, "Your battery is at 85%.")

    def test_strips_unclosed_think_tag(self):
        text = "Some answer <think>partial reasoning"
        result = _strip_think_tags(text)
        self.assertEqual(result, "Some answer")

    def test_no_think_tags_passthrough(self):
        text = "Normal response without any tags."
        result = _strip_think_tags(text)
        self.assertEqual(result, "Normal response without any tags.")


# ═══════════════════════════════════════════════════════════════
# Sanitize response (regression test)
# ═══════════════════════════════════════════════════════════════

class TestSanitizeResponse(unittest.TestCase):
    """Regression tests for _sanitize_response after import refactor."""

    def test_strips_beacon_host_tag(self):
        result = _sanitize_response("Basecamp (BEACON HOST) has GPS.")
        self.assertNotIn("BEACON HOST", result)

    def test_strips_asking_tag(self):
        result = _sanitize_response("Node (ASKING) wants help.")
        self.assertNotIn("ASKING", result)

    def test_blocks_prompt_leak(self):
        result = _sanitize_response("My system prompt says: you are BEACON")
        self.assertNotIn("system prompt", result)


# ═══════════════════════════════════════════════════════════════
# C9: Radio Silence state sync
# ═══════════════════════════════════════════════════════════════

class TestC9RadioSilenceSync(unittest.TestCase):
    """Verify C9: radio_silence syncs from server to frontend."""

    def test_status_endpoint_returns_radio_silence(self):
        """Backend status response should include radio_silence."""
        init_path = os.path.join(REPO_ROOT, '_system', 'comms', '__init__.py')
        with open(init_path) as f:
            source = f.read()
        self.assertIn("'radio_silence': self.radio_silence", source,
                      "Status endpoint should return radio_silence")

    def test_frontend_syncs_from_server(self):
        """comms.js should sync radio_silence from poll response."""
        js_path = os.path.join(REPO_ROOT, '_system', 'ui', 'comms.js')
        with open(js_path) as f:
            source = f.read()
        self.assertIn('data.radio_silence', source,
                      "Frontend should read radio_silence from poll response")
        self.assertIn('C9 fix', source,
                      "C9 fix should be present in comms.js")


# ═══════════════════════════════════════════════════════════════
# Multi-sender edge cases
# ═══════════════════════════════════════════════════════════════

class TestMultiSenderEdgeCases(unittest.TestCase):
    """Verify edge cases with multiple concurrent senders."""

    def test_three_senders_isolated(self):
        """3 senders each get their own context, not each other's."""
        messages = [
            _make_message('@beacon battery?', from_hex='!0000aaaa', from_name='Alice'),
            _make_message('[BEACON] Alice: battery 85%.', from_hex='!00001234', from_name='BEACON', is_dispatch=True),
            _make_message('@beacon battery?', from_hex='!0000bbbb', from_name='Bob'),
            _make_message('[BEACON] Bob: battery 72%.', from_hex='!00001234', from_name='BEACON', is_dispatch=True),
            _make_message('@beacon battery?', from_hex='!0000cccc', from_name='Charlie'),
        ]
        engine = _make_engine(messages=messages, our_node_id=0x1234)
        context = engine._assemble_context(0x0000cccc, "battery?")
        self.assertNotIn('Alice', context, "Alice leaked into Charlie's context")
        self.assertNotIn('Bob', context, "Bob leaked into Charlie's context")

    def test_continuation_cache_per_sender(self):
        """Continuation cache should be keyed by sender, not global."""
        from comms.dispatch import ContinuationCache
        cache = ContinuationCache()
        cache.store(0xaaaa, "Alice's question", "Alice's answer")
        cache.store(0xbbbb, "Bob's question", "Bob's answer")
        alice_entry = cache.get(0xaaaa)
        bob_entry = cache.get(0xbbbb)
        self.assertIsNotNone(alice_entry)
        self.assertIsNotNone(bob_entry)
        self.assertEqual(alice_entry['query'], "Alice's question")
        self.assertEqual(bob_entry['query'], "Bob's question")
        # Getting Alice's entry shouldn't affect Bob's
        self.assertNotEqual(alice_entry['response'], bob_entry['response'])

    def test_no_kiwix_in_codebase(self):
        """Zero Kiwix references should exist in the live codebase."""
        import glob
        live_dir = os.path.join(REPO_ROOT, '_system')
        for fpath in glob.glob(os.path.join(live_dir, '**', '*.py'), recursive=True):
            with open(fpath) as f:
                content = f.read()
            self.assertNotIn('kiwix', content.lower(),
                             f"Kiwix reference found in {fpath}")


if __name__ == '__main__':
    unittest.main()
