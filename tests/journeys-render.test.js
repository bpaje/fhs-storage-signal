"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const journeys = require(path.join(ROOT, "journeys.js"));
const tenants = require(path.join(ROOT, "tenants.js"));
const fixture = require(path.join(__dirname, "fixtures", "journeys-visual-fixture.js"));
const tenantFixture = require(path.join(__dirname, "fixtures", "tenants-visual-fixture.js"));

function run() {
  const leadView = journeys.initialLeadView(fixture.leads);
  const leadsMarkup = journeys.renderLeadsView(fixture.leads, leadView);
  assert.match(leadsMarkup, /journey-filter-bar/);
  assert.match(leadsMarkup, /Confirmed renters \(new\)/);
  assert.match(leadsMarkup, /Synthetic Tenant 1 With an Intentionally Long Display Name/);
  assert.match(leadsMarkup, /At least — leads may use other contact details/);
  assert.doesNotMatch(leadsMarkup, /\b(?:export|csv|print)\b/i);

  const lead = fixture.leads.leads[0];
  const leadDialog = journeys.renderLeadDialog(lead);
  assert.match(leadDialog, /Lead journey|Meta lead/);
  assert.match(leadDialog, /Confirmed via email/);
  assert.match(leadDialog, /View renter profile/);
  assert.match(leadDialog, /\$500\.00 net/);

  const profile = Object.values(tenantFixture.facility.profiles)[0];
  const profileMarkup = tenants.renderProfile(profile, tenantFixture.facility.facility.name, [lead]);
  assert.match(profileMarkup, /Journey/);
  assert.match(profileMarkup, /Synthetic Campaign/);
  assert.match(profileMarkup, /Confirmed via email/);
  const emptyJourney = tenants.renderProfile(profile, tenantFixture.facility.facility.name, []);
  assert.match(emptyJourney, /No Meta lead found for this renter\./);

  const visitorView = journeys.initialVisitorView(fixture.visitors);
  const visitorsMarkup = journeys.renderVisitorsView(fixture.visitors, visitorView);
  assert.match(visitorsMarkup, /Website visitors can't yet be linked to named renters/);
  assert.match(visitorsMarkup, /First-touch channel mix/);
  assert.match(visitorsMarkup, /journey-channel-bar/);
  assert.match(visitorsMarkup, /a1b2c3d4e5f6/);
  assert.doesNotMatch(visitorsMarkup, /\b(?:export|csv|print)\b/i);

  const visitor = fixture.visitors.visitors[0];
  const timeline = journeys.renderVisitorDialog(visitor, fixture.timelines[visitor.vid]);
  assert.match(timeline, /Visitor timeline|Anonymous visitor/);
  assert.match(timeline, /page_view/);
  assert.match(timeline, /familyheirloomstorage\.com\/storage/);
  assert.doesNotMatch(timeline, /pseudo-fixture|\?utm_/);

  const publicFiles = ["index.html", "app.js", "details.js", "styles.css", "tenants.js", "journeys.js"]
    .map(name => fs.readFileSync(path.join(ROOT, name), "utf8"))
    .join("\n");
  for (const name of ["Possible Renter Example", "Unmatched Lead Example"])
    assert.doesNotMatch(publicFiles, new RegExp(name));
  assert.ok(publicFiles.includes("This data isn\\'t available on this site."));
  assert.match(publicFiles, /cache:\s*"no-store"/);

  const index = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  assert.ok(index.indexOf('src="tenants.js"') < index.indexOf('src="journeys.js"'), "journeys.js must load after shared tenant dialog code");
  console.log("headless Leads, lead journey, profile Journey, Visitors, and visitor timeline renders passed");
}

run();
