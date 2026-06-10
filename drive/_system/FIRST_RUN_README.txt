The Blackout Drive — FIRST TIME SETUP
================================

WINDOWS USERS — READ THIS FIRST:
----------------------------------
When you plug in this drive for the first time, Windows may
show a security warning ("Windows protected your PC").

FIX IN 3 STEPS:
  1. Double-click: FIRST_RUN_WINDOWS.bat
  2. Click "Yes" when Windows asks for permission
  3. The Blackout Drive will launch automatically

After that first setup, always use: START_WINDOWS.bat

─────────────────────────────────────────────────────────────

MAC USERS — READ THIS FIRST:
------------------------------
macOS may block the launcher with a "can't be opened because
it's from an unidentified developer" message.

FIX:
  1. Go to System Settings → Privacy & Security
  2. Click "Allow Anyway" next to the blocked app message
  3. Double-click "The Blackout Drive" app again

After that first setup, always use: The Blackout Drive.app

─────────────────────────────────────────────────────────────

LINUX USERS (EXPERIMENTAL) — READ THIS FIRST:
--------------------------------
Note: Linux support is currently experimental and has not been fully tested.
Most Linux distributions will run the launcher directly.

GET STARTED:
  1. Open a terminal in the drive folder
  2. Run: bash Start\ \(Linux\).sh
     (or right-click the file and select "Run as a program")
  3. The Blackout Drive will launch in your browser

If you get a "Permission denied" error, run:
  chmod +x "Start (Linux).sh"
  Then try again.

─────────────────────────────────────────────────────────────

BEFORE UNPLUGGING:
------------------
Always shut down The Blackout Drive before removing the drive:
  → Close the browser tab — the drive detects this and
    automatically shuts down the server and AI engine
  → Wait a few seconds, then safely eject through your OS

Do NOT just yank the drive. The AI engine runs in your 
computer's memory — closing the tab shuts it down cleanly.

─────────────────────────────────────────────────────────────

WHAT'S ON THIS DRIVE:
----------------------
The Blackout Drive is a self-contained basecamp on a USB drive.
It includes an offline AI, encrypted file storage, a reference library,
mesh communications (via LoRa radio), and six interactive tools.
It has no internet and sends nothing to any server.

Click the "📚 LIBRARY" button inside the chat interface to
browse and read everything on this drive.

  PRELOADED CONTENT:
    • Offline reference books — Survival, medical, legal, engineering,
      philosophy, homestead, cybersecurity, development, and more
    • Multiple Bible translations (KJV, WEB, ASV, YLT)
    • Ham radio toolkit — Morse trainer, frequency charts, and quiz
    • 100+ curated prompts across 11 knowledge domains

  FEATURES & SECURITY:
    • MASTER PASSWORD — Created when you first enable encryption (via Settings or the Locked tab in Workspace). One password protects all your encrypted data.
    • BLACKOUT PROTOCOL — One-click security switch (top-right corner). Forces Network Lock + Encrypt Chat History ON.
    • WORKSPACE — Personal file storage. Unlocked (open access) or Locked (password-protected, AES-256-GCM encrypted).
    • TOOLS — 6 interactive offline utilities: Ham Radio, Tactical Navigator, Cipher Studio, Survival Calculators, Medical Timers, and Prep Checklists.
    • COMMS — Mesh communications via LoRa radio, built on the open-source Meshtastic protocol (meshtastic.org). Off-grid messaging, live node tracking, and AI dispatch. (Requires Mesh Bundle or a Heltec V3 LoRa radio.)
    • CHANGE PASSWORD — Settings → Data → Change Master Password (re-encrypts everything, nothing is lost).
    • FORGOT PASSWORD — You can reset, but all encrypted conversations and locked files will be permanently deleted.

  DOWNLOADABLE CONTENT (requires internet, one time):
    Click ⬇ GET MORE in the library to browse and download
    additional content packs. All content is public domain
    and free to download. Categories include survival guides,
    medical references, legal texts, engineering manuals,
    philosophy, and more.

─────────────────────────────────────────────────────────────

MINIMUM REQUIREMENTS:
  • macOS 11+ (Apple Silicon or Intel)
  • Windows 10/11 with a dedicated GPU (NVIDIA or AMD)
  • Linux (64-bit x86_64, experimental — not yet fully tested) with a dedicated GPU (NVIDIA or AMD)
  • 8GB RAM minimum (16GB recommended)
  • USB 3.0+ port (recommended for best performance)
  • No internet connection required

NOTE: On Windows computers without a dedicated GPU
or with less than 8GB RAM, BEACON AI will be disabled but
all other features (Library, COMMS, Workspace, Ham Radio)
work normally.

PERFORMANCE DISCLAIMER:
BEACON is a fully offline AI — it runs entirely on your computer,
not in the cloud. Because of this, speed depends on your computer's
hardware (processor, RAM, and GPU). The first response after each
launch may take longer while the AI loads into memory.
Minimum required RAM: 8GB.
Recommended for faster performance: 16GB RAM or higher
with a dedicated GPU.

AI MODEL: BEACON is powered by Qwen3, an open-source language
model developed by Alibaba Cloud (Apache 2.0 License), running
via Ollama (MIT License). We did not create the AI model — we
packaged and configured it to run offline from this drive.

─────────────────────────────────────────────────────────────

LIMITATION OF LIABILITY:
----------------------
The Blackout Drive is an offline AI system with encrypted data storage, designed for zero-connectivity environments. It is provided "as-is" without warranties of any kind. 

Hutton Technologies LLC claims zero liability for injury, death, legal repercussions, or property damage resulting from the use of the information contained within. 

The user assumes all risk associated with executing any procedures generated by the device. If infrastructure permits, always consult licensed medical or legal professionals.

─────────────────────────────────────────────────────────────

Questions or support: support@theblackoutdrive.com
