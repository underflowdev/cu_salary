# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Working Rules

- After completing any task, update this file to reflect the current state of the project (new files, removed files, changed architecture or conventions).

## Project Overview

Scrape, store, and visualize salary data from the [CU salary database](https://www.cu.edu/budget/cu-salary-database).

## Directory Layout

```
scraper/   # Python scraper
data/      # CSV output from scraper
site/      # Static D3.js visualization
```

## Architecture

Three loosely coupled components:

### Scraper
- Language: Python
- Targets the CU salary database public page via HTTP POST (pagination required)
- Runs locally; may move to AWS Lambda later — keep I/O side-effect-free and easily extractable
- Rate limit: no more than 1 request per second
- Persists the current page number so interrupted runs resume without re-fetching already-scraped pages
- Writes parsed rows to `data/` after each page (not raw responses)
- Venv: `.venv/` at repo root (Python 3.12); activate with `source .venv/bin/activate`
- Install deps: `pip install -r scraper/requirements.txt && pip install playwright Pillow && playwright install chromium`
- Run: `python scraper/scraper.py`

### Data Layer
- CSV files in `data/`, one file per scrape run or per year (TBD)
- Schema mirrors the columns in the CU salary database table; additional columns may be added as needed
- Design with a future migration to SQLite in mind: keep data access behind a thin abstraction, but do not build the SQLite layer yet

### Visualization
- Static multi-page D3.js site (MPA, not SPA)
- Entry point: a responsive grid gallery (`site/index.html`) linking to individual visualizations; cards use `auto-fill minmax(240px)` grid layout with thumbnail on top and text below
- Data transformation happens client-side in JavaScript
- All data paths use `/cu/` prefix to match production. Local dev requires symlinks: `ln -s site cu && ln -s ../data cu/data`, then serve from repo root at `http://localhost:8080/cu/`
- Deploy: `scripts/deploy.sh` — syncs `site/` → `s3://underflow.dev/cu/` and `data/` → `s3://underflow.dev/cu/data/`
- Thumbnails: `source .venv/bin/activate && python3 scripts/make_thumbs.py` — Playwright script that screenshots each vis page and saves 640×360 PNGs to `site/img/thumbs/`
- Production root: `https://underflow.dev/cu`

#### Target Display
- Optimized for large desktop screens; no mobile/responsive requirement

#### Page Layout (all visualization pages share this structure)
- **Header**: title and secondary/subtitle text
- **Main area**: large D3 display with left and right margin columns for annotation
- **Footer**: large section for elaboration/explanatory text

#### Existing Visualizations

All salaries are COL-adjusted (divided by `cost_of_living` from `metadata.json`) before display. Wage threshold markers are shown per-campus as short horizontal dashes; values are `wage × 2080 / cost_of_living`.

**Wage markers** (consistent across all charts): poverty `#e05252 "3,3"`, min wage `#e0a052 "6,3"`, living wage `#52b052 "9,3"`, median county wage `#9b7fd4 "12,3"`. Living wage label reads "Living wage (1 adult)" — figures are for 1 adult, 0 children. Sources: MIT Living Wage Calculator; U.S. Census Bureau (median county wage).

**`metadata.json`** (`data/metadata.json`, served at `/cu/data/metadata.json`) — per-campus COL index and wage thresholds. Keys: `boulder`, `anschutz`, `colorado_springs`, `denver`, `system_administration`. Each entry: `cost_of_living`, `city`, `county`, `living_wage_1_adult_0_children`, `poverty_wage`, `minimum_wage`, `median_wage`.

**Campus overview:**
- `vis/salary-by-campus-ft.html` + `js/salary-by-campus-ft.js` — jittered strip chart, full-time employees only (`full_time_pct === "100"`); salary on Y, campus on X (alphabetical left-to-right); box-and-whisker overlay (de-emphasized); left margin: n / COL / Q1 / median / Q3; right margin: wage threshold legend + sources; header checkbox toggles COL adjustment on/off and re-renders without reloading data; raw data held at module scope, COL applied inside `draw()` based on checkbox state

**All-campuses strip chart:**
- `vis/all-campuses-strip.html` + `js/all-campuses-strip.js` — jittered strip chart, all campuses pooled; COL-adjusted per campus before pooling; X-axis = job_family sorted by median descending; X-axis labels colored by job family (Tableau10); box-and-whisker overlay; wage thresholds = average COL-adjusted across all campuses; dots `opacity=0.25` (lower than per-campus charts due to density); left margin: total n / family count; right margin: threshold legend with dollar amounts + sources

**All-campuses bubble charts:**
- `vis/all-campuses-bubble.html` + `js/all-campuses-bubble.js` — one bubble per job family, all campuses pooled; COL-adjusted per campus before pooling; wage thresholds = average COL-adjusted across all campuses; right margin: n / family count + threshold legend with dollar amounts
- `vis/multi-campus-bubble.html` + `js/multi-campus-bubble.js` — one bubble per (campus × job family); campus columns share a Y axis (median COL-adjusted salary); campuses always displayed alphabetically left-to-right (Anschutz, Boulder, Colorado Springs, Denver, System Admin); per-column wage marker dashes (`markerHalfW = xScale.step() * 0.44`); force: `forceX` toward campus center (strength=0.3), `forceY` toward salary target (strength=0.4), 300 ticks

**All-campuses department charts:**
- `vis/all-depts-strip.html` + `js/all-depts-strip.js` — jittered strip + box/whisker by `dept_name`; all campuses pooled, COL-adjusted per campus; MIN_N=5 (system-wide FTE headcount); same-named depts at different campuses merged; wage thresholds = average COL-adjusted; STEP_PX=28; scrolls horizontally; left margin: n / dept count; right margin: threshold legend + sources
- `vis/all-depts-bubble.html` + `js/all-depts-bubble.js` — one bubble per `dept_name` system-wide; MIN_N=55; rScale range [8, 90]; 600 force ticks; dynamic SVG expansion post-simulation; tooltip on hover; labels inside bubbles r > 20; wage thresholds = average COL-adjusted; right margin: n / dept count + threshold legend + sources

**Per-campus bubble chart (shared JS, one HTML per campus):**
- `js/campus-bubble.js` — reads `data-campus-key` / `data-campus-label` from `<body>` dataset; one bubble per job family; bubble area ∝ headcount (`scaleSqrt`, range 9–90); Y position = median COL-adjusted salary; force simulation runs synchronously (200 ticks, no animation); labels inside bubbles with r > 20; right margin: city/COL/n/family count + sources
- Force layout: `forceCollide(r+2, strength=0.85, iterations=2)` + `forceX` toward center (strength=0.04) + `forceY` toward salary target (strength=0.4)
- HTML pages: `vis/campus-boulder-bubble.html`, `vis/campus-anschutz-bubble.html`, `vis/campus-denver-bubble.html`, `vis/campus-colorado-springs-bubble.html`, `vis/campus-system-administration-bubble.html`
- Boulder page previously used `js/campus-boulder-bubble.js` (now deleted in favor of shared script)

**Per-campus detail (shared JS, one HTML per campus):**
- `js/salary-by-jobfamily.js` — reads `data-campus-key` / `data-campus-label` from `<body>` dataset; X-axis = job_family sorted by median descending; X-axis labels colored by job family (Tableau10); malformed rows excluded by numeric `full_time_pct` filter; full-width wage threshold lines; right margin: threshold legend with dollar amounts + sources
- `vis/campus-boulder.html`, `vis/campus-anschutz.html`, `vis/campus-denver.html`, `vis/campus-colorado-springs.html`, `vis/campus-system-administration.html`
- Detail pages use `grid-template-columns: 130px 1fr 150px` (narrower margins than the CSS default `200px 1fr 200px`)

**Per-campus department strip chart (shared JS, one HTML per campus):**
- `js/campus-dept.js` — reads `data-campus-key` / `data-campus-label` from `<body>` dataset; jittered strip + box/whisker by `dept_name`; MIN_N=10 filter; STEP_PX=28; SVG width = groups.length × STEP_PX; `#vis-display` scrolls horizontally; X-axis labels rotated −55°; left margin: campus label / COL / n / dept count; right margin: wage threshold legend + sources
- HTML pages: `vis/boulder-dept.html`, `vis/anschutz-dept.html`, `vis/colorado-springs-dept.html`, `vis/denver-dept.html`, `vis/system-administration-dept.html`
- Legacy `js/boulder-dept.js` kept as reference but pages now use the shared script

**Per-campus Regular Faculty department strip chart (shared JS, one HTML per campus):**
- `js/campus-faculty-dept.js` — reads `data-campus-key` / `data-campus-label` from `<body>` dataset; filters `job_family === "Regular Faculty"` and `full_time_pct === "100"`; jittered strip + box/whisker by `dept_name`; MIN_N=5; STEP_PX=28; scrolls horizontally; +n outlier label above whisker fence; left margin: campus/COL/n/dept count; right margin: threshold legend + sources
- HTML pages: `vis/boulder-faculty-dept.html`, `vis/anschutz-faculty-dept.html`, `vis/colorado-springs-faculty-dept.html`, `vis/denver-faculty-dept.html`
- System Administration excluded (no Regular Faculty records)
- Legacy `js/boulder-faculty-dept.js` kept as reference but pages now use the shared script

**Per-campus department bubble chart (shared JS, one HTML per campus):**
- `js/campus-dept-bubble.js` — reads `data-campus-key` / `data-campus-label` from `<body>` dataset; one bubble per `dept_name`; MIN_N=10; rScale range [8, 90]; 600 force ticks; dynamic SVG expansion post-simulation; tooltip on hover (dept, n, Q1/med/Q3); labels inside bubbles with r > 20
- HTML pages: `vis/boulder-dept-bubble.html`, `vis/anschutz-dept-bubble.html`, `vis/colorado-springs-dept-bubble.html`, `vis/denver-dept-bubble.html`, `vis/system-administration-dept-bubble.html`
- Legacy `js/boulder-dept-bubble.js` kept as reference but pages now use the shared script

**Per-campus scatter: salary vs. job family size (shared JS, one HTML per campus):**
- `js/campus-scatter.js` — reads `data-campus-key` / `data-campus-label` from `<body>` dataset; one dot per job family; X = headcount, Y = median COL-adjusted salary; IQR bars; tooltip on hover; right margin: campus label / COL / n / family count + wage threshold legend + sources
- HTML pages: `vis/boulder-scatter.html`, `vis/anschutz-scatter.html`, `vis/colorado-springs-scatter.html`, `vis/denver-scatter.html`, `vis/system-administration-scatter.html`
- Legacy `js/boulder-scatter.js` kept as reference but pages now use the shared script

**Box-and-whisker style (all charts):** dots `r=1.5, opacity=0.35`; whiskers `stroke-width=1.5, opacity=0.6`; IQR box `fill-opacity=0.12, stroke-width=1.5, opacity=0.75`; median `stroke="#fff", stroke-width=2, opacity=0.75`.

#### Scraper / Data notes
- Caspio POST endpoint: `https://c0afw245.caspio.com/dp/8cf13000191ba30d2c0840c68269`
- Campus filter values (POST field `Value1_1`): `BOULDER`, `UCCS`, `SYSTEM`, `DENVER`, `ANSCHUTZ`
- CSV columns: `campus, dept_group, dept_group_detail, dept_name, roster_id, job_title, job_family, full_time_pct, total, empl_record`
- `total` field is formatted as `"$127,600.00"` — strip `$` and `,` before parsing
- Some rows are malformed (column shift due to unquoted commas in dept names); these have non-numeric `full_time_pct` values and are naturally excluded by the `=== "100"` filter
- Pagination: POST field `CPIpage=N`, `cbCurrentPageSize=100`; Caspio returns two `of N` patterns in HTML — the larger one is total records, the smaller is total pages; `total_pages()` takes the max
