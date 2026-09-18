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

  const details = fs.readFileSync(path.join(ROOT, "details.js"), "utf8");
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
