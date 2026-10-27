"use strict";

// "Source of rentals" panel: evidence rows, honest day-one reading, no combined figure, private host only.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const panel = require("../sources.js");

const ROOT = path.join(__dirname, "..");
const cell = over => ({ moveIns: 0, confirmed: 0, disagree: 0, creditedLease: 0, creditedOnline: 0, notRecorded: 0, notRecordedOnline: 0, creditedBySlug: {}, ...over });
const file = {
  schema: panel.SCHEMA,
  cutoff: "2026-09-30",
  periods: [{
    id: "2026-09",
    facilities: {
      1: cell({ moveIns: 6, confirmed: 1, creditedLease: 2, creditedOnline: 1, notRecorded: 2, notRecordedOnline: 1, creditedBySlug: { gads_albany_search: 2, meta_remarketing_all: 1 } }),
      2: cell({ moveIns: 4, notRecorded: 4, notRecordedOnline: 3 }),
    },
    cost: [{ slug: "gads_albany_search", creditedRentals: 2, spend: 300, costPerRentalAtLeast: 150 }],
  }],
};
const visible = markup => markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

function run() {
  const all = panel.summarize(file, "2026-09", [1, 2]);
  assert.equal(all.counts.moveIns, 10);
  assert.equal(all.counts.confirmed + all.counts.disagree + all.counts.creditedLease + all.counts.creditedOnline + all.counts.notRecorded, 10, "rows partition the move-ins");
  assert.deepEqual(all.counts.creditedBySlug, { gads_albany_search: 2, meta_remarketing_all: 1 });
  assert.equal(panel.summarize(file, "2026-09", [2]).counts.moveIns, 4, "facility filter applies");
  assert.equal(panel.summarize(file, "2026-08", [1]), null, "an uncovered month yields no summary");
  assert.equal(panel.summarize(file, "2026-09", [99]).counts.moveIns, 0, "unknown facility adds nothing");

  const markup = panel.render(all, "September 2026", true);
  const text = visible(markup);
  for (const label of ["CCStorage move-ins (non-void)", "Confirmed", "Credited", "Not recorded", "of which rented online, no campaign link", "Sources disagree", "Cost per rental, at least", "Platform-reported results are on the Google Ads"])
    assert.ok(text.includes(label), label);
  assert.match(text, /Credited coverage: 3 of 10 move-ins \(30% of move-ins\)/);
  assert.ok(text.includes("gads_albany_search: $150.00 ($300.00 spend, 2 credited)"));
  assert.doesNotMatch(text, /attributed|total attributed|combined/i, "no combined attribution figure");

  const dayOne = visible(panel.render(panel.summarize({ ...file, periods: [{ id: "2026-09", facilities: { 1: cell({ moveIns: 8, notRecorded: 8, notRecordedOnline: 2 }) }, cost: [] }] }, "2026-09", [1]), "September 2026", true));
  assert.match(dayOne, /Not recorded No evidence of source 8/, "Not recorded is always shown, with its count");
  assert.match(dayOne, /Credited coverage: 0 of 8 move-ins \(0% of move-ins\)/);
  assert.match(dayOne, /Needs a campaign mapped/, "no cost without a mapping");

  assert.match(visible(panel.render(all, "September 2026", false)), /Shown for all facilities only/, "cost is withheld for a facility subset");
  assert.match(visible(panel.render(null, "June 2026", true)), /No source data for this month/);
  assert.doesNotMatch(panel.render(panel.summarize({ ...file, periods: [{ id: "2026-09", facilities: { 1: cell({ creditedBySlug: { "<b>x</b>": 1 }, creditedLease: 1, moveIns: 1 }) }, cost: [{ slug: "<u onclick=1>", creditedRentals: 1, spend: 1, costPerRentalAtLeast: 1 }] }] }, "2026-09", [1]), "<script>", true), /<script>|<u onclick|<b>x/, "escaped");

  const titles = panel.definitions.map(item => item[0]);
  for (const title of ["Source of rentals", "Confirmed", "Credited", "Not recorded", "Sources disagree", "Cost per rental, at least"]) assert.ok(titles.includes(title), `definition ${title}`);

  // Wiring: private host only. The section is removed and never fetched on the public host; the file is not a public data file.
  const index = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const app = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
  assert.ok(index.indexOf('src="sources.js"') > index.indexOf('src="app.js"'));
  assert.match(app, /if\(onPublicHost\)\$\('#sources-panel'\)\?\.remove\(\);/);
  assert.match(app, /if\(!onPublicHost\)globalThis\.sourcesPanel\?\.update\(/);
  assert.match(app, /if\(!onPublicHost\)\$\('#sources-info'\)\.onclick=openDefinitions;/);
  assert.match(panel.DATA_URL, /^data\/restricted\//);
  const sourceText = fs.readFileSync(path.join(ROOT, "sources.js"), "utf8");
  assert.doesNotMatch(sourceText, /localStorage|sessionStorage|document\.cookie/);
  console.log("sources panel: evidence partition, honest day-one reading, no combined figure, private host only");
}

run();
