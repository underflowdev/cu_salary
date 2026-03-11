// Boulder bubble chart: one bubble per job family, sized by headcount, y ≈ median salary.
// Force simulation runs synchronously — no animation.

const CAMPUS_KEY = "boulder";
const CSV_FILE   = `/cu/data/2026_${CAMPUS_KEY}.csv`;

function parseSalary(s) {
  return parseFloat((s || "").replace(/[$,]/g, "")) || 0;
}

Promise.all([
  d3.json("/cu/data/metadata.json"),
  d3.csv(CSV_FILE),
]).then(([metaJson, rows]) => {
  const meta = metaJson.metadata[CAMPUS_KEY];

  const data = rows
    .filter(r => r.full_time_pct.trim().replace(/[^0-9.\-]/g, "") !== "" && parseSalary(r.total) > 0)
    .map(r => ({
      family: r.job_family.trim(),
      salary: parseSalary(r.total) / meta.cost_of_living,
    }))
    .filter(d => d.family);

  draw(data, meta);
});

function draw(data, meta) {
  const container = document.getElementById("vis-display");
  const W = container.clientWidth  || 1200;
  const H = container.clientHeight || 700;

  const margin = { top: 40, right: 20, bottom: 40, left: 80 };
  const innerW  = W - margin.left - margin.right;
  const innerH  = H - margin.top  - margin.bottom;

  // ── Aggregate to one node per job family ──────────────────────────────────

  const families = d3.rollup(
    data,
    v => ({ count: v.length, median: d3.median(v, d => d.salary) }),
    d => d.family
  );

  const nodes = [...families.entries()].map(([family, s]) => ({
    family,
    count:  s.count,
    median: s.median,
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
    .domain(nodes.map(d => d.family));

  // ── Initial positions ─────────────────────────────────────────────────────

  nodes.forEach(d => {
    d.r  = rScale(d.count);
    d.x  = margin.left + innerW / 2 + (Math.random() - 0.5) * innerW * 0.3;
    d.y  = margin.top  + yScale(d.median);
    d.ty = margin.top  + yScale(d.median);   // target y
  });

  // ── Force simulation — synchronous ────────────────────────────────────────

  const sim = d3.forceSimulation(nodes)
    .force("collide", d3.forceCollide(d => d.r + 2).strength(0.85).iterations(2))
    .force("x", d3.forceX(margin.left + innerW / 2).strength(0.04))
    .force("y", d3.forceY(d => d.ty).strength(0.4))
    .stop();

  for (let i = 0; i < 200; i++) sim.tick();

  // ── Render ────────────────────────────────────────────────────────────────

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

  // Y axis label
  axisG.append("text")
    .attr("transform", "rotate(-90)")
    .attr("x", -innerH / 2)
    .attr("y", -65)
    .attr("text-anchor", "middle")
    .style("fill", "#888")
    .style("font-size", "12px")
    .text("Median COL-Adjusted Annual Salary");

  // Bubbles
  svg.append("g")
    .selectAll("circle")
    .data(nodes)
    .join("circle")
      .attr("cx", d => d.x)
      .attr("cy", d => d.y)
      .attr("r",  d => d.r)
      .attr("fill", d => COLOR(d.family))
      .attr("opacity", 0.75);

  // Labels — inside bubble if large enough, otherwise suppress
  svg.append("g")
    .selectAll("text")
    .data(nodes.filter(d => d.r > 20))
    .join("text")
      .attr("x", d => d.x)
      .attr("y", d => d.y)
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "middle")
      .style("font-size", d => Math.min(12, d.r * 0.28) + "px")
      .style("fill", "#fff")
      .style("pointer-events", "none")
      .each(function(d) {
        // Wrap long names onto two lines
        const words = d.family.split(/\s+/);
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
    const fmt = d3.format(",.0f");
    rightSide.innerHTML = `
      <div style="font-size:0.8rem;color:#aaa;margin-bottom:0.6rem;font-weight:bold;">${meta.city}</div>
      <div style="font-size:0.75rem;color:#aaa;line-height:1.7;">
        COL ×${meta.cost_of_living.toFixed(2)}<br>
        n = ${d3.format(",")(data.length)}<br>
        ${nodes.length} job families
      </div>
      <div style="font-size:0.72rem;color:#555;margin-top:1rem;line-height:1.6;">
        Bubble area ∝ headcount.<br>
        Y ≈ median salary; hover to confirm.<br><br>
        <strong style="color:#444;">Sources</strong><br>
        Salaries: <a href="https://www.cu.edu/budget/cu-salary-database" target="_blank" style="color:#555;">CU Salary Database</a><br>
        Cost of living: <a href="https://www.bestplaces.net/" target="_blank" style="color:#555;">BestPlaces.net</a>
      </div>`;
  }
}
