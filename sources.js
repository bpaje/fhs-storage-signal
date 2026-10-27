"use strict";

// "Source of rentals" panel (docs/ATTRIBUTION_PLAN.md). Private host only: app.js removes the section on the public host
// and never calls update() there. Rows are an evidence partition of CCStorage move-ins; they are never added into one
// "attributed" figure. Platform-reported results stay on their own tabs.
(function (root, factory) {
 const api = factory();
 if (typeof module !== "undefined" && module.exports) module.exports = api;
 if (root) root.sourcesPanel = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
 const SCHEMA = "storage-signal.sources.v1";
 const DATA_URL = "data/restricted/tenants-sources.json";
 const COUNT_KEYS = ["moveIns", "confirmed", "disagree", "creditedLease", "creditedOnline", "notRecorded", "notRecordedOnline"];
 let dataPromise;
 let data;
 let unavailable = false;

 const definitions = [
  ["Source of rentals", "Each non-void CCStorage move-in in the selected month and facilities is counted once, under the strongest evidence of where the renter came from. Rows are never added into one attributed number. Nothing is modeled or guessed from campaign names."],
  ["Confirmed", "A Meta lead whose email or phone exactly matches the renter's CCStorage record, where the lead came before the move-in. It shows the renter responded to a Meta form. It does not prove the ad caused the rental, and Meta pre-fills forms, so matches are a lower bound. Renters who were already tenants are not counted."],
  ["Credited", "A source recorded in CCStorage itself: the campaign credited on the lease at move-in, or the campaign link on the online checkout that became the lease. It is only as good as what staff or the checkout recorded."],
  ["Not recorded", "No evidence of source in the rows above. This is not a measure of organic or direct rentals. The online sub-line counts rentals made through online checkout without a campaign link: the channel is known (the website), the source is not."],
  ["Sources disagree", "The campaign credited in CCStorage maps (through data/sources-mapping.json) to a different Meta campaign than the matched lead. Both are real evidence, so no winner is picked and the move-in appears only here."],
  ["Cost per rental, at least", "Spend of the campaigns mapped to a CCStorage campaign slug divided by that slug's Credited rentals. It excludes rentals that were never credited, so the real cost per rental is this figure or lower. Shown only for all facilities, because spend is not split across facilities."],
 ];

 const html = value => String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
 const number = value => new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Number(value || 0));
 const money = value => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(Number(value || 0));
 const blank = () => ({ ...Object.fromEntries(COUNT_KEYS.map(key => [key, 0])), creditedBySlug: {} });

 function summarize(file, periodId, ids) {
  const period = file?.periods?.find(item => item.id === periodId);
  if (!period) return null;
  const total = blank();
  for (const id of ids) {
   const cell = period.facilities[String(id)];
   if (!cell) continue;
   for (const key of COUNT_KEYS) total[key] += cell[key];
   for (const [slug, count] of Object.entries(cell.creditedBySlug || {})) total.creditedBySlug[slug] = (total.creditedBySlug[slug] || 0) + count;
  }
  return { counts: total, cost: period.cost || [] };
 }

 function row(label, detail, value, className = "") {
  return `<div class="outcome-row sources-row ${className}"><div><strong>${html(label)}</strong>${detail ? `<small>${html(detail)}</small>` : ""}</div><div><b>${html(value)}</b></div></div>`;
 }

 function render(summary, label, allFacilities) {
  if (!summary) return `<div class="outcome-row"><div><strong>No source data for this month</strong><small>The private source file does not cover ${html(label)}.</small></div><div><b>n/a</b></div></div>`;
  const c = summary.counts;
  const credited = c.creditedLease + c.creditedOnline;
  const share = c.moveIns ? `${Math.round(credited / c.moveIns * 100)}% of move-ins` : "no move-ins";
  const cost = !allFacilities
   ? "Shown for all facilities only: spend is account-wide and is never split across facilities."
   : summary.cost.length
    ? summary.cost.map(item => `${item.slug}: ${money(item.costPerRentalAtLeast)} (${money(item.spend)} spend, ${number(item.creditedRentals)} credited)`).join(" · ")
    : "Needs a campaign mapped in data/sources-mapping.json that has credited rentals.";
  return [
   row("CCStorage move-ins (non-void)", `${label} · selected facilities`, number(c.moveIns), "sources-total"),
   `<p class="report-note sources-heading">Evidence of source: a move-in counts once, strongest evidence first.</p>`,
   row("Confirmed", "Meta lead matched to the renter", number(c.confirmed)),
   row("Credited", "Campaign on the lease at move-in", number(c.creditedLease)),
   row("Credited", "Campaign link on the online checkout", number(c.creditedOnline)),
   row("Not recorded", "No evidence of source", number(c.notRecorded), "sources-not-recorded"),
   row("of which rented online, no campaign link", "Channel known (website), source not", number(c.notRecordedOnline), "sources-sub"),
   row("Sources disagree", "Credited campaign differs from the matched lead", number(c.disagree)),
   `<p class="report-note">Credited coverage: ${number(credited)} of ${number(c.moveIns)} move-ins (${html(share)}). This is the adoption measure for recording a source at move-in.</p>`,
   `<p class="report-note"><strong>Cost per rental, at least:</strong> ${html(cost)}</p>`,
   `<p class="report-note">Platform-reported results are on the Google Ads, Google Analytics and Meta Ads tabs. They are not part of these rows and are never added to them.</p>`,
  ].join("");
 }

 function load() {
  if (!dataPromise) {
   dataPromise = fetch(DATA_URL, { cache: "no-store" })
    .then(response => { if (!response.ok) throw new Error("Source data unavailable"); return response.json(); })
    .then(file => { if (file.schema !== SCHEMA || !Array.isArray(file.periods)) throw new Error("Invalid source data"); data = file; return file; })
    .catch(error => { unavailable = true; console.warn(error.message); return null; });
  }
  return dataPromise;
 }

 function paint(options) {
  const container = document.getElementById("sources-body");
  const note = document.getElementById("sources-subtitle");
  if (!container) return;
  if (unavailable || !data) {
   container.innerHTML = row("Source data is not available on this host", "The private source file has not been deployed here.", "n/a");
   return;
  }
  const period = data.periods.find(item => item.id === options.periodId);
  const ids = options.ids || [];
  const allFacilities = ids.length > 0 && period && ids.length >= options.allCount;
  if (note) note.textContent = `Data through ${data.cutoff} · private`;
  container.innerHTML = render(summarize(data, options.periodId, ids), options.periodLabel || options.periodId, allFacilities);
 }

 function update(options) {
  if (typeof document === "undefined") return Promise.resolve();
  return load().then(() => paint(options));
 }

 return { SCHEMA, DATA_URL, COUNT_KEYS, definitions, summarize, render, update };
});
