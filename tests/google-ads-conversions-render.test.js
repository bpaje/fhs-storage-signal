"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const conversions = require(path.join(ROOT, "google-ads-conversions.js"));

function run() {
  const split = {
    conversionsByGroup: {
      leads_and_calls: 4,
      phone_clicks: 2,
      button_clicks: 8,
      store_visits: 1,
      rentals: 0,
      other: 1,
    },
    conversionsByAction: [
      {id:"1", name:"GA4 generate_lead", category:"SUBMIT_LEAD_FORM", group:"leads_and_calls", conversions:4},
      {id:"2", name:"GA4 begin_checkout", category:"BEGIN_CHECKOUT", group:"button_clicks", conversions:8},
    ],
  };
  const card = conversions.renderLeadCard(400, split);
  const breakdown = conversions.renderBreakdown(split);
  assert.match(card, /Leads &amp; calls/);
  assert.match(card, /Cost \/ lead &amp; call: \$100\.00/);
  assert.match(breakdown, /Conversions by type/);
  assert.match(breakdown, /Rent Now \/ Pay bill button clicks/);
  assert.match(breakdown, /50%/);
  assert.match(breakdown, /View conversion actions/);
  assert.match(breakdown, /GA4 begin_checkout/);

  assert.equal(conversions.renderLeadCard(400, null), "");
  assert.equal(conversions.renderBreakdown(null), "");
  assert.equal(conversions.aggregate([{id:"old"}]), null);

  const aggregate = conversions.aggregate([
    {...split, conversionsByGroup:{...split.conversionsByGroup}},
    {
      conversionsByGroup:{leads_and_calls:1, phone_clicks:0, button_clicks:0, store_visits:0, rentals:1, other:0},
      conversionsByAction:[{id:"1", name:"GA4 generate_lead", category:"SUBMIT_LEAD_FORM", group:"leads_and_calls", conversions:1}],
    },
  ]);
  assert.equal(aggregate.conversionsByGroup.leads_and_calls, 5);
  assert.equal(aggregate.conversionsByGroup.rentals, 1);
  assert.equal(aggregate.conversionsByAction.find(action => action.id === "1").conversions, 5);

  // Campaign table: cost per lead and call = that campaign's cost / its Leads & calls count (not a cost per renter).
  const campaign = counts => ({costMicros: 400_000_000, conversionsByGroup: {...split.conversionsByGroup, leads_and_calls: counts}, conversionsByAction: split.conversionsByAction});
  assert.equal(conversions.costPerLeadAndCall(campaign(4)), 100);
  assert.equal(conversions.costPerLeadAndCall(campaign(3)), 400 / 3, "no rounding before display");
  assert.equal(conversions.costPerLeadAndCall(campaign(2.5)), 160, "fractional counts divide as given");
  assert.equal(conversions.costPerLeadAndCall(campaign(0)), null, "zero Leads & calls is null, never Infinity or 0");
  assert.equal(conversions.costPerLeadAndCall({costMicros: 0, conversionsByGroup: {leads_and_calls: 2}}), 0);
  assert.equal(conversions.costPerLeadAndCall({costMicros: 400_000_000}), null, "rows without the conversion split stay null");
  assert.equal(conversions.costPerLeadAndCall(null), null);
  assert.equal(conversions.costPerLeadAndCall(campaign(4)), conversions.summary(400, split).costPerLeadAndCall, "matches the account-level card arithmetic");
  const published = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "google-ads.json"), "utf8"));
  const withLeads = published.campaigns.filter(row => row.conversionsByGroup?.leads_and_calls > 0);
  assert.ok(withLeads.length > 0);
  for (const row of published.campaigns) {
    const leads = row.conversionsByGroup?.leads_and_calls;
    assert.equal(conversions.costPerLeadAndCall(row), leads ? row.costMicros / 1e6 / leads : null);
  }

  const details = fs.readFileSync(path.join(ROOT, "details.js"), "utf8");
  assert.match(details, /row\.costPerLeadAndCall=googleAdsConversions\.costPerLeadAndCall\(row\)/);
  assert.match(details, /\['costPerLeadAndCall','Cost \/ lead & call','money'\]/);
  assert.match(details, /not a cost per renter/);
  const overview = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
  const styles = fs.readFileSync(path.join(ROOT, "styles.css"), "utf8");
  assert.match(details, /Conversions \(Google, all primary\)/);
  assert.match(details, /Leads & calls/);
  assert.match(details, /begin_checkout has been imported from GA4 since 2026-08-28/);
  assert.match(overview, /Google counts \$\{fmt\(p\.google\.conversions\)\} conversions incl\./);
  assert.match(styles, /\.conversion-breakdown/);
  assert.match(styles, /\.channel-row \{ grid-template-columns: repeat\(2,minmax\(0,1fr\)\); min-width: 0;/);
  console.log("headless Google Ads conversion card, breakdown, fallback, aggregation, and mobile layout checks passed");
}

run();
