#!/bin/bash
# ============================================================
# The Blackout Drive — Shell Configuration (Unix/Mac)
# ============================================================
# BOOTSTRAP ONLY — provides minimal defaults before Python
# parses config.json. The real config lives in config.json and
# is loaded by model_setup.py, which outputs all values.
#
# The launcher parses model_setup.py output and OVERRIDES these
# values with the ones from config.json. Do NOT change ports or
# model names here — edit config.json instead.
#
# Sourced by: START_MAC.command, START_LINUX.sh, STOP_BEACON.*
# ============================================================

# ── Product Identity ──────────────────────────────────────
BLACKOUT_APP_NAME="The Blackout Drive"
BLACKOUT_VERSION="1.0.0"

# ── Bootstrap Defaults (overridden by config.json) ────────
# These are ONLY used before model_setup.py runs.
# After that, the launcher uses values from config.json.
BLACKOUT_MODEL_NAME="blackout-beacon"
BLACKOUT_OLLAMA_BIND="127.0.0.1"
BLACKOUT_OLLAMA_PORT="11434"
BLACKOUT_UI_PORT="8080"

# ── Derived Values (do not edit) ─────────────────────────
BLACKOUT_OLLAMA_HOST_ADDR="${BLACKOUT_OLLAMA_BIND}:${BLACKOUT_OLLAMA_PORT}"
BLACKOUT_OLLAMA_URL="http://127.0.0.1:${BLACKOUT_OLLAMA_PORT}"
BLACKOUT_UI_URL="http://127.0.0.1:${BLACKOUT_UI_PORT}"
BLACKOUT_OLLAMA_ORIGINS="http://127.0.0.1:${BLACKOUT_UI_PORT}"

# ── Drive Root (auto-detected from config.sh location) ───
BLACKOUT_DRIVE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
