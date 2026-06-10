#!/bin/bash
# ============================================================
# THE BLACKOUT DRIVE — Download Content Library Script
# ============================================================
# Downloads the curated offline survival knowledge base:
#
#   1. Wikipedia (survival/medicine/wilderness subset via Kiwix)
#   2. Wiktionary mini (offline dictionary)
#   3. US Army Survival Field Manuals (public domain PDFs)
#   4. FEMA Emergency Preparedness guides (public domain)
#   5. Hesperian Health Guides (free redistribution)
#   6. USDA canning/food preservation guides (public domain)
#   7. EPA emergency water treatment (public domain)
#   8. Field Medicine Guides
#
# Run once during drive assembly.
# Output: drive/content/zim/   — Kiwix ZIM archives
#         drive/content/books/ — PDF survival library
# ============================================================

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
DRIVE_DIR="$SCRIPT_DIR/../drive/_system"
CONTENT_DIR="$DRIVE_DIR/content"
ZIM_DIR="$CONTENT_DIR/zim"
BOOKS_DIR="$CONTENT_DIR/books"

# Load config
source "$DRIVE_DIR/config.sh"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

echo ""
echo -e "${YELLOW}  THE BLACKOUT DRIVE — Download Content Library${NC}"
echo "  ============================================="
echo ""

mkdir -p "$ZIM_DIR" "$BOOKS_DIR"

# ── Helper functions ─────────────────────────────────────────
download_file() {
    local NAME="$1"
    local URL="$2"
    local DEST="$3"
    local EXPECTED_MB="$4"

    if [ -f "$DEST" ]; then
        local SIZE=$(du -sh "$DEST" | cut -f1)
        echo -e "  ${GREEN}[SKIP]${NC} Already downloaded: $(basename $DEST) ($SIZE)"
        return 0
    fi

    echo -e "  ${CYAN}[DOWNLOAD]${NC} $NAME (~${EXPECTED_MB}MB)..."
    curl -fL --progress-bar "$URL" -o "$DEST"

    if [ -f "$DEST" ]; then
        local SIZE=$(du -sh "$DEST" | cut -f1)
        echo -e "  ${GREEN}[OK]${NC} $NAME → $(basename $DEST) ($SIZE)"
    else
        echo -e "  ${RED}[FAIL]${NC} Failed to download: $NAME"
        echo "         URL: $URL"
        echo "         Continuing with remaining downloads..."
    fi
}

# ============================================================
# SECTION 1: KIWIX ZIM ARCHIVES (DEFERRED TO V2)
# ============================================================
# ZIM archives are not used in V1 — no ZIM reader is currently
# implemented. These downloads have been disabled to avoid
# stale URL errors and wasted bandwidth (~2.2GB).
#
# When V2 "Offline Wikipedia" feature ships, update the URLs
# from https://library.kiwix.org and re-enable.
echo -e "  ${BOLD}── ZIM Archives ─────────────────────────────────────${NC}"
echo -e "  ${YELLOW}[SKIP]${NC} ZIM downloads deferred to V2 (no reader in V1)"

echo ""

# ============================================================
# SECTION 2: US GOVERNMENT PUBLIC DOMAIN PDFs
# ============================================================
echo -e "  ${BOLD}── US Government Survival Manuals (Public Domain) ───${NC}"
echo ""

# US Army FM 21-76 Survival Manual (1992)
download_file \
    "US Army FM 21-76 Survival Manual" \
    "https://www.bits.de/NRANEU/others/amd-us-archive/FM21-76%281992%29.pdf" \
    "$BOOKS_DIR/army_fm21-76_survival_1992.pdf" \
    "12"

# US Army FM 3-05.70 Survival (2002) — updated version
download_file \
    "US Army FM 3-05.70 Survival" \
    "https://armypubs.army.mil/epubs/DR_pubs/DR_a/pdf/web/fm3_05x70.pdf" \
    "$BOOKS_DIR/army_fm3-05-70_survival_2002.pdf" \
    "8"

# FEMA "Are You Ready?" Guide
download_file \
    "FEMA Are You Ready Guide" \
    "https://www.ready.gov/sites/default/files/2020-03/ready_are-you-ready-guide.pdf" \
    "$BOOKS_DIR/fema_are_you_ready.pdf" \
    "6"

# FEMA Community Emergency Response Team (CERT) Guide
download_file \
    "FEMA CERT Training Guide" \
    "https://www.ready.gov/sites/default/files/2021-06/cert-basic-training-unit-1_disaster-preparedness.pdf" \
    "$BOOKS_DIR/fema_cert_training.pdf" \
    "4"

# USDA National Center for Home Food Preservation Guide
download_file \
    "USDA Complete Guide to Home Canning" \
    "https://nchfp.uga.edu/publications/publications_usda.html" \
    "$BOOKS_DIR/usda_home_canning_complete.pdf" \
    "5"

echo ""

# ============================================================
# SECTION 3: HESPERIAN HEALTH GUIDES
# ============================================================
echo -e "  ${BOLD}── Hesperian Health Guides (Free Redistribution) ────${NC}"
echo ""

# Field Medicine Guides (Hesperian Foundation - free download)
download_file \
    "Field Medicine Guide (Hesperian)" \
    "https://hesperian.org/wp-content/uploads/pdf/en_wtnd_2011/en_wtnd_2011.pdf" \
    "$BOOKS_DIR/field_medicine_guide.pdf" \
    "15"

# Emergency Dental Guides
download_file \
    "Emergency Dental Guide (Hesperian)" \
    "https://hesperian.org/wp-content/uploads/pdf/en_wtnd_2011/en_wtind_2005.pdf" \
    "$BOOKS_DIR/emergency_dental_guide.pdf" \
    "8"

# "A Book for Midwives" — obstetric emergencies
download_file \
    "A Book for Midwives (Hesperian)" \
    "https://hesperian.org/wp-content/uploads/pdf/en_mw_2009/en_mw_2009.pdf" \
    "$BOOKS_DIR/book_for_midwives.pdf" \
    "12"

echo ""

# ============================================================
# SECTION 4: ADDITIONAL REFERENCE
# ============================================================
echo -e "  ${BOLD}── Additional Reference Documents ─────────────────────${NC}"
echo ""

# EPA Emergency Disinfection of Drinking Water
download_file \
    "EPA Emergency Water Disinfection" \
    "https://www.epa.gov/sites/default/files/2015-09/documents/emergency_disinfection.pdf" \
    "$BOOKS_DIR/epa_emergency_water_disinfection.pdf" \
    "1"

# Red Cross First Aid Manual (reference — check latest link)
download_file \
    "Red Cross First Aid Pocket Guide" \
    "https://www.redcross.org/content/dam/redcross/atg/PDF_s/Preparedness___Disaster_Recovery/General_Preparedness___Recovery/Home/ARC_Family_Disaster_Plan_Template_r083012.pdf" \
    "$BOOKS_DIR/redcross_family_disaster_plan.pdf" \
    "2"

echo ""


# ============================================================
# SECTION 5: RELIGIOUS TEXTS (PUBLIC DOMAIN)
# ============================================================
# Legal basis:
#   King James Version (KJV, 1611)  — published 1611, public domain in the US
#   World English Bible (WEB)       — explicitly dedicated to the public domain
#   American Standard Version (ASV) — published 1901, public domain
#
# Source: Project Gutenberg (https://www.gutenberg.org)
# No royalties, no restrictions, free redistribution permitted.
# ============================================================
echo -e "  ${BOLD}── Religious Texts (Public Domain) ────────────────────${NC}"
echo ""

# King James Bible (KJV) — Plain Text from Project Gutenberg
# Ebook #10 = King James Bible (most downloaded text on Gutenberg)
download_file \
    "King James Bible (KJV) — Project Gutenberg" \
    "https://www.gutenberg.org/cache/epub/10/pg10.txt" \
    "$BOOKS_DIR/bible_kjv.txt" \
    "5"

# World English Bible (WEB) — Modern English, explicitly Public Domain
download_file \
    "World English Bible (WEB)" \
    "https://www.gutenberg.org/cache/epub/72674/pg72674.txt" \
    "$BOOKS_DIR/bible_web.txt" \
    "5"

# American Standard Version (ASV, 1901) — Project Gutenberg
download_file \
    "American Standard Version (ASV, 1901)" \
    "https://www.gutenberg.org/cache/epub/9182/pg9182.txt" \
    "$BOOKS_DIR/bible_asv.txt" \
    "5"

echo ""


# ── More Bible translations ───────────────────────────────
# Young's Literal Translation (YLT, 1862) — hyper-literal, PD
download_file \
    "Young's Literal Translation (YLT, 1862)" \
    "https://www.gutenberg.org/cache/epub/1895/pg1895.txt" \
    "$BOOKS_DIR/bible_ylt.txt" \
    "5"

# ── Other Religious Texts ─────────────────────────────────




echo ""

# ============================================================
# SECTION 6: PHILOSOPHY & WISDOM (PUBLIC DOMAIN)
# ============================================================
echo -e "  ${BOLD}── Philosophy & Wisdom (Public Domain) ────────────────${NC}"
echo ""

# Meditations — Marcus Aurelius (PD)
download_file \
    "Meditations — Marcus Aurelius" \
    "https://www.gutenberg.org/cache/epub/2680/pg2680.txt" \
    "$BOOKS_DIR/meditations_marcus_aurelius.txt" \
    "1"

# Enchiridion — Epictetus (PD)
download_file \
    "Enchiridion — Epictetus" \
    "https://www.gutenberg.org/cache/epub/45109/pg45109.txt" \
    "$BOOKS_DIR/enchiridion_epictetus.txt" \
    "1"

# The Art of War — Sun Tzu (PD)
download_file \
    "The Art of War — Sun Tzu" \
    "https://www.gutenberg.org/cache/epub/132/pg132.txt" \
    "$BOOKS_DIR/art_of_war.txt" \
    "1"

echo ""

# ============================================================
# SECTION 7: LAW & FOUNDING DOCUMENTS (PUBLIC DOMAIN)
# ============================================================
echo -e "  ${BOLD}── Law & Founding Documents (Public Domain) ───────────${NC}"
echo ""

# US Constitution + Bill of Rights (from Gutenberg)
download_file \
    "US Constitution & Bill of Rights" \
    "https://www.gutenberg.org/cache/epub/5/pg5.txt" \
    "$BOOKS_DIR/us_constitution.txt" \
    "1"

# Declaration of Independence
download_file \
    "Declaration of Independence (1776)" \
    "https://www.gutenberg.org/cache/epub/1/pg1.txt" \
    "$BOOKS_DIR/declaration_of_independence.txt" \
    "1"

# UN Universal Declaration of Human Rights
download_file \
    "UN Universal Declaration of Human Rights" \
    "https://www.gutenberg.org/cache/epub/10000/pg10000.txt" \
    "$BOOKS_DIR/un_declaration_human_rights.txt" \
    "1"

# Black's Law Dictionary (1910 — public domain)
download_file \
    "Black's Law Dictionary (1910 Edition)" \
    "https://www.gutenberg.org/cache/epub/22559/pg22559.txt" \
    "$BOOKS_DIR/blacks_law_dictionary_1910.txt" \
    "5"

echo ""

# ============================================================
# SUMMARY
# ============================================================
echo "  ============================================="
echo -e "  ${GREEN}CONTENT LIBRARY DOWNLOAD COMPLETE${NC}"
echo ""
echo "  ZIM archives:"
ls -lh "$ZIM_DIR"/*.zim 2>/dev/null | awk '{print "    " $NF " (" $5 ")"}' || echo "    (none downloaded)"
echo ""
echo "  PDF books:"
ls -lh "$BOOKS_DIR"/*.pdf 2>/dev/null | awk '{print "    " $NF " (" $5 ")"}' || echo "    (none downloaded)"
echo ""
echo "  Total content size:"
du -sh "$CONTENT_DIR" 2>/dev/null | awk '{print "    " $1}'
echo "  ============================================="
echo ""
echo -e "  ${CYAN}[NEXT]${NC} Run: scripts/setup_drive.sh  (final assembly)"
echo ""
