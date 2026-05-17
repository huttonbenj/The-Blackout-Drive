#!/usr/bin/env python3
import os
import subprocess
import json

NPX = "/opt/homebrew/opt/node@24/bin/npx"
BUCKET = "blackout-drive-content"
BOOKS_DIR = "/Users/benjamin/github/The-Blackout-Drive/drive/_system/content/books"

CATEGORIES = {
    "bible": {"name": "The Bible", "description": "KJV, World English Bible, ASV, and Young's Literal Translation.", "icon": "", "price": 0},
    "heritage": {"name": "Foundational Wisdom & Western Heritage", "description": "Theological classics, philosophical pillars, and timeless texts for spiritual and intellectual resilience.", "icon": "", "price": 0},
    "medical": {"name": "Medical & First Aid", "description": "Field medicine, anatomy, nursing, and historical drug references.", "icon": "", "price": 0},
    "survival": {"name": "Survival & Field Craft", "description": "Wilderness survival, shelter building, knots, trapping, and woodcraft.", "icon": "", "price": 0},
    "homestead": {"name": "Homesteading & Agriculture", "description": "Off-grid farming, canning, herbalism, beekeeping, and self-sufficiency.", "icon": "", "price": 0},
    "engineering": {"name": "Engineering & Mechanics", "description": "Practical mechanics, machine-shop techniques, carpentry, and basic electricity.", "icon": "", "price": 0},
    "communication": {"name": "Communication & Navigation", "description": "Radio amateur guides, telegraphy, and celestial navigation.", "icon": "", "price": 0},
    "law": {"name": "Law & Founding Documents", "description": "US Constitution, Declaration of Independence, Magna Carta, Federalist Papers, Blackstone.", "icon": "", "price": 0},
}

def upload():
    print(f"Uploading from {BOOKS_DIR} to R2 bucket: {BUCKET}")
    
    for category in sorted(os.listdir(BOOKS_DIR)):
        cat_path = os.path.join(BOOKS_DIR, category)
        if not os.path.isdir(cat_path) or category.startswith('.'): continue
        
        print(f"\n── {category.upper()} ──")
        for f in sorted(os.listdir(cat_path)):
            if f.startswith('.'): continue
            
            file_path = os.path.join(cat_path, f)
            obj_key = f"{category}/{f}"
            
            ext = f.split('.')[-1].lower()
            content_type = "application/pdf" if ext == "pdf" else "application/epub+zip" if ext == "epub" else "text/plain"
            
            print(f"  ⬆ {f} ... ", end='', flush=True)
            cmd = [NPX, "wrangler", "r2", "object", "put", f"{BUCKET}/{obj_key}", "--file", file_path, "--content-type", content_type, "--remote"]
            res = subprocess.run(cmd, capture_output=True, text=True)
            if res.returncode == 0:
                print("OK")
            else:
                print(f"FAIL {res.stderr[:80]}")
                
        if category in CATEGORIES:
            meta = CATEGORIES[category]
            meta_json = json.dumps(meta)
            print(f"  ⬆ _meta.json ... ", end='', flush=True)
            
            meta_path = f"/tmp/{category}_meta.json"
            with open(meta_path, "w") as mf:
                mf.write(meta_json)
                
            cmd = [NPX, "wrangler", "r2", "object", "put", f"{BUCKET}/{category}/_meta.json", "--file", meta_path, "--content-type", "application/json", "--remote"]
            res = subprocess.run(cmd, capture_output=True, text=True)
            if res.returncode == 0:
                print("OK")
            else:
                print(f"FAIL {res.stderr[:80]}")

if __name__ == "__main__":
    upload()
