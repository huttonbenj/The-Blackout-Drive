"""
The Blackout Drive — Live Hardware Detection (Shared Module)
Copyright (c) 2026 Hutton Technologies LLC — Licensed under BSL 1.1
================================================================
Single source of truth for hardware capability detection.

The Blackout Drive is a portable USB device that moves between machines.
Hardware checks MUST detect the current machine live — never rely on a
static file that may have been written on a different computer.

Usage:
    from hardware import get_hardware_info

    info = get_hardware_info()
    if info['ai_disabled']:
        print(f"AI unavailable: {info['ai_disabled_reason']}")
    else:
        print(f"RAM: {info['ram_gb']}GB, GPU: {info['gpu_name']}")

Consumers:
    - server.py (/api/info, /api/status) — hardware gating + frontend data
    - comms/dispatch.py — dispatch engine hardware gate
    - model_setup.py — boot-time tier selection (uses its own functions
      directly, but the functions are the same ones we import here)

Caching:
    Results are cached per-process. Hardware doesn't change while the
    server is running. Call invalidate() if you ever need to re-detect
    (e.g. after a hot-plug event, though this is unlikely for RAM/GPU).
================================================================
"""

import os
import sys
import logging

_log = logging.getLogger('blackout.hardware')

# Per-process cache — detected once, reused everywhere
_cache = None


def get_hardware_info():
    """Detect hardware capabilities of the current machine.

    Returns a dict with:
        ram_gb (float):            Total system RAM in GB
        has_gpu (bool):            Whether a dedicated/discrete GPU is present
        gpu_name (str):            GPU identifier string
        ai_disabled (bool):        True if hardware cannot run the AI engine
        ai_disabled_reason (str):  'no_gpu', 'insufficient_ram', or None
    """
    global _cache
    if _cache is not None:
        return _cache

    # Import detection functions from model_setup.py (same _system directory)
    _system_dir = os.path.dirname(os.path.abspath(__file__))
    added = False
    if _system_dir not in sys.path:
        sys.path.insert(0, _system_dir)
        added = True

    try:
        from model_setup import (
            get_system_ram_gb,
            has_dedicated_gpu,
            check_hardware_sufficient,
        )
    finally:
        if added:
            try:
                sys.path.remove(_system_dir)
            except ValueError:
                pass

    # Detect live hardware
    ram_gb = get_system_ram_gb()
    has_gpu, gpu_name = has_dedicated_gpu()
    is_mac = sys.platform == 'darwin'
    ai_disabled, ai_disabled_reason = check_hardware_sufficient(
        ram_gb, has_gpu, is_mac
    )

    _cache = {
        'ram_gb': round(ram_gb, 1) if ram_gb else 0,
        'has_gpu': has_gpu,
        'gpu_name': gpu_name or 'Unknown',
        'ai_disabled': ai_disabled,
        'ai_disabled_reason': ai_disabled_reason,
    }

    _log.info(
        "Live hardware detection: RAM=%.1fGB, GPU=%s (dedicated=%s), "
        "aiDisabled=%s (reason=%s)",
        _cache['ram_gb'], _cache['gpu_name'], _cache['has_gpu'],
        _cache['ai_disabled'], _cache['ai_disabled_reason']
    )

    return _cache


def invalidate():
    """Clear the cached hardware info. Next call to get_hardware_info()
    will re-detect. Useful if hardware state could have changed."""
    global _cache
    _cache = None
