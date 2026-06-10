#!/usr/bin/env python3
"""
build_text_index.py — Extract plaintext from all EPUBs on the drive.
Creates content/text_index.json used by the search API for library-aware chat.

Usage:
    python3 scripts/build_text_index.py /path/to/drive/_system
"""

import json
import os
import re
import sys
import zipfile
from html.parser import HTMLParser


class HTMLStripper(HTMLParser):
    """Strip HTML tags, return plaintext."""
    def __init__(self):
        super().__init__()
        self.result = []
        self._skip = False

    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style'):
            self._skip = True

    def handle_endtag(self, tag):
        if tag in ('script', 'style'):
            self._skip = False
        if tag in ('p', 'div', 'br', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'tr'):
            self.result.append('\n')

    def handle_data(self, data):
        if not self._skip:
            self.result.append(data)

    def get_text(self):
        return ''.join(self.result)


def strip_html(html_str):
    s = HTMLStripper()
    s.feed(html_str)
    text = s.get_text()
    # Collapse whitespace
    text = re.sub(r'[ \t]+', ' ', text)
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text.strip()


def chunk_text(text, max_words=400):
    """Split text into chunks of ~max_words words, breaking at paragraph boundaries."""
    paragraphs = text.split('\n\n')
    chunks = []
    current = []
    word_count = 0

    for para in paragraphs:
        para = para.strip()
        if not para:
            continue
        words = len(para.split())
        if word_count + words > max_words and current:
            chunks.append('\n\n'.join(current))
            current = [para]
            word_count = words
        else:
            current.append(para)
            word_count += words

    if current:
        chunks.append('\n\n'.join(current))

    return chunks


GUTENBERG_SKIP = re.compile(
    r'project\s+gutenberg|gutenberg\s+license|'
    r'this ebook is for the use of anyone|'
    r'produced by|'
    r'\*\*\*\s*(start|end)\s+of',
    re.IGNORECASE
)


def extract_epub(epub_path):
    """Extract text from an EPUB, returning title and list of {chapter, text} chunks."""
    try:
        z = zipfile.ZipFile(epub_path)
    except Exception as e:
        print(f"  ⚠ Cannot open: {e}")
        return None

    # Find rootfile
    try:
        container = z.read('META-INF/container.xml').decode('utf-8')
        m = re.search(r'full-path="([^"]+)"', container)
        if not m:
            return None
        root_path = m.group(1)
        base_path = os.path.dirname(root_path)
    except Exception:
        return None

    # Parse OPF for manifest + spine
    try:
        opf = z.read(root_path).decode('utf-8')
    except Exception:
        return None

    # Extract title
    title_match = re.search(r'<dc:title[^>]*>([^<]+)</dc:title>', opf)
    title = title_match.group(1).strip() if title_match else os.path.basename(epub_path)

    # Build manifest
    manifest = {}
    for m in re.finditer(r'<item\s+[^>]*id="([^"]+)"[^>]*href="([^"]+)"[^>]*media-type="([^"]+)"', opf):
        manifest[m.group(1)] = {'href': m.group(2), 'type': m.group(3)}
    # Handle reversed attribute order
    for m in re.finditer(r'<item\s+[^>]*href="([^"]+)"[^>]*id="([^"]+)"[^>]*media-type="([^"]+)"', opf):
        manifest[m.group(2)] = {'href': m.group(1), 'type': m.group(3)}

    # Build spine
    spine = []
    for m in re.finditer(r'<itemref\s+idref="([^"]+)"', opf):
        if m.group(1) in manifest:
            spine.append(manifest[m.group(1)]['href'])

    # Parse NCX for chapter labels
    chapter_labels = {}
    ncx_entry = None
    for mid, info in manifest.items():
        if info['type'] == 'application/x-dtbncx+xml':
            ncx_entry = info['href']
            break

    if ncx_entry:
        try:
            ncx_path = os.path.join(base_path, ncx_entry) if base_path else ncx_entry
            ncx_xml = z.read(ncx_path).decode('utf-8')
            for m in re.finditer(
                r'<navPoint[^>]*>.*?<navLabel>\s*<text>([^<]+)</text>.*?<content\s+src="([^"]+)"',
                ncx_xml, re.DOTALL
            ):
                label = m.group(1).strip()
                src = m.group(2).split('#')[0]  # strip fragment
                if src not in chapter_labels:
                    chapter_labels[src] = label
        except Exception:
            pass

    # Extract text from each spine item
    all_chunks = []
    for href in spine:
        full_path = os.path.join(base_path, href) if base_path else href
        try:
            html = z.read(full_path).decode('utf-8', errors='replace')
        except Exception:
            continue

        text = strip_html(html)
        if not text or len(text) < 50:
            continue

        # Skip Gutenberg boilerplate pages
        if GUTENBERG_SKIP.search(text[:500]) and len(text) < 2000:
            continue

        chapter_name = chapter_labels.get(href, href)
        chunks = chunk_text(text)

        for i, chunk in enumerate(chunks):
            # Skip chunks that are mostly boilerplate
            if GUTENBERG_SKIP.search(chunk) and len(chunk) < 500:
                continue
            all_chunks.append({
                'chapter': chapter_name,
                'text': chunk[:2000]  # safety cap
            })

    z.close()
    return {'title': title, 'chunks': all_chunks}


def extract_txt(txt_path):
    """Extract text from a plain .txt file, returning title and list of chunks."""
    try:
        with open(txt_path, 'r', encoding='utf-8', errors='replace') as f:
            text = f.read()
    except Exception as e:
        print(f"  ⚠ Cannot read: {e}")
        return None

    if not text or len(text) < 50:
        return None

    title = os.path.splitext(os.path.basename(txt_path))[0].replace('_', ' ').title()
    chunks = chunk_text(text)
    all_chunks = []
    for i, chunk in enumerate(chunks):
        all_chunks.append({
            'chapter': f'Section {i+1}',
            'text': chunk[:2000]
        })
    return {'title': title, 'chunks': all_chunks}


def main():
    if len(sys.argv) < 2:
        print("Usage: python3 build_text_index.py /path/to/drive/_system")
        sys.exit(1)

    base = sys.argv[1]
    books_dir = os.path.join(base, 'content', 'books')
    out_path = os.path.join(base, 'content', 'text_index.json')

    # Also check for user content (lives at drive root level: ../USER_DATA/content/)
    drive_root = os.path.dirname(base)  # go up from _system to drive root
    user_dir = os.path.join(drive_root, 'USER_DATA', 'content')

    if not os.path.isdir(books_dir):
        print(f"Books directory not found: {books_dir}")
        sys.exit(1)

    # Walk ALL subdirectories to find EPUBs and TXT files
    files_to_index = []
    for dirpath, dirnames, filenames in os.walk(books_dir):
        dirnames[:] = sorted(d for d in dirnames if not d.startswith('.'))
        for fname in sorted(filenames):
            if fname.startswith('.'):
                continue
            ext = os.path.splitext(fname)[1].lower()
            if ext in ('.epub', '.txt'):
                rel = os.path.relpath(os.path.join(dirpath, fname), base)
                files_to_index.append((os.path.join(dirpath, fname), rel, ext))

    # Also walk user content directory
    if os.path.isdir(user_dir):
        for dirpath, dirnames, filenames in os.walk(user_dir):
            dirnames[:] = sorted(d for d in dirnames if not d.startswith('.'))
            for fname in sorted(filenames):
                if fname.startswith('.') or fname == '.gitkeep':
                    continue
                ext = os.path.splitext(fname)[1].lower()
                if ext in ('.epub', '.txt'):
                    # User files get a USER_DATA/content/ prefix
                    rel = 'USER_DATA/content/' + os.path.relpath(os.path.join(dirpath, fname), user_dir)
                    files_to_index.append((os.path.join(dirpath, fname), rel, ext))

    print(f"Building text index from {len(files_to_index)} files...")

    index = {'books': []}
    total_chunks = 0

    for full_path, rel_path, ext in files_to_index:
        fname = os.path.basename(full_path)
        print(f"  {rel_path}...", end='')
        if ext == '.epub':
            result = extract_epub(full_path)
        elif ext == '.txt':
            result = extract_txt(full_path)
        else:
            result = None

        if result:
            index['books'].append({
                'title': result['title'],
                'file': rel_path,
                'chunks': result['chunks']
            })
            print(f" {len(result['chunks'])} chunks")
            total_chunks += len(result['chunks'])
        else:
            print(" SKIPPED")

    with open(out_path, 'w') as f:
        json.dump(index, f, ensure_ascii=False)

    size_kb = os.path.getsize(out_path) // 1024
    print(f"\n✓ Index written: {out_path}")
    print(f"  {len(index['books'])} books, {total_chunks} chunks, {size_kb} KB")


if __name__ == '__main__':
    main()

