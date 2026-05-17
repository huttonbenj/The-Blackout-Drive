#!/usr/bin/env python3
"""
The Blackout Drive — Model Setup Utility (v2: Tiered Profiles)

Reads models.json, auto-detects system hardware to pick the right
model tier (BASE or MAX), assembles a layered system prompt from
profiles/, generates a Modelfile, and prints config for the launcher.

Usage:
    python3 model_setup.py <script_dir> [--generate-modelfile] [--print-config] [--auto-detect]

Flags:
    --auto-detect        Pick model tier automatically based on system RAM.
                         If data/tier_override.json exists with a manual
                         override, that takes precedence.
    --generate-modelfile Write _system/Modelfile.generated
    --print-config       Print KEY=VALUE config for launcher shell scripts

Tier Selection Priority:
    1. Manual override file (data/tier_override.json)
    2. Auto-detect from system RAM (if --auto-detect)
    3. 'default' key in models.json (fallback)

If the selected model's GGUF file doesn't exist, falls back to
whichever model IS present on the drive.
"""
import json
import os
import sys
import urllib.request
import urllib.error


def get_system_ram_gb():
    """Detect total system RAM in GB. Returns 0 on failure."""
    try:
        if sys.platform == 'darwin' or sys.platform.startswith('linux'):
            pages = os.sysconf('SC_PHYS_PAGES')
            page_size = os.sysconf('SC_PAGE_SIZE')
            return (pages * page_size) / (1024 ** 3)
        elif sys.platform == 'win32':
            import ctypes
            class MEMORYSTATUSEX(ctypes.Structure):
                _fields_ = [
                    ('dwLength', ctypes.c_ulong),
                    ('dwMemoryLoad', ctypes.c_ulong),
                    ('ullTotalPhys', ctypes.c_ulonglong),
                    ('ullAvailPhys', ctypes.c_ulonglong),
                    ('ullTotalPageFile', ctypes.c_ulonglong),
                    ('ullAvailPageFile', ctypes.c_ulonglong),
                    ('ullTotalVirtual', ctypes.c_ulonglong),
                    ('ullAvailVirtual', ctypes.c_ulonglong),
                    ('ullAvailExtendedVirtual', ctypes.c_ulonglong),
                ]
            stat = MEMORYSTATUSEX()
            stat.dwLength = ctypes.sizeof(stat)
            ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(stat))
            return stat.ullTotalPhys / (1024 ** 3)
    except Exception as e:
        print(f"WARNING: RAM detection failed: {e}", file=sys.stderr)
    return 0


def read_tier_override(script_dir):
    """Read manual tier override from data/tier_override.json.
    Returns 'base', 'max', or None."""
    override_path = os.path.join(script_dir, 'data', 'tier_override.json')
    if os.path.isfile(override_path):
        try:
            with open(override_path) as f:
                data = json.load(f)
            tier = data.get('tier', '').lower().strip()
            if tier in ('base', 'max'):
                return tier
        except Exception:
            pass
    return None


def select_model_key(manifest, script_dir, auto_detect=False):
    """Determine which model key to use. Returns (model_key, tier, source).
    source is one of: 'override', 'auto', 'default', 'fallback'."""
    tiers = manifest.get('tiers', {})
    models = manifest.get('models', {})
    default_key = manifest.get('default', '')

    # Priority 1: Manual override
    override_tier = read_tier_override(script_dir)
    if override_tier and override_tier in tiers:
        model_key = tiers[override_tier]
        if model_key in models:
            gguf = os.path.join(script_dir, 'models', models[model_key]['file'])
            if os.path.isfile(gguf):
                return model_key, override_tier, 'override'
            else:
                print(f"WARNING: Override tier '{override_tier}' model not found: {gguf}",
                      file=sys.stderr)

    # Priority 2: Auto-detect from RAM
    if auto_detect:
        ram_gb = get_system_ram_gb()
        threshold = manifest.get('ramThresholdGB', 9)
        detected_tier = 'max' if ram_gb >= threshold else 'base'
        print(f"RAM detected: {ram_gb:.1f} GB (threshold: {threshold} GB) → tier: {detected_tier}",
              file=sys.stderr)

        model_key = tiers.get(detected_tier, default_key)
        if model_key in models:
            gguf = os.path.join(script_dir, 'models', models[model_key]['file'])
            if os.path.isfile(gguf):
                return model_key, detected_tier, 'auto'
            else:
                print(f"WARNING: Auto-detected tier '{detected_tier}' model not found: {gguf}",
                      file=sys.stderr)
                # Fall through to find any available model

    # Priority 3: Default from models.json
    if default_key in models:
        gguf = os.path.join(script_dir, 'models', models[default_key]['file'])
        tier = models[default_key].get('tier', 'base')
        if os.path.isfile(gguf):
            return default_key, tier, 'default'

    # Priority 4: Fallback — use whichever model GGUF actually exists
    for key, model in models.items():
        gguf = os.path.join(script_dir, 'models', model['file'])
        if os.path.isfile(gguf):
            tier = model.get('tier', 'base')
            print(f"WARNING: Using fallback model '{key}' (only available GGUF)",
                  file=sys.stderr)
            return key, tier, 'fallback'

    # Nothing found
    print("ERROR: No model GGUF files found in models/ directory", file=sys.stderr)
    models_dir = os.path.join(script_dir, 'models')
    if os.path.isdir(models_dir):
        print(f"Contents of {models_dir}:", file=sys.stderr)
        for f in os.listdir(models_dir):
            print(f"  - {f}", file=sys.stderr)
    sys.exit(1)


def assemble_system_prompt(script_dir, tier):
    """Assemble the 3-layer system prompt from profiles/.
    Layer 1: profiles/{tier}/identity.txt
    Layer 2: profiles/{tier}/tuning.txt
    Layer 3: profiles/_shared/device_facts.txt
    Returns the concatenated prompt string."""
    profiles_dir = os.path.join(script_dir, 'profiles')
    tier_dir = os.path.join(profiles_dir, tier)
    shared_dir = os.path.join(profiles_dir, '_shared')

    layers = []

    # Layer 1: Identity
    identity_path = os.path.join(tier_dir, 'identity.txt')
    if os.path.isfile(identity_path):
        with open(identity_path, encoding='utf-8') as f:
            layers.append(f.read().strip())
    else:
        print(f"WARNING: Identity file not found: {identity_path}", file=sys.stderr)

    # Layer 2: Model-specific tuning
    tuning_path = os.path.join(tier_dir, 'tuning.txt')
    if os.path.isfile(tuning_path):
        with open(tuning_path, encoding='utf-8') as f:
            layers.append(f.read().strip())
    else:
        print(f"WARNING: Tuning file not found: {tuning_path}", file=sys.stderr)

    # Layer 3: Shared device facts
    facts_path = os.path.join(shared_dir, 'device_facts.txt')
    if os.path.isfile(facts_path):
        with open(facts_path, encoding='utf-8') as f:
            layers.append(f.read().strip())
    else:
        print(f"WARNING: Device facts not found: {facts_path}", file=sys.stderr)

    return '\n\n'.join(layers)


def write_active_tier(script_dir, tier, model_key, model_name, source, ram_gb=None):
    """Write the active tier info to data/active_tier.json for diagnostics."""
    data_dir = os.path.join(script_dir, 'data')
    os.makedirs(data_dir, exist_ok=True)
    info = {
        'tier': tier,
        'modelKey': model_key,
        'modelName': model_name,
        'source': source,
    }
    if ram_gb is not None:
        info['detectedRamGB'] = round(ram_gb, 1)
    path = os.path.join(data_dir, 'active_tier.json')
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(info, f, indent=2)


def evict_model_from_memory(model_name, script_dir):
    """Force Ollama to unload the model from VRAM/RAM.

    Sends keep_alive: 0 via the /api/generate endpoint, which tells
    Ollama to immediately release the model from its hot cache. This
    ensures that the next 'ollama create' picks up the new Modelfile
    instead of serving the stale in-memory version.

    Silently no-ops if Ollama isn't running (the create will start it).
    """
    # Read port from config.json (same source the launchers use)
    config_path = os.path.join(script_dir, 'config.json')
    port = 11434
    try:
        if os.path.isfile(config_path):
            with open(config_path) as f:
                port = json.load(f).get('network', {}).get('ollamaPort', 11434)
    except Exception:
        pass

    url = f'http://127.0.0.1:{port}/api/generate'
    payload = json.dumps({
        'model': model_name,
        'keep_alive': 0
    }).encode('utf-8')

    try:
        req = urllib.request.Request(
            url,
            data=payload,
            headers={'Content-Type': 'application/json'},
            method='POST'
        )
        with urllib.request.urlopen(req, timeout=5) as resp:
            resp.read()  # drain response
        print(f"Evicted '{model_name}' from Ollama memory cache", file=sys.stderr)
    except urllib.error.URLError:
        # Ollama not running — that's fine, nothing to evict
        print(f"Ollama not running — no model to evict (will start on create)", file=sys.stderr)
    except Exception as e:
        # Non-fatal: log but don't block the build
        print(f"WARNING: Model eviction failed: {e}", file=sys.stderr)


def main():
    if len(sys.argv) < 2:
        print("Usage: model_setup.py <script_dir> [--generate-modelfile] "
              "[--print-config] [--auto-detect]", file=sys.stderr)
        sys.exit(1)

    script_dir = os.path.realpath(sys.argv[1])
    actions = set(sys.argv[2:]) if len(sys.argv) > 2 else {'--generate-modelfile', '--print-config'}
    auto_detect = '--auto-detect' in actions

    # Load models.json
    models_path = os.path.join(script_dir, 'models.json')
    if not os.path.isfile(models_path):
        print(f"ERROR: models.json not found at {models_path}", file=sys.stderr)
        sys.exit(1)

    with open(models_path) as f:
        manifest = json.load(f)

    # Select model based on tier logic
    model_key, tier, source = select_model_key(manifest, script_dir, auto_detect)
    model = manifest['models'][model_key]
    model_file = model['file']
    model_name = model.get('ollamaName', 'blackout-beacon')
    model_display = model.get('name', model_key)
    gguf_path = os.path.join(script_dir, 'models', model_file)

    print(f"Selected: {model_display} (tier={tier}, source={source})", file=sys.stderr)

    # Detect RAM for diagnostics (even if not using auto-detect)
    ram_gb = get_system_ram_gb() if auto_detect else None

    # Write active tier info for diagnostics
    write_active_tier(script_dir, tier, model_key, model_display, source, ram_gb)

    if '--generate-modelfile' in actions:
        # Evict the hot model from Ollama's memory cache BEFORE rebuilding.
        # This prevents the stale cached prompt from persisting after create.
        evict_model_from_memory(model_name, script_dir)

        # Assemble layered system prompt
        system_prompt = assemble_system_prompt(script_dir, tier)

        # Build Modelfile with ABSOLUTE path to GGUF
        lines = []
        lines.append(f'FROM {gguf_path}')
        lines.append('')

        # Parameters
        params = model.get('parameters', {})
        for key, val in params.items():
            lines.append(f'PARAMETER {key} {val}')
        lines.append('')

        # Stop tokens
        for stop in model.get('stop', []):
            lines.append(f'PARAMETER stop "{stop}"')
        lines.append('')

        # Template
        template = model.get('template', '')
        if template:
            lines.append(f'TEMPLATE """{template}"""')
            lines.append('')

        # System prompt (assembled from layers)
        if system_prompt:
            lines.append(f'SYSTEM """\n{system_prompt}\n"""')
            lines.append('')

        # Write generated Modelfile
        out_path = os.path.join(script_dir, 'Modelfile.generated')
        with open(out_path, 'w', newline='\n') as f:
            f.write('\n'.join(lines))

        print(f"Modelfile generated: {out_path}", file=sys.stderr)
        print(f"  Prompt layers: identity.txt + tuning.txt + device_facts.txt ({tier})",
              file=sys.stderr)

    if '--print-config' in actions:
        # Print config in KEY=VALUE format for shell/batch consumption
        print(f"MODEL_FILE={model_file}")
        print(f"MODEL_NAME={model_name}")
        print(f"MODEL_DISPLAY={model_display}")
        print(f"MODEL_GGUF={gguf_path}")
        print(f"MODEL_TIER={tier}")
        print(f"TIER_SOURCE={source}")

        # Read config.json (single source of truth for all settings)
        config_path = os.path.join(script_dir, 'config.json')
        config = {}
        if os.path.isfile(config_path):
            try:
                with open(config_path) as f:
                    config = json.load(f)
            except Exception:
                pass

        # Debug flag
        debug_mode = config.get('debug', False)
        print(f"DEBUG={'1' if debug_mode else '0'}")
        log_dir = os.path.join(script_dir, 'data', 'logs')
        print(f"LOG_DIR={log_dir}")

        # Network config
        network = config.get('network', {})
        ollama_port = network.get('ollamaPort', 11434)
        ollama_bind = network.get('ollamaBind', '127.0.0.1')
        ui_port = network.get('uiPort', 8080)
        print(f"OLLAMA_PORT={ollama_port}")
        print(f"OLLAMA_BIND={ollama_bind}")
        print(f"UI_PORT={ui_port}")
        print(f"OLLAMA_HOST_ADDR={ollama_bind}:{ollama_port}")
        print(f"OLLAMA_URL=http://127.0.0.1:{ollama_port}")
        print(f"UI_URL=http://127.0.0.1:{ui_port}")
        print(f"OLLAMA_ORIGINS=http://127.0.0.1:{ui_port}")


if __name__ == '__main__':
    main()
