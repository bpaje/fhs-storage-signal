"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const tenants = require(path.join(ROOT, "tenants.js"));
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "tenants-ui.json"), "utf8"));
const built = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "tenants-built-profiles.json"), "utf8"));
const visualFixture = require(path.join(__dirname, "fixtures", "tenants-visual-fixture.js"));

function run() {
  const syntheticNames = ["Avery Example", "Morgan Sample"];
  const publicFiles = ["index.html", "app.js", "details.js", "styles.css"]
    .map(name => fs.readFileSync(path.join(ROOT, name), "utf8"))
    .join("\n");
  for (const name of syntheticNames) assert.doesNotMatch(publicFiles, new RegExp(name));

  const view = tenants.createInitialView(fixture.index);
  const page = tenants.renderTenantView(fixture.index, view);
  assert.match(page, /tenant-filter-bar/);
  assert.match(page, /Move-ins/);
  assert.match(page, /Avery Example/);
  assert.doesNotMatch(page, /\b(?:export|csv|print)\b/i);

  const searchedPage = tenants.renderTenantView(fixture.index, { ...view, search: "Avery" });
  assert.equal((searchedPage.match(/Filtered by search/g) || []).length, 6);
  assert.equal(tenants.dialogHeaderText("Collected", true), "Collected · Filtered by search");

  const paymentRows = tenants.scoped(fixture.index, view).payments;
  const dialog = tenants.renderScorecardDialog("Collected", "payments", paymentRows);
  assert.match(dialog, /PAY-FIX-001/);
  assert.match(dialog, /Avery Example/);
  assert.match(dialog, /\$90\.00 collected/);

  let profile;
  assert.doesNotThrow(() => {
    profile = tenants.renderProfile(built.north.profiles["customer-1"], built.north.facility.name);
  });
  assert.match(profile, /Avery Example/);
  assert.match(profile, /Customer #C-FIX-001/);
  assert.match(profile, /Drive up, Gated/);
  assert.match(profile, /Still renting/);
  assert.match(profile, /\$25\.00 collected[^<]*Not returned/);
  assert.match(profile, /Alternate contact<\/h4><p>Not recorded/);
  assert.match(profile, /Payment history starts when this facility joined CCStorage\./);
  assert.doesNotMatch(profile, /\b(?:export|csv|print)\b/i);

  const movedOut = tenants.renderProfile(built.north.profiles["customer-2"], built.north.facility.name);
  assert.match(movedOut, /\$30\.00 collected[^<]*\$30\.00 returned/);
  assert.match(movedOut, />2026-08-20<\/td>/);
  assert.doesNotMatch(movedOut, /Scheduled 2026-08-20/);

  const scheduled = tenants.renderProfile(built.south.profiles["customer-3"], built.south.facility.name);
  assert.match(scheduled, /Scheduled 2026-09-30/);

  assert.equal(tenants.normalizeUnitFootprint("10 x 20"), "10x20");
  assert.equal(tenants.normalizeUnitFootprint("10x10x8"), "10x10");
  assert.equal(tenants.normalizeUnitFootprint("5x5x0"), "5x5");
  assert.equal(tenants.normalizeUnitFootprint("Parking"), "Parking");

  const visualView = tenants.createInitialView(visualFixture.index);
  const visualPage = tenants.renderTenantView(visualFixture.index, visualView);
  assert.match(visualPage, /tenant-chart-gridline/);
  assert.match(visualPage, /tenant-bar-value/);
  assert.match(visualPage, /Aug 31/);
  assert.match(visualPage, /Synthetic Tenant 1 With an Intentionally Long Display Name/);
  const sizeMix = tenants.sizeMixChart(visualFixture.index.moveIns);
  assert.match(sizeMix, />10x10</);
  assert.match(sizeMix, />10x20</);
  assert.match(sizeMix, />5x5</);
  assert.match(sizeMix, />Other</);
  assert.doesNotMatch(sizeMix, />10x10x8</);
  const singleWeek = tenants.weeklyChart([visualFixture.index.moveIns[0]], [], "2026-08-01", "2026-08-02");
  assert.match(singleWeek, /width="44"/);
  assert.match(singleWeek, /Jul 27/);
  console.log("headless Tenants tab, scorecard dialog, search notes, and builder-output profiles passed");
}

run();
