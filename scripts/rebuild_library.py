#!/usr/bin/env python3
import os
import sys
import json
import urllib.request
from pathlib import Path

# Setup paths
SCRIPT_DIR = Path(__file__).resolve().parent
BOOKS_DIR = SCRIPT_DIR.parent / "drive" / "_system" / "content" / "books"

LIBRARY = {
    "heritage": [
        ("art_of_war_suntzu.epub", "https://www.gutenberg.org/ebooks/132.epub.noimages"),
        ("confessions_of_augustine.epub", "https://www.gutenberg.org/ebooks/3296.epub.noimages"),
        ("enchiridion_epictetus.epub", "https://www.gutenberg.org/ebooks/45109.epub.noimages"),
        ("foxes_book_of_martyrs.epub", "https://www.gutenberg.org/ebooks/22400.epub.noimages"),
        ("imitation_of_christ.epub", "https://www.gutenberg.org/ebooks/1653.epub.noimages"),
        ("meditations_aurelius.epub", "https://www.gutenberg.org/ebooks/2680.epub.noimages"),
        ("orthodoxy_chesterton.epub", "https://www.gutenberg.org/ebooks/130.epub.noimages"),
        ("paradise_lost.epub", "https://www.gutenberg.org/ebooks/20.epub.noimages"),
        ("pilgrims_progress.epub", "https://www.gutenberg.org/ebooks/131.epub.noimages"),
        ("plato_republic.epub", "https://www.gutenberg.org/ebooks/1497.epub.noimages"),
        ("walden_thoreau.epub", "https://www.gutenberg.org/ebooks/205.epub.noimages")
    ],
    "medical": [
        ("mercks_1899_manual.epub", "https://www.gutenberg.org/ebooks/41697.epub.noimages"),
        ("notes_on_nursing.epub", "https://www.gutenberg.org/ebooks/12439.epub.noimages")
    ],
    "survival": [
        ("shelters_shacks_shanties.epub", "https://www.gutenberg.org/ebooks/28255.epub.noimages"),
        ("woodcraft_and_camping.epub", "https://www.gutenberg.org/ebooks/34607.epub.noimages"),
        ("camp_lore_and_woodcraft.epub", "https://www.gutenberg.org/ebooks/44215.epub.noimages"),
        ("knots_splices_rope_work.epub", "https://www.gutenberg.org/ebooks/13510.epub.noimages"),
        ("the_boy_mechanic.epub", "https://www.gutenberg.org/ebooks/12655.epub.noimages")
    ],
    "homestead": [
        ("american_frugal_housewife.epub", "https://www.gutenberg.org/ebooks/13493.epub.noimages"),
        ("compleat_herbal.epub", "https://www.gutenberg.org/ebooks/49513.epub.noimages"),
        ("farmers_of_forty_centuries.epub", "https://www.gutenberg.org/ebooks/5350.epub.noimages"),
        ("langstroth_beekeeping.epub", "https://www.gutenberg.org/ebooks/24583.epub.noimages"),
        ("manual_of_gardening.epub", "https://www.gutenberg.org/ebooks/9550.epub.noimages"),
        ("preservation_of_food_1919.epub", "https://www.gutenberg.org/ebooks/72831.epub.noimages"),
        ("ten_acres_enough.epub", "https://www.gutenberg.org/ebooks/48753.epub.noimages")
    ],
    "engineering": [
        ("boy_electrician.epub", "https://www.gutenberg.org/ebooks/63207.epub.noimages"),
        ("farm_mechanics.epub", "https://www.gutenberg.org/ebooks/39791.epub.noimages"),
        ("machine_shop_practice.epub", "https://www.gutenberg.org/ebooks/39225.epub.noimages"),
        ("practical_mechanics.epub", "https://www.gutenberg.org/ebooks/22298.epub.noimages"),
        ("woodwork_joints.epub", "https://www.gutenberg.org/ebooks/21531.epub.noimages")
    ],
    "communication": [
        ("radio_amateurs_handbook.epub", "https://www.gutenberg.org/ebooks/6934.epub.noimages")
    ],
    "law": [
        ("us_constitution.epub", "https://www.gutenberg.org/ebooks/5.epub.noimages"),
        ("declaration_of_independence.epub", "https://www.gutenberg.org/ebooks/1.epub.noimages"),
        ("federalist_papers.epub", "https://www.gutenberg.org/ebooks/1404.epub.noimages"),
        ("magna_carta.epub", "https://www.gutenberg.org/ebooks/65363.epub.noimages"),
        ("common_sense.epub", "https://www.gutenberg.org/ebooks/147.epub.noimages"),
        ("blackstones_commentaries.epub", "https://www.gutenberg.org/ebooks/30802.epub.noimages"),
        ("second_treatise_of_gov.epub", "https://www.gutenberg.org/ebooks/7370.epub.noimages")
    ]
}

def download_file(url, dest):
    if dest.exists():
        print(f"  [SKIP] {dest.name} already exists.")
        return True
    print(f"  [DOWNLOADING] {dest.name} ... ", end='', flush=True)
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    try:
        with urllib.request.urlopen(req) as response:
            with open(dest, 'wb') as f:
                f.write(response.read())
        print("✅ DONE")
        return True
    except Exception as e:
        print(f"❌ ERROR: {e}")
        return False

def main():
    print(f"\\nRebuilding The Blackout Drive Library (Target: {BOOKS_DIR})\\n")
    os.makedirs(BOOKS_DIR, exist_ok=True)
    
    total = 0
    success = 0
    
    for category, books in LIBRARY.items():
        cat_dir = BOOKS_DIR / category
        os.makedirs(cat_dir, exist_ok=True)
        
        print(f"── {category.upper()} ───────────────────────")
        for filename, url in books:
            total += 1
            dest = cat_dir / filename
            if download_file(url, dest):
                success += 1
        print("")

    print(f"\\nDownload summary: {success}/{total} successful.\\n")

if __name__ == "__main__":
    main()
