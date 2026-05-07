#!/bin/bash
# ============================================================
# BEACON DRIVE — Shell Configuration (Unix/Mac)
# ============================================================
# Single source of truth for all configurable values.
# Sourced by: START_MAC.command, STOP_BEACON.command,
#             FIRST_RUN_MAC.command, scripts/dev_test.sh
#
# ⚠ IMPORTANT: If you change OLLAMA_PORT or MODEL_NAME here,
# you MUST also update the matching values in:
#   → drive/ui/config.js  (JS cannot read shell variables)
# ============================================================

# ── Product Identity ──────────────────────────────────────
BLACKOUT_APP_NAME="The Blackout Drive"
BLACKOUT_VERSION="1.0.0"

# ── AI Model ─────────────────────────────────────────────
# MODEL_NAME: the Ollama model identifier (must match Modelfile)
# BASE_MODEL: the upstream model to pull (shown during download)
# MODELFILE:  filename of the Ollama Modelfile (relative to drive root)
# MODEL_FILE: expected GGUF filename in the models/ directory
BLACKOUT_MODEL_NAME="blackout-beacon"
BLACKOUT_BASE_MODEL="phi3:mini"
BLACKOUT_MODELFILE="Modelfile"
BLACKOUT_MODEL_FILE="phi3-mini.Q4_K_M.gguf"

# ── Network ───────────────────────────────────────────────
# OLLAMA_BIND: interface Ollama listens on (localhost only for security)
# OLLAMA_PORT: Ollama API port (default: 11434)
# UI_PORT:     local HTTP server port for the chat interface
BLACKOUT_OLLAMA_BIND="127.0.0.1"
BLACKOUT_OLLAMA_PORT="11434"
BLACKOUT_UI_PORT="8080"

# ── Derived Values (do not edit) ─────────────────────────
BLACKOUT_OLLAMA_HOST_ADDR="${BLACKOUT_OLLAMA_BIND}:${BLACKOUT_OLLAMA_PORT}"
BLACKOUT_OLLAMA_URL="http://localhost:${BLACKOUT_OLLAMA_PORT}"
BLACKOUT_UI_URL="http://localhost:${BLACKOUT_UI_PORT}/ui/"
BLACKOUT_OLLAMA_ORIGINS="${BLACKOUT_UI_URL},http://127.0.0.1:${BLACKOUT_UI_PORT}"
