"use strict";

// Cost per confirmed renter uses only calendar months the selected lead-date range fully covers. Synthetic data only.
const assert = require("node:assert/strict");
const path = require("node:path");

const journeys = require(path.join(__dirname, "..", "journeys.js"));

const renter = (days = 5) => ({ status: "confirmed", label: "Confirmed via email", multiple: false, matches: [{ customer_id: "synthetic", company_id: "1", via: "email", timing: "moved in after lead", days_to_move_in: days, payments: { count: 1, net: "10.00" } }] });
const lead = (id, date, match) => ({ id, created_date: date, created_time: `${date}T12:00:00Z`, form: "Synthetic Form", campaign: { key: "campaign-one", name: "Synthetic Campaign", source: "formAds" }, adset: "Set", ad: "Ad", platform: "facebook", organic: false, display_name: `Synthetic Lead ${id}`, answers: {}, match });
const none = { status: "none", label: "No renter match", multiple: false, matches: [] };
const possible = { status: "possible", label: "Possible match - unconfirmed", multiple: false, matches: [{ customer_id: "synthetic-2", company_id: "1", via: "name and timing", timing: "moved in after lead", days_to_move_in: 9 }] };

const data = {
  schema: "storage-signal.leads.v1",
  cutoff: "2026-09-17",
  summary: { reconciliation_note: "synthetic", later_leads_excluded: 0 },
  byCampaign: [{ key: "campaign-one", name: "Synthetic Campaign", meta_spend: 590, spend_by_month: { "2026-07": 300, "2026-08": 200, "2026-09": 90 } }],
  leads: [
    lead("1", "2026-07-20", renter()),
    lead("2", "2026-08-05", renter()),
    lead("3", "2026-08-25", none),
    lead("4", "2026-08-27", possible),
    lead("5", "2026-09-03", renter()),
  ],
  byCustomer: {},
};

const view = (from, to, extra = {}) => ({ ...journeys.initialLeadView(data), preset: "custom", from, to, ...extra });
const row = (from, to, extra) => journeys.campaignRows(data, view(from, to, extra))[0];

function run() {
  // Which months count: first day AND last data day (month end, or the cutoff for the latest month) must be inside the range.
  const covered = (from, to, cutoff = "2026-09-17") => journeys.coveredMonths(from, to, cutoff);
  assert.deepEqual(covered("2026-07-15", "2026-08-20"), [], "two partial months cover nothing");
  assert.deepEqual(covered("2026-07-01", "2026-08-20"), ["2026-07"]);
  assert.deepEqual(covered("2026-07-02", "2026-08-31"), ["2026-08"]);
  assert.deepEqual(covered("2026-08-01", "2026-08-31"), ["2026-08"]);
  assert.deepEqual(covered("2026-08-02", "2026-08-31"), [], "range starting after the first day does not cover the month");
  assert.deepEqual(covered("2026-08-01", "2026-08-30"), [], "range ending before the month end does not cover the month");
  assert.deepEqual(covered("2026-08-01", "2026-09-17"), ["2026-08", "2026-09"], "latest month is covered through the cutoff");
  assert.deepEqual(covered("2026-08-01", "2026-09-16"), ["2026-08"]);
  assert.deepEqual(covered("2026-06-01", "2026-09-17"), ["2026-06", "2026-07", "2026-08", "2026-09"]);
  assert.deepEqual(covered("2028-02-01", "2028-02-29", "2028-12-31"), ["2028-02"], "leap February");
  assert.deepEqual(covered("2027-02-01", "2027-02-28", "2027-12-31"), ["2027-02"]);
  assert.deepEqual(covered("2026-12-01", "2027-01-31", "2027-06-30"), ["2026-12", "2027-01"], "year boundary");
  assert.deepEqual(covered("2026-09-01", "2026-09-10", "2026-09-17"), [], "part of the latest month is not covered");

  // REGRESSION: a range spanning two months partially. The old code summed whole-month spend ($300 + $200) for every month
  // touched by an in-range lead but counted renters only inside the range ($250 per renter). Now nothing is fully covered.
  const partial = row("2026-07-15", "2026-08-20");
  assert.equal(partial.spend, null);
  assert.equal(partial.cost, null);
  const partialMarkup = journeys.renderLeadsView(data, view("2026-07-15", "2026-08-20"));
  assert.match(partialMarkup, /Spend per confirmed renter is n\/a: no calendar month is fully inside the selected dates/);
  assert.doesNotMatch(partialMarkup, /\$250\.00/);
  assert.doesNotMatch(partialMarkup, /\$500\.00/);
  assert.match(partialMarkup, /At least — leads may use other contact details/);

  // One covered month plus one partial month: spend, leads and renters all come from the covered month only.
  const julyOnly = row("2026-07-01", "2026-08-20");
  assert.equal(julyOnly.leads, 1);
  assert.equal(julyOnly.newRenters, 1);
  assert.equal(julyOnly.spend, 300);
  assert.equal(julyOnly.cost, 300, "old behaviour gave (300 + 200) / 2 = 250");
  const julyMarkup = journeys.renderLeadsView(data, view("2026-07-01", "2026-08-20"));
  assert.match(julyMarkup, /calendar months fully inside the selected dates: July 2026\./);
  assert.match(julyMarkup, /<strong>\$300\.00<\/strong><small>At least — leads may use other contact details<\/small>/);

  // A full month: Confirmed counts only new renters; Possible stays separate and never enters the cost.
  const august = row("2026-08-01", "2026-08-31");
  assert.deepEqual([august.leads, august.newRenters, august.possible, august.spend, august.cost], [3, 1, 1, 200, 200]);

  // The latest month is covered through the cutoff; a range ending a day earlier excludes it.
  const through = row("2026-08-01", "2026-09-17");
  assert.deepEqual([through.leads, through.newRenters, through.spend, through.cost], [4, 2, 290, 145]);
  assert.match(journeys.renderLeadsView(data, view("2026-08-01", "2026-09-17")), /August 2026, September 2026\./);
  const early = row("2026-08-01", "2026-09-16");
  assert.deepEqual([early.leads, early.newRenters, early.spend, early.cost], [3, 1, 200, 200]);

  // Existing filters still apply; no renters means no cost, never zero.
  assert.equal(row("2026-08-01", "2026-08-31", { match: "none" }).cost, null);
  assert.equal(row("2026-08-01", "2026-08-31", { match: "none" }).newRenters, 0);

  // A campaign with no recorded spend for the covered months shows n/a, not a fallback total.
  const noSpend = { ...data, byCampaign: [{ key: "campaign-one", name: "Synthetic Campaign", meta_spend: 590, spend_by_month: { "2026-07": 300 } }] };
  const noSpendRow = journeys.campaignRows(noSpend, { ...journeys.initialLeadView(noSpend), preset: "custom", from: "2026-08-01", to: "2026-08-31" })[0];
  assert.equal(noSpendRow.spend, null);
  assert.equal(noSpendRow.cost, null);

  console.log("cost per confirmed renter: covered-month rule, partial-range regression, cutoff month and filters passed");
}

run();
