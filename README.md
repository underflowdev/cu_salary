# CU Salary

Scrape and visualize salary data from the [CU Salary Database](https://www.cu.edu/budget/cu-salary-database).

Live site: **https://underflow.dev/cu**

## What's here

| Directory | Purpose |
|-----------|---------|
| `scraper/` | Python scraper targeting the Caspio-backed CU salary database |
| `data/` | CSV output — one file per campus per year (e.g. `2026_boulder.csv`) |
| `site/` | Static D3.js visualization site |
| `scripts/` | Utility scripts (thumbnail generation, etc.) |

## Setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r scraper/requirements.txt
pip install playwright Pillow
playwright install chromium
```

## Scraper

Fetches all salary records via HTTP POST to Caspio, one page at a time (100 rows/page). Saves progress so interrupted runs resume where they left off.

```bash
source .venv/bin/activate
python scraper/scraper.py
```

Output goes to `data/`. The `total` salary field is formatted as `"$127,600.00"` — strip `$` and `,` before parsing.

## Visualization

Static MPA — one HTML file per chart, shared JS where possible. All data paths use the `/cu/` prefix to match production hosting at `underflow.dev/cu`.

**Local dev** — set up symlinks so paths resolve correctly, then serve from repo root:

```bash
ln -s site cu
ln -s ../data cu/data
python3 -m http.server 8080
# site: http://localhost:8080/cu/
```

**Deploy to S3:**

```bash
./scripts/deploy.sh
```

Syncs `site/` → `s3://underflow.dev/cu/` and `data/` → `s3://underflow.dev/cu/data/`. Requires `aws` CLI configured with appropriate credentials.

### Charts

**All campuses**
- Salary by Campus (full-time only) — jittered strip chart, one dot per employee, box-and-whisker overlay
- Salary by Job Family — all campuses pooled and COL-adjusted, strip chart by job family
- Salary Bubble Chart — one bubble per job family, area ∝ system-wide headcount, Y position = median salary
- Salary Bubble Chart Side by Side — campus columns sharing a common Y axis

**Per campus** (Anschutz, Boulder, Colorado Springs, Denver, System Administration)
- By Job Family — strip chart with box-and-whisker, sorted by median COL-adjusted salary
- Bubble Chart — one bubble per job family, area ∝ headcount, Y position = median salary

All salaries are COL-adjusted (divided by a cost-of-living index relative to national baseline, sourced from BestPlaces.net). Indices are stored in `metadata.json`.

### Thumbnails

```bash
source .venv/bin/activate
python3 scripts/make_thumbs.py
```

Screenshots every vis page with Playwright and saves 640×360 PNGs to `site/img/thumbs/`.

## Data notes

- Some rows are malformed due to unquoted commas in department names (column shift); these have non-numeric `full_time_pct` and are naturally excluded by filters.
- CSV columns: `campus, dept_group, dept_group_detail, dept_name, roster_id, job_title, job_family, full_time_pct, total, empl_record`
