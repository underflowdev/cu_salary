// Jittered strip chart: full-time employees only (full_time_pct === "100").
// Paths use /cu/ prefix; for local dev create a symlink: ln -s site cu && ln -s ../data cu/data

const FILES = {
  "CU Anschutz":            "/cu/data/2026_anschutz.csv",
  "CU Boulder":             "/cu/data/2026_boulder.csv",
  "CU Colorado Springs":    "/cu/data/2026_colorado_springs.csv",
  "CU Denver":              "/cu/data/2026_denver.csv",
  "System Administration":  "/cu/data/2026_system_administration.csv",
};

const CAMPUS_ORDER = Object.keys(FILES);

// Maps display label → key in metadata.json
const CAMPUS_META_KEY = {
  "CU Anschutz":           "anschutz",
  "CU Boulder":            "boulder",
  "CU Colorado Springs":   "colorado_springs",
  "CU Denver":             "denver",
  "System Administration": "system_administration",
};

const HOURS_PER_YEAR = 2080;

const COLOR = d3.scaleOrdinal()
  .domain(CAMPUS_ORDER)
  .range(["#76b7b2", "#4e79a7", "#f28e2b", "#e15759", "#59a14f"]);

function parseSalary(s) {
  return parseFloat((s || "").replace(/[$,]/g, "")) || 0;
}

// ── Load metadata + all CSVs ─────────────────────────────────────────────────

Promise.all([
  d3.json("/cu/data/metadata.json"),
  ...Object.entries(FILES).map(([label, path]) =>
    d3.csv(path).then(rows => rows
      .filter(r => r.full_time_pct === "100")
      .map(r => ({ campus: label, salary: parseSalary(r.total) }))
    )
  ),
]).then(([metaJson, ...chunks]) => {
  const rawMeta = metaJson.metadata;
  const campusMeta = Object.fromEntries(
    CAMPUS_ORDER.map(label => [label, rawMeta[CAMPUS_META_KEY[label]]])
  );
  const data = chunks.flat()
    .filter(d => d.salary > 0)
    .map(d => ({ ...d, salary: d.salary / campusMeta[d.campus].cost_of_living }));
  draw(data, campusMeta);
});

// ── Draw ─────────────────────────────────────────────────────────────────────

function draw(data, campusMeta) {
  const container = document.getElementById("vis-display");
  const W = container.clientWidth  || 900;
  const H = container.clientHeight || 640;

  const margin = { top: 40, right: 20, bottom: 60, left: 80 };
  const innerW = W - margin.left - margin.right;
  const innerH = H - margin.top  - margin.bottom;

  // ── Stats (computed before scales — Q3 values set the y-axis top) ─────────

  const stats = d3.rollup(data, v => {
    const sorted  = v.map(d => d.salary).sort(d3.ascending);
    const q1      = d3.quantile(sorted, 0.25);
    const med     = d3.quantile(sorted, 0.50);
    const q3      = d3.quantile(sorted, 0.75);
    const iqr     = q3 - q1;
    const lo      = d3.min(sorted.filter(s => s >= q1 - 1.5 * iqr));
    const hi      = d3.max(sorted.filter(s => s <= q3 + 1.5 * iqr));
    const n_above = sorted.filter(s => s > hi).length;
    return { q1, med, q3, lo, hi, n_above, count: sorted.length };
  }, d => d.campus);

  const maxQ3 = d3.max(CAMPUS_ORDER, c => stats.get(c)?.q3 ?? 0);

  // ── Scales ─────────────────────────────────────────────────────────────────

  const xScale = d3.scalePoint()
    .domain(CAMPUS_ORDER)
    .range([0, innerW])
    .padding(0.5);

  const yScale = d3.scaleLinear()
    .domain([0, maxQ3 * 1.15])
    .range([innerH, 0])
    .nice();

  const yTop = yScale.domain()[1];

  const bandwidth = xScale.step() * 0.35;  // jitter half-width
  const jitter = d3.randomUniform(-bandwidth, bandwidth);

  const svg = d3.select("#vis-display").append("svg")
    .attr("width",  W)
    .attr("height", H);

  const g = svg.append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  // ── Axes ────────────────────────────────────────────────────────────────────

  g.append("g")
    .attr("transform", `translate(0,${innerH})`)
    .call(d3.axisBottom(xScale))
    .call(ax => ax.select(".domain").remove())
    .selectAll("text")
      .style("font-size", "13px")
      .style("fill", d => COLOR(d));

  g.append("g")
    .call(
      d3.axisLeft(yScale)
        .ticks(8)
        .tickFormat(d => "$" + d3.format(",.0f")(d))
    )
    .call(ax => ax.select(".domain").remove())
    .call(ax => ax.selectAll(".tick line")
      .clone().attr("x2", innerW).attr("stroke", "#2a2a2a"))
    .selectAll("text")
      .style("font-size", "11px")
      .style("fill", "#aaa");

  // Y axis label
  g.append("text")
    .attr("transform", "rotate(-90)")
    .attr("x", -innerH / 2)
    .attr("y", -65)
    .attr("text-anchor", "middle")
    .style("fill", "#888")
    .style("font-size", "12px")
    .text("COL-Adjusted Annual Salary");

  // ── Dots (only salary ≤ group Q3) ───────────────────────────────────────

  g.append("g")
    .selectAll("circle")
    .data(d3.shuffle([...data]).filter(d => d.salary <= (stats.get(d.campus)?.hi ?? Infinity)))
    .join("circle")
      .attr("cx", d => xScale(d.campus) + jitter())
      .attr("cy", d => yScale(d.salary))
      .attr("r", 1.5)
      .attr("fill", d => COLOR(d.campus))
      .attr("opacity", 0.35);

  // ── Box and whisker overlays ─────────────────────────────────────────────

  const boxW     = bandwidth * 1.1;
  const whiskerW = boxW * 0.45;

  CAMPUS_ORDER.forEach(campus => {
    const s = stats.get(campus);
    if (!s) return;
    const x     = xScale(campus);
    const color = COLOR(campus);

    // Lower whisker
    g.append("line")
      .attr("x1", x).attr("x2", x)
      .attr("y1", yScale(s.lo)).attr("y2", yScale(s.q1))
      .attr("stroke", color).attr("stroke-width", 1.5).attr("opacity", 0.6);

    // Lower fence cap
    g.append("line")
      .attr("x1", x - whiskerW).attr("x2", x + whiskerW)
      .attr("y1", yScale(s.lo)).attr("y2", yScale(s.lo))
      .attr("stroke", color).attr("stroke-width", 1.5).attr("opacity", 0.6);

    // Upper whisker — capped at yTop
    const hiDrawn = Math.min(s.hi, yTop);
    g.append("line")
      .attr("x1", x).attr("x2", x)
      .attr("y1", yScale(s.q3)).attr("y2", yScale(hiDrawn))
      .attr("stroke", color).attr("stroke-width", 1.5).attr("opacity", 0.6);

    // Upper fence cap — only if within chart
    if (s.hi <= yTop) {
      g.append("line")
        .attr("x1", x - whiskerW).attr("x2", x + whiskerW)
        .attr("y1", yScale(s.hi)).attr("y2", yScale(s.hi))
        .attr("stroke", color).attr("stroke-width", 1.5).attr("opacity", 0.6);
    }

    // IQR box
    g.append("rect")
      .attr("x", x - boxW)
      .attr("y", yScale(s.q3))
      .attr("width", boxW * 2)
      .attr("height", yScale(s.q1) - yScale(s.q3))
      .attr("fill", color).attr("fill-opacity", 0.12)
      .attr("stroke", color).attr("stroke-width", 1.5).attr("opacity", 0.75);

    // Median line
    g.append("line")
      .attr("x1", x - boxW).attr("x2", x + boxW)
      .attr("y1", yScale(s.med)).attr("y2", yScale(s.med))
      .attr("stroke", "#fff").attr("stroke-width", 2).attr("opacity", 0.75);

    // "+n" label above the upper whisker fence
    if (s.n_above > 0) {
      g.append("text")
        .attr("transform", `translate(${x}, ${yScale(hiDrawn) - 4}) rotate(-90)`)
        .attr("text-anchor", "start")
        .attr("dominant-baseline", "middle")
        .style("font-size", "9px")
        .style("fill", color)
        .style("opacity", 0.8)
        .text(`+${s.n_above}`);
    }
  });

  // ── Wage threshold markers ───────────────────────────────────────────────
  // Values are COL-adjusted (wage × 2080 ÷ COL) to match the Y axis scale.

  const WAGE_MARKERS = [
    { key: "living_wage_1_adult_0_children",  label: "Living wage (1 adult)",  color: "#52b052", dash: "9,3"  },
    { key: "median_wage",                     label: "Median county wage",      color: "#9b7fd4", dash: "12,3" },
  ];

  const markerHalfW = xScale.step() * 0.44;

  CAMPUS_ORDER.forEach(campus => {
    const m = campusMeta[campus];
    const x = xScale(campus);

    WAGE_MARKERS.forEach(({ key, color, dash }) => {
      const val = m[key] * HOURS_PER_YEAR / m.cost_of_living;
      if (val > yTop) return;
      g.append("line")
        .attr("x1", x - markerHalfW).attr("x2", x + markerHalfW)
        .attr("y1", yScale(val)).attr("y2", yScale(val))
        .attr("stroke", color)
        .attr("stroke-width", 1.5)
        .attr("stroke-dasharray", dash)
        .attr("opacity", 0.85);
    });
  });

  // ── Annotation sidebar ────────────────────────────────────────────────────

  const fmt = d3.format(",.0f");
  const leftSide = document.getElementById("annotation-left") ||
                   document.querySelector("#margin-left");
  if (leftSide) {
    leftSide.innerHTML = CAMPUS_ORDER.map(campus => {
      const s = stats.get(campus);
      const m = campusMeta[campus];
      if (!s) return "";
      return `<div style="margin-bottom:1.4rem;">
        <div style="color:${COLOR(campus)};font-weight:bold;margin-bottom:0.3rem;">${campus}</div>
        <div style="font-size:0.78rem;color:#aaa;line-height:1.6;">
          n = ${d3.format(",")(s.count)}<br>
          COL ×${m.cost_of_living.toFixed(2)}<br>
          Q1 &nbsp;&nbsp;$${fmt(s.q1)}<br>
          med &nbsp;$${fmt(s.med)}<br>
          Q3 &nbsp;&nbsp;$${fmt(s.q3)}
        </div>
      </div>`;
    }).join("");
  }

  const rightSide = document.getElementById("annotation-right") ||
                    document.querySelector("#margin-right");
  if (rightSide) {
    rightSide.innerHTML = `
      <div style="font-size:0.8rem;color:#aaa;margin-bottom:0.6rem;font-weight:bold;">Wage thresholds</div>
      <div style="font-size:0.75rem;color:#aaa;line-height:1.8;">
        ${WAGE_MARKERS.map(({ label, color, dash }) => {
          const dashSvg = `<svg width="24" height="10" style="vertical-align:middle;margin-right:6px;">
            <line x1="0" y1="5" x2="24" y2="5" stroke="${color}" stroke-width="1.5"
              stroke-dasharray="${dash}"/></svg>`;
          return `<div>${dashSvg}${label}</div>`;
        }).join("")}
      </div>
      <div style="font-size:0.72rem;color:#555;margin-top:1rem;line-height:1.6;">
        Hourly wage × 2,080 hrs, COL-adjusted.<br><br>
        <strong style="color:#444;">Sources</strong><br>
        Salaries: <a href="https://www.cu.edu/budget/cu-salary-database" target="_blank" style="color:#555;">CU Salary Database</a><br>
        Cost of living: <a href="https://www.bestplaces.net/" target="_blank" style="color:#555;">BestPlaces.net</a><br>
        Wage thresholds: <a href="https://livingwage.mit.edu/" target="_blank" style="color:#555;">MIT Living Wage Calculator</a><br>
        Median wage: <a href="https://www.census.gov/" target="_blank" style="color:#555;">U.S. Census Bureau</a>
      </div>`;
  }
}
