"use strict";

// Questions tab: the top-level questions a CEO, a CMO, a finance auditor and the dashboard's builder ask, each answered
// from the loaded snapshots with its evidence and its limits, or marked as not answerable yet with what would unblock it.
// Restricted questions (sources, leads, tracking, budgets) load private files only off the public host; on the public
// host they show "Private host only" and never fetch. Platform results are shown side by side and never added together.
(function (root, factory) {
 const api = factory();
 if (typeof module !== "undefined" && module.exports) module.exports = api;
 if (root) root.questionsBoard = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
 const PUBLIC_FILES = { restatements: "data/restatements.json", meta: "data/meta.json" };
 const PRIVATE_FILES = { sources: "data/restricted/tenants-sources.json", leads: "data/restricted/tenants-leads-index.json", tracking: "data/restricted/tracking.json", budgets: "data/restricted/budgets.json" };
 const STATUS = { answered: "Answered", partial: "Partly answered", blocked: "Not answerable yet", private: "Private host only" };
 const HEARTBEAT_DAYS = 28;

 const html = value => String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
 const isNum = value => typeof value === "number" && Number.isFinite(value);
 const number = value => isNum(value) ? new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value) : "n/a";
 const money = value => isNum(value) ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value) : "n/a";
 const percent = value => isNum(value) ? new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 }).format(value) : "n/a";
 const minus = text => text.replace(/^-/, "−");
 const signed = (value, kind = "number") => !isNum(value) ? "n/a" : (value > 0 ? "+" : value < 0 ? "−" : "") + (kind === "money" ? money(Math.abs(value)) : number(Math.abs(value)));
 const signedPct = value => !isNum(value) ? "n/a" : (value > 0 ? "+" : "") + minus(percent(value));
 const sum = (rows, key) => { const values = rows.map(row => row[key]).filter(isNum); return values.length ? values.reduce((a, b) => a + b, 0) : null; };
 const days = period => Math.round((Date.parse(period.end) - Date.parse(period.start)) / 864e5) + 1;
 const monthName = id => new Date(`${id}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });
 const shortDate = iso => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
 const span = (from, to) => from === to ? shortDate(from) : `${shortDate(from)}–${from.slice(0, 7) === to.slice(0, 7) ? Number(to.slice(8)) : shortDate(to)}`;
 const periodName = period => period.partial ? `${monthName(period.id)} ${Number(period.start.slice(8))}–${Number(period.end.slice(8))}` : monthName(period.id);
 const ids = rows => rows.map(row => row.id).sort().join(",");

 // Totals are compared as totals between complete months and as per-day averages when either month is partial.
 function versus(current, previous, period, prior) {
  if (!prior || !isNum(current) || !isNum(previous)) return "";
  const perDay = period.partial || prior.partial;
  const a = perDay ? current / days(period) : current, b = perDay ? previous / days(prior) : previous;
  if (!b) return "";
  return `${signedPct((a - b) / b)} ${perDay ? "per day " : ""}vs ${monthName(prior.id)}`;
 }

 function occupancy(rows) {
  const counted = rows.filter(row => isNum(row.units) && isNum(row.leases));
  const units = sum(counted, "units");
  return { rows: counted, value: units ? sum(counted, "leases") / units : null };
 }

 function ask(id, question, fields) {
  return { id, question, status: "answered", alert: false, facts: [], table: null, spark: null, evidence: "", limit: "", unblock: "", ...fields };
 }

 const privateOnly = (id, question) => ask(id, question, { status: "private", headline: "Answered on the private host only. Its source data is restricted and is never published here." });
 const missing = (id, question, what) => ask(id, question, { status: "blocked", headline: `${what} is not available on this host.`, unblock: "Run the private refresh and deploy its restricted files." });

 // ---------- CEO ----------
 function growth(c) {
  const q = "Are we gaining or losing renters?";
  const rows = c.period.facilities, moveIns = sum(rows, "moveIns"), moveOuts = sum(rows, "moveOuts"), net = isNum(moveIns) && isNum(moveOuts) ? moveIns - moveOuts : null;
  const prior = c.prior?.facilities || [], occ = occupancy(rows), priorOcc = occupancy(prior);
  const sameCoverage = c.prior && ids(occ.rows) === ids(priorOcc.rows);
  const word = net > 0 ? "Gaining" : net < 0 ? "Losing" : "Flat";
  return ask("ceo-growth", q, {
   headline: `${word}: ${number(moveIns)} move-ins and ${number(moveOuts)} move-outs in ${periodName(c.period)}, net ${signed(net)}.`,
   facts: [
    ["Move-ins", number(moveIns), versus(moveIns, sum(prior, "moveIns"), c.period, c.prior)],
    ["Move-outs", number(moveOuts), versus(moveOuts, sum(prior, "moveOuts"), c.period, c.prior)],
    ["Net change", signed(net), c.prior ? `${monthName(c.prior.id)}: ${signed(sum(prior, "moveIns") - sum(prior, "moveOuts"))}` : ""],
    ["Occupancy", percent(occ.value), sameCoverage && isNum(priorOcc.value) ? `${signed(Math.round((occ.value - priorOcc.value) * 1000) / 10)} pp vs ${shortDate(c.prior.end)}` : `at ${shortDate(c.period.end)}`],
   ],
   evidence: `CCStorage non-void lease events and the occupancy snapshot at ${shortDate(c.period.end)}, all ${rows.length} facilities.`,
   limit: `Lease events are not distinct customers. Move-outs cluster at month end and are sometimes entered late, which revises past months (see the restatements answer)${c.period.partial ? ", so a partial month understates them" : ""}.`,
  });
 }

 function spend(c) {
  const p = c.period, prior = c.prior, total = p.google.spend + p.meta.spend, priorTotal = prior ? prior.google.spend + prior.meta.spend : null;
  return ask("ceo-spend", "What are we spending on advertising, and is it rising?", {
   headline: `${money(total)} on Google and Meta ads in ${periodName(p)}${prior ? `, ${versus(total, priorTotal, p, prior)}` : ""}.`,
   facts: [
    ["Google Ads", money(p.google.spend), versus(p.google.spend, prior?.google.spend, p, prior)],
    ["Meta Ads", money(p.meta.spend), versus(p.meta.spend, prior?.meta.spend, p, prior)],
    ["Both platforms", money(total), prior ? `${monthName(prior.id)}: ${money(priorTotal)}` : ""],
   ],
   evidence: "Direct Google Ads and Meta Ads account totals in USD, America/New_York dates.",
   limit: "Spend is account-wide. It is not split across facilities. Other marketing costs (agency fees, signage, listings) are not loaded.",
  });
 }

 function cash(c) {
  const p = c.period, prior = c.prior, paid = p.facilities.filter(f => isNum(f.net)), priorPaid = prior ? prior.facilities.filter(f => isNum(f.net)) : [];
  const net = sum(paid, "net"), comparable = prior && ids(paid) === ids(priorPaid);
  return ask("ceo-cash", "Is the money coming in growing?", {
   headline: `${money(net)} in net recorded payments in ${periodName(p)}${comparable ? `, ${versus(net, sum(priorPaid, "net"), p, prior)}` : ""}.`,
   facts: [
    ["Net recorded payments", money(net), comparable ? versus(net, sum(priorPaid, "net"), p, prior) : prior ? "Facility coverage changed; no % shown" : ""],
    ["Facilities with payments", `${paid.length} of ${p.facilities.length}`, ""],
    ["Refund adjustments", money(sum(paid, "refunds")), "Applied to the original payment month"],
   ],
   evidence: "CCStorage payment register: Complete, Manually Entered, Partially Refunded and Refunded payments less current refunds.",
   limit: `This is the payment register, not audited revenue or bank deposits. CCStorage's reporting view shows a different total (see the finance questions).${p.partial ? " Rent is mostly paid early in the month, so a partial month's per-day pace runs high." : ""}`,
  });
 }

 function costPerRenter(c) {
  const q = "What does it cost us to win a new renter?";
  const unblock = "Staff record the campaign on every move-in (docs/ATTRIBUTION_STAFF_GUIDE.md), online checkout links carry the campaign, and campaigns are mapped in data/sources-mapping.json. Then this shows an \"at least\" cost per credited rental.";
  if (c.isPublic) return ask("ceo-cost-per-renter", q, { status: "blocked", headline: "Not answerable yet: CCStorage does not record where most renters came from.", unblock, limit: "A blended \"ad spend ÷ all move-ins\" figure is deliberately not shown: it would credit advertising with every rental, including walk-ins and referrals." });
  const period = c.sources?.periods?.find(item => item.id === c.period.id);
  if (!period) return missing("ceo-cost-per-renter", q, "The source-of-rentals file");
  const t = period.portfolio, evidence = t.confirmed + t.creditedLease + t.creditedOnline, costs = period.cost || [];
  return ask("ceo-cost-per-renter", q, {
   status: costs.length ? "partial" : "blocked",
   headline: costs.length ? `At least ${costs.map(item => `${money(item.costPerRentalAtLeast)} per credited rental (${item.slug})`).join("; ")}.` : `Not answerable yet: only ${number(evidence)} of ${number(t.moveIns)} move-ins in ${periodName(c.period)} carry any evidence of source, and no campaign is mapped to spend.`,
   facts: [["Move-ins", number(t.moveIns), ""], ["With source evidence", number(evidence), percent(t.moveIns ? evidence / t.moveIns : null)], ["Campaigns mapped to spend", number(c.sources.mappedCampaigns?.length || 0), ""]],
   evidence: "Private source-of-rentals file: Confirmed lead matches and campaigns credited in CCStorage.",
   limit: "A blended \"ad spend ÷ all move-ins\" figure is deliberately not shown: it would credit advertising with every rental, including walk-ins and referrals.",
   unblock,
  });
 }

 function facilities(c) {
  const rows = c.period.facilities.filter(f => isNum(f.units) && isNum(f.leases)).map(f => ({ ...f, empty: f.units - f.leases, net: (f.moveIns || 0) - (f.moveOuts || 0) })).filter(f => f.empty > 0).sort((a, b) => b.empty - a.empty || a.occupancy - b.occupancy);
  const top = rows.slice(0, 5), losing = c.period.facilities.filter(f => (f.moveOuts || 0) > (f.moveIns || 0)).length;
  return ask("ceo-facilities", "Which facilities need marketing help most?", {
   headline: top.length ? `${top[0].name} has the most empty units: ${number(top[0].empty)} of ${number(top[0].units)} (${percent(top[0].occupancy)} occupied). ${losing} ${losing === 1 ? "facility" : "facilities"} lost more renters than ${losing === 1 ? "it" : "they"} gained in ${periodName(c.period)}.` : "No facility reports empty units.",
   table: { head: ["Facility", "Empty units", "Occupancy", "Net move-ins"], rows: top.map(f => [f.name, number(f.empty), percent(f.occupancy), signed(f.net)]) },
   evidence: `CCStorage units and occupied leases at ${shortDate(c.period.end)}; move-ins and move-outs in ${periodName(c.period)}.`,
   limit: "Empty units show where capacity is, not whether advertising would fill it. The Overview table lists every facility.",
  });
 }

 function targeting() {
  return ask("ceo-targeting", "Is our advertising aimed at the facilities with empty units?", {
   status: "blocked",
   headline: "Not answerable under the current rule: ad spend is never split across facilities, and campaign names are not used as evidence.",
   limit: "Google Ads shows a campaign-location label taken from each campaign's name. It is a name, not a verified facility link.",
   unblock: "An owner-maintained campaign-to-facility list (like data/sources-mapping.json) would let spend sit beside each facility's vacancy without guessing from names. It needs the owner's approval first.",
  });
 }

 // ---------- CMO ----------
 function sources(c) {
  const q = "Where did our renters come from?";
  if (c.isPublic) return privateOnly("cmo-sources", q);
  const period = c.sources?.periods?.find(item => item.id === c.period.id);
  if (!period) return missing("cmo-sources", q, "The source-of-rentals file");
  const t = period.portfolio;
  return ask("cmo-sources", q, {
   status: t.moveIns && t.notRecorded / t.moveIns > 0.5 ? "partial" : "answered",
   headline: `${number(t.notRecorded)} of ${number(t.moveIns)} move-ins in ${periodName(c.period)} have no recorded source. ${number(t.notRecordedOnline)} of those rented through online checkout without a campaign link.`,
   table: { head: ["Evidence of source", "Move-ins"], rows: [["Confirmed (Meta lead matched by email or phone)", number(t.confirmed)], ["Credited on the lease by staff", number(t.creditedLease)], ["Credited by the online checkout link", number(t.creditedOnline)], ["Sources disagree", number(t.disagree)], ["Not recorded", number(t.notRecorded)], ["… of which rented online", number(t.notRecordedOnline)]] },
   evidence: "CCStorage leases and online checkouts, matched to Meta lead records. Each move-in counts once, strongest evidence first.",
   limit: "\"Not recorded\" is not organic or walk-in; it means no evidence either way.",
   unblock: "Staff recording the campaign at move-in and campaign links on online checkout fill the Credited rows.",
  });
 }

 function costPerLead(c) {
  const p = c.period, prior = c.prior, leadsAndCalls = period => period?.google.conversionsByGroup?.leads_and_calls ?? null;
  const google = leadsAndCalls(p) ? p.google.spend / leadsAndCalls(p) : null, meta = p.meta.leads ? p.meta.spend / p.meta.leads : null;
  const priorGoogle = leadsAndCalls(prior) ? prior.google.spend / leadsAndCalls(prior) : null, priorMeta = prior?.meta.leads ? prior.meta.spend / prior.meta.leads : null;
  const change = (a, b) => isNum(a) && isNum(b) && b ? `${signedPct((a - b) / b)} vs ${monthName(prior.id)} (${money(b)})` : "";
  return ask("cmo-cost-per-lead", "What does a lead cost on each platform, and is it changing?", {
   headline: `Google Ads: ${money(google)} per lead or call. Meta Ads: ${money(meta)} per lead. ${periodName(p)}.`,
   facts: [["Google Ads cost per lead or call", money(google), change(google, priorGoogle)], ["Google leads & calls", number(leadsAndCalls(p)), "Lead forms and calls from ads; excludes button clicks"], ["Meta Ads cost per lead", money(meta), change(meta, priorMeta)], ["Meta leads", number(p.meta.leads), "Meta's lead action"]],
   evidence: "Each platform's own spend divided by its own reported results.",
   limit: "These are platform-reported results with different definitions, not renters. The two platforms are never added into one lead count.",
  });
 }

 function waste(c) {
  const q = "Which campaigns are spending without results?";
  if (!c.ads || !c.meta) return missing("cmo-waste", q, "Campaign detail");
  const google = c.ads.campaigns.filter(r => r.month === c.period.id && r.costMicros > 0).map(r => ({ platform: "Google Ads", name: r.name, spend: r.costMicros / 1e6, clicks: r.clicks, results: r.conversionsByGroup ? r.conversionsByGroup.leads_and_calls : r.conversions }));
  const meta = (c.meta.periods?.[c.period.id]?.campaigns || []).filter(r => r.spend > 0).map(r => ({ platform: "Meta Ads", name: r.name, spend: r.spend, clicks: r.linkClicks, results: r.leads }));
  const all = google.concat(meta), idle = all.filter(r => !(r.results >= 0.5)).sort((a, b) => b.spend - a.spend), idleSpend = sum(idle, "spend"), total = sum(all, "spend");
  return ask("cmo-waste", q, {
   headline: idle.length ? `${money(idleSpend)} (${percent(total ? idleSpend / total : null)} of ad spend) went to ${idle.length} campaign${idle.length === 1 ? "" : "s"} with no platform-reported leads or calls in ${periodName(c.period)}.` : `Every campaign with spend in ${periodName(c.period)} reported at least one lead or call.`,
   table: idle.length ? { head: ["Platform", "Campaign", "Spend", "Clicks"], rows: idle.slice(0, 8).map(r => [r.platform, r.name, money(r.spend), number(r.clicks)]) } : null,
   evidence: "Google Ads leads & calls and Meta leads per campaign for the month.",
   limit: "Some campaigns aim at awareness, button clicks or store visits. Check the objective before pausing. Zero platform results is not proof of zero rentals.",
  });
 }

 function leadConversion(c) {
  const q = "Do leads become renters, and how quickly?";
  if (c.isPublic) return privateOnly("cmo-lead-conversion", q);
  if (!c.leads) return missing("cmo-lead-conversion", q, "The lead-matching file");
  const s = c.leads.summary, inPeriod = (c.leads.leads || []).filter(l => l.created_date >= c.period.start && l.created_date <= c.period.end), confirmed = inPeriod.filter(l => l.match?.status === "confirmed").length;
  return ask("cmo-lead-conversion", q, {
   status: "partial",
   headline: `${number(s.confirmed_new_renters)} of ${number(s.leads)} Meta leads since June became confirmed new renters (${number(s.already_tenants)} more were already tenants). Median ${number(s.median_days_to_move_in)} days from lead to move-in.`,
   facts: [[`Meta leads, ${periodName(c.period)}`, number(inPeriod.length), ""], ["Matched to a renter", number(confirmed), "Exact email or phone match"], ["All Meta leads since June", number(s.leads), ""], ["Possible (name and timing only)", number(s.possible), "Unconfirmed, never counted above"]],
   evidence: "Meta lead records matched to CCStorage customers by hashed email or phone.",
   limit: "Meta lead forms only. Google calls and website forms carry no contact record to match. A renter may use a different email or phone, so matches are a lower bound.",
   unblock: "Call tracking with caller numbers, and website form records, would extend matching beyond Meta.",
  });
 }

 function funnel(c) {
  const q = "Is the website turning visitors into rentals?";
  const ga = c.ga?.periods?.[c.period.id]?.summary;
  if (c.isPublic) return ask("cmo-funnel", q, { status: "partial", headline: ga ? `${number(ga.totalUsers)} website users and ${number(ga.keyEvents)} GA4 key events in ${periodName(c.period)}. The visitor-to-rental funnel is on the private host.` : "No GA4 data for this month.", evidence: "GA4 Data API, website stream.", limit: "Key events mix checkout clicks, forms and calls; they are not rentals." });
  const m = c.tracking?.months?.find(item => item.id === c.period.id);
  if (!m) return missing("cmo-funnel", q, "The tracking file");
  if (!isNum(m.visitors)) return ask("cmo-funnel", q, { status: "blocked", headline: `The GA4 event export starts ${shortDate(c.tracking.coverage.ga4.start)}; it does not cover ${periodName(c.period)}.`, facts: [["CCStorage online move-ins", number(m.onlineMoveIns), ""], ["All move-ins", number(m.moveIns), ""]] });
  return ask("cmo-funnel", q, {
   status: m.ga4Days < m.days ? "partial" : "answered",
   headline: `${number(m.checkoutVisitors)} of ${number(m.visitors)} website visitors (${percent(m.visitors ? m.checkoutVisitors / m.visitors : null)}) started a checkout. CCStorage recorded ${number(m.onlineMoveIns)} online move-ins; GA4 saw ${number(m.rentalEvents)} rental-completed events.`,
   facts: [["Website visitors", number(m.visitors), "Distinct GA4 browsers on the main site"], ["Started a checkout", number(m.checkoutVisitors), percent(m.visitors ? m.checkoutVisitors / m.visitors : null)], ["Online move-ins (CCStorage)", number(m.onlineMoveIns), `of ${number(m.moveIns)} move-ins`], ["Rental-completed events (GA4)", number(m.rentalEvents), "Platform-reported"]],
   evidence: `GA4 BigQuery event export (${m.ga4Days} of ${m.days} days) and CCStorage online checkouts that became leases.`,
   limit: "Visitors are pseudonymous browsers, not people, and are never linked to renters. GA4's rental event fires on far fewer rentals than CCStorage records online, so use CCStorage's count for rentals.",
  });
 }

 function budget(c) {
  const q = "Are we spending to budget?";
  const unblock = "Add monthly budgets per platform to data/restricted/budgets.json, for example {\"months\": {\"2026-11\": {\"google\": 6000, \"meta\": 600}}}.";
  if (c.isPublic) return ask("cmo-budget", q, { status: "blocked", headline: "Not answerable yet: no budget is recorded.", unblock });
  const plan = c.budgets?.months?.[c.period.id];
  if (!plan) return ask("cmo-budget", q, { status: "blocked", headline: `Not answerable yet: no budget is recorded for ${monthName(c.period.id)}.`, unblock });
  const length = new Date(Date.UTC(Number(c.period.id.slice(0, 4)), Number(c.period.id.slice(5, 7)), 0)).getUTCDate(), share = days(c.period) / length;
  const rows = [["Google Ads", c.period.google.spend, plan.google], ["Meta Ads", c.period.meta.spend, plan.meta]].filter(r => isNum(r[2]));
  return ask("cmo-budget", q, {
   headline: rows.map(([name, spent, target]) => `${name}: ${money(spent)} of ${money(target)} (${percent(spent / target)}) with ${percent(share)} of the month elapsed`).join(". ") + ".",
   facts: rows.map(([name, spent, target]) => [name, `${money(spent)} / ${money(target)}`, `Pace ${percent(spent / (target * share))} of plan`]),
   evidence: "Platform spend against the owner-entered monthly budget.",
   limit: "Pace assumes even daily spend across the month.",
  });
 }

 // ---------- Finance and audit ----------
 function tieOut(c) {
  const q = "Does the ad spend shown tie out to each platform's own totals?";
  if (!c.ads || !c.meta) return missing("fin-tie-out", q, "Platform detail");
  const p = c.period, account = c.ads.accountTotals?.find(r => r.month === p.id), metaPeriod = c.meta.periods?.[p.id], recon = c.ads.validation?.reconciliation?.[p.id];
  const googleAccount = account ? account.costMicros / 1e6 : null, metaAccount = metaPeriod?.account?.spend ?? null, metaCampaigns = metaPeriod ? sum(metaPeriod.campaigns, "spend") : null;
  const diff = (a, b) => isNum(a) && isNum(b) ? Math.round((a - b) * 100) / 100 : null;
  const rows = [
   ["Google Ads spend: Overview vs account report", p.google.spend, googleAccount, diff(p.google.spend, googleAccount)],
   ["Meta Ads spend: Overview vs account report", p.meta.spend, metaAccount, diff(p.meta.spend, metaAccount)],
   ["Meta Ads: campaigns vs account", metaCampaigns, metaAccount, diff(metaCampaigns, metaAccount)],
  ];
  const ok = rows.every(r => r[3] === 0) && recon?.campaigns?.exactDeliveryTotals !== false;
  return ask("fin-tie-out", q, {
   alert: !ok,
   headline: ok ? `Yes. Every spend figure for ${periodName(p)} matches its platform report to the cent, and Google Ads campaigns add up exactly to the account.` : `No: at least one spend figure for ${periodName(p)} differs from its platform report.`,
   table: { head: ["Check", "Dashboard", "Platform", "Difference"], rows: rows.map(([label, a, b, d]) => [label, money(a), money(b), signed(d, "money")]).concat([["Google Ads: campaigns and ad groups vs account", recon?.campaigns?.exactDeliveryTotals ? "Exact" : "n/a", recon?.groups?.exactDeliveryTotals ? "Exact" : "n/a", ""]]) },
   evidence: "Google Ads and Meta reporting APIs, read separately at account and campaign level.",
   limit: "This ties to each platform's reporting, not to invoices or card charges. Billing statements are not loaded.",
  });
 }

 function paymentGap(c) {
  const rows = c.report.periods.map(p => { const net = sum(p.facilities, "net"), view = p.reportingViewVolume; return { p, net, view, gap: isNum(net) && isNum(view) ? net - view : null }; });
  const now = rows.find(r => r.p.id === c.period.id);
  return ask("fin-payment-gap", "How far apart are CCStorage's two payment totals?", {
   headline: `In ${periodName(c.period)} the payment register is ${signed(now.gap, "money")} (${signedPct(now.view ? now.gap / now.view : null)}) against CCStorage's reporting view.${rows.every(r => r.gap > 0) ? " The register is higher in every month shown." : ""}`,
   table: { head: ["Month", "Payment register", "Reporting view", "Difference"], rows: rows.map(r => [periodName(r.p), money(r.net), money(r.view), signed(r.gap, "money")]) },
   evidence: "CCStorage payments table (register) and CCStorage's monthly/daily payment views.",
   limit: "The cause of the difference is unresolved. Neither total is audited revenue or bank deposits; the dashboard uses the register throughout.",
   unblock: "A line-by-line comparison of the two definitions (statuses, refunds, payment dates) would explain it.",
  });
 }

 function restated(c) {
  const q = "What changed in past months since the last refresh?";
  const r = c.restatements;
  if (!r) return missing("fin-restated", q, "The restatement file");
  if (r.current?.ccExtractedAt !== c.report.ccExtractedAt) return ask("fin-restated", q, { status: "partial", headline: "The restatement file was built from a different snapshot than the one shown. Rerun the refresh.", evidence: `Restatements compare ${r.previous?.cutoff} with ${r.current?.cutoff}.` });
  const value = (v, kind) => kind === "money" ? money(v) : number(v);
  const months = r.months.filter(m => m.status === "restated");
  const lines = months.flatMap(m => m.changes.flatMap(ch => [[monthName(m.id), `${ch.label}, all facilities`, value(ch.previous, ch.kind), value(ch.current, ch.kind), signed(ch.difference, ch.kind)]]
   .concat(m.facilities.filter(f => f.metric === ch.metric).map(f => ["", `↳ ${f.name}`, value(f.previous, f.kind), value(f.current, f.kind), signed(f.difference, f.kind)]))));
  return ask("fin-restated", q, {
   headline: months.length ? `${months.length} past month${months.length === 1 ? " was" : "s were"} revised since the ${shortDate(r.previous.cutoff)} snapshot: ${months.map(m => m.changes.map(ch => `${monthName(m.id)} ${ch.label.toLowerCase()} ${signed(ch.difference, ch.kind)}`).join(", ")).join("; ")}.` : `No past month changed since the ${shortDate(r.previous.cutoff)} snapshot.`,
   table: lines.length ? { head: ["Month", "Measure", "Was", "Now", "Change"], rows: lines } : null,
   evidence: `This snapshot (data through ${shortDate(r.current.cutoff)}) compared with the previous published one (through ${shortDate(r.previous.cutoff)}). Months that only gained days are not counted as revised.`,
   limit: "Sources revise history: late ACH returns, voided leases, backdated move-outs and platform conversion updates. Each refresh is a dated snapshot, not a correction of an error.",
  });
 }

 function claims(c) {
  const p = c.period, m = c.tracking?.months?.find(item => item.id === p.id), period = c.sources?.periods?.find(item => item.id === p.id), ga = c.ga?.periods?.[p.id]?.summary;
  const rows = [["Move-ins", "CCStorage", number(sum(p.facilities, "moveIns"))]];
  if (!c.isPublic) rows.push(["Online move-ins", "CCStorage", number(m?.onlineMoveIns)], ["Confirmed Meta lead matches", "Lead matching", number(period?.portfolio.confirmed)]);
  rows.push(["Rental conversions", "Google Ads", number(p.google.conversionsByGroup?.rentals)], ["Leads & calls", "Google Ads", number(p.google.conversionsByGroup?.leads_and_calls)], ["Leads", "Meta Ads", number(p.meta.leads)], ["Key events", "GA4", number(ga?.keyEvents)]);
  if (!c.isPublic) rows.push(["Rental-completed events", "GA4", number(m?.rentalEvents)]);
  return ask("fin-claims", "How do platform claims compare with actual move-ins?", {
   headline: `CCStorage recorded ${number(sum(p.facilities, "moveIns"))} move-ins in ${periodName(p)}. Google Ads reported ${number(p.google.conversionsByGroup?.rentals)} rental conversions${!c.isPublic && m ? `, and GA4 saw ${number(m.rentalEvents)} rental-completed events against ${number(m.onlineMoveIns)} online move-ins` : ""}.`,
   table: { head: ["Measure", "System", periodName(p)], rows },
   evidence: "Each system's own count for the same dates.",
   limit: "Every row is a different measure from a different system. They are never added together, and platform results are not renters.",
  });
 }

 function leadRecords(c) {
  const q = "Do the lead records we hold match what Meta reports?";
  if (c.isPublic) return privateOnly("fin-lead-records", q);
  if (!c.leads) return missing("fin-lead-records", q, "The lead-matching file");
  const rec = c.leads.summary.reconciliation || [], now = rec.find(r => r.month === c.period.id);
  return ask("fin-lead-records", q, {
   headline: now ? `${number(now.lead_records)} lead records against ${number(now.meta_account_leads)} Meta-reported leads in ${monthName(c.period.id)}.` : "No reconciliation row for this month.",
   table: { head: ["Month", "Lead records", "Meta-reported leads", "Difference"], rows: rec.map(r => [monthName(r.month), number(r.lead_records), number(r.meta_account_leads), signed(r.lead_records - r.meta_account_leads)]) },
   evidence: "Lead records downloaded from the Facebook page's lead forms, compared with the ad account's lead action.",
   limit: "Forms can receive leads from outside this ad account, and Meta can count leads it no longer returns. The cause of each difference is not confirmed.",
  });
 }

 // ---------- Builder ----------
 function freshness(c) {
  const cutoff = c.report.periods.at(-1).end;
  const sourcesThrough = [["Google Ads", c.ads?.through], ["Meta Ads", c.meta?.through], ["Google Analytics", c.ga?.through], ["CCStorage", cutoff]];
  const aligned = sourcesThrough.every(([, through]) => through === cutoff), age = Math.floor((c.now - Date.parse(`${cutoff}T00:00:00Z`)) / 864e5);
  const lag = c.tracking?.coverage?.ga4?.lastExportedDay;
  return ask("dev-freshness", "Is every source current and on the same cutoff?", {
   alert: !aligned || age > 7,
   headline: `${aligned ? "Yes" : "No"}: ${aligned ? "all four sources run" : "sources do not all run"} through ${shortDate(cutoff)}, ${age <= 0 ? "today" : `${age} day${age === 1 ? "" : "s"} ago`}. CCStorage was extracted ${c.report.ccExtractedAt.slice(0, 16).replace("T", " ")} UTC.`,
   table: { head: ["Source", "Data through"], rows: sourcesThrough.map(([name, through]) => [name, through ? shortDate(through) : "not loaded"]).concat(lag && !c.isPublic ? [["GA4 event export (visitors, tracking)", shortDate(lag)]] : []) },
   evidence: "Each snapshot's own through date. The refresh refuses to publish when the cutoffs differ.",
   limit: lag && lag < cutoff && !c.isPublic ? `GA4's BigQuery export lands about a day late, so the event-level views stop at ${shortDate(lag)}.` : "Refreshes are manual; the dashboard warns when data is more than 7 days old.",
  });
 }

 function spark(values, flagged) {
  const max = Math.max(1, ...values.filter(isNum)), width = 280 / values.length;
  return `<svg viewBox="0 0 280 36" preserveAspectRatio="none" aria-hidden="true">${values.map((v, i) => flagged[i] ? `<rect x="${(i * width).toFixed(1)}" y="0" width="${width.toFixed(1)}" height="36" class="q-bar-flag-bg"/>` : "").join("")}${values.map((v, i) => isNum(v) ? `<rect x="${(i * width + 0.5).toFixed(1)}" y="${(36 - Math.max(1.5, v / max * 34)).toFixed(1)}" width="${(width - 1).toFixed(1)}" height="${Math.max(1.5, v / max * 34).toFixed(1)}" class="${flagged[i] ? "q-bar-flag" : "q-bar"}"/>` : `<rect x="${(i * width + 0.5).toFixed(1)}" y="34" width="${(width - 1).toFixed(1)}" height="2" class="q-bar-none"/>`).join("")}</svg>`;
 }

 function heartbeat(c) {
  const q = "Is tracking still firing every day?";
  if (c.isPublic) return privateOnly("dev-heartbeat", q);
  const t = c.tracking;
  if (!t) return missing("dev-heartbeat", q, "The tracking file");
  const recentDays = t.days.slice(-HEARTBEAT_DAYS), first = recentDays[0].date, last = t.flags.at(-1);
  const lastCovered = key => t.days.filter(d => isNum(d[key])).at(-1)?.date, ongoing = t.flags.filter(f => f.to === lastCovered(f.series));
  const outage = f => t.flags.filter(g => g.from === f.from), describe = flags => `${flags.map(g => g.label.toLowerCase()).join(", ")} fell to ${number(Math.min(...flags.map(g => g.lowest)))} a day (${flags.map(g => `${g.label.toLowerCase()} normally ${number(g.typical)}`).join(", ")})`;
  const inFlag = (key, date) => t.flags.some(f => f.series === key && f.from <= date && date <= f.to);
  const series = t.series.map(s => {
   const values = recentDays.map(d => d[s.key]), known = values.filter(isNum), sorted = [...known].sort((a, b) => a - b), typical = sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
   return { ...s, values, flagged: recentDays.map(d => inFlag(s.key, d.date)), latest: known.at(-1), typical };
  });
  return ask("dev-heartbeat", q, {
   alert: ongoing.length > 0,
   headline: ongoing.length ? `No: ${ongoing.map(f => `${f.label.toLowerCase()} has been down since ${shortDate(f.from)} (${number(f.lowest)} a day, normally ${number(f.typical)})`).join("; ")}.` : `Yes, every signal is firing on its latest day.${last ? ` The last outage was ${span(last.from, last.to)}: ${describe(outage(last))}.` : ""}`,
   spark: series,
   evidence: `Daily counts, ${shortDate(first)}–${shortDate(recentDays.at(-1).date)} (America/New_York). GA4 events come from the BigQuery export, Google Ads from the account's daily report, Meta from lead records.`,
   limit: `A day is flagged when a signal that normally runs at least ${t.rule.minTypical} a day falls below ${percent(t.rule.ratio)} of its ${t.rule.typicalDays}-day median. Low-volume signals are shown but never flagged. Red shading marks flagged days; grey ticks are days the GA4 export has not delivered yet.`,
  });
 }

 function evidenceShare(c) {
  const q = "What share of move-ins can be traced to a source?";
  if (c.isPublic) return privateOnly("dev-evidence", q);
  if (!c.sources) return missing("dev-evidence", q, "The source-of-rentals file");
  const total = key => c.sources.periods.reduce((s, p) => s + p.portfolio[key], 0), traced = p => p.confirmed + p.creditedLease + p.creditedOnline;
  const period = c.sources.periods.find(item => item.id === c.period.id)?.portfolio, all = { confirmed: total("confirmed"), creditedLease: total("creditedLease"), creditedOnline: total("creditedOnline"), moveIns: total("moveIns") };
  return ask("dev-evidence", q, {
   headline: `${percent(period?.moveIns ? traced(period) / period.moveIns : null)} in ${periodName(c.period)} (${number(period && traced(period))} of ${number(period?.moveIns)}). Since June: ${number(traced(all))} of ${number(all.moveIns)} (${percent(all.moveIns ? traced(all) / all.moveIns : null)}).`,
   table: { head: ["Month", "Move-ins", "With evidence", "Share"], rows: c.sources.periods.map(p => [monthName(p.id), number(p.portfolio.moveIns), number(traced(p.portfolio)), percent(p.portfolio.moveIns ? traced(p.portfolio) / p.portfolio.moveIns : null)]) },
   evidence: "Confirmed lead matches plus campaigns credited in CCStorage.",
   limit: "This is the adoption measure for recording a source. Until it rises, cost per renter and channel mix cannot be answered.",
   unblock: "Roll out the staff instruction in Attribution Rollout/01_STAFF_INSTRUCTION.md and the online-checkout campaign links.",
  });
 }

 function answer(context) {
  const report = context.report, period = report.periods.find(p => p.id === context.periodId) || report.periods.at(-1);
  const c = { ...context, period, prior: report.periods[report.periods.indexOf(period) - 1] || null, now: context.now ?? Date.now() };
  const groups = [
   { id: "ceo", title: "CEO", lead: "Is marketing growing the business?", questions: [growth(c), spend(c), cash(c), costPerRenter(c), facilities(c), targeting(c)] },
   { id: "cmo", title: "CMO", lead: "Which channels and campaigns work?", questions: [sources(c), costPerLead(c), waste(c), leadConversion(c), funnel(c), budget(c)] },
   { id: "finance", title: "Finance and audit", lead: "Can every number be traced and trusted?", questions: [tieOut(c), paymentGap(c), restated(c), claims(c), leadRecords(c)] },
   { id: "builder", title: "Builder", lead: "Is the data pipeline healthy?", questions: [freshness(c), heartbeat(c), evidenceShare(c)] },
  ];
  const counts = Object.fromEntries(Object.keys(STATUS).map(key => [key, groups.flatMap(g => g.questions).filter(q => q.status === key).length]));
  return { period, groups, counts };
 }

 function renderQuestion(q) {
  const facts = q.facts.length ? `<dl class="q-facts">${q.facts.map(([label, value, note]) => `<div><dt>${html(label)}</dt><dd>${html(value)}${note ? `<small>${html(note)}</small>` : ""}</dd></div>`).join("")}</dl>` : "";
  const table = q.table?.rows.length ? `<div class="table-scroll q-table-scroll"><table class="q-table"><thead><tr>${q.table.head.map(h => `<th>${html(h)}</th>`).join("")}</tr></thead><tbody>${q.table.rows.map(r => `<tr>${r.map(cell => `<td>${html(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>` : "";
  const sparks = q.spark ? `<div class="q-sparks">${q.spark.map(s => `<div class="q-spark"><div><strong>${html(s.label)}</strong><small>Latest ${html(number(s.latest))} · typical ${html(number(s.typical))}</small></div><div role="img" aria-label="${html(`${s.label}, last ${s.values.length} days: ${s.values.map(number).join(", ")}`)}">${spark(s.values, s.flagged)}</div></div>`).join("")}</div>` : "";
  const meta = [["Evidence", q.evidence], ["Limit", q.limit], ["To answer it fully", q.unblock]].filter(([, text]) => text).map(([label, text]) => `<p class="q-meta"><b>${label}</b> ${html(text)}</p>`).join("");
  return `<article class="q-item${q.alert ? " is-alert" : ""}" id="q-${html(q.id)}"><div class="q-head"><h4>${html(q.question)}</h4><span class="q-chips">${q.alert ? '<span class="q-status q-alert">Needs attention</span>' : ""}<span class="q-status q-${html(q.status)}">${html(STATUS[q.status])}</span></span></div><p class="q-answer">${html(q.headline)}</p>${facts}${table}${sparks}${meta}</article>`;
 }

 function render(result) {
  const total = result.groups.reduce((n, g) => n + g.questions.length, 0);
  const summary = Object.entries(result.counts).filter(([, n]) => n).map(([key, n]) => `<span class="q-status q-${key}">${n} ${html(STATUS[key].toLowerCase())}</span>`).join("");
  return `<p class="detail-scope q-intro">${total} questions for ${html(periodName(result.period))}. Each answer comes from the loaded snapshots and states its evidence and limits. A question the data cannot answer says what would unblock it.</p><div class="q-summary">${summary}</div>` +
   result.groups.map(g => `<section class="panel q-group" aria-labelledby="q-group-${g.id}"><header class="panel-header"><div><h3 id="q-group-${g.id}">${html(g.title)}</h3><p>${html(g.lead)}</p></div><span class="q-group-count">${g.questions.filter(q => q.status === "answered").length} of ${g.questions.length} answered</span></header><div class="q-list">${g.questions.map(renderQuestion).join("")}</div></section>`).join("");
 }

 // Browser glue. report, adsData, gaData, metaPanel, state and onPublicHost are the page's own globals.
 const loaded = {};
 let loading = null;
 function load(isPublic) {
  if (loading) return loading;
  const files = { ...PUBLIC_FILES, ...(isPublic ? {} : PRIVATE_FILES) };
  loading = Promise.all(Object.entries(files).map(([key, url]) => fetch(url, { cache: "no-store" }).then(r => r.ok ? r.json() : null).catch(() => null).then(value => { loaded[key] = value; })));
  return loading;
 }

 function update() {
  const root = document.getElementById("questions-root");
  if (!root || typeof report === "undefined" || !report) return;
  const isPublic = typeof onPublicHost !== "undefined" ? onPublicHost : true;
  if (!loading) { root.innerHTML = '<p class="tenant-loading">Loading answers…</p>'; load(isPublic).then(() => { if (typeof detail !== "undefined" && detail.view === "questions") update(); }); return; }
  const context = {
   report, periodId: state.period, isPublic,
   ads: typeof adsData !== "undefined" ? adsData : null, ga: typeof gaData !== "undefined" ? gaData : null,
   meta: (typeof metaPanel !== "undefined" && metaPanel.source()) || loaded.meta,
   restatements: loaded.restatements, sources: loaded.sources, leads: loaded.leads, tracking: loaded.tracking, budgets: loaded.budgets,
  };
  root.innerHTML = render(answer(context));
 }

 return { STATUS, answer, render, renderQuestion, update, versus };
});
