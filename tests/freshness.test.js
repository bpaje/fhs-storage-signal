"use strict";

// Source freshness is derived from each source's own cutoff and a `now` that tests fix; the real clock is never read here.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const dates = require("../reporting-dates.js");

const ROOT = path.join(__dirname, "..");
const at = (year, month, day, hour = 12, minute = 0) => new Date(year, month - 1, day, hour, minute);

function run() {
  const now = at(2026, 10, 8);
  assert.equal(dates.ageInDays("2026-09-17", now), 21);
  assert.equal(dates.freshness("2026-09-17", now).label, "Data through September 17 (21 days old)");
  assert.equal(dates.freshness("2026-09-17", now).text, "Data through September 17 (21 days old) · Stale: older than 7 days");

  // The warning threshold: 7 days is still fresh, 8 is stale. Same day and singular wording.
  const day = n => at(2026, 9, 17 + n);
  assert.equal(dates.freshness("2026-09-17", day(0)).label, "Data through September 17 (0 days old)");
  assert.equal(dates.freshness("2026-09-17", day(1)).label, "Data through September 17 (1 day old)");
  assert.deepEqual([dates.freshness("2026-09-17", day(7)).stale, dates.freshness("2026-09-17", day(7)).warning], [false, ""]);
  assert.deepEqual([dates.freshness("2026-09-17", day(8)).stale, dates.freshness("2026-09-17", day(8)).warning], [true, "Stale: older than 7 days"]);

  // Whole local calendar days: time of day does not move the count; month, year and leap boundaries are exact.
  assert.equal(dates.ageInDays("2026-09-17", at(2026, 9, 18, 0, 1)), 1);
  assert.equal(dates.ageInDays("2026-09-17", at(2026, 9, 18, 23, 59)), 1);
  assert.equal(dates.ageInDays("2026-12-30", at(2027, 1, 2)), 3);
  assert.equal(dates.ageInDays("2028-02-28", at(2028, 3, 1)), 2);
  assert.equal(dates.ageInDays("2027-02-28", at(2027, 3, 1)), 1);

  // A date stamp that carries a time still reads as that calendar date; a future date never shows a negative age.
  assert.equal(dates.freshness("2026-09-17T16:31:54Z", now).days, 21);
  assert.equal(dates.freshness("2026-10-20", now).days, 0);

  // Missing or malformed dates are surfaced as unknown, never as fresh.
  for (const bad of [undefined, null, "", "soon", "2026-9-17"]) {
    const result = dates.freshness(bad, now);
    assert.deepEqual([result.stale, result.days, result.label], [true, null, "Data date unavailable"]);
    assert.match(result.text, /Freshness unknown/);
  }

  // The pure functions take `now` as a parameter and never read the clock themselves.
  const source = fs.readFileSync(path.join(ROOT, "reporting-dates.js"), "utf8");
  const start = source.indexOf("const STALE_AFTER_DAYS"), end = source.indexOf("function dashboardLabels");
  assert.ok(start > 0 && end > start);
  assert.doesNotMatch(source.slice(start, end), /Date\.now|new Date\(\s*\)/);

  // Every public source file carries its own cutoff and refreshed stamp, and the UI reads each file's own value.
  const read = name => JSON.parse(fs.readFileSync(path.join(ROOT, "data", name), "utf8"));
  const report = read("reporting.json");
  assert.match(dates.latestPeriod(report).end, /^\d{4}-\d{2}-\d{2}$/);
  for (const [file, cutoff] of [["google-ads.json", "through"], ["analytics.json", "through"], ["meta.json", "through"]]) {
    const body = read(file);
    assert.match(body[cutoff], /^\d{4}-\d{2}-\d{2}$/, `${file} ${cutoff}`);
    assert.match(body.refreshed, /^\d{4}-\d{2}-\d{2}$/, `${file} refreshed`);
  }
  const details = fs.readFileSync(path.join(ROOT, "details.js"), "utf8");
  const app = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
  const meta = fs.readFileSync(path.join(ROOT, "meta.js"), "utf8");
  assert.doesNotMatch(details + app, /<b class="state ok">Loaded<\/b>|'Loaded'/, "static Loaded strip must be gone");
  assert.match(app, /reportingDates\.freshness\(iso,new Date\(\)\)/);
  assert.match(details, /sourceItem\('google','G','Google Ads',adsData\?\.through\?\?cutoff\)/);
  assert.match(details, /sourceItem\('ga','GA','Google Analytics',gaData\?\.through/);
  assert.match(details, /setFreshness\(p\.label,source\?\.through,source\?\.refreshed,loading\)/);
  // Meta header (details.js) and footer (meta.js) both read meta.json's own refreshed value through one formatter.
  assert.match(details, /metaPanel\.source\(\)/);
  assert.match(details, /reportingDates\.formatDate\(source\.refreshed\)/);
  assert.match(meta, /Refreshed \$\{reportingDates\.formatDate\(data\.refreshed\)\}/);
  assert.doesNotMatch(details, /source\?\.refreshed\|\|report\.refreshed/, "header must not fall back to another file's refreshed value");
  console.log("source freshness: age, 7-day warning, boundaries, missing dates and per-source wiring passed");
}

run();
