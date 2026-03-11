// Per-campus bubble chart: one bubble per dept_name, sized by headcount, y ≈ median salary.
// The HTML page sets data-campus-key and data-campus-label on <body>.
// Departments with fewer than MIN_N full-time employees are excluded.
// Force simulation runs synchronously — no animation.

const CAMPUS_KEY   = document.body.dataset.campusKey;
const CAMPUS_LABEL = document.body.dataset.campusLabel;
const CSV_FILE     = `/cu/data/2026_${CAMPUS_KEY}.csv`;

const HOURS_PER_YEAR = 2080;
const MIN_N          = 10;

const WAGE_MARKERS = [
  { key: "living_wage_1_adult_0_children", label: "Living wage (1 adult)", color: "#52b052", dash: "9,3" },
  { key: "median_wage",                    label: "Median county wage",    color: "#9b7fd4", dash: "12,3" },
  { key: "minimum_wage",                   label: "Min. wage",             color: "#e0a052", dash: "6,3"  },
];

function parseSalary(s) {
  return parseFloat((s || "").replace(/[$,]/g, "")) || 0;
}

Promise.all([
  d3.json("/cu/data/metadata.json"),
  d3.csv(CSV_FILE),
]).then(([metaJson, rows]) => {
  const meta = metaJson.metadata[CAMPUS_KEY];

  const all = rows
    .filter(r => r.full_time_pct === "100" && parseSalary(r.total) > 0)
    .map(r => ({
      dept:   r.dept_name.trim(),
      salary: parseSalary(r.total) / meta.cost_of_living,
    }))
    .filter(d => d.dept);

  const counts = d3.rollup(all, v => v.length, d => d.dept);
  const data   = all.filter(d => counts.get(d.dept) >= MIN_N);

  draw(data, meta);
});

function draw(data, meta) {
  const container = document.getElementById("vis-display");
  const frameW = container.clientWidth  || 1200;
  const frameH = container.clientHeight || 700;

  const margin = { top: 40, right: 20, bottom: 40, left: 80 };
  const innerW = frameW - margin.left - margin.right;
  const innerH = frameH - margin.top  - margin.bottom;

  // ── Aggregate to one node per dept ────────────────────────────────────────

  const depts = d3.rollup(
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
    d => d.dept
  );

  const nodes = [...depts.entries()].map(([dept, s]) => ({
    dept,
    count:  s.count,
    q1:     s.q1,
    median: s.median,
    q3:     s.q3,
  }));

  // ── Scales ────────────────────────────────────────────────────────────────

  const yScale = d3.scaleLinear()
    .domain([0, d3.max(nodes, d => d.median)])
    .range([innerH, 0])
    .nice();

  const rScale = d3.scaleSqrt()
    .domain([0, d3.max(nodes, d => d.count)])
    .range([8, 90]);

  const COLOR = d3.scaleOrdinal(d3.schemeTableau10)
    .domain(nodes.map(d => d.dept));

  // ── Initial positions ─────────────────────────────────────────────────────

  nodes.forEach(d => {
    d.r  = rScale(d.count);
    d.x  = margin.left + innerW / 2 + (Math.random() - 0.5) * innerW * 0.4;
    d.y  = margin.top  + yScale(d.median);
    d.ty = margin.top  + yScale(d.median);
  });

  // ── Force simulation — synchronous ────────────────────────────────────────

  const sim = d3.forceSimulation(nodes)
    .force("collide", d3.forceCollide(d => d.r + 2).strength(0.85).iterations(2))
    .force("x", d3.forceX(margin.left + innerW / 2).strength(0.04))
    .force("y", d3.forceY(d => d.ty).strength(0.4))
    .stop();

  for (let i = 0; i < 600; i++) sim.tick();

  // ── Render ────────────────────────────────────────────────────────────────

  // Expand SVG to fit wherever bubbles actually landed after force simulation
  const PAD = 20;
  const W = Math.max(frameW, d3.max(nodes, d => d.x + d.r) + PAD);
  const H = Math.max(frameH, d3.max(nodes, d => d.y + d.r) + PAD);

  const svg = d3.select("#vis-display").append("svg")
    .attr("width",  W)
    .attr("height", H);

  // Y axis
  const axisG = svg.append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  axisG.call(
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

  axisG.append("text")
    .attr("transform", "rotate(-90)")
    .attr("x", -innerH / 2)
    .attr("y", -65)
    .attr("text-anchor", "middle")
    .style("fill", "#888")
    .style("font-size", "12px")
    .text("Median COL-Adjusted Annual Salary");

  // ── Wage threshold lines ──────────────────────────────────────────────────

  WAGE_MARKERS.forEach(({ key, color, dash }) => {
    const y = margin.top + yScale(meta[key] * HOURS_PER_YEAR / meta.cost_of_living);
    svg.append("line")
      .attr("x1", margin.left).attr("x2", margin.left + innerW)
      .attr("y1", y).attr("y2", y)
      .attr("stroke", color).attr("stroke-width", 1.5)
      .attr("stroke-dasharray", dash).attr("opacity", 0.7);
  });

  // ── Tooltip ───────────────────────────────────────────────────────────────

  const tooltip = d3.select("body").append("div")
    .style("position", "fixed")
    .style("pointer-events", "none")
    .style("background", "#1c1c1c")
    .style("border", "1px solid #444")
    .style("color", "#ddd")
    .style("font-size", "0.8rem")
    .style("padding", "0.4rem 0.65rem")
    .style("border-radius", "3px")
    .style("white-space", "nowrap")
    .style("opacity", 0);

  // Bubbles
  svg.append("g")
    .selectAll("circle")
    .data(nodes)
    .join("circle")
      .attr("cx", d => d.x)
      .attr("cy", d => d.y)
      .attr("r",  d => d.r)
      .attr("fill", d => COLOR(d.dept))
      .attr("opacity", 0.75)
      .on("mousemove", function(event, d) {
        const fmt = d3.format(",.0f");
        tooltip.style("opacity", 1).html(
          `<strong>${d.dept}</strong><br>` +
          `n = ${d3.format(",")(d.count)}<br>` +
          `Q3 &nbsp;&nbsp;$${fmt(d.q3)}<br>` +
          `med &nbsp;$${fmt(d.median)}<br>` +
          `Q1 &nbsp;&nbsp;$${fmt(d.q1)}`
        );
        const tw = tooltip.node().offsetWidth;
        const th = tooltip.node().offsetHeight;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const pad = 12;
        let x = event.clientX + pad;
        let y = event.clientY + pad;
        if (x + tw > vw - pad) x = event.clientX - tw - pad;
        if (y + th > vh - pad) y = event.clientY - th - pad;
        tooltip.style("left", x + "px").style("top", y + "px");
      })
      .on("mouseleave", () => tooltip.style("opacity", 0));

  // Labels — inside bubble if large enough
  svg.append("g")
    .selectAll("text")
    .data(nodes.filter(d => d.r > 20))
    .join("text")
      .attr("x", d => d.x)
      .attr("y", d => d.y)
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "middle")
      .style("font-size", d => Math.min(11, d.r * 0.28) + "px")
      .style("fill", "#fff")
      .style("pointer-events", "none")
      .each(function(d) {
        const words = d.dept.split(/\s+/);
        const mid   = Math.ceil(words.length / 2);
        d3.select(this).append("tspan")
          .attr("x", d.x).attr("dy", "-0.55em")
          .text(words.slice(0, mid).join(" "));
        d3.select(this).append("tspan")
          .attr("x", d.x).attr("dy", "1.1em")
          .text(words.slice(mid).join(" "));
      });

  // ── Annotations ───────────────────────────────────────────────────────────

  const rightSide = document.getElementById("margin-right");
  if (rightSide) {
    rightSide.innerHTML = `
      <div style="font-size:0.8rem;color:#aaa;margin-bottom:0.6rem;font-weight:bold;">${meta.city}</div>
      <div style="font-size:0.75rem;color:#aaa;line-height:1.7;">
        COL ×${meta.cost_of_living.toFixed(2)}<br>
        n = ${d3.format(",")(data.length)}<br>
        ${nodes.length} departments<br>
        (≥ ${MIN_N} FTE shown)
      </div>
      <div style="font-size:0.8rem;color:#aaa;margin-top:1rem;margin-bottom:0.4rem;font-weight:bold;">Wage thresholds</div>
      <div style="font-size:0.75rem;color:#aaa;line-height:1.8;">
        ${WAGE_MARKERS.map(({ key, label, color, dash }) => {
          const annual = meta[key] * HOURS_PER_YEAR / meta.cost_of_living;
          const svg = `<svg width="24" height="10" style="vertical-align:middle;margin-right:6px;">
            <line x1="0" y1="5" x2="24" y2="5" stroke="${color}" stroke-width="1.5"
              stroke-dasharray="${dash}"/></svg>`;
          return `<div>${svg}${label}<br><span style="font-size:0.7rem;color:#666;padding-left:30px;">$${d3.format(",.0f")(annual)}</span></div>`;
        }).join("")}
      </div>
      <div style="font-size:0.72rem;color:#555;margin-top:1rem;line-height:1.6;">
        Bubble area ∝ headcount.<br>
        Y ≈ median salary; hover to confirm.<br>
        Hourly × 2,080 hrs, COL-adjusted.<br><br>
        <strong style="color:#444;">Sources</strong><br>
        Salaries: <a href="https://www.cu.edu/budget/cu-salary-database" target="_blank" style="color:#555;">CU Salary Database</a><br>
        Cost of living: <a href="https://www.bestplaces.net/" target="_blank" style="color:#555;">BestPlaces.net</a><br>
        Wage thresholds: <a href="https://livingwage.mit.edu/" target="_blank" style="color:#555;">MIT Living Wage Calculator</a><br>
        Median wage: <a href="https://www.census.gov/" target="_blank" style="color:#555;">U.S. Census Bureau</a>
      </div>`;
  }
}
