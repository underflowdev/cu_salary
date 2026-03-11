// System-wide strip chart: one dot per employee, grouped by job family.
// All campuses pooled; each salary COL-adjusted by campus before aggregation.
// Dots above each group's Q3 are replaced by a vertical "+n" count label
// drawn just above the upper whisker fence. Y-axis is scaled to max(Q3) + padding.

const FILES = {
  boulder:               "/cu/data/2026_boulder.csv",
  colorado_springs:      "/cu/data/2026_colorado_springs.csv",
  denver:                "/cu/data/2026_denver.csv",
  anschutz:              "/cu/data/2026_anschutz.csv",
  system_administration: "/cu/data/2026_system_administration.csv",
};

const HOURS_PER_YEAR = 2080;

const WAGE_MARKERS = [
  { key: "living_wage_1_adult_0_children", label: "Living wage (1 adult)", color: "#52b052", dash: "9,3" },
  { key: "median_wage",                    label: "Median county wage",    color: "#9b7fd4", dash: "12,3" },
  { key: "minimum_wage",                   label: "Min. wage",             color: "#e0a052", dash: "6,3"  },
];

function parseSalary(s) {
  return parseFloat((s || "").replace(/[$,]/g, "")) || 0;
}

// ── Load ─────────────────────────────────────────────────────────────────────

Promise.all([
  d3.json("/cu/data/metadata.json"),
  ...Object.entries(FILES).map(([key, path]) =>
    d3.csv(path).then(rows => ({ key, rows }))
  ),
]).then(([metaJson, ...chunks]) => {
  const meta = metaJson.metadata;

  const data = chunks.flatMap(({ key, rows }) => {
    const col = meta[key].cost_of_living;
    return rows
      .filter(r => r.full_time_pct === "100" && parseSalary(r.total) > 0)
      .map(r => ({ family: r.job_family.trim(), salary: parseSalary(r.total) / col }))
      .filter(d => d.family);
  });

  draw(data, meta);
});

// ── Draw ─────────────────────────────────────────────────────────────────────

function draw(data, meta) {
  const container = document.getElementById("vis-display");
  const W = container.clientWidth  || 1200;
  const H = container.clientHeight || 680;

  const margin = { top: 40, right: 30, bottom: 110, left: 85 };
  const innerW = W - margin.left - margin.right;
  const innerH = H - margin.top  - margin.bottom;

  // Sort groups by median salary descending
  const groupMedians = d3.rollup(data, v => d3.median(v, d => d.salary), d => d.family);
  const groups = [...groupMedians.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([g]) => g);

  const COLOR = d3.scaleOrdinal(d3.schemeTableau10).domain(groups);

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
  }, d => d.family);

  const maxQ3 = d3.max(groups, g => stats.get(g)?.q3 ?? 0);

  // ── Scales ────────────────────────────────────────────────────────────────

  const xScale = d3.scalePoint()
    .domain(groups)
    .range([0, innerW])
    .padding(0.5);

  const yScale = d3.scaleLinear()
    .domain([0, maxQ3 * 1.15])
    .range([innerH, 0])
    .nice();

  const yTop = yScale.domain()[1];

  const bandwidth  = xScale.step() * 0.3;
  const jitter     = d3.randomUniform(-bandwidth, bandwidth);

  // ── Axes ──────────────────────────────────────────────────────────────────

  const svg = d3.select("#vis-display").append("svg")
    .attr("width",  W)
    .attr("height", H);

  const g = svg.append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  g.append("g")
    .attr("transform", `translate(0,${innerH})`)
    .call(d3.axisBottom(xScale).tickSize(0))
    .call(ax => ax.select(".domain").remove())
    .selectAll("text")
      .style("font-size", "11px")
      .style("fill", d => COLOR(d))
      .attr("transform", "rotate(-40)")
      .attr("text-anchor", "end")
      .attr("dx", "-0.4em")
      .attr("dy", "0.6em");

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

  g.append("text")
    .attr("transform", "rotate(-90)")
    .attr("x", -innerH / 2)
    .attr("y", -68)
    .attr("text-anchor", "middle")
    .style("fill", "#888")
    .style("font-size", "12px")
    .text("COL-Adjusted Annual Salary");

  // ── Dots (only salary ≤ group Q3) ────────────────────────────────────────

  g.append("g")
    .selectAll("circle")
    .data(d3.shuffle([...data]).filter(d => d.salary <= (stats.get(d.family)?.hi ?? Infinity)))
    .join("circle")
      .attr("cx", d => xScale(d.family) + jitter())
      .attr("cy", d => yScale(d.salary))
      .attr("r", 1.5)
      .attr("fill", d => COLOR(d.family))
      .attr("opacity", 0.25);

  // ── Box and whisker overlays ──────────────────────────────────────────────

  const boxW     = bandwidth * 1.1;
  const whiskerW = boxW * 0.45;

  groups.forEach(family => {
    const s = stats.get(family);
    if (!s) return;
    const x     = xScale(family);
    const color = COLOR(family);

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

  // ── Wage threshold lines (avg COL-adjusted, only if within y range) ───────

  const campusMetas = Object.values(meta);
  WAGE_MARKERS.forEach(({ key, color, dash }) => {
    const avg = d3.mean(campusMetas, m => m[key] * HOURS_PER_YEAR / m.cost_of_living);
    if (avg > yTop) return;
    const y = yScale(avg);
    g.append("line")
      .attr("x1", 0).attr("x2", innerW)
      .attr("y1", y).attr("y2", y)
      .attr("stroke", color).attr("stroke-width", 1.5)
      .attr("stroke-dasharray", dash).attr("opacity", 0.7);
  });

  // ── Annotations ───────────────────────────────────────────────────────────

  const fmt      = d3.format(",.0f");
  const leftSide = document.getElementById("margin-left");
  if (leftSide) {
    leftSide.innerHTML = `
      <div style="font-size:0.8rem;color:#aaa;margin-bottom:1rem;">
        <div style="font-weight:bold;margin-bottom:0.4rem;">CU System</div>
        <div style="line-height:1.7;font-size:0.75rem;">
          All campuses<br>
          n = ${d3.format(",")(data.length)}<br>
          ${groups.length} job families
        </div>
      </div>`;
  }

  const rightSide = document.getElementById("margin-right");
  if (rightSide) {
    rightSide.innerHTML = `
      <div style="font-size:0.8rem;color:#aaa;margin-bottom:0.6rem;font-weight:bold;">Wage thresholds</div>
      <div style="font-size:0.75rem;color:#aaa;line-height:1.8;">
        ${WAGE_MARKERS.map(({ key, label, color, dash }) => {
          const avg = d3.mean(campusMetas, m => m[key] * HOURS_PER_YEAR / m.cost_of_living);
          const svgEl = `<svg width="24" height="10" style="vertical-align:middle;margin-right:6px;">
            <line x1="0" y1="5" x2="24" y2="5" stroke="${color}" stroke-width="1.5"
              stroke-dasharray="${dash}"/></svg>`;
          return `<div>${svgEl}${label}<br><span style="font-size:0.7rem;color:#666;padding-left:30px;">~$${fmt(avg)}</span></div>`;
        }).join("")}
      </div>
      <div style="font-size:0.72rem;color:#555;margin-top:1rem;line-height:1.6;">
        Salary COL-adjusted per campus<br>before pooling. Thresholds are<br>averages across all campuses.<br>
        Groups sorted by median.<br>
        +n above each column = pts<br>above Q3 not drawn.<br><br>
        <strong style="color:#444;">Sources</strong><br>
        Salaries: <a href="https://www.cu.edu/budget/cu-salary-database" target="_blank" style="color:#555;">CU Salary Database</a><br>
        Cost of living: <a href="https://www.bestplaces.net/" target="_blank" style="color:#555;">BestPlaces.net</a><br>
        Wage thresholds: <a href="https://livingwage.mit.edu/" target="_blank" style="color:#555;">MIT Living Wage Calculator</a><br>
        Median wage: <a href="https://www.census.gov/" target="_blank" style="color:#555;">U.S. Census Bureau</a>
      </div>`;
  }
}
