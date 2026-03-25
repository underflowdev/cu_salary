// Side-by-side bubble chart: one bubble per (campus × job family).
// Campus columns share a Y axis. COL adjustment toggled via header checkbox.

const CAMPUSES = [
  { key: "anschutz",              label: "CU Anschutz",         color: "#76b7b2" },
  { key: "boulder",               label: "CU Boulder",          color: "#4e79a7" },
  { key: "colorado_springs",      label: "CU Colorado Springs", color: "#f28e2b" },
  { key: "denver",                label: "CU Denver",           color: "#e15759" },
  { key: "system_administration", label: "System Admin",        color: "#59a14f" },
];

const HOURS_PER_YEAR = 2080;

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
  ...CAMPUSES.map(c =>
    d3.csv(`/cu/data/2026_${c.key}.csv`).then(rows => ({ key: c.key, rows }))
  ),
]).then(([metaJson, ...chunks]) => {
  metaAll = metaJson.metadata;

  rawData = chunks.flatMap(({ key, rows }) =>
    rows
      .filter(r => r.full_time_pct === "100" && parseSalary(r.total) > 0)
      .map(r => ({ campusKey: key, family: r.job_family.trim(), rawSalary: parseSalary(r.total) }))
      .filter(d => d.family)
  );

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

  const data = rawData.map(d => ({
    ...d,
    salary: colAdjusted
      ? d.rawSalary / metaAll[d.campusKey].cost_of_living
      : d.rawSalary,
  }));

  const container = document.getElementById("vis-display");
  const frameW = container.clientWidth  || 1200;
  const frameH = container.clientHeight || 700;

  const margin = { top: 40, right: 20, bottom: 50, left: 80 };
  const innerW  = frameW - margin.left - margin.right;
  const innerH  = frameH - margin.top  - margin.bottom;

  const families = d3.rollup(
    data,
    v => {
      const sorted = v.map(d => d.salary).sort(d3.ascending);
      return {
        count:  sorted.length,
        q1:     d3.quantile(sorted, 0.25),
        median: d3.quantile(sorted, 0.50),
        q3:     d3.quantile(sorted, 0.75),
      };
    },
    d => d.campusKey,
    d => d.family
  );

  const nodes = [];
  for (const [campusKey, familyMap] of families) {
    for (const [family, s] of familyMap) {
      nodes.push({ campusKey, family, ...s });
    }
  }

  const xScale = d3.scalePoint()
    .domain(CAMPUSES.map(c => c.key)).range([0, innerW]).padding(0.5);

  const yScale = d3.scaleLinear()
    .domain([0, d3.max(nodes, d => d.median)]).range([innerH, 0]).nice();

  const rScale = d3.scaleSqrt()
    .domain([0, d3.max(nodes, d => d.count)]).range([8, 90]);

  const campusColor = Object.fromEntries(CAMPUSES.map(c => [c.key, c.color]));

  nodes.forEach(d => {
    d.r  = rScale(d.count);
    d.tx = margin.left + xScale(d.campusKey);
    d.ty = margin.top  + yScale(d.median);
    d.x  = d.tx + (Math.random() - 0.5) * 40;
    d.y  = d.ty;
  });

  const sim = d3.forceSimulation(nodes)
    .force("collide", d3.forceCollide(d => d.r + 2).strength(0.85).iterations(2))
    .force("x", d3.forceX(d => d.tx).strength(0.3))
    .force("y", d3.forceY(d => d.ty).strength(0.4))
    .stop();

  for (let i = 0; i < 300; i++) sim.tick();

  const PAD = 20;
  const W = Math.max(frameW, d3.max(nodes, d => d.x + d.r) + PAD);
  const H = Math.max(frameH, d3.max(nodes, d => d.y + d.r) + PAD);

  const svg = d3.select("#vis-display").append("svg").attr("width", W).attr("height", H);
  const g   = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  g.call(d3.axisLeft(yScale).ticks(8).tickFormat(d => "$" + d3.format(",.0f")(d)))
    .call(ax => ax.select(".domain").remove())
    .call(ax => ax.selectAll(".tick line").clone().attr("x2", innerW).attr("stroke", "#2a2a2a"))
    .selectAll("text").style("font-size", "11px").style("fill", "#aaa");

  g.append("text")
    .attr("transform", "rotate(-90)").attr("x", -innerH / 2).attr("y", -65)
    .attr("text-anchor", "middle").style("fill", "#888").style("font-size", "12px")
    .text(colAdjusted ? "Median COL-Adjusted Annual Salary" : "Median Annual Salary");

  const xAxisG = g.append("g").attr("transform", `translate(0,${innerH + 12})`);
  CAMPUSES.forEach(c => {
    xAxisG.append("text")
      .attr("x", xScale(c.key)).attr("y", 0).attr("text-anchor", "middle")
      .style("font-size", "12px").style("fill", c.color).text(c.label);
  });

  // Per-campus wage marker dashes
  const markerHalfW = xScale.step() * 0.44;
  CAMPUSES.forEach(c => {
    const m = metaAll[c.key];
    const cx = margin.left + xScale(c.key);
    WAGE_MARKERS.forEach(({ key, color, dash }) => {
      const val = colAdjusted
        ? m[key] * HOURS_PER_YEAR / m.cost_of_living
        : m[key] * HOURS_PER_YEAR;
      const y = margin.top + yScale(val);
      svg.append("line")
        .attr("x1", cx - markerHalfW).attr("x2", cx + markerHalfW)
        .attr("y1", y).attr("y2", y)
        .attr("stroke", color).attr("stroke-width", 1.5)
        .attr("stroke-dasharray", dash).attr("opacity", 0.85);
    });
  });

  const tooltip = d3.select("body").append("div")
    .attr("class", "chart-tooltip")
    .style("position", "fixed").style("pointer-events", "none")
    .style("background", "#1c1c1c").style("border", "1px solid #444")
    .style("color", "#ddd").style("font-size", "0.8rem")
    .style("padding", "0.4rem 0.65rem").style("border-radius", "3px")
    .style("white-space", "nowrap").style("opacity", 0);

  svg.append("g").selectAll("circle").data(nodes).join("circle")
    .attr("cx", d => d.x).attr("cy", d => d.y).attr("r", d => d.r)
    .attr("fill", d => campusColor[d.campusKey]).attr("opacity", 0.75)
    .on("mousemove", function(event, d) {
      const campus = CAMPUSES.find(c => c.key === d.campusKey);
      const fmt = d3.format(",.0f");
      tooltip.style("opacity", 1).html(
        `<strong>${d.family}</strong><br>${campus.label}<br>n = ${d3.format(",")(d.count)}<br>` +
        `Q3 &nbsp;&nbsp;$${fmt(d.q3)}<br>med &nbsp;$${fmt(d.median)}<br>Q1 &nbsp;&nbsp;$${fmt(d.q1)}`
      );
      const tw = tooltip.node().offsetWidth, th = tooltip.node().offsetHeight;
      const pad = 12;
      let x = event.clientX + pad, y = event.clientY + pad;
      if (x + tw > window.innerWidth  - pad) x = event.clientX - tw - pad;
      if (y + th > window.innerHeight - pad) y = event.clientY - th - pad;
      tooltip.style("left", x + "px").style("top", y + "px");
    })
    .on("mouseleave", () => tooltip.style("opacity", 0));

  svg.append("g").selectAll("text").data(nodes.filter(d => d.r > 18)).join("text")
    .attr("x", d => d.x).attr("y", d => d.y)
    .attr("text-anchor", "middle").attr("dominant-baseline", "middle")
    .style("font-size", d => Math.min(10, d.r * 0.28) + "px")
    .style("fill", "#fff").style("pointer-events", "none")
    .each(function(d) {
      const words = d.family.split(/\s+/);
      const mid   = Math.ceil(words.length / 2);
      d3.select(this).append("tspan").attr("x", d.x).attr("dy", "-0.55em")
        .text(words.slice(0, mid).join(" "));
      d3.select(this).append("tspan").attr("x", d.x).attr("dy", "1.1em")
        .text(words.slice(mid).join(" "));
    });

  const rightSide = document.getElementById("margin-right");
  if (rightSide) {
    const wageNote = colAdjusted
      ? "Hourly × 2,080 hrs, COL-adjusted."
      : "Hourly × 2,080 hrs (not COL-adjusted).";
    rightSide.innerHTML = `
      <div style="font-size:0.75rem;color:#aaa;line-height:1.7;">
        n = ${d3.format(",")(data.length)}<br>
        ${nodes.length} bubbles total
      </div>
      <div style="font-size:0.8rem;color:#aaa;margin-top:1rem;margin-bottom:0.4rem;font-weight:bold;">Wage thresholds</div>
      <div style="font-size:0.75rem;color:#aaa;line-height:1.8;">
        ${WAGE_MARKERS.map(({ label, color, dash }) => {
          const svgEl = `<svg width="24" height="10" style="vertical-align:middle;margin-right:6px;">
            <line x1="0" y1="5" x2="24" y2="5" stroke="${color}" stroke-width="1.5"
              stroke-dasharray="${dash}"/></svg>`;
          return `<div>${svgEl}${label}</div>`;
        }).join("")}
      </div>
      <div style="font-size:0.72rem;color:#555;margin-top:1rem;line-height:1.6;">
        Bubble area ∝ headcount<br>within campus.<br>
        Y ≈ median salary; hover to confirm.<br>
        ${wageNote}<br><br>
        <strong style="color:#444;">Sources</strong><br>
        Salaries: <a href="https://www.cu.edu/budget/cu-salary-database" target="_blank" style="color:#555;">CU Salary Database</a><br>
        Cost of living: <a href="https://www.bestplaces.net/" target="_blank" style="color:#555;">BestPlaces.net</a><br>
        Wage thresholds: <a href="https://livingwage.mit.edu/" target="_blank" style="color:#555;">MIT Living Wage Calculator</a><br>
        Median wage: <a href="https://www.census.gov/" target="_blank" style="color:#555;">U.S. Census Bureau</a>
      </div>`;
  }
}
