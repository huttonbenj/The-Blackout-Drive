# Library System — Full Architecture Design

## The Three Drive States

| State | Internet | What User Sees |
|-------|----------|---------------|
| **Grid-Down (production)** | None | Only pre-loaded content. No GET MORE. Full MANAGE SPACE. |
| **Pre-Doomsday (online)** | Yes | Pre-loaded + GET MORE panel to download additional packs |
| **Post-Download (back offline)** | None | Pre-loaded + anything they downloaded while online |

---

## Sidebar — Correct Behavior

```
ON THIS DRIVE              ← section label
  📖 Holy Bible    (4)    ← shown ONLY if ≥1 file in manifest
  ☠  Survival      (6)    ← shown ONLY if ≥1 file in manifest
  🏥 Medical       (3)    ← shown ONLY if ≥1 file in manifest
  ⚖  Law           (0)    ← HIDDEN — not grayed, not locked — invisible
  ∞  Philosophy    (0)    ← HIDDEN
  W  Wikipedia     (0)    ← HIDDEN
──────────────────────────
⬇  GET MORE               ← ONLY if navigator.onLine === true (hidden offline)
🗑  MANAGE SPACE           ← ALWAYS shown
```

**Rules:**
- Zero files in a category → that sidebar item does not render at all
- GET MORE literally disappears from the DOM when offline — no disabled state
- MANAGE SPACE is always present so users can always free up drive space
- The "ON THIS DRIVE" section label only shows if ≥1 category has files

---

## GET MORE Panel (Online Only)

When user clicks "⬇ GET MORE":

```
┌────────────────────────────────────────────────────────────┐
│  ⬇  GET MORE CONTENT                                        │
│  Connected to internet. Download additional content packs. │
│                                            [Browse files ▾]│
├────────────────────────────────────────────────────────────┤
│  AVAILABLE PACKS                                           │
│                                                            │
│  📖 Bible Commentary Pack                          ~15 MB  │
│     Matthew Henry Commentary, Strongs Concordance         │
│     [⬇ DOWNLOAD PACK]  [▾ See 2 files]                   │
│                                                            │
│  🏥 Extended Medical Pack                          ~45 MB  │
│     Merck Manual, CDC Guidelines, Field Surgery           │
│     [⬇ DOWNLOAD PACK]  [▾ See 5 files]                   │
│                                                            │
│  📡 Ham Radio & Comms Pack                          ~8 MB  │
│     Frequencies, PACE plan templates, signaling guides    │
│     [⬇ DOWNLOAD PACK]  [▾ See 3 files]                   │
│                                                            │
│  🌿 Homestead & Agriculture Pack                   ~30 MB  │
│     USDA archives, seed saving, off-grid solar            │
│     [⬇ DOWNLOAD PACK]  [▾ See 7 files]                   │
│                                                            │
│  ▾ See 3 more packs...                                    │
└────────────────────────────────────────────────────────────┘
```

**Pack behavior:**
- `[⬇ DOWNLOAD PACK]` → downloads ALL files in the pack (1 click, most users)
- `[▾ See N files]` → expands to show individual files, each with its own download toggle (power users who want to cherry-pick)
- Download in progress shows a progress bar per pack:
  ```
  📡 Ham Radio Pack   [████████░░] 67%  5.3 MB / 8.0 MB  [Cancel]
  ```
- On completion: manifest.json updated → category appears in sidebar automatically → no page refresh needed
- If download interrupted/cancelled: partial file deleted, manifest NOT updated

---

## MANAGE SPACE Panel (Always Available)

When user clicks "🗑 MANAGE SPACE":

```
┌────────────────────────────────────────────────────────────┐
│  🗑  MANAGE SPACE                                           │
│  Drive usage: ████░░░░░░░░░░░  16.2 MB used                │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  📖 Holy Bible                             16.2 MB  [−]   │
│     ✓ KJV Bible (King James, 1611)          4.2 MB  [🗑]  │
│     ✓ WEB Bible (World English)             4.1 MB  [🗑]  │
│     ✓ ASV Bible (American Standard)         3.9 MB  [🗑]  │
│     ✓ YLT Bible (Young's Literal)           3.8 MB  [🗑]  │
│                                                            │
│  ☠ Survival Manuals                        42.0 MB  [−]   │
│     ✓ Army FM 21-76 Survival Manual        12.0 MB  [🗑]  │
│     ✓ FEMA Are You Ready Guide              6.0 MB  [🗑]  │
│     ...                                                    │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

**Manage behavior:**
- `[−]` collapses the category file list
- `[🗑]` on a FILE → confirmation dialog → deletes file → manifest updated → if category now empty, it disappears from the sidebar
- `[🗑]` on a CATEGORY header → confirmation "Remove all N files in [Category]?" → deletes all → category vanishes from sidebar
- NO multi-select checkboxes — individual or whole-pack, keeps it simple and non-technical

**Confirmation dialog:**
```
  ⚠ Remove "KJV Bible"?
  This will permanently delete this file from your drive.
  You can re-download it later if you have internet.
  [Cancel]  [Remove File]
```

---

## What Requires a Custom Local Server

**The critical issue:** `python3 -m http.server` is READ-ONLY. It cannot write or delete files. To support downloading TO disk and deleting files FROM disk, we need a custom local server.

### The Solution: `scripts/server.py` (~120 lines, zero dependencies)

Replaces `python3 -m http.server 8080` in both START_MAC.command and START_WINDOWS.bat.

```python
# Endpoints:
GET  /content/*           → serve static files (same as now)
GET  /api/manifest        → return manifest.json  
DELETE /api/files?path=…  → delete file from disk + update manifest
POST /api/download        → {url, dest} → stream file to disk + update manifest
GET  /api/download/status → {progress, total, done}
```

This is a direct drop-in replacement. Same startup time. No pip installs. No Node. No npm.

---

## What's Pre-Loaded vs. Downloadable

**Pre-loaded at assembly (always on the drive, no download needed):**
- The 4 Bible translations (KJV, WEB, ASV, YLT)
- Survival Manuals (Army FM 21-76, FM 3-05.70, FEMA, EPA, USDA)
- Medical (Where There Is No Doctor, Dentist, Midwives)
- Philosophy (Meditations, Enchiridion, Art of War)
- Law (US Constitution, Declaration, UN UDHR, Black's Law)

**Available via GET MORE (optional, internet required):**
- Bible Commentary Pack (Matthew Henry, Strongs)
- Extended Medical Pack (Merck Manual, field surgery)
- Ham Radio & Comms Pack
- Homestead & Agriculture Pack (deep archive)
- Wikipedia ZIM slices (very large — warn user)

---

## Implementation Phases

### V1 (Implement Now — No Server Changes)
- [ ] Fix sidebar: hide categories with 0 manifest files (MOST URGENT — currently broken)
- [ ] Add "⬇ GET MORE" to sidebar, hidden when offline (`navigator.onLine === false`)
- [ ] Add "🗑 MANAGE SPACE" to sidebar, always visible
- [ ] GET MORE panel: shows available packs from a static `library_extended.json` catalog
  - Download buttons show but clicking opens a "coming soon" or browser-download fallback
- [ ] MANAGE SPACE panel: shows disk usage per category/file
  - Delete buttons show but clicking shows "requires drive update" message
- [ ] These panels establish the full UI so V2 just wires up the backend

### V2 (After Server Upgrade)
- [ ] Write `scripts/server.py` — custom Python HTTP server (GET, DELETE, POST /api/download)
- [ ] Update START_MAC.command + START_WINDOWS.bat to use server.py instead of http.server
- [ ] Wire DELETE endpoint to 🗑 buttons in MANAGE SPACE panel
- [ ] Wire POST /api/download to ⬇ DOWNLOAD buttons in GET MORE panel
- [ ] Add download progress bar (polling GET /api/download/status)
- [ ] Pack completion: auto-add category to sidebar, auto-update manifest

---

## Open Questions for User

1. **What packs should be available in GET MORE?** The ones I listed (Bible Commentary, Extended Medical, Ham Radio, Homestead) — any others to add or remove?

2. **Should GET MORE packs be free or paid?** If paid, we need a license key system in V2. If free, just CDN downloads.

3. **Drive space indicator:** Should the MANAGE SPACE panel show total USB drive capacity (requires OS API) or just DOOMSDAY.AI content size (simpler, pure JS)? Simpler is better for V1.

4. **Confirm V1 approach:** I build the full UI shell for GET MORE and MANAGE SPACE now (no working backend), then wire it up in V2 when the custom server is ready?
