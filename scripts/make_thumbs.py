#!/usr/bin/env python3
"""Screenshot each vis page and save a 16:9 thumbnail to site/img/thumbs/."""

import subprocess
import time
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

REPO   = Path(__file__).parent.parent
THUMBS = REPO / "site" / "img" / "thumbs"
PORT   = 8080
BASE   = f"http://localhost:{PORT}/site"

PAGES = [
    ("salary-by-campus-ft",               "vis/salary-by-campus-ft.html"),
    ("all-campuses-strip",                "vis/all-campuses-strip.html"),
    ("all-campuses-bubble",               "vis/all-campuses-bubble.html"),
    ("multi-campus-bubble",               "vis/multi-campus-bubble.html"),
    ("campus-boulder",                     "vis/campus-boulder.html"),
    ("campus-boulder-bubble",              "vis/campus-boulder-bubble.html"),
    ("campus-anschutz",                    "vis/campus-anschutz.html"),
    ("campus-anschutz-bubble",             "vis/campus-anschutz-bubble.html"),
    ("campus-denver",                      "vis/campus-denver.html"),
    ("campus-denver-bubble",               "vis/campus-denver-bubble.html"),
    ("campus-colorado-springs",            "vis/campus-colorado-springs.html"),
    ("campus-colorado-springs-bubble",     "vis/campus-colorado-springs-bubble.html"),
    ("campus-system-administration",       "vis/campus-system-administration.html"),
    ("campus-system-administration-bubble","vis/campus-system-administration-bubble.html"),
]

THUMB_W = 640
THUMB_H = 360   # 16:9

def main():
    THUMBS.mkdir(parents=True, exist_ok=True)

    # Start HTTP server
    server = subprocess.Popen(
        ["python3", "-m", "http.server", str(PORT)],
        cwd=REPO,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    time.sleep(1)

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page(viewport={"width": 1400, "height": 800})

            for slug, path in PAGES:
                url = f"{BASE}/{path}"
                out = THUMBS / f"{slug}.png"
                print(f"  {slug}...", end=" ", flush=True)

                page.goto(url)
                # Wait for the SVG to appear inside #vis-display
                page.wait_for_selector("#vis-display svg", timeout=15000)
                # Small extra pause for any post-render work
                page.wait_for_timeout(300)

                element = page.query_selector("#vis-display")
                element.screenshot(path=str(out))

                # Resize to thumbnail using Playwright's clip isn't needed —
                # we screenshot the element directly, then resize with PIL if available
                print(f"saved ({out.stat().st_size // 1024}KB)")

            browser.close()
    finally:
        server.terminate()

    # Optionally resize with Pillow if installed
    try:
        from PIL import Image
        print("\nResizing to 640×360...")
        for slug, _ in PAGES:
            p = THUMBS / f"{slug}.png"
            img = Image.open(p)
            img = img.resize((THUMB_W, THUMB_H), Image.LANCZOS)
            img.save(p, optimize=True)
            print(f"  {slug}.png → {THUMB_W}×{THUMB_H}")
    except ImportError:
        print("\nPillow not installed — thumbnails are full element size (install with: pip install Pillow)")

    print("\nDone.")

if __name__ == "__main__":
    main()
