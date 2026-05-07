# DOOMSDAY.AI — Full Audit Findings & Fix Plan
## Date: 2026-05-07

---

## ISSUE LIST (Priority Order)

### 🔴 CRITICAL — Functional Bugs

| # | Screen | Issue | Fix |
|---|--------|-------|-----|
| C1 | Library overview | Category card is huge/wasteful — shows just title + description with tons of empty space | Redesign as compact info card with hover effect |
| C2 | Holy Bible view | Shows "Four public domain translations…KJV, WEB, ASV, and YLT" but manifest only has 1 file — misleading description | Dynamic description from manifest count |
| C3 | Bible file list | Only 1 item when catalog says 4 — remaining 3 Bible translations are not downloaded, but nothing tells user that | Show all 4 with clear "not downloaded / get it in GET MORE" state |
| C4 | Bible reader | chapter progress bar "X / Y" doesn't update when using jump feature | Fix: update after renderBibleChapterView |
| C5 | Library sidebar | "Holy Bible" has a badge that shows "0" not "1" | Fix count badge logic |
| C6 | Chat | The messages area has too much empty space when there are only 1-2 messages — content starts at very top, feels off | Add proper padding/centering or let messages anchor to bottom |
| C7 | Chat | Numbered list items have no spacing between them (crowded) | Already CSS was set to 1px margin — need a bit more for ol items specifically |

### 🟠 HIGH — UX Problems

| # | Screen | Issue | Fix |
|---|--------|-------|-----|
| H1 | Library overview | Category grid cards don't look clickable — no hover effect visible | Add visible hover state |
| H2 | Library sidebar | "ON THIS DRIVE" text is barely visible — too dim | Brighten sidebar section label |
| H3 | Library sidebar | No visual divider visible between categories and GET MORE/MANAGE SPACE | Fix divider style |
| H4 | Bible reader | Sidebar book list text is extremely small and dim | Increase font size and brightness |
| H5 | Bible reader | No way to see which book is currently active in sidebar at a glance when scrolled | Sticky/highlighted active state |
| H6 | Bible reader | Bottom nav prev/next buttons are hard to see | Make them more prominent |
| H7 | Chat | Messages from user and AI have too much vertical gap between them | Reduce message gap |
| H8 | Chat | The disclaimer footer at bottom is hardcoded "not a substitute for emergency services. Call 911" — wrong branding | Remove or make configurable |
| H9 | Library | Category page header shows description says 4 translations but only 1 is available — confusing | Fix to reflect reality |
| H10 | GET MORE | Pack cards look flat — no visual hierarchy between pack name and description | Improve card typography |

### 🟡 MEDIUM — Visual Polish

| # | Screen | Issue | Fix |
|---|--------|-------|-----|
| M1 | All library | Secondary text (sizes, licenses, meta) is very dim monospace — barely readable | Lighten to at least 50% opacity |
| M2 | Library file list | File items have no hover effect | Add hover state |
| M3 | Bible reader | Verse numbers are same size as text — should be smaller/dimmer superscripts | Style verse numbers |
| M4 | Bible reader | No visual chapter title separator | Add chapter heading style |
| M5 | Chat | User message bubble has no tailwind-like visual weight — looks plain | Polish bubble styling |
| M6 | Chat | "DOOMSDAY.AI" sender label above each assistant message is redundant noise | Remove or make much smaller |
| M7 | Main | The "× CLEAR" button is awkward next to LIBRARY | Make it less prominent, maybe icon-only |
| M8 | Library | Library panel has no transition when opening — jarring | Add smooth slide/fade in |
| M9 | Bible reader | Jump search input placeholder text "e.g. John 3:16" is in wrong color | Fix placeholder color |
| M10 | MANAGE SPACE | Disk usage bar is 6px tall and hard to perceive | Make it 10px with better label |

### 🟢 ENHANCEMENT — Nice to Have

| # | Feature | Description |
|---|---------|-------------|
| E1 | Chat | "Typing" indicator with animated dots during AI generation |
| E2 | Chat | Auto-scroll to bottom on new message (may already work but verify) |
| E3 | Chat | Keyboard shortcut help in input placeholder |
| E4 | Library | Remember last opened category/file on re-open |
| E5 | Bible | Verse copy button (copy verse text to clipboard) |
| E6 | Welcome | Show suggested prompts that ACTUALLY SEND when clicked |
| E7 | Chat | Smooth scroll when new messages arrive |
| E8 | Library | Search across all library content |

---

## Fix Priority for This Session (All Critical + High)

1. Fix chat message spacing and list formatting
2. Fix footer disclaimer text
3. Fix library category card UX (hover, click affordance)
4. Fix sidebar label visibility + divider
5. Fix Bible sidebar readability
6. Fix category descriptions to reflect actual downloaded files
7. Fix Bible chapter progress indicator after jump
8. Fix file items to show all 4 Bible versions (present + not downloaded)
9. Polish Bible reader verse styling
10. Improve overall visual density and readability

