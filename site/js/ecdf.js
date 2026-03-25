// ECDF: one line per campus, X = salary, Y = fraction of employees below that value.
// Full-time employees only. COL adjustment toggled via header checkbox.

const CAMPUSES = [
  { key: "anschutz",              label: "CU Anschutz",         color: "#76b7b2" },
  { key: "boulder",               label: "CU Boulder",          color: "#4e79a7" },
  { key: "colorado_springs",      label: "CU Colorado Springs", color: "#f28e2b" },
  { key: "denver",                label: "CU Denver",           color: "#e15759" },
  { key: "system_administration", label: "System Admin",        color: "#59a14f" },
];

const FILES = {
  anschutz:              "/cu/data/2026_anschutz.csv",
  boulder:               "/cu/data/2026_boulder.csv",
  colorado_springs:      "/cu/data/2026_colorado_springs.csv",
  denver:                "/cu/data/2026_denver.csv",
  system_administration: "/cu/data/2026_system_administration.csv",
};

const HOURS_PER_YEAR = 2080;

const WAGE_MARKERS = [
  { key: "living_wage_1_adult_0_children", label: "Living wage (1 adult)", color: "#52b052", dash: "9,3"  },
  { key: "median_wage",                    label: "Median county wage",    color: "#9b7fd4", dash: "12,3" },
  { key: "minimum_wage",                   label: "Min. wage",             color: "#e0a052", dash: "6,3"  },
];

function parseSalary(s) {
  return parseFloat((s || "").replace(/[$,]/g, "")) || 0;
}

// ── Module state ─────────────────────────────────────────────────────────────

let rawCampusData = null;  // [{ key, rawSalaries: [] }] — sorted ascending
let metaAll       = null;

// ── Load ─────────────────────────────────────────────────────────────────────

Promise.all([
  d3.json("/cu/data/metadata.json"),
  ...CAMPUSES.map(({ key }) =>
    d3.csv(FILES[key]).then(rows => ({ key, rows }))
  ),
]).then(([metaJson, ...chunks]) => {
  metaAll = metaJson.metadata;

  rawCampusData = chunks.map(({ key, rows }) => {
    const rawSalaries = rows
      .filter(r => r.full_time_pct === "100" && parseSalary(r.total) > 0)
      .map(r => parseSalary(r.total))
      .sort(d3.ascending);
    return { key, rawSalaries };
  });

  draw();
});

document.getElementById("col-toggle").addEventListener("change", () => {
  d3.select("#vis-display").selectAll("*").remove();
  d3.selectAll(".chart-tooltip").remove();
  draw();
});

// ── Draw ─────────────────────────────────────────────────────────────────────

function draw() {
  const colAdjusted = document.getElementById("col-toggle").checked;

  const subtitle = document.getElementById("vis-subtitle");
  if (subtitle) {
    if (!subtitle.dataset.orig) subtitle.dataset.orig = subtitle.textContent;
    subtitle.textContent = colAdjusted
      ? subtitle.dataset.orig
      : subtitle.dataset.orig.replace(/COL-adjusted/gi, "unadjusted");
  }

  // Apply (or skip) COL adjustment — rawSalaries already sorted, COL is constant per campus
  const campusData = rawCampusData.map(({ key, rawSalaries }) => ({
    key,
    salaries: colAdjusted
      ? rawSalaries.map(s => s / metaAll[key].cost_of_living)
      : rawSalaries.slice(),
  }));

  const campusMetas = CAMPUSES.map(c => metaAll[c.key]);

  const container = document.getElementById("vis-display");
  const W = container.clientWidth  || 1200;
  const H = container.clientHeight || 700;

  const margin = { top: 40, right: 30, bottom: 60, left: 90 };
  const innerW  = W - margin.left - margin.right;
  const innerH  = H - margin.top  - margin.bottom;

  const allSalaries = campusData.flatMap(d => d.salaries);
  const allSorted   = allSalaries.slice().sort(d3.ascending);
  const xMax        = d3.quantile(allSorted, 0.995);

  const xScale = d3.scaleLinear().domain([0, xMax]).range([0, innerW]).nice();
  const yScale = d3.scaleLinear().domain([0, 1]).range([innerH, 0]);

  const svg = d3.select("#vis-display").append("svg").attr("width", W).attr("height", H);
  const g   = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  g.append("g")
    .attr("transform", `translate(0,${innerH})`)
    .call(d3.axisBottom(xScale).ticks(10).tickFormat(d => "$" + d3.format(",.0f")(d)))
    .call(ax => ax.select(".domain").remove())
    .call(ax => ax.selectAll(".tick line").clone().attr("y2", -innerH).attr("stroke", "#2a2a2a"))
    .selectAll("text").style("font-size", "11px").style("fill", "#aaa");

  g.append("text")
    .attr("x", innerW / 2).attr("y", innerH + 48).attr("text-anchor", "middle")
    .style("fill", "#888").style("font-size", "12px")
    .text(colAdjusted ? "COL-Adjusted Annual Salary" : "Annual Salary");

  g.append("g")
    .call(d3.axisLeft(yScale).ticks(5).tickFormat(d3.format(".0%")))
    .call(ax => ax.select(".domain").remove())
    .call(ax => ax.selectAll(".tick line").clone().attr("x2", innerW).attr("stroke", "#2a2a2a"))
    .selectAll("text").style("font-size", "11px").style("fill", "#aaa");

  g.append("text")
    .attr("transform", "rotate(-90)").attr("x", -innerH / 2).attr("y", -72)
    .attr("text-anchor", "middle").style("fill", "#888").style("font-size", "12px")
    .text("Fraction of employees earning ≤ X");

  // Wage threshold vertical lines
  WAGE_MARKERS.forEach(({ key, color, dash }) => {
    const avg = colAdjusted
      ? d3.mean(campusMetas, m => m[key] * HOURS_PER_YEAR / m.cost_of_living)
      : d3.mean(campusMetas, m => m[key] * HOURS_PER_YEAR);
    const x = xScale(avg);
    g.append("line")
      .attr("x1", x).attr("x2", x).attr("y1", 0).attr("y2", innerH)
      .attr("stroke", color).attr("stroke-width", 1.5)
      .attr("stroke-dasharray", dash).attr("opacity", 0.7);
  });

  // ECDF lines
  const lineGen = d3.line()
    .x(d => xScale(d.salary)).y(d => yScale(d.pct)).curve(d3.curveLinear);

  const colorMap = Object.fromEntries(CAMPUSES.map(c => [c.key, c.color]));

  campusData.forEach(({ key, salaries }) => {
    const n = salaries.length;
    const points = salaries.map((s, i) => ({ salary: s, pct: (i + 1) / n }));
    points.unshift({ salary: 0, pct: 0 });
    g.append("path").datum(points)
      .attr("fill", "none").attr("stroke", colorMap[key])
      .attr("stroke-width", 2).attr("opacity", 0.85)
      .attr("d", lineGen);
  });

  // Crosshair + tooltip
  const tooltip = d3.select("body").append("div")
    .attr("class", "chart-tooltip")
    .style("position", "fixed").style("pointer-events", "none")
    .style("background", "#1c1c1c").style("border", "1px solid #444")
    .style("color", "#ddd").style("font-size", "0.8rem")
    .style("padding", "0.4rem 0.65rem").style("border-radius", "3px")
    .style("opacity", 0);

  const crosshair = g.append("line")
    .attr("y1", 0).attr("y2", innerH)
    .attr("stroke", "#aaa").attr("stroke-width", 1)
    .attr("opacity", 0).style("pointer-events", "none");

  g.append("rect")
    .attr("width", innerW).attr("height", innerH)
    .attr("fill", "none").style("pointer-events", "all")
    .on("mousemove", function(event) {
      const [mx] = d3.pointer(event);
      const salary = xScale.invert(mx);
      crosshair.attr("x1", mx).attr("x2", mx).attr("opacity", 1);

      const fmt = d3.format(",.0f"), pctFmt = d3.format(".1%");
      const rows = campusData.map(({ key, salaries }) => {
        const n   = salaries.length;
        const idx = d3.bisectRight(salaries, salary);
        const pct = idx / n;
        const campus = CAMPUSES.find(c => c.key === key);
        return `<span style="color:${campus.color}">${campus.label}</span>: ${pctFmt(pct)}`;
      });

      tooltip.style("opacity", 1)
        .html(`<strong>$${fmt(salary)}</strong><br>${rows.join("<br>")}`);

      const tw = tooltip.node().offsetWidth, th = tooltip.node().offsetHeight;
      const pad = 12;
      let tx = event.clientX + pad, ty = event.clientY + pad;
      if (tx + tw > window.innerWidth  - pad) tx = event.clientX - tw - pad;
      if (ty + th > window.innerHeight - pad) ty = event.clientY - th - pad;
      tooltip.style("left", tx + "px").style("top", ty + "px");
    })
    .on("mouseleave", function() {
      crosshair.attr("opacity", 0);
      tooltip.style("opacity", 0);
    });

  const fmt = d3.format(",.0f");
  const rightSide = document.getElementById("margin-right");
  if (rightSide) {
    const thresholdNote = colAdjusted
      ? "Salary COL-adjusted<br>per campus.<br>Thresholds = avg<br>across campuses.<br>Hourly × 2,080 hrs."
      : "Salaries not COL-adjusted.<br>Thresholds = avg<br>across campuses.<br>Hourly × 2,080 hrs.";
    rightSide.innerHTML = `
      <div style="font-size:0.8rem;color:#aaa;margin-bottom:0.6rem;font-weight:bold;">Campuses</div>
      <div style="font-size:0.75rem;color:#aaa;line-height:1.9;">
        ${CAMPUSES.map(({ label, color, key }) => {
          const n = campusData.find(d => d.key === key).salaries.length;
          return `<div><span style="display:inline-block;width:18px;height:2px;background:${color};vertical-align:middle;margin-right:6px;"></span>${label}<br>
            <span style="font-size:0.7rem;color:#555;padding-left:24px;">n = ${d3.format(",")(n)}</span></div>`;
        }).join("")}
      </div>
      <div style="font-size:0.8rem;color:#aaa;margin-top:1rem;margin-bottom:0.4rem;font-weight:bold;">Wage thresholds</div>
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
        ${thresholdNote}<br><br>
        <strong style="color:#444;">Sources</strong><br>
        Salaries: <a href="https://www.cu.edu/budget/cu-salary-database" target="_blank" style="color:#555;">CU Salary Database</a><br>
        Cost of living: <a href="https://www.bestplaces.net/" target="_blank" style="color:#555;">BestPlaces.net</a><br>
        Wage thresholds: <a href="https://livingwage.mit.edu/" target="_blank" style="color:#555;">MIT Living Wage Calculator</a><br>
        Median wage: <a href="https://www.census.gov/" target="_blank" style="color:#555;">U.S. Census Bureau</a>
      </div>`;
  }
}
