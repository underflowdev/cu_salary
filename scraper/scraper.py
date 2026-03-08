"""
Scraper for the CU Salary Database (Caspio-backed).
https://www.cu.edu/budget/cu-salary-database

POST endpoint: https://c0afw245.caspio.com/dp/8cf13000191ba30d2c0840c68269
Columns: CAMPUS, DEPT GROUP, DEPT GROUP DETAIL, DEPT NAME, ROSTER ID,
         JOB TITLE, JOB FAMILY, FULL-TIME %, TOTAL, EMPL RECORD

Progress is tracked in data/progress.json so interrupted runs resume
without re-fetching already-scraped pages.
"""

import csv
import json
import os
import re
import time
from datetime import date
from pathlib import Path

import requests
from bs4 import BeautifulSoup

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

CASPIO_URL = "https://c0afw245.caspio.com/dp/8cf13000191ba30d2c0840c68269"
APP_KEY = "8cf13000191ba30d2c0840c68269"
PAGE_SIZE = 100
RATE_LIMIT_SECONDS = 1.0  # play nice — no more than 1 request/sec

DATA_DIR = Path(__file__).parent.parent / "data"
DATA_DIR.mkdir(exist_ok=True)

# Keys are the POST values Caspio expects; values are used for filenames/display.
CAMPUSES = {
    "BOULDER": "boulder",
    "UCCS": "colorado_springs",
    "SYSTEM": "system_administration",
    "DENVER": "denver",
    "ANSCHUTZ": "anschutz",
}

CSV_COLUMNS = [
    "campus",
    "dept_group",
    "dept_group_detail",
    "dept_name",
    "roster_id",
    "job_title",
    "job_family",
    "full_time_pct",
    "total",
    "empl_record",
]

# ---------------------------------------------------------------------------
# Progress tracking
# ---------------------------------------------------------------------------

def progress_path() -> Path:
    return DATA_DIR / "progress.json"


def load_progress() -> dict:
    p = progress_path()
    if p.exists():
        return json.loads(p.read_text())
    return {}


def save_progress(progress: dict) -> None:
    progress_path().write_text(json.dumps(progress, indent=2))


# ---------------------------------------------------------------------------
# HTTP helpers
# ---------------------------------------------------------------------------

def _base_form(campus: str) -> dict:
    """Return the base POST fields for a campus search."""
    return {
        "cbUniqueFormId": "_18f8a5f7142eba",
        "FieldName1": "CAMPUS",
        "Operator1": "OR",
        "NumCriteriaDetails1": "1",
        "ComparisonType1_1": "LIKE",
        "MatchNull1_1": "N",
        "AppKey": APP_KEY,
        "PrevPageID": "2",
        "cbPageType": "Search",
        "ClientQueryString": "",
        "PageID": "2",
        "GlobalOperator": "AND",
        "NumCriteria": "1",
        "Search": "1",
        "Value1_1": campus,
        "searchID": "Search",
    }


def fetch_page(session: requests.Session, campus: str, page_num: int) -> str:
    """POST to Caspio and return raw HTML for the given campus page."""
    data = _base_form(campus)
    data["CPIpage"] = str(page_num)
    data["cbCurrentPageSize"] = str(PAGE_SIZE)

    resp = session.post(
        CASPIO_URL,
        data=data,
        headers={"User-Agent": "Mozilla/5.0"},
        timeout=30,
    )
    resp.raise_for_status()
    return resp.text


# ---------------------------------------------------------------------------
# Parsing
# ---------------------------------------------------------------------------

def parse_rows(html: str) -> list[dict]:
    """Extract data rows from a Caspio results page."""
    soup = BeautifulSoup(html, "html.parser")
    rows = []

    for tr in soup.find_all("tr"):
        cells = tr.find_all("td")
        if not cells:
            continue

        # Caspio renders each cell as "COLUMN:value" in a data attribute or text.
        # Fall back to positional parsing if the labelled format is present.
        cell_texts = [re.sub(r"\s+", " ", c.get_text()).strip() for c in cells]

        # Detect labelled format: "CAMPUS:CU Boulder"
        if cell_texts and ":" in cell_texts[0]:
            record = {}
            for text in cell_texts:
                if ":" in text:
                    key, _, val = text.partition(":")
                    col_map = {
                        "CAMPUS": "campus",
                        "DEPT GROUP": "dept_group",
                        "DEPT GROUP DETAIL": "dept_group_detail",
                        "DEPT NAME": "dept_name",
                        "ROSTER ID": "roster_id",
                        "JOB TITLE": "job_title",
                        "JOB FAMILY": "job_family",
                        "FULL-TIME %": "full_time_pct",
                        "TOTAL": "total",
                        "EMPL RECORD": "empl_record",
                    }
                    mapped = col_map.get(key.strip())
                    if mapped:
                        record[mapped] = val.strip()
            if record:
                rows.append(record)
        elif len(cell_texts) == len(CSV_COLUMNS):
            rows.append(dict(zip(CSV_COLUMNS, cell_texts)))

    return rows


def total_pages(html: str) -> int:
    """
    Extract total record count from HTML and calculate page count.
    Caspio renders two 'of N' values: page count (small) and record count (large).
    We take the maximum to get total records, then compute page count.
    Returns 1 if count cannot be determined.
    """
    matches = re.findall(r"of\s+([\d,]+)", html)
    if matches:
        total_records = max(int(m.replace(",", "")) for m in matches)
        return max(1, -(-total_records // PAGE_SIZE))  # ceiling division
    return 1


# ---------------------------------------------------------------------------
# CSV helpers
# ---------------------------------------------------------------------------

def csv_path(campus_key: str, year: str) -> Path:
    return DATA_DIR / f"{year}_{CAMPUSES[campus_key]}.csv"


def open_csv(path: Path, append: bool):
    """Open CSV file for writing or appending. Returns (file, writer)."""
    mode = "a" if append else "w"
    f = open(path, mode, newline="", encoding="utf-8")
    writer = csv.DictWriter(f, fieldnames=CSV_COLUMNS, extrasaction="ignore")
    if not append:
        writer.writeheader()
    return f, writer


# ---------------------------------------------------------------------------
# Main scrape loop
# ---------------------------------------------------------------------------

def scrape_campus(
    session: requests.Session,
    campus: str,
    year: str,
    progress: dict,
) -> None:
    label = CAMPUSES[campus]
    key = f"{year}_{label}"
    start_page = progress.get(key, {}).get("next_page", 1)

    if progress.get(key, {}).get("done"):
        print(f"  [{label}] already complete, skipping.")
        return

    path = csv_path(campus, year)
    append = start_page > 1
    f, writer = open_csv(path, append)

    try:
        page = start_page
        pages_total = None

        while True:
            print(f"  [{label}] page {page}" + (f"/{pages_total}" if pages_total else ""))
            html = fetch_page(session, campus, page)

            if pages_total is None:
                pages_total = total_pages(html)

            rows = parse_rows(html)
            if not rows:
                print(f"  [{label}] no rows on page {page}, stopping.")
                break

            writer.writerows(rows)
            f.flush()

            # Persist progress after each successful page
            progress[key] = {"next_page": page + 1, "done": False}
            save_progress(progress)

            if page >= pages_total:
                break

            page += 1
            time.sleep(RATE_LIMIT_SECONDS)

        progress[key] = {"next_page": page, "done": True}
        save_progress(progress)
        print(f"  [{label}] done.")

    finally:
        f.close()


def main() -> None:
    year = str(date.today().year)
    session = requests.Session()
    progress = load_progress()

    print(f"Scraping CU salary data for FY {year}...")
    for campus in CAMPUSES:
        scrape_campus(session, campus, year, progress)


    print("All campuses complete.")


if __name__ == "__main__":
    main()
