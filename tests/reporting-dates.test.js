"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const dates = require("../reporting-dates.js");

const ROOT = path.join(__dirname, "..");

function fixture(end, partial, label, refreshed) {
  return {
    refreshed,
    periods: [
      { id: "2026-06", label: "June 2026", start: "2026-06-01", end: "2026-06-30", partial: false },
      { id: "2026-07", label: "July 2026", start: "2026-07-01", end: "2026-07-31", partial: false },
      { id: "2026-08", label: "August 2026", start: "2026-08-01", end: "2026-08-31", partial: false },
      { id: "2026-09", label, start: "2026-09-01", end, partial },
    ],
  };
}

function rendered(report) {
  return Object.values(dates.dashboardLabels(report)).flat().join("\n");
}

const day9 = fixture("2026-09-09", true, "September 1–9, 2026 (MTD)", "2026-09-10");
const day9Labels = dates.dashboardLabels(day9);
assert.match(rendered(day9), /September 1–9/);
assert.match(day9Labels.periodRefresh, /September covers days 1–9 only\. Refreshed September 10\./);
assert.match(day9Labels.detailCoverage, /through September 9/);

const day17 = fixture("2026-09-17", true, "September 1–17, 2026 (MTD)", "2026-09-18");
const day17Rendered = rendered(day17);
assert.match(day17Rendered, /September 1–17/);
assert.match(day17Rendered, /Refreshed September 18/);
assert.doesNotMatch(day17Rendered, /1–9|September 9|September 10|Sep 9/);

const fullMonth = fixture("2026-09-30", false, "September 2026", "2026-10-01");
const fullLabels = dates.dashboardLabels(fullMonth);
const fullRendered = rendered(fullMonth);
assert.match(fullLabels.periodRefresh, /^Complete calendar month\. Refreshed October 1\./);
assert.equal(fullLabels.trend, "June–September · account-wide");
assert.doesNotMatch(fullRendered, /covers days|partial|not compared with a full prior month|1–9|September 9|September 10|Sep 9/);

const cutoffSensitiveFiles = ["app.js", "details.js", "meta.js", "monthly-trend.js", "tenants.js", "journeys.js", "index.html"];
for (const file of cutoffSensitiveFiles) {
  const source = fs.readFileSync(path.join(ROOT, file), "utf8");
  assert.doesNotMatch(source, /1–9|September 9|September 10|Sep 9/i, `${file} contains a fixed cutoff label`);
}
const index = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
assert.ok(index.indexOf('src="reporting-dates.js"') < index.indexOf('src="app.js"'), "date helpers must load before app.js");

console.log("cutoff-derived dashboard labels passed for day 9, day 17, and a full month");
