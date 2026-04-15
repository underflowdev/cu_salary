// System-wide strip chart: one dot per employee, grouped by dept_name.
// All campuses pooled; COL adjustment toggled via header checkbox.
// Departments with fewer than MIN_N full-time employees (across all campuses) are excluded.

const FILES = {
  boulder:               "/cu/data/2026_boulder.csv",
  colorado_springs:      "/cu/data/2026_colorado_springs.csv",
  denver:                "/cu/data/2026_denver.csv",
  anschutz:              "/cu/data/2026_anschutz.csv",
  system_administration: "/cu/data/2026_system_administration.csv",
};

const HOURS_PER_YEAR = 2080;
const MIN_N          = 5;
const STEP_PX        = 28;

const WAGE_MARKERS = [
  { key: "living_wage_1_adult_0_children", label: "Living wage (1 adult)", color: "#52b052", dash: "9,3" },
  { key: "median_wage",                    label: "Median county wage",    color: "#9b7fd4", dash: "12,3" },
  { key: "minimum_wage",                   label: "Min. wage",             color: "#e0a052", dash: "6,3"  },
];

function parseSalary(s) {
  return parseFloat((s || "").replace(/[$,]/g, "")) || 0;
}

// ── Module state ─────────────────────────────────────────────────────────────

let rawData = null;
let metaAll = null;

// ── Load ─────────────────────────────────────────────────────────────────────

Promise.all([
  d3.json("/cu/data/metadata.json"),
  ...Object.entries(FILES).map(([key, path]) =>
    d3.csv(path).then(rows => ({ key, rows }))
  ),
]).then(([metaJson, ...chunks]) => {
  metaAll = metaJson.metadata;

  const rawAll = chunks.flatMap(({ key, rows }) =>
    rows
      .filter(r => r.full_time_pct === "100" && parseSalary(r.total) > 0)
      .map(r => ({ campusKey: key, dept: r.dept_name.trim(), rawSalary: parseSalary(r.total) }))
      .filter(d => d.dept)
  );

  const counts = d3.rollup(rawAll, v => v.length, d => d.dept);
  rawData = rawAll.filter(d => counts.get(d.dept) >= MIN_N);

  draw();
});

document.getElementById("col-toggle").addEventListener("change", () => {
  d3.select("#vis-display").selectAll("*").remove();
  draw();
});

document.getElementById("outlier-toggle").addEventListener("change", () => {
  d3.select("#vis-display").selectAll("*").remove();
  draw();
});

// ── Draw ─────────────────────────────────────────────────────────────────────

function draw() {
  const colAdjusted  = document.getElementById("col-toggle").checked;
  const showOutliers = document.getElementById("outlier-toggle").checked;

  const subtitle = document.getElementById("vis-subtitle");
  if (subtitle) {
    if (!subtitle.dataset.orig) subtitle.dataset.orig = subtitle.textContent;
    subtitle.textContent = colAdjusted
      ? subtitle.dataset.orig
      : subtitle.dataset.orig.replace(/COL-adjusted/gi, "unadjusted");
  }

  const data = rawData.map(d => ({
    ...d,
    salary: colAdjusted
      ? d.rawSalary / metaAll[d.campusKey].cost_of_living
      : d.rawSalary,
  }));

  const campusMetas = Object.values(metaAll);

  const groupMedians = d3.rollup(data, v => d3.median(v, d => d.salary), d => d.dept);
  const groups = [...groupMedians.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([g]) => g);

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
  }, d => d.dept);

  const maxQ3 = d3.max(groups, g => stats.get(g)?.q3 ?? 0);
  const yMax  = showOutliers
    ? d3.max(data, d => d.salary) * 1.05
    : maxQ3 * 1.15;

  const margin = { top: 40, right: 30, bottom: 140, left: 85 };
  const H      = document.getElementById("vis-display").clientHeight || 680;
  const innerH = H - margin.top - margin.bottom;
  const innerW = groups.length * STEP_PX;
  const W      = innerW + margin.left + margin.right;

  const COLOR = d3.scaleOrdinal(d3.schemeTableau10).domain(groups);

  const xScale = d3.scalePoint()
    .domain(groups).range([0, innerW]).padding(0.5);

  const yScale = d3.scaleLinear()
    .domain([0, yMax]).range([innerH, 0]).nice();

  const yTop = yScale.domain()[1];
  const bandwidth = xScale.step() * 0.3;
  const jitter    = d3.randomUniform(-bandwidth, bandwidth);

  const svg = d3.select("#vis-display").append("svg").attr("width", W).attr("height", H);
  const g   = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  g.append("g")
    .attr("transform", `translate(0,${innerH})`)
    .call(d3.axisBottom(xScale).tickSize(0).tickFormat(d => `${d} (${d3.format(",")(stats.get(d)?.count ?? 0)})`))
    .call(ax => ax.select(".domain").remove())
    .selectAll("text")
      .style("font-size", "9px").style("fill", d => COLOR(d))
      .attr("transform", "rotate(-55)").attr("text-anchor", "end")
      .attr("dx", "-0.4em").attr("dy", "0.6em");

  g.append("g")
    .call(d3.axisLeft(yScale).ticks(8).tickFormat(d => "$" + d3.format(",.0f")(d)))
    .call(ax => ax.select(".domain").remove())
    .call(ax => ax.selectAll(".tick line").clone().attr("x2", innerW).attr("stroke", "#2a2a2a"))
    .selectAll("text").style("font-size", "11px").style("fill", "#aaa");

  g.append("text")
    .attr("transform", "rotate(-90)").attr("x", -innerH / 2).attr("y", -68)
    .attr("text-anchor", "middle").style("fill", "#888").style("font-size", "12px")
    .text(colAdjusted ? "COL-Adjusted Annual Salary" : "Annual Salary");

  g.append("g")
    .selectAll("circle")
    .data(d3.shuffle([...data]).filter(d => showOutliers || d.salary <= (stats.get(d.dept)?.hi ?? Infinity)))
    .join("circle")
      .attr("cx", d => xScale(d.dept) + jitter()).attr("cy", d => yScale(d.salary))
      .attr("r", d => d.salary > (stats.get(d.dept)?.hi ?? Infinity) ? 3 : 1.5)
      .attr("fill", d => COLOR(d.dept)).attr("opacity", 0.25);

  const boxW = bandwidth * 1.1, whiskerW = boxW * 0.45;

  groups.forEach(dept => {
    const s = stats.get(dept);
    if (!s) return;
    const x = xScale(dept), color = COLOR(dept);

    g.append("line").attr("x1", x).attr("x2", x)
      .attr("y1", yScale(s.lo)).attr("y2", yScale(s.q1))
      .attr("stroke", color).attr("stroke-width", 1.5).attr("opacity", 0.6);
    g.append("line").attr("x1", x - whiskerW).attr("x2", x + whiskerW)
      .attr("y1", yScale(s.lo)).attr("y2", yScale(s.lo))
      .attr("stroke", color).attr("stroke-width", 1.5).attr("opacity", 0.6);

    const hiDrawn = Math.min(s.hi, yTop);
    g.append("line").attr("x1", x).attr("x2", x)
      .attr("y1", yScale(s.q3)).attr("y2", yScale(hiDrawn))
      .attr("stroke", color).attr("stroke-width", 1.5).attr("opacity", 0.6);
    if (s.hi <= yTop) {
      g.append("line").attr("x1", x - whiskerW).attr("x2", x + whiskerW)
        .attr("y1", yScale(s.hi)).attr("y2", yScale(s.hi))
        .attr("stroke", color).attr("stroke-width", 1.5).attr("opacity", 0.6);
    }

    g.append("rect")
      .attr("x", x - boxW).attr("y", yScale(s.q3))
      .attr("width", boxW * 2).attr("height", yScale(s.q1) - yScale(s.q3))
      .attr("fill", color).attr("fill-opacity", 0.12)
      .attr("stroke", color).attr("stroke-width", 1.5).attr("opacity", 0.75);
    g.append("line").attr("x1", x - boxW).attr("x2", x + boxW)
      .attr("y1", yScale(s.med)).attr("y2", yScale(s.med))
      .attr("stroke", "#fff").attr("stroke-width", 2).attr("opacity", 0.75);

    if (!showOutliers && s.n_above > 0) {
      g.append("text")
        .attr("transform", `translate(${x}, ${yScale(hiDrawn) - 4}) rotate(-90)`)
        .attr("text-anchor", "start").attr("dominant-baseline", "middle")
        .style("font-size", "9px").style("fill", color).style("opacity", 0.8)
        .text(`+${s.n_above}`);
    }
  });

  WAGE_MARKERS.forEach(({ key, color, dash }) => {
    const avg = colAdjusted
      ? d3.mean(campusMetas, m => m[key] * HOURS_PER_YEAR / m.cost_of_living)
      : d3.mean(campusMetas, m => m[key] * HOURS_PER_YEAR);
    if (avg > yTop) return;
    g.append("line")
      .attr("x1", 0).attr("x2", innerW)
      .attr("y1", yScale(avg)).attr("y2", yScale(avg))
      .attr("stroke", color).attr("stroke-width", 1.5)
      .attr("stroke-dasharray", dash).attr("opacity", 0.7);
  });

  const fmt      = d3.format(",.0f");
  const leftSide = document.getElementById("margin-left");
  if (leftSide) {
    leftSide.innerHTML = `
      <div style="font-size:0.8rem;color:#aaa;margin-bottom:1rem;">
        <div style="font-weight:bold;margin-bottom:0.4rem;">CU System</div>
        <div style="line-height:1.7;font-size:0.75rem;">
          All campuses<br>
          n = ${d3.format(",")(data.length)}<br>
          depts ≥ ${MIN_N} FTE: ${groups.length}
        </div>
      </div>`;
  }

  const rightSide = document.getElementById("margin-right");
  if (rightSide) {
    const poolNote = colAdjusted
      ? "Salary COL-adjusted per campus<br>before pooling. Thresholds are<br>averages across all campuses."
      : "Salaries not COL-adjusted;<br>pooled across campuses. Thresholds<br>are averages across campuses.";
    rightSide.innerHTML = `
      <div style="font-size:0.8rem;color:#aaa;margin-bottom:0.6rem;font-weight:bold;">Wage thresholds</div>
      <div style="font-size:0.75rem;color:#aaa;line-height:1.8;">
        ${WAGE_MARKERS.map(({ key, label, color, dash }) => {
          const avg = colAdjusted
            ? d3.mean(campusMetas, m => m[key] * HOURS_PER_YEAR / m.cost_of_living)
            : d3.mean(campusMetas, m => m[key] * HOURS_PER_YEAR);
          const svgEl = `<svg width="24" height="10" style="vertical-align:middle;margin-right:6px;">
            <line x1="0" y1="5" x2="24" y2="5" stroke="${color}" stroke-width="1.5"
              stroke-dasharray="${dash}"/></svg>`;
          return `<div>${svgEl}${label}<br><span style="font-size:0.7rem;color:#666;padding-left:30px;">~$${fmt(avg)}</span></div>`;
        }).join("")}
      </div>
      <div style="font-size:0.72rem;color:#555;margin-top:1rem;line-height:1.6;">
        ${poolNote}<br>
        Sorted by median.<br>
        +n above each column = pts<br>above whisker fence; toggle<br>"Show outliers" to display.<br>
        Depts with &lt; ${MIN_N} FTE excluded.<br><br>
        <strong style="color:#444;">Sources</strong><br>
        Salaries: <a href="https://www.cu.edu/budget/cu-salary-database" target="_blank" style="color:#555;">CU Salary Database</a><br>
        Cost of living: <a href="https://www.bestplaces.net/" target="_blank" style="color:#555;">BestPlaces.net</a><br>
        Wage thresholds: <a href="https://livingwage.mit.edu/" target="_blank" style="color:#555;">MIT Living Wage Calculator</a><br>
        Median wage: <a href="https://www.census.gov/" target="_blank" style="color:#555;">U.S. Census Bureau</a>
      </div>`;
  }
}
