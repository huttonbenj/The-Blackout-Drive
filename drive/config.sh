#!/bin/bash
# ============================================================
# DOOMSDAY DRIVE — Shell Configuration (Unix/Mac)
# ============================================================
# Single source of truth for all configurable values.
# Sourced by: START_MAC.command, STOP_DOOMSDAY.command,
#             FIRST_RUN_MAC.command, scripts/dev_test.sh
#
# ⚠ IMPORTANT: If you change OLLAMA_PORT or MODEL_NAME here,
# you MUST also update the matching values in:
#   → drive/ui/config.js  (JS cannot read shell variables)
# ============================================================

# ── Product Identity ──────────────────────────────────────
DOOMSDAY_APP_NAME="DOOMSDAY.AI"
DOOMSDAY_VERSION="1.0.0"

# ── AI Model ─────────────────────────────────────────────
# MODEL_NAME: the Ollama model identifier (must match Modelfile)
# BASE_MODEL: the upstream model to pull (shown during download)
# MODELFILE:  filename of the Ollama Modelfile (relative to drive root)
# MODEL_FILE: expected GGUF filename in the models/ directory
DOOMSDAY_MODEL_NAME="doomsday-ai"
DOOMSDAY_BASE_MODEL="phi3:mini"
DOOMSDAY_MODELFILE="Modelfile"
DOOMSDAY_MODEL_FILE="phi3-mini.Q4_K_M.gguf"

# ── Network ───────────────────────────────────────────────
# OLLAMA_BIND: interface Ollama listens on (localhost only for security)
# OLLAMA_PORT: Ollama API port (default: 11434)
# UI_PORT:     local HTTP server port for the chat interface
DOOMSDAY_OLLAMA_BIND="127.0.0.1"
DOOMSDAY_OLLAMA_PORT="11434"
DOOMSDAY_UI_PORT="8080"

# ── Derived Values (do not edit) ─────────────────────────
DOOMSDAY_OLLAMA_HOST_ADDR="${DOOMSDAY_OLLAMA_BIND}:${DOOMSDAY_OLLAMA_PORT}"
DOOMSDAY_OLLAMA_URL="http://localhost:${DOOMSDAY_OLLAMA_PORT}"
DOOMSDAY_UI_URL="http://localhost:${DOOMSDAY_UI_PORT}/ui/"
DOOMSDAY_OLLAMA_ORIGINS="${DOOMSDAY_UI_URL},http://127.0.0.1:${DOOMSDAY_UI_PORT}"
