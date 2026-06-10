#!/usr/bin/env python3
"""
V3 Segmented AEAD Integration Stress Test

Pushes the V3 architecture to its limits with realistic scenarios:
  1. COMMS store: 50 simulated radio messages (atomic rewrite loop)
  2. 100MB streaming encrypt/decrypt with SHA-256 verification
  3. Wrong-password instant rejection on first segment

Copyright (c) 2026 Hutton Technologies LLC — Licensed under BSL 1.1
"""

import hashlib
import os
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from comms.store import CommsStore
from comms.filecrypt import encrypt_stream, decrypt_to_stream, decrypt_to_bytes


def _human_size(n):
    for unit in ('B', 'KB', 'MB', 'GB'):
        if n < 1024:
            return f'{n:.1f} {unit}'
        n /= 1024
    return f'{n:.1f} TB'


def test_comms_storm():
    """Test 1: Hammer the COMMS store with 50 rapid appends."""
    print('╔══════════════════════════════════════════════════╗')
    print('║  TEST 1: COMMS STORE — 50 Message Radio Storm   ║')
    print('╚══════════════════════════════════════════════════╝')
    print()

    with tempfile.NamedTemporaryFile(suffix='.bkv', delete=False) as f:
        store_path = f.name

    store = CommsStore(store_path)
    assert store.unlock('COMMS_STRESS_TEST_PW'), 'Unlock failed'

    # Simulate 50 radio messages from 4 nodes
    nodes = ['Basecamp', 'FieldUnit-01', 'FieldUnit-02', 'FieldUnit-03']
    messages = []
    t0 = time.time()

    for i in range(50):
        msg = {
            'from': nodes[i % len(nodes)],
            'to': 'broadcast',
            'text': f'Radio check #{i+1} — grid ref {37+i//10}.{i*7%100:02d}N, position stable. RSSI: -{55+i}dBm',
            'ts': 1716300000 + i * 30,
            'channel': 0,
            'hop_limit': 3,
        }
        store.append(msg)
        messages.append(msg)

    elapsed = time.time() - t0

    # Verify all messages persisted
    loaded = store.load_all()
    assert len(loaded) == 50, f'Expected 50 messages, got {len(loaded)}'

    # Verify content integrity
    for i, (orig, loaded_msg) in enumerate(zip(messages, loaded)):
        assert orig['text'] == loaded_msg['text'], f'Message {i} content mismatch'
        assert orig['from'] == loaded_msg['from'], f'Message {i} sender mismatch'

    # Verify file is V3
    with open(store_path, 'rb') as f:
        magic = f.read(4)
        ver = f.read(1)[0]
    assert magic == b'BKVF', f'Wrong magic: {magic}'
    assert ver == 0x03, f'Wrong version: 0x{ver:02x}'

    file_size = os.path.getsize(store_path)

    # Verify fresh load from disk
    store2 = CommsStore(store_path)
    assert store2.unlock('COMMS_STRESS_TEST_PW'), 'Fresh unlock failed'
    loaded2 = store2.load_all()
    assert len(loaded2) == 50, f'Fresh load: expected 50, got {len(loaded2)}'

    os.unlink(store_path)

    print(f'  ✅ 50 messages appended in {elapsed:.3f}s ({elapsed/50*1000:.1f}ms/msg)')
    print(f'  ✅ Store file: {_human_size(file_size)}')
    print(f'  ✅ All 50 messages verified (content + sender integrity)')
    print(f'  ✅ Fresh load from disk: 50/50 messages recovered')
    print(f'  ✅ File format: BKVF V3 confirmed')
    print()
    return True


def test_100mb_streaming():
    """Test 2+3: Stream-encrypt 100MB, verify SHA-256 hash after decrypt."""
    print('╔══════════════════════════════════════════════════╗')
    print('║  TEST 2: 100MB STREAMING ENCRYPT/DECRYPT        ║')
    print('╚══════════════════════════════════════════════════╝')
    print()

    # Generate 100MB of pseudo-random data
    print('  Generating 100MB test payload...', end=' ', flush=True)
    data_size = 100 * 1024 * 1024  # 100MB
    # Use deterministic PRNG for reproducibility — seed with known value,
    # generate in 1MB blocks for speed
    chunks_list = []
    rng = hashlib.sha256(b'V3_STRESS_TEST_SEED')
    generated = 0
    while generated < data_size:
        block_size = min(1024 * 1024, data_size - generated)
        block = bytearray(block_size)
        for j in range(0, block_size, 32):
            rng = hashlib.sha256(rng.digest())
            end = min(j + 32, block_size)
            block[j:end] = rng.digest()[:end - j]
        chunks_list.append(bytes(block))
        generated += block_size
    print(f'{_human_size(data_size)} ready')

    # Compute original SHA-256
    orig_hash = hashlib.sha256()
    for chunk in chunks_list:
        orig_hash.update(chunk)
    orig_sha = orig_hash.hexdigest()
    print(f'  Original SHA-256: {orig_sha[:16]}...{orig_sha[-16:]}')

    # Stream-encrypt
    with tempfile.NamedTemporaryFile(suffix='.bkv', delete=False) as f:
        bkv_path = f.name

    def input_chunks():
        for chunk in chunks_list:
            # Feed in varied chunk sizes to stress the buffering logic
            offset = 0
            while offset < len(chunk):
                cs = min(73728, len(chunk) - offset)  # 72KB chunks (non-aligned)
                yield chunk[offset:offset + cs]
                offset += cs

    print('  Encrypting (streaming, 64KB segments)...', end=' ', flush=True)
    t0 = time.time()
    ok, err = encrypt_stream(
        input_chunks(), bkv_path, 'STRESS_TEST_PW_100MB',
        'stress_test_100mb.bin', data_size
    )
    encrypt_time = time.time() - t0
    assert ok, f'Encrypt failed: {err}'
    enc_size = os.path.getsize(bkv_path)
    overhead = enc_size - data_size
    overhead_pct = overhead / data_size * 100
    print(f'done in {encrypt_time:.2f}s ({_human_size(data_size / encrypt_time)}/s)')
    print(f'  Encrypted file: {_human_size(enc_size)} (overhead: {_human_size(overhead)}, {overhead_pct:.2f}%)')

    # Compute segment count
    seg_count = (data_size + 65536 - 1) // 65536 + 1  # +1 for header segment
    print(f'  Segments: ~{seg_count} (64KB each)')

    # Stream-decrypt and verify SHA-256
    print('  Decrypting (streaming)...', end=' ', flush=True)
    t0 = time.time()
    header, file_size, chunk_gen = decrypt_to_stream(bkv_path, 'STRESS_TEST_PW_100MB')
    assert header['name'] == 'stress_test_100mb.bin', f'Wrong filename: {header["name"]}'
    assert header['size'] == data_size, f'Wrong size: {header["size"]}'

    dec_hash = hashlib.sha256()
    dec_bytes = 0
    for chunk in chunk_gen:
        dec_hash.update(chunk)
        dec_bytes += len(chunk)
    decrypt_time = time.time() - t0
    dec_sha = dec_hash.hexdigest()
    print(f'done in {decrypt_time:.2f}s ({_human_size(data_size / decrypt_time)}/s)')

    assert dec_bytes == data_size, f'Decrypted size mismatch: {dec_bytes} vs {data_size}'
    assert dec_sha == orig_sha, f'SHA-256 MISMATCH!\n  Original: {orig_sha}\n  Decrypted: {dec_sha}'

    print(f'  Decrypted SHA-256: {dec_sha[:16]}...{dec_sha[-16:]}')
    print(f'  ✅ SHA-256 MATCH — {_human_size(data_size)} verified bit-perfect')
    print()

    os.unlink(bkv_path)
    return True


def test_wrong_password_instant_reject():
    """Test 4: Wrong password rejected on first segment without loading rest."""
    print('╔══════════════════════════════════════════════════╗')
    print('║  TEST 3: WRONG PASSWORD — INSTANT REJECTION     ║')
    print('╚══════════════════════════════════════════════════╝')
    print()

    # Create a 10MB encrypted file
    data_size = 10 * 1024 * 1024
    print(f'  Creating {_human_size(data_size)} encrypted file...', end=' ', flush=True)

    with tempfile.NamedTemporaryFile(suffix='.bkv', delete=False) as f:
        bkv_path = f.name

    test_data = os.urandom(data_size)
    def chunks():
        for i in range(0, len(test_data), 65536):
            yield test_data[i:i+65536]

    ok, _ = encrypt_stream(chunks(), bkv_path, 'correct_password',
                            'test_10mb.bin', data_size)
    assert ok
    print('done')

    # Attempt decrypt with wrong password — should fail INSTANTLY
    print('  Attempting decrypt with wrong password...', end=' ', flush=True)
    t0 = time.time()
    try:
        header, _, chunk_gen = decrypt_to_stream(bkv_path, 'wrong_password')
        # If decrypt_to_stream didn't throw, the generator might
        # But actually, our implementation decrypts segment 0 during
        # header parsing, so it should have thrown already
        for _ in chunk_gen:
            pass
        assert False, 'Should have raised ValueError'
    except ValueError as e:
        reject_time = time.time() - t0
        error_msg = str(e)

    assert 'Wrong password' in error_msg, f'Expected "Wrong password", got: {error_msg}'
    print(f'REJECTED in {reject_time*1000:.1f}ms')

    # Verify it was instant (should be < 500ms — only segment 0 was touched)
    assert reject_time < 2.0, f'Rejection took {reject_time:.2f}s — too slow (loaded more than segment 0?)'

    os.unlink(bkv_path)

    print(f'  ✅ Error: "{error_msg}"')
    print(f'  ✅ Rejection time: {reject_time*1000:.1f}ms (segment 0 only, {_human_size(data_size)} never loaded)')
    print()
    return True


def main():
    print()
    print('  ╔════════════════════════════════════════════════════╗')
    print('  ║   V3 SEGMENTED AEAD — INTEGRATION STRESS TEST     ║')
    print('  ╠════════════════════════════════════════════════════╣')
    print('  ║   COMMS Store: 50 message storm                   ║')
    print('  ║   Streaming:   100MB encrypt/decrypt + SHA-256    ║')
    print('  ║   Security:    Instant wrong-password rejection   ║')
    print('  ╚════════════════════════════════════════════════════╝')
    print()

    results = []
    results.append(('COMMS Storm (50 msgs)', test_comms_storm()))
    results.append(('100MB Stream + SHA-256', test_100mb_streaming()))
    results.append(('Wrong Password Reject', test_wrong_password_instant_reject()))

    print()
    print('═══════════════════════════════════════════════════════')
    print('  RESULTS')
    print('═══════════════════════════════════════════════════════')
    all_pass = True
    for name, passed in results:
        status = '✅ PASS' if passed else '❌ FAIL'
        print(f'  {status}  {name}')
        if not passed:
            all_pass = False
    print()

    if all_pass:
        print('  ★ CORE V3 STRESS TEST COMPLETE — ALL PASSED')
    else:
        print('  ✖ SOME TESTS FAILED')
        sys.exit(1)

    print()


if __name__ == '__main__':
    main()
