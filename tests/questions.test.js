"use strict";

// Questions tab: every question answered or marked with what unblocks it, private data never used on the public host,
// platform results never added together, partial months compared per day, and alerts only for live data problems.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const board = require("../questions.js");

const ROOT = path.join(__dirname, "..");
const facility = (id, over = {}) => ({ id, name: `Facility ${id}`, net: 1000, refunds: 0, moveIns: 3, moveOuts: 1, leases: 80, units: 100, occupancy: 0.8, ...over });
const month = (id, start, end, partial, over = {}) => ({
 id, label: id, start, end, partial,
 google: { spend: 300, impressions: 1, clicks: 1, conversions: 12, conversionsByGroup: { leads_and_calls: 6, phone_clicks: 2, button_clicks: 4, store_visits: 0, rentals: 0, other: 0 } },
 meta: { spend: 100, leads: 5 }, reportingViewVolume: 1800,
 facilities: [facility("1"), facility("2", { units: 50, leases: 20, occupancy: 0.4, moveIns: 1, moveOuts: 4 })], ...over,
});
const report = { schema: "storage-signal.reporting.v1", refreshed: "2026-10-29", ccExtractedAt: "2026-10-29T09:00:00+00:00", periods: [month("2026-09", "2026-09-01", "2026-09-30", false), month("2026-10", "2026-10-01", "2026-10-15", true)] };
const ads = {
 through: "2026-10-15",
 accountTotals: [{ month: "2026-10", costMicros: 300e6 }],
 validation: { reconciliation: { "2026-10": { campaigns: { exactDeliveryTotals: true }, groups: { exactDeliveryTotals: true } } } },
 campaigns: [{ month: "2026-10", name: "Idle <b>search</b>", costMicros: 120e6, clicks: 9, conversions: 2, conversionsByGroup: { leads_and_calls: 0 } }, { month: "2026-10", name: "Working", costMicros: 180e6, clicks: 20, conversions: 10, conversionsByGroup: { leads_and_calls: 6 } }],
};
const meta = { through: "2026-10-15", periods: { "2026-10": { account: { spend: 100 }, campaigns: [{ name: "Leads", spend: 100, leads: 5, linkClicks: 30 }] } } };
const ga = { through: "2026-10-15", periods: { "2026-10": { summary: { totalUsers: 900, keyEvents: 120 } } } };
const restatements = { current: { ccExtractedAt: report.ccExtractedAt, cutoff: "2026-10-15" }, previous: { cutoff: "2026-10-13" }, months: [{ id: "2026-09", status: "restated", changes: [{ metric: "net", label: "Net recorded payments", kind: "money", previous: 2012.5, current: 2000, difference: -12.5 }], facilities: [{ id: "1", name: "Facility 1", metric: "net", label: "Net recorded payments", kind: "money", previous: 1012.5, current: 1000, difference: -12.5 }] }, { id: "2026-10", status: "extended", changes: [], facilities: [] }] };
const portfolio = { moveIns: 4, confirmed: 1, disagree: 0, creditedLease: 0, creditedOnline: 0, notRecorded: 3, notRecordedOnline: 1 };
const sources = { mappedCampaigns: [], periods: [{ id: "2026-09", portfolio: { ...portfolio, confirmed: 0, notRecorded: 4 } }, { id: "2026-10", portfolio, cost: [] }] };
const leads = { summary: { leads: 40, confirmed: 2, possible: 1, confirmed_new_renters: 1, already_tenants: 1, median_days_to_move_in: 9, reconciliation: [{ month: "2026-10", lead_records: 6, meta_account_leads: 5 }] }, leads: [{ created_date: "2026-10-02", match: { status: "confirmed" } }, { created_date: "2026-10-03", match: { status: "none" } }, { created_date: "2026-09-03", match: { status: "none" } }] };
const day = (date, over = {}) => ({ date, pageViews: 200, checkoutStarts: 30, formSubmits: 1, contacts: 2, portalPageViews: 40, rentalsCompleted: 0, googleClicks: 20, googleConversions: 5, metaLeads: 1, ...over });
const trackingDays = Array.from({ length: 30 }, (_, i) => day(`2026-10-${String(i + 1).padStart(2, "0")}`)).slice(0, 15);
const tracking = {
 coverage: { ga4: { start: "2026-08-13", lastExportedDay: "2026-10-14" } }, rule: { typicalDays: 14, minTypical: 10, ratio: 0.25 },
 series: [{ key: "pageViews", label: "Website page views" }, { key: "googleClicks", label: "Google Ads clicks" }],
 days: trackingDays.map(d => d.date === "2026-10-15" ? { ...d, pageViews: null } : d),
 months: [{ id: "2026-10", ga4Days: 14, days: 15, visitors: 800, checkoutVisitors: 100, rentalEvents: 1, moveIns: 4, onlineMoveIns: 2 }],
 flags: [{ series: "pageViews", label: "Website page views", from: "2026-10-03", to: "2026-10-04", days: 2, lowest: 0, typical: 200 }],
};
const now = Date.parse("2026-10-16T12:00:00Z");
const base = { report, ads, meta, ga, restatements, periodId: "2026-10", now };
const privateContext = { ...base, isPublic: false, sources, leads, tracking, budgets: { months: {} } };
const find = (result, id) => result.groups.flatMap(g => g.questions).find(q => q.id === id);
const visible = markup => markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

function run() {
 const priv = board.answer(privateContext);
 const all = priv.groups.flatMap(g => g.questions);
 assert.deepEqual(priv.groups.map(g => g.title), ["CEO", "CMO", "Finance and audit", "Builder"]);
 assert.equal(all.length, 20);
 assert.equal(new Set(all.map(q => q.id)).size, 20, "question ids are unique");
 for (const q of all) {
  assert.ok(board.STATUS[q.status], `${q.id} has a known status`);
  assert.ok(q.headline && !/undefined|NaN/.test(q.headline + JSON.stringify(q.facts) + JSON.stringify(q.table)), `${q.id} renders real values`);
  if (q.status === "blocked") assert.ok(q.unblock || /rule/.test(q.headline) || /not available/.test(q.headline), `${q.id} says what would unblock it`);
 }
 assert.equal(priv.counts.private, 0, "the private host answers every question itself");

 // Partial months compare per day; complete months compare totals.
 assert.equal(board.versus(165, 300, report.periods[1], report.periods[0]), "+10% per day vs September");
 assert.equal(board.versus(150, 300, report.periods[1], report.periods[0]), "0% per day vs September");
 assert.equal(board.versus(330, 300, report.periods[0], { ...report.periods[0], id: "2026-08", partial: false }), "+10% vs August");
 assert.match(find(priv, "ceo-growth").headline, /^Gaining: 4 move-ins and 5 move-outs|^Losing: 4 move-ins and 5 move-outs in October 1–15, net −1\.$/);

 // Platform results are listed side by side, never added into one lead or rental number.
 const cpl = find(priv, "cmo-cost-per-lead");
 assert.match(cpl.headline, /Google Ads: \$50\.00 per lead or call\. Meta Ads: \$20\.00 per lead\./);
 const claims = find(priv, "fin-claims");
 assert.ok(!claims.table.rows.some(r => /total|combined|all platforms/i.test(r[0])), "no combined platform row");
 assert.doesNotMatch(JSON.stringify(all), /\b11 (leads|results)\b/, "6 Google leads & calls + 5 Meta leads are never summed");

 // Campaigns spending without results, escaped when rendered.
 const waste = find(priv, "cmo-waste");
 assert.match(waste.headline, /\$120\.00 \(30% of ad spend\) went to 1 campaign with no platform-reported leads or calls/);
 assert.doesNotMatch(board.renderQuestion(waste), /<b>search<\/b>/, "campaign names are escaped");

 // Cost per renter is never a blended spend ÷ move-ins figure.
 const cost = find(priv, "ceo-cost-per-renter");
 assert.equal(cost.status, "blocked");
 assert.match(cost.headline, /only 1 of 4 move-ins/);
 assert.doesNotMatch(JSON.stringify(cost), /\$100\.00 per (renter|move-in)|\$400/, "no blended cost per move-in");

 // Audit answers.
 assert.match(find(priv, "fin-tie-out").headline, /^Yes\./);
 const broken = board.answer({ ...privateContext, ads: { ...ads, accountTotals: [{ month: "2026-10", costMicros: 299e6 }] } });
 assert.equal(find(broken, "fin-tie-out").alert, true, "a spend mismatch needs attention");
 assert.match(find(priv, "fin-restated").headline, /1 past month was revised since the Oct 13 snapshot: September net recorded payments −\$12\.50/);
 assert.deepEqual(find(priv, "fin-restated").table.rows, [["September", "Net recorded payments, all facilities", "$2,012.50", "$2,000.00", "−$12.50"], ["", "↳ Facility 1", "$1,012.50", "$1,000.00", "−$12.50"]]);
 const stale = board.answer({ ...privateContext, restatements: { ...restatements, current: { ccExtractedAt: "older" } } });
 assert.equal(find(stale, "fin-restated").status, "partial");
 assert.match(find(priv, "fin-payment-gap").headline, /\+\$200\.00 \(\+11\.1%\).*higher in every month/);

 // Tracking heartbeat: a resolved outage is reported, not alerted; a live one is.
 const beat = find(priv, "dev-heartbeat");
 assert.equal(beat.alert, false);
 assert.match(beat.headline, /^Yes, every signal is firing on its latest day\. The last outage was Oct 3–4: website page views fell to 0 a day/);
 assert.ok(beat.spark.every(s => s.values.length === 15));
 const live = board.answer({ ...privateContext, tracking: { ...tracking, flags: [{ ...tracking.flags[0], from: "2026-10-12", to: "2026-10-14" }] } });
 assert.equal(find(live, "dev-heartbeat").alert, true);
 assert.match(find(live, "dev-heartbeat").headline, /^No: website page views has been down since Oct 12/);
 assert.match(board.renderQuestion(find(live, "dev-heartbeat")), /Needs attention/);
 assert.match(find(priv, "dev-freshness").headline, /^Yes: all four sources run through Oct 15, 1 day ago/);

 // Budget: blocked until the owner records one, then paced against elapsed days.
 assert.equal(find(priv, "cmo-budget").status, "blocked");
 const paced = find(board.answer({ ...privateContext, budgets: { months: { "2026-10": { google: 620, meta: 310 } } } }), "cmo-budget");
 assert.equal(paced.status, "answered");
 assert.match(paced.headline, /Google Ads: \$300\.00 of \$620\.00 \(48\.4%\) with 48\.4% of the month elapsed/);

 // Public host: no restricted file is read, restricted questions say so, and no restricted number leaks.
 const pub = board.answer({ ...base, isPublic: true, sources, leads, tracking, budgets: { months: { "2026-10": { google: 1 } } } });
 const restrictedIds = ["cmo-sources", "cmo-lead-conversion", "fin-lead-records", "dev-heartbeat", "dev-evidence"];
 for (const id of restrictedIds) assert.equal(find(pub, id).status, "private", `${id} is private-only on the public host`);
 const pubText = JSON.stringify(pub);
 assert.doesNotMatch(pubText, /Website page views|online move-ins against|Confirmed Meta lead matches|lead records against|800 website visitors|of 40 Meta leads|only 1 of 4/i, "no restricted data on the public host");
 assert.equal(find(pub, "cmo-budget").status, "blocked");
 assert.equal(find(pub, "ceo-cost-per-renter").facts.length, 0);

 const page = board.render(pub);
 assert.match(visible(page), /20 questions for October 1–15/);
 assert.match(page, /Private host only/);

 // Wiring: loaded after details.js, nav and section present, private files fetched only off the public host.
 const index = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
 const details = fs.readFileSync(path.join(ROOT, "details.js"), "utf8");
 const source = fs.readFileSync(path.join(ROOT, "questions.js"), "utf8");
 assert.ok(index.indexOf('src="questions.js"') > index.indexOf('src="details.js"'));
 assert.match(index, /data-view="questions"/);
 assert.match(index, /id="questions-root"/);
 assert.match(index, /href="questions.css"/);
 assert.match(details, /detail\.view==='questions'.*questionsBoard\?\.update\(\)/);
 assert.match(source, /\.\.\.\(isPublic \? \{\} : PRIVATE_FILES\)/);
 assert.doesNotMatch(source, /localStorage|sessionStorage|document\.cookie/);
 console.log("questions tab: 20 questions answered or blocked with a reason, public host safe, no combined platform numbers");
}

run();
