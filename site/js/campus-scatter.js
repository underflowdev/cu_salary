// Scatter: median salary (Y) vs. headcount (X), one dot per job family.
// The HTML page sets data-campus-key and data-campus-label on <body>.

const CAMPUS_KEY   = document.body.dataset.campusKey;
const CAMPUS_LABEL = document.body.dataset.campusLabel;
const CSV_FILE     = `/cu/data/2026_${CAMPUS_KEY}.csv`;

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

let rawData = null;
let meta    = null;

// ── Load ─────────────────────────────────────────────────────────────────────

Promise.all([
  d3.json("/cu/data/metadata.json"),
  d3.csv(CSV_FILE),
]).then(([metaJson, rows]) => {
  meta = metaJson.metadata[CAMPUS_KEY];

  rawData = rows
    .filter(r => r.full_time_pct === "100" && parseSalary(r.total) > 0)
    .map(r => ({ family: r.job_family.trim(), rawSalary: parseSalary(r.total) }))
    .filter(d => d.family);

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
    salary: colAdjusted ? d.rawSalary / meta.cost_of_living : d.rawSalary,
  }));

  const container = document.getElementById("vis-display");
  const W = container.clientWidth  || 1200;
  const H = container.clientHeight || 700;

  const margin = { top: 40, right: 40, bottom: 60, left: 90 };
  const innerW  = W - margin.left - margin.right;
  const innerH  = H - margin.top  - margin.bottom;

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
    d => d.family
  );

  const nodes = [...families.entries()]
    .map(([family, s]) => ({ family, ...s }))
    .sort((a, b) => d3.ascending(a.count, b.count));

  const xScale = d3.scaleLinear()
    .domain([0, d3.max(nodes, d => d.count) * 1.08]).range([0, innerW]).nice();

  const yScale = d3.scaleLinear()
    .domain([0, d3.max(nodes, d => d.q3) * 1.08]).range([innerH, 0]).nice();

  const COLOR = d3.scaleOrdinal(d3.schemeTableau10).domain(nodes.map(d => d.family));

  const svg = d3.select("#vis-display").append("svg").attr("width", W).attr("height", H);
  const g   = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  g.append("g")
    .attr("transform", `translate(0,${innerH})`)
    .call(d3.axisBottom(xScale).ticks(8).tickFormat(d3.format(",")))
    .call(ax => ax.select(".domain").remove())
    .call(ax => ax.selectAll(".tick line").clone().attr("y2", -innerH).attr("stroke", "#2a2a2a"))
    .selectAll("text").style("font-size", "11px").style("fill", "#aaa");

  g.append("text")
    .attr("x", innerW / 2).attr("y", innerH + 48).attr("text-anchor", "middle")
    .style("fill", "#888").style("font-size", "12px")
    .text("Headcount (full-time employees)");

  g.append("g")
    .call(d3.axisLeft(yScale).ticks(8).tickFormat(d => "$" + d3.format(",.0f")(d)))
    .call(ax => ax.select(".domain").remove())
    .call(ax => ax.selectAll(".tick line").clone().attr("x2", innerW).attr("stroke", "#2a2a2a"))
    .selectAll("text").style("font-size", "11px").style("fill", "#aaa");

  g.append("text")
    .attr("transform", "rotate(-90)").attr("x", -innerH / 2).attr("y", -72)
    .attr("text-anchor", "middle").style("fill", "#888").style("font-size", "12px")
    .text(colAdjusted ? "Median COL-Adjusted Annual Salary" : "Median Annual Salary");

  WAGE_MARKERS.forEach(({ key, color, dash }) => {
    const val = colAdjusted
      ? meta[key] * HOURS_PER_YEAR / meta.cost_of_living
      : meta[key] * HOURS_PER_YEAR;
    const y = yScale(val);
    g.append("line")
      .attr("x1", 0).attr("x2", innerW).attr("y1", y).attr("y2", y)
      .attr("stroke", color).attr("stroke-width", 1.5)
      .attr("stroke-dasharray", dash).attr("opacity", 0.7);
  });

  g.append("g").selectAll("line").data(nodes).join("line")
    .attr("x1", d => xScale(d.count)).attr("x2", d => xScale(d.count))
    .attr("y1", d => yScale(d.q1)).attr("y2", d => yScale(d.q3))
    .attr("stroke", d => COLOR(d.family)).attr("stroke-width", 2).attr("opacity", 0.35);

  const tooltip = d3.select("body").append("div")
    .attr("class", "chart-tooltip")
    .style("position", "fixed").style("pointer-events", "none")
    .style("background", "#1c1c1c").style("border", "1px solid #444")
    .style("color", "#ddd").style("font-size", "0.8rem")
    .style("padding", "0.4rem 0.65rem").style("border-radius", "3px")
    .style("white-space", "nowrap").style("opacity", 0);

  const fmt = d3.format(",.0f");

  g.append("g").selectAll("circle").data(nodes).join("circle")
    .attr("cx", d => xScale(d.count)).attr("cy", d => yScale(d.median))
    .attr("r", 7).attr("fill", d => COLOR(d.family)).attr("opacity", 0.85)
    .style("cursor", "default")
    .on("mousemove", function(event, d) {
      tooltip.style("opacity", 1).html(
        `<strong>${d.family}</strong><br>n = ${d3.format(",")(d.count)}<br>` +
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

  const rightSide = document.getElementById("margin-right");
  if (rightSide) {
    const colLine = colAdjusted ? `COL ×${meta.cost_of_living.toFixed(2)}<br>` : "";
    const wageNote = colAdjusted
      ? "Hourly × 2,080 hrs,<br>COL-adjusted."
      : "Hourly × 2,080 hrs<br>(not COL-adjusted).";
    rightSide.innerHTML = `
      <div style="font-size:0.8rem;color:#aaa;margin-bottom:0.6rem;font-weight:bold;">${CAMPUS_LABEL}</div>
      <div style="font-size:0.75rem;color:#aaa;line-height:1.7;">
        ${colLine}n = ${d3.format(",")(data.length)}<br>
        ${nodes.length} job families
      </div>
      <div style="font-size:0.8rem;color:#aaa;margin-top:1rem;margin-bottom:0.4rem;font-weight:bold;">Wage thresholds</div>
      <div style="font-size:0.75rem;color:#aaa;line-height:1.8;">
        ${WAGE_MARKERS.map(({ key, label, color, dash }) => {
          const annual = colAdjusted
            ? meta[key] * HOURS_PER_YEAR / meta.cost_of_living
            : meta[key] * HOURS_PER_YEAR;
          const svgEl = `<svg width="24" height="10" style="vertical-align:middle;margin-right:6px;">
            <line x1="0" y1="5" x2="24" y2="5" stroke="${color}" stroke-width="1.5"
              stroke-dasharray="${dash}"/></svg>`;
          return `<div>${svgEl}${label}<br><span style="font-size:0.7rem;color:#666;padding-left:30px;">$${d3.format(",.0f")(annual)}</span></div>`;
        }).join("")}
      </div>
      <div style="font-size:0.72rem;color:#555;margin-top:1rem;line-height:1.6;">
        X = headcount.<br>
        Y = median salary.<br>
        Bar = IQR (Q1–Q3).<br>
        ${wageNote}<br><br>
        <strong style="color:#444;">Sources</strong><br>
        Salaries: <a href="https://www.cu.edu/budget/cu-salary-database" target="_blank" style="color:#555;">CU Salary Database</a><br>
        Cost of living: <a href="https://www.bestplaces.net/" target="_blank" style="color:#555;">BestPlaces.net</a><br>
        Wage thresholds: <a href="https://livingwage.mit.edu/" target="_blank" style="color:#555;">MIT Living Wage Calculator</a><br>
        Median wage: <a href="https://www.census.gov/" target="_blank" style="color:#555;">U.S. Census Bureau</a>
      </div>`;
  }
}
