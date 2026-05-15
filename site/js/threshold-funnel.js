// 100% stacked bar chart: proportion of full-time employees in each wage band per campus.
// Thresholds are sorted by annual dollar value per campus so bands always run
// low → high regardless of the local poverty/min/living/median ordering.

const FILES = {
  "CU Anschutz":           "/cu/data/2026_anschutz.csv",
  "CU Boulder":            "/cu/data/2026_boulder.csv",
  "CU Colorado Springs":   "/cu/data/2026_colorado_springs.csv",
  "CU Denver":             "/cu/data/2026_denver.csv",
  "System Administration": "/cu/data/2026_system_administration.csv",
};

const CAMPUS_ORDER = Object.keys(FILES);

const CAMPUS_META_KEY = {
  "CU Anschutz":           "anschutz",
  "CU Boulder":            "boulder",
  "CU Colorado Springs":   "colorado_springs",
  "CU Denver":             "denver",
  "System Administration": "system_administration",
};

const HOURS_PER_YEAR = 2080;

const THRESHOLDS = [
  { key: "poverty_wage",                   label: "Poverty wage",          color: "#e05252", dash: "3,3"  },
  { key: "minimum_wage",                   label: "Minimum wage",          color: "#e0a052", dash: "6,3"  },
  { key: "living_wage_1_adult_0_children", label: "Living wage (1 adult)", color: "#52b052", dash: "9,3"  },
  { key: "median_wage",                    label: "Median county wage",    color: "#9b7fd4", dash: "12,3" },
];

// Five band colors: below t0 → t0–t1 → t1–t2 → t2–t3 → above t3
// Bands are indexed after sorting thresholds by $; colors go from danger (red) to comfortable (purple).
const BAND_COLORS = ["#c94040", "#c87a30", "#b8a830", "#4a9450", "#7070b8"];

function parseSalary(s) {
  return parseFloat((s || "").replace(/[$,]/g, "")) || 0;
}

// ── Module state ─────────────────────────────────────────────────────────────

let _campusStats = null;

// ── Load ──────────────────────────────────────────────────────────────────────

Promise.all([
  d3.json("/cu/data/metadata.json"),
  ...Object.entries(FILES).map(([label, path]) =>
    d3.csv(path).then(rows => rows
      .filter(r => r.full_time_pct === "100")
      .map(r => ({ campus: label, salary: parseSalary(r.total) }))
    )
  ),
]).then(([metaJson, ...chunks]) => {
  const rawMeta   = metaJson.metadata;
  const campusMeta = Object.fromEntries(
    CAMPUS_ORDER.map(label => [label, rawMeta[CAMPUS_META_KEY[label]]])
  );
  // Store raw per-campus salary arrays keyed by campus label
  const rawByCampus = Object.fromEntries(
    CAMPUS_ORDER.map((label, i) => [label, chunks[i].map(d => d.salary)])
  );

  _campusStats = CAMPUS_ORDER.map(campus => ({
    campus,
    n:        rawByCampus[campus].length,
    salaries: rawByCampus[campus],
    meta:     campusMeta[campus],
  }));

  render();

  document.getElementById("col-toggle").addEventListener("change", () => {
    d3.select("#vis-display").selectAll("*").remove();
    render();
  });
});

// ── Render (compute bands then draw) ─────────────────────────────────────────

function render() {
  const colAdjusted = document.getElementById("col-toggle").checked;

  const subtitle = document.getElementById("vis-subtitle");
  if (subtitle) {
    subtitle.textContent = (colAdjusted
      ? "COL-adjusted salary and thresholds"
      : "Nominal salary and thresholds (not COL-adjusted)")
      + " · Full-time employees · FY 2025–26 · Sorted by % below living wage";
  }

  const campusStats = _campusStats.map(({ campus, n, salaries, meta: m }) => {
    const col = colAdjusted ? m.cost_of_living : 1;

    // Sort thresholds by adjusted annual $ for this campus
    const sorted = THRESHOLDS
      .map(t => ({ ...t, annual: m[t.key] * HOURS_PER_YEAR / col }))
      .sort((a, b) => a.annual - b.annual);

    const cuts = sorted.map(t => t.annual);
    const adjSalaries = salaries.map(s => s / col);

    const bandDefs = [
      { lo: -Infinity, hi: cuts[0] },
      { lo: cuts[0],   hi: cuts[1] },
      { lo: cuts[1],   hi: cuts[2] },
      { lo: cuts[2],   hi: cuts[3] },
      { lo: cuts[3],   hi: Infinity },
    ];

    const bands = bandDefs.map((b, i) => {
      const count = adjSalaries.filter(s => s >= b.lo && s < b.hi).length;
      return { ...b, count, pct: count / n, color: BAND_COLORS[i] };
    });

    const lwAnnual = m.living_wage_1_adult_0_children * HOURS_PER_YEAR / col;
    const pctBelowLiving = bands
      .filter(b => b.hi !== Infinity && b.hi <= lwAnnual)
      .reduce((s, b) => s + b.pct, 0);

    return { campus, n, bands, sortedThresholds: sorted, meta: m, pctBelowLiving, colAdjusted };
  });

  campusStats.sort((a, b) => b.pctBelowLiving - a.pctBelowLiving);

  draw(campusStats);
  renderSidebars(campusStats);
  renderFooter(campusStats);
}

// ── Draw ──────────────────────────────────────────────────────────────────────

function draw(campusStats) {
  const container = document.getElementById("vis-display");
  const W         = container.clientWidth || 860;

  const BAR_H   = 46;
  const BAR_GAP = 28;
  const ROW_H   = BAR_H + BAR_GAP;
  const margin  = { top: 30, right: 30, bottom: 36, left: 188 };
  const innerW  = W - margin.left - margin.right;
  const innerH  = ROW_H * campusStats.length;
  const H       = innerH + margin.top + margin.bottom;

  const xScale = d3.scaleLinear().domain([0, 1]).range([0, innerW]);
  const yScale = d3.scaleBand()
    .domain(campusStats.map(s => s.campus))
    .range([0, innerH])
    .paddingInner(BAR_GAP / ROW_H)
    .paddingOuter(0.2);

  const svg = d3.select("#vis-display").append("svg")
    .attr("width",  W)
    .attr("height", H);

  const g = svg.append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  // ── Axes ────────────────────────────────────────────────────────────────────

  const xAxisFmt = d3.format(".0%");

  g.append("g")
    .attr("transform", `translate(0,${innerH})`)
    .call(d3.axisBottom(xScale).ticks(10).tickFormat(xAxisFmt))
    .call(ax => ax.select(".domain").remove())
    .selectAll("text").style("font-size", "12px").style("fill", "#aaa");

  g.append("g")
    .call(d3.axisTop(xScale).ticks(10).tickFormat(xAxisFmt))
    .call(ax => ax.select(".domain").remove())
    .call(ax => ax.selectAll(".tick line").remove())
    .selectAll("text").style("font-size", "12px").style("fill", "#aaa");

  // ── Grid ────────────────────────────────────────────────────────────────────

  g.selectAll("line.grid")
    .data(xScale.ticks(10))
    .join("line")
      .attr("class", "grid")
      .attr("x1", d => xScale(d)).attr("x2", d => xScale(d))
      .attr("y1", 0).attr("y2", innerH)
      .attr("stroke", d => d === 0 ? "#555" : "#1e1e1e")
      .attr("stroke-width", d => d === 0 ? 1 : 1);

  // ── Bars ────────────────────────────────────────────────────────────────────

  campusStats.forEach(({ campus, n, bands }) => {
    const y  = yScale(campus);
    const bh = yScale.bandwidth();
    let x0   = 0;

    // Campus label + n count
    g.append("text")
      .attr("x", -10).attr("y", y + bh / 2 - 7)
      .attr("text-anchor", "end").attr("dominant-baseline", "middle")
      .style("font-size", "14px").style("fill", "#ddd")
      .text(campus);

    g.append("text")
      .attr("x", -10).attr("y", y + bh / 2 + 9)
      .attr("text-anchor", "end").attr("dominant-baseline", "middle")
      .style("font-size", "11px").style("fill", "#555")
      .text(`n = ${d3.format(",")(n)}`);

    bands.forEach(band => {
      const bw = xScale(band.pct);
      if (bw < 0.5) { x0 += bw; return; }  // skip invisibly thin segments

      g.append("rect")
        .attr("x", x0).attr("y", y)
        .attr("width", bw).attr("height", bh)
        .attr("fill", band.color)
        .attr("fill-opacity", 0.85);

      // Label inside if wide enough
      if (bw > 28) {
        g.append("text")
          .attr("x", x0 + bw / 2).attr("y", y + bh / 2)
          .attr("text-anchor", "middle").attr("dominant-baseline", "middle")
          .style("font-size", bw > 50 ? "12px" : "10px")
          .style("fill", "#fff").style("font-weight", "bold")
          .style("pointer-events", "none")
          .text(d3.format(".1%")(band.pct));
      }

      x0 += bw;
    });
  });

  // ── Threshold boundary lines ─────────────────────────────────────────────
  // Draw a light tick above each bar at the living-wage boundary to highlight it.

  campusStats.forEach(({ campus, pctBelowLiving }) => {
    const y   = yScale(campus);
    const bh  = yScale.bandwidth();
    const xLW = xScale(pctBelowLiving);

    g.append("line")
      .attr("x1", xLW).attr("x2", xLW)
      .attr("y1", y - 4).attr("y2", y + bh + 4)
      .attr("stroke", "#52b052").attr("stroke-width", 1.5).attr("opacity", 0.7);
  });
}

// ── Sidebars ─────────────────────────────────────────────────────────────────

function renderSidebars(campusStats) {
  const pctFmt = d3.format(".1%");
  const numFmt = d3.format(",");
  const { colAdjusted } = campusStats[0];

  const totalN        = d3.sum(campusStats, s => s.n);
  const totalBelowLW  = d3.sum(campusStats, s =>
    Math.round(s.pctBelowLiving * s.n)
  );

  const left = document.querySelector("#margin-left");
  if (left) {
    left.innerHTML = `
      <div style="font-size:0.8rem;color:#aaa;font-weight:bold;margin-bottom:0.5rem;">System-wide (FT)</div>
      <div style="font-size:0.78rem;color:#aaa;line-height:1.9;">
        n = ${numFmt(totalN)}<br>
        Below living wage:<br>
        <span style="color:#52b052;font-weight:bold;">${numFmt(totalBelowLW)}<br>${pctFmt(totalBelowLW / totalN)}</span>
      </div>
      ${colAdjusted ? `<div style="font-size:0.72rem;color:#555;margin-top:1rem;line-height:1.7;">
        ${campusStats.map(s => `<div>${s.campus.replace("CU ", "").replace(" Administration", " Admin")}:<br>
          <span style="color:#777;">COL ×${s.meta.cost_of_living.toFixed(3)}</span></div>`).join("")}
      </div>` : ""}`;
  }

  const right = document.querySelector("#margin-right");
  if (right) {
    const bandLabels = [
      { color: BAND_COLORS[0], label: "Below poverty wage"     },
      { color: BAND_COLORS[1], label: "Poverty → min wage"     },
      { color: BAND_COLORS[2], label: "Min wage → next"        },
      { color: BAND_COLORS[3], label: "Next → highest"         },
      { color: BAND_COLORS[4], label: "Above all thresholds"   },
    ];

    right.innerHTML = `
      <div style="font-size:0.8rem;color:#aaa;font-weight:bold;margin-bottom:0.6rem;">Wage bands</div>
      <div style="font-size:0.75rem;color:#aaa;line-height:2.1;">
        ${bandLabels.map(b => `
          <div>
            <svg width="16" height="10" style="vertical-align:middle;margin-right:6px;">
              <rect x="0" y="1" width="16" height="8" fill="${b.color}" fill-opacity="0.85" rx="1"/>
            </svg>${b.label}
          </div>`).join("")}
      </div>
      <div style="font-size:0.72rem;color:#555;margin-top:1rem;line-height:1.6;">
        <span style="color:#52b052;">│</span> Green tick = living wage boundary.<br><br>
        Thresholds are campus-specific and
        sorted by dollar value — see footer
        for per-campus dollar amounts.<br><br>
        <strong style="color:#444;">Sources</strong><br>
        Salaries: <a href="https://www.cu.edu/budget/cu-salary-database"
          target="_blank" style="color:#555;">CU Salary Database</a><br>
        Wage thresholds: <a href="https://livingwage.mit.edu/"
          target="_blank" style="color:#555;">MIT Living Wage Calculator</a><br>
        Median wage: <a href="https://www.census.gov/"
          target="_blank" style="color:#555;">U.S. Census Bureau</a>
      </div>`;
  }
}

// ── Footer ────────────────────────────────────────────────────────────────────

function renderFooter(campusStats) {
  const fmtD = d3.format("$,.0f");
  const fmtP = d3.format(".1%");
  const el   = document.getElementById("footer-content");
  if (!el) return;

  // One row per campus × one column per threshold (sorted by $ for that campus)
  const rows = campusStats.map(({ campus, sortedThresholds, bands, n }) => {
    const cells = sortedThresholds.map((t, i) => {
      const band = bands[i];  // band i ends at t.annual (its upper boundary)
      const cumPct = bands.slice(0, i + 1).reduce((s, b) => s + b.pct, 0);
      return `<td style="padding:3px 14px;border-left:1px solid #222;">
        <span style="color:${t.color};font-weight:bold;">${t.label}</span><br>
        <span style="color:#888;font-size:0.85em;">${fmtD(t.annual)}/yr</span><br>
        <span style="color:#aaa;font-size:0.85em;">${fmtP(cumPct)} below</span>
      </td>`;
    }).join("");
    return `<tr>
      <td style="padding:3px 14px 3px 0;color:#bbb;white-space:nowrap;vertical-align:top;">${campus}</td>
      ${cells}
    </tr>`;
  }).join("");

  const { colAdjusted } = campusStats[0];
  const colNote = colAdjusted
    ? `Both salaries and thresholds are divided by the campus cost-of-living index,
       normalizing purchasing power to a common scale.
       Because the same COL factor scales both sides of the comparison, the band
       proportions are identical to the unadjusted view — but the dollar amounts
       in the table below reflect COL-adjusted values.`
    : `Salaries and thresholds are shown as nominal dollar amounts with no COL adjustment.
       Dollar amounts in the table below are annualized hourly rates (× 2,080 hrs).`;

  el.innerHTML = `
    <p style="color:#888;margin-bottom:0.6rem;max-width:860px;line-height:1.6;">
      Each bar shows <strong>full-time (100% FTE)</strong> employees split into five wage bands.
      Thresholds are <strong>campus-specific</strong>
      — Boulder employees are compared to Boulder-area figures, UCCS to Colorado Springs figures, etc.
      At some campuses (Anschutz, UCCS) the median county wage falls below the living wage;
      thresholds are always sorted by dollar value so bands run consistently low → high.
      The green tick marks the living-wage boundary on each bar.
    </p>
    <p style="color:#666;margin-bottom:1rem;max-width:860px;line-height:1.6;font-size:0.88rem;">${colNote}</p>
    <table style="border-collapse:collapse;font-size:0.82rem;color:#aaa;">
      <thead><tr>
        <th style="padding:3px 14px 6px 0;text-align:left;color:#666;">Campus</th>
        <th style="padding:3px 14px 6px;border-left:1px solid #222;color:#666;font-weight:normal;">1st threshold</th>
        <th style="padding:3px 14px 6px;border-left:1px solid #222;color:#666;font-weight:normal;">2nd threshold</th>
        <th style="padding:3px 14px 6px;border-left:1px solid #222;color:#666;font-weight:normal;">3rd threshold</th>
        <th style="padding:3px 14px 6px;border-left:1px solid #222;color:#666;font-weight:normal;">4th threshold</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}
