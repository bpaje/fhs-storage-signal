"use strict";

// Watch list and Keywords tabs (private host only): the Google Ads campaigns the owner chose to keep watching, and their
// keywords, totalled over recent dates from data/restricted/ads-watch.json. A lead is leads_and_calls + phone_clicks;
// checkout-button clicks and Google's modelled store visits are shown apart and never added in. Shares for a period are
// ratios of summed impressions, never averaged daily percentages; the last 7/14/30/90 days use Google's own figures
// (windowShares) because rebuilt shares drift. Watch lists are saved through /api/watchlists for everyone who signs in,
// or in this browser only when that API does not answer (local preview).
(function (root, factory) {
 const api = factory();
 if (typeof module !== "undefined" && module.exports) module.exports = api;
 if (root) root.adsWatch = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
 const SCHEMA = "storage-signal.ads-watch.v1";
 const DATA_URL = "data/restricted/ads-watch.json";
 const API_URL = "/api/watchlists";
 const STORAGE_KEY = "fhs-watchlists";
 const RUNNING = "*running";
 const PRESETS = ["7", "14", "30", "90"];
 const PAGE_SIZE = 50;
 const LIMITS = { lists: 50, name: 60, note: 200, campaigns: 200 };
 const ID_PATTERN = /^[a-z0-9-]{1,40}$/;
 const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
 const SEED = { version: 1, lists: [{ id: "meeting-2026-10-30", name: "Meeting 30 Oct", campaignIds: ["23501980267", "24329125185", "23740930692", "23390764985"], note: "The four campaigns the leadership meeting on 30 Oct 2026 chose to keep watching.", updatedAt: "2026-10-30T00:00:00Z" }] };
 const SUMMED = ["cost", "impressions", "clicks", "phoneCalls", "leads_and_calls", "phone_clicks", "button_clicks", "store_visits", "other"];
 const STATUS = { ENABLED: "Running", PAUSED: "Paused", REMOVED: "Removed" };
 const MATCH = { BROAD: "Broad", PHRASE: "Phrase", EXACT: "Exact" };
 const QUALITY = { BELOW_AVERAGE: 1, AVERAGE: 2, ABOVE_AVERAGE: 3 };
 const QUALITY_LABEL = { 1: "Below", 2: "Average", 3: "Above" };
 const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
 const DASH = "–";
 const APPROX_NOTE = "Approximate (≈): rebuilt from daily figures. Google reports days under 10% as 0.0999, so this can differ from Google's own figure by several points. Google's own figure is shown for the last 7, 14, 30 and 90 days.";
 const DEFINITIONS = [
  ["Watch list and Keywords: leads", "Google Ads figures for the chosen dates (America/New_York, USD). A lead is an ad call of 60 seconds or more, a website form or a tap on the website phone number. Checkout-button clicks (which also fire on Pay your bill) and Google's modelled store visits are shown separately and never counted as leads. Cost per lead is spend divided by leads; – means no leads. Ad calls counts calls of any length. Changes compare with the same number of days just before, only when those days are inside the data."],
  ["Watch list: impression share", "Impression share is the share of searches the ads were eligible for where they showed; lost to budget and lost to rank are the shares missed for each reason. For the last 7, 14, 30 and 90 days each campaign shows Google's own figure. For chosen dates and for the list total the share is rebuilt from summed daily impressions and marked ≈ (approximate): Google reports days under 10% as 0.0999, so a rebuilt share can differ by several points. Daily percentages are never averaged."],
  ["Keywords: ratings and badges", "Quality Score (1–10) and its three parts (expected click rate, ad relevance, landing page: Below, Average or Above average) are Google's current ratings, not ratings for the chosen dates. Duplicate means the same keyword text and match type is also enabled in another enabled ad group of the same campaign. Quality Score 3 or lower is marked red; keywords that spent $50 or more with no leads are highlighted."],
 ];

 const html = value => String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
 const isNum = value => typeof value === "number" && Number.isFinite(value);
 const money = value => isNum(value) ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value) : DASH;
 const count = (value, digits = 1) => isNum(value) ? new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(value) : DASH;
 const percent = value => isNum(value) ? new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 }).format(value) : DASH;
 const signedPercent = value => isNum(value) ? (value > 0 ? "+" : value < 0 ? "−" : "±") + percent(Math.abs(value)) : DASH;
 const plural = (value, word) => `${count(value)} ${word}${value === 1 ? "" : "s"}`;
 const round = value => Math.round(value * 100) / 100;
 const ratio = (part, whole) => isNum(part) && isNum(whole) && whole > 0 ? part / whole : null;
 const change = (current, previous) => isNum(current) && isNum(previous) && previous !== 0 ? (current - previous) / previous : null;
 const dayMonth = iso => `${Number(String(iso).slice(8, 10))} ${MONTHS[Number(String(iso).slice(5, 7)) - 1] || ""}`;
 const dayLabel = iso => `${dayMonth(iso)} ${String(iso).slice(0, 4)}`;
 const rangeLabel = (from, to) => from === to ? dayLabel(to) : from.slice(0, 7) === to.slice(0, 7) ? `${Number(from.slice(8, 10))}–${dayLabel(to)}` : `${from.slice(0, 4) === to.slice(0, 4) ? dayMonth(from) : dayLabel(from)} – ${dayLabel(to)}`;
 const localDay = iso => { const date = new Date(iso); return Number.isNaN(date.getTime()) ? "" : `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`; };
 const addDays = (iso, amount) => { const date = new Date(`${iso}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + amount); return date.toISOString().slice(0, 10); };
 const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 864e5) + 1;
 const clamp = (value, minimum, maximum) => value < minimum ? minimum : value > maximum ? maximum : value;
 const shortName = name => String(name ?? "").replace(/^\[FHS\]\s*/, "");
 const leadsOf = row => (row.leads_and_calls || 0) + (row.phone_clicks || 0);
 const isActiveKeyword = keyword => keyword.status === "ENABLED" && keyword.adGroupStatus === "ENABLED";
 const characters = value => Array.from(String(value ?? "")).length;
 const byDate = (left, right) => left.date < right.date ? -1 : left.date > right.date ? 1 : 0;

 // ---------- Data ----------
 function rowsOf(block) {
  const columns = block?.columns || [];
  return (block?.rows || []).map(row => Object.fromEntries(columns.map((column, index) => [column, row[index]])));
 }

 function prepare(raw) {
  if (raw?.schema !== SCHEMA || !ISO_DATE.test(raw.from) || !ISO_DATE.test(raw.through)) throw new Error("Invalid Google Ads watch data");
  const campaigns = (raw.campaigns || []).map(campaign => ({ ...campaign, id: String(campaign.id) }));
  const keywords = (raw.keywords || []).map(keyword => ({ ...keyword, id: String(keyword.id), campaignId: String(keyword.campaignId), adGroupId: String(keyword.adGroupId) }));
  return {
   ...raw, campaigns, keywords,
   campaignById: new Map(campaigns.map(campaign => [campaign.id, campaign])),
   campaignDays: rowsOf(raw.campaignDays).map(row => ({ ...row, campaignId: String(row.campaignId) })).sort(byDate),
   keywordDays: rowsOf(raw.keywordDays).map(row => ({ ...row, keywordId: String(row.keywordId) })).sort(byDate),
   duplicates: duplicates(keywords),
  };
 }

 // Rows are sorted by date, so a window is one binary search plus a walk.
 function between(rows, from, to) {
  let low = 0, high = rows.length;
  while (low < high) { const middle = (low + high) >> 1; if (rows[middle].date < from) low = middle + 1; else high = middle; }
  const out = [];
  for (let index = low; index < rows.length && rows[index].date <= to; index++) out.push(rows[index]);
  return out;
 }

 // ---------- Date window ----------
 // Presets end at the data's last day; custom dates are clamped to the data range.
 function windowRange(data, preset, from, to) {
  if (PRESETS.includes(String(preset))) {
   const start = clamp(addDays(data.through, 1 - Number(preset)), data.from, data.through);
   return { preset: String(preset), from: start, to: data.through, days: daysBetween(start, data.through) };
  }
  let start = clamp(ISO_DATE.test(from || "") ? from : data.from, data.from, data.through);
  let end = clamp(ISO_DATE.test(to || "") ? to : data.through, data.from, data.through);
  if (start > end) [start, end] = [end, start];
  return { preset: "custom", from: start, to: end, days: daysBetween(start, end) };
 }

 // The same number of days just before the window, only when all of them are inside the data.
 function previousWindow(data, range) {
  const from = addDays(range.from, -range.days), to = addDays(range.from, -1);
  return from >= data.from ? { preset: "custom", from, to, days: range.days } : null;
 }

 // ---------- Sums ----------
 function emptyTotals() {
  return { cost: 0, impressions: 0, clicks: 0, phoneCalls: 0, leads_and_calls: 0, phone_clicks: 0, button_clicks: 0, store_visits: 0, other: 0, eligible: 0, shareImpressions: 0, lostBudget: 0, lostRank: 0 };
 }

 // Shares only count days that have an eligible-impression figure: impressions on other days are left out of both sides.
 function addRow(totals, row) {
  for (const key of SUMMED) if (isNum(row[key])) totals[key] += row[key];
  if (isNum(row.eligibleImpressions) && row.eligibleImpressions > 0) {
   totals.eligible += row.eligibleImpressions;
   totals.shareImpressions += row.impressions || 0;
   totals.lostBudget += row.lostBudgetImpressions || 0;
   totals.lostRank += row.lostRankImpressions || 0;
  }
  return totals;
 }

 function finish(totals) {
  const out = { ...totals };
  for (const key of SUMMED) out[key] = round(totals[key]);
  out.leads = round(leadsOf(out));
  out.costPerLead = out.leads > 0 ? out.cost / out.leads : null;
  out.cpc = ratio(out.cost, out.clicks);
  out.ctr = ratio(out.clicks, out.impressions);
  out.impressionShare = ratio(totals.shareImpressions, totals.eligible);
  out.lostBudgetShare = ratio(totals.lostBudget, totals.eligible);
  out.lostRankShare = ratio(totals.lostRank, totals.eligible);
  out.sharesApproximate = true;
  return out;
 }

 function campaignTotals(data, campaignIds, range) {
  const ids = [...new Set(campaignIds.map(String))], dates = Array.from({ length: range.days }, (_, index) => addDays(range.from, index)), position = new Map(dates.map((date, index) => [date, index]));
  const entry = () => ({ totals: emptyTotals(), daily: dates.map(() => 0) });
  const per = new Map(ids.map(id => [id, entry()])), all = entry();
  for (const row of between(data.campaignDays, range.from, range.to)) {
   const own = per.get(row.campaignId);
   if (!own) continue;
   for (const target of [own, all]) { addRow(target.totals, row); target.daily[position.get(row.date)] += isNum(row.cost) ? row.cost : 0; }
  }
  const done = item => ({ ...finish(item.totals), daily: item.daily.map(round) });
  return { dates, rows: new Map([...per].map(([id, item]) => [id, done(item)])), total: done(all) };
 }

 // Google's own share for a preset window. A campaign missing from that window had no impressions there.
 function googleShares(data, range, campaignId) {
  const shares = range.preset !== "custom" ? data.windowShares?.[range.preset] : null;
  if (!shares) return null;
  const own = shares[campaignId] || {}, value = key => isNum(own[key]) ? own[key] : null;
  return { impressionShare: value("impressionShare"), lostBudgetShare: value("lostBudget"), lostRankShare: value("lostRank"), sharesApproximate: false };
 }

 function campaignFlags(row, listCostPerLead) {
  const reasons = [];
  if (row.cost > 0 && !(row.leads > 0)) reasons.push(`${money(row.cost)} spent, no leads`);
  else if (isNum(row.costPerLead) && isNum(listCostPerLead) && row.costPerLead > 2 * listCostPerLead) reasons.push(`Cost per lead ${money(row.costPerLead)} is more than twice the list's ${money(listCostPerLead)}`);
  if (isNum(row.lostBudgetShare) && row.lostBudgetShare > 0.4) reasons.push(`${row.sharesApproximate ? "≈" : ""}${percent(row.lostBudgetShare)} of possible impressions lost to budget`);
  return reasons;
 }

 function watchModel(data, list, range) {
  const ids = [...new Set(list.campaignIds.map(String))], known = ids.filter(id => data.campaignById.has(id)), missing = ids.filter(id => !data.campaignById.has(id));
  const current = campaignTotals(data, known, range), previousRange = previousWindow(data, range);
  const total = current.total, budgets = known.map(id => data.campaignById.get(id)).filter(campaign => campaign.status === "ENABLED" && isNum(campaign.budgetPerDay));
  const rows = known.map(id => {
   const campaign = data.campaignById.get(id);
   const row = { ...current.rows.get(id), ...(googleShares(data, range, id) || {}), id, name: shortName(campaign.name), fullName: String(campaign.name ?? ""), status: campaign.status, statusLabel: STATUS[campaign.status] || String(campaign.status ?? DASH), budgetPerDay: isNum(campaign.budgetPerDay) ? campaign.budgetPerDay : null };
   row.reasons = campaignFlags(row, total.costPerLead);
   return row;
  });
  return {
   list, range, previousRange, rows, missing, dates: current.dates,
   total: { ...total, budgetPerDay: budgets.length ? round(budgets.reduce((sum, campaign) => sum + campaign.budgetPerDay, 0)) : null },
   previous: previousRange ? campaignTotals(data, known, previousRange).total : null,
  };
 }

 // Headline figures with their change against the previous window of the same length.
 function headline(model) {
  const now = model.total, before = model.previous;
  return [
   { key: "cost", label: "Spend", value: money(now.cost), previous: before && money(before.cost), change: before ? change(now.cost, before.cost) : null, better: 0 },
   { key: "leads", label: "Leads", value: count(now.leads), previous: before && count(before.leads), change: before ? change(now.leads, before.leads) : null, better: 1 },
   { key: "costPerLead", label: "Cost per lead", value: money(now.costPerLead), title: now.costPerLead == null ? "No leads in these dates" : "", previous: before && (before.costPerLead == null ? "no leads" : money(before.costPerLead)), change: before ? change(now.costPerLead, before.costPerLead) : null, better: -1 },
   { key: "clicks", label: "Clicks", value: count(now.clicks, 0), previous: before && count(before.clicks, 0), change: before ? change(now.clicks, before.clicks) : null, better: 1 },
  ];
 }

 // ---------- Keywords ----------
 // Same campaign, same normalized text and match type, enabled in two or more enabled ad groups.
 function duplicates(keywords) {
  const groups = new Map();
  for (const keyword of keywords) {
   if (!isActiveKeyword(keyword)) continue;
   const key = [keyword.campaignId, String(keyword.text ?? "").trim().toLowerCase().replace(/\s+/g, " "), keyword.matchType].join("|");
   if (!groups.has(key)) groups.set(key, []);
   groups.get(key).push(keyword);
  }
  const result = new Map();
  for (const group of groups.values()) {
   if (new Set(group.map(keyword => keyword.adGroupId)).size < 2) continue;
   for (const keyword of group) result.set(keyword.id, [...new Set(group.filter(other => other.adGroupId !== keyword.adGroupId).map(other => String(other.adGroup ?? other.adGroupId)))]);
  }
  return result;
 }

 function keywordModel(data, campaignIds, filters, range) {
  const scope = new Set(campaignIds.map(String).filter(id => filters.campaign === "all" || id === filters.campaign));
  const search = String(filters.search ?? "").trim().toLowerCase(), totals = new Map(), empty = finish(emptyTotals());
  for (const row of between(data.keywordDays, range.from, range.to)) {
   if (!totals.has(row.keywordId)) totals.set(row.keywordId, emptyTotals());
   addRow(totals.get(row.keywordId), row);
  }
  const rows = [];
  for (const keyword of data.keywords) {
   const active = isActiveKeyword(keyword);
   if (!scope.has(keyword.campaignId)) continue;
   if (filters.match !== "all" && keyword.matchType !== filters.match) continue;
   if ((filters.status === "active" && !active) || (filters.status === "paused" && active)) continue;
   if (search && !`${keyword.text ?? ""} ${keyword.adGroup ?? ""}`.toLowerCase().includes(search)) continue;
   const sums = totals.has(keyword.id) ? finish(totals.get(keyword.id)) : empty;
   if (filters.onlySpend && !(sums.cost > 0)) continue;
   const quality = key => QUALITY[keyword[key]] ?? null;
   const row = {
    ...sums, id: keyword.id, text: String(keyword.text ?? ""), matchType: keyword.matchType, matchLabel: MATCH[keyword.matchType] || String(keyword.matchType ?? DASH),
    campaignId: keyword.campaignId, campaign: shortName(data.campaignById.get(keyword.campaignId)?.name ?? keyword.campaignId), adGroup: String(keyword.adGroup ?? ""),
    qualityScore: isNum(keyword.qualityScore) ? keyword.qualityScore : null, expectedCtr: quality("expectedCtr"), adRelevance: quality("adRelevance"), landingPage: quality("landingPage"),
    active, statusNote: active ? "" : keyword.status !== "ENABLED" ? `${STATUS[keyword.status] || keyword.status} keyword` : "Ad group paused",
    duplicateOf: data.duplicates.get(keyword.id) || null,
   };
   row.lowQuality = isNum(row.qualityScore) && row.qualityScore <= 3;
   row.costlyNoLeads = row.cost >= 50 && !(row.leads > 0);
   rows.push(row);
  }
  return { rows, summary: keywordSummary(rows) };
 }

 function keywordSummary(rows) {
  const spendOf = list => list.reduce((sum, row) => sum + row.cost, 0), spend = round(spendOf(rows));
  return {
   count: rows.length, spend, leads: round(rows.reduce((sum, row) => sum + row.leads, 0)),
   lowQualityShare: ratio(spendOf(rows.filter(row => isNum(row.qualityScore) && row.qualityScore <= 4)), spend),
   noLeadShare: ratio(spendOf(rows.filter(row => !(row.leads > 0))), spend),
  };
 }

 function sortRows(rows, sort, direction) {
  const blank = value => value == null || value === "";
  return [...rows].sort((left, right) => {
   const a = left[sort], b = right[sort];
   if (blank(a)) return blank(b) ? 0 : 1;
   if (blank(b)) return -1;
   return (typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" })) * direction;
  });
 }

 // ---------- Watch lists ----------
 function makeListId(name, random = Math.random) {
  const slug = String(name ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 33).replace(/-+$/, "") || "list";
  let suffix = "";
  for (let index = 0; index < 6; index++) suffix += "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(random() * 36) % 36];
  return `${slug}-${suffix}`;
 }

 function buildList(draft, existingId, now = new Date()) {
  const name = String(draft.name ?? "").trim();
  return { id: existingId || makeListId(name), name, campaignIds: [...new Set((draft.campaignIds || []).map(String))], note: String(draft.note ?? "").trim(), updatedAt: now.toISOString() };
 }

 // The same limits the server enforces, in plain words.
 function validateList(list) {
  const errors = [], name = typeof list?.name === "string" ? list.name.trim() : "", ids = Array.isArray(list?.campaignIds) ? list.campaignIds : [];
  if (!name) errors.push("Give the list a name.");
  else if (characters(name) > LIMITS.name) errors.push(`Keep the name to ${LIMITS.name} characters or fewer (it has ${characters(name)}).`);
  if (list?.note != null && typeof list.note !== "string") errors.push("The note must be text.");
  else if (characters(list?.note) > LIMITS.note) errors.push(`Keep the note to ${LIMITS.note} characters or fewer (it has ${characters(list.note)}).`);
  if (typeof list?.id !== "string" || !ID_PATTERN.test(list.id)) errors.push("The list's id must be 1 to 40 lowercase letters, digits or dashes.");
  if (!ids.length) errors.push("Choose at least one campaign.");
  else if (ids.length > LIMITS.campaigns) errors.push(`Choose ${LIMITS.campaigns} campaigns or fewer (${ids.length} are chosen).`);
  if (ids.some(id => typeof id !== "string" || !/^\d+$/.test(id))) errors.push("Campaign ids must be digits only.");
  if (new Set(ids).size !== ids.length) errors.push("A campaign is chosen twice.");
  return errors;
 }

 function validateLists(lists) {
  if (!Array.isArray(lists)) return ["The watch lists are not a list."];
  const errors = [], seen = new Set();
  if (lists.length > LIMITS.lists) errors.push(`There can be at most ${LIMITS.lists} watch lists. Delete one first.`);
  for (const list of lists) {
   if (seen.has(list?.id)) errors.push(`Two lists share the id ${list.id}.`);
   seen.add(list?.id);
   for (const error of validateList(list)) errors.push(`${list?.name || list?.id || "A list"}: ${error}`);
  }
  return errors;
 }

 const applyEdit = (lists, list) => lists.some(item => item.id === list.id) ? lists.map(item => item.id === list.id ? list : item) : [...lists, list];

 function normalizeLists(body) {
  if (!body || typeof body !== "object" || !Number.isInteger(body.version) || !Array.isArray(body.lists)) return null;
  const lists = [];
  for (const item of body.lists) {
   if (!item || typeof item.id !== "string" || typeof item.name !== "string" || !Array.isArray(item.campaignIds)) return null;
   lists.push({ id: item.id, name: item.name, campaignIds: item.campaignIds.map(String), note: typeof item.note === "string" ? item.note : "", ...(typeof item.updatedAt === "string" && item.updatedAt ? { updatedAt: item.updatedAt } : {}) });
  }
  return { version: body.version, lists };
 }

 function browserStorage() {
  try { return globalThis.localStorage || null; } catch (error) { return null; }
 }

 function readLocal(storage) {
  try {
   const raw = storage ? storage.getItem(STORAGE_KEY) : null, parsed = raw ? normalizeLists(JSON.parse(raw)) : null;
   if (parsed) return parsed;
  } catch (error) { /* blocked or unreadable storage falls back to the seed list */ }
  return JSON.parse(JSON.stringify(SEED));
 }

 function writeLocal(storage, value) {
  try { if (!storage) return false; storage.setItem(STORAGE_KEY, JSON.stringify(value)); return true; } catch (error) { return false; }
 }

 function csrfToken() {
  try { return document.querySelector('meta[name="fhs-csrf"]')?.getAttribute("content") || ""; } catch (error) { return ""; }
 }

 // server: the shared API answered. local: no API (preview, non-JSON, network failure), so lists live in this browser.
 // signed-out: 401 or a redirect to the sign-in page. error: the API answered with an error of its own.
 async function fetchLists(fetcher = globalThis.fetch, storage = browserStorage()) {
  const local = () => ({ mode: "local", ...readLocal(storage) });
  let response;
  try { response = await fetcher(API_URL, { cache: "no-store", credentials: "same-origin", headers: { Accept: "application/json" } }); } catch (error) { return local(); }
  if (response.status === 401 || /\/login\.php(?:[?#]|$)/.test(response.url || "")) return { mode: "signed-out", version: null, lists: [] };
  let body;
  try { body = await response.json(); } catch (error) { return local(); }
  const parsed = response.ok ? normalizeLists(body) : null;
  if (parsed) return { mode: "server", ...parsed };
  return response.ok || response.status === 404 ? local() : { mode: "error", status: response.status, version: null, lists: [] };
 }

 function interpretSave(status, body) {
  const parsed = normalizeLists(body);
  if (status === 200 && parsed) return { ok: true, mode: "server", ...parsed };
  if (status === 409) return { ok: false, kind: "conflict", latest: parsed ? { mode: "server", ...parsed } : null, message: "Someone else saved the watch lists first, so this change was not saved. The latest lists are now loaded." };
  if (status === 400) return { ok: false, kind: "invalid", message: `The server did not accept the change${typeof body?.detail === "string" && body.detail ? `: ${body.detail}` : "."}` };
  if (status === 403) return { ok: false, kind: "token", message: "The page's security check has expired, so nothing was saved. Reload the page and try again." };
  if (status === 401) return { ok: false, kind: "signed-out", message: "You have been signed out, so nothing was saved. Reload the page to sign in again." };
  return { ok: false, kind: "error", message: `The server could not save the change (${status === 200 ? "unexpected reply" : `error ${status}`}). Nothing was saved; try again.` };
 }

 async function saveLists(store, lists, fetcher = globalThis.fetch, storage = browserStorage(), token = csrfToken()) {
  const errors = validateLists(lists);
  if (errors.length) return { ok: false, kind: "invalid", message: errors.join(" ") };
  if (store.mode === "local") {
   const next = { version: (store.version || 0) + 1, lists };
   return writeLocal(storage, next) ? { ok: true, mode: "local", ...next } : { ok: false, kind: "storage", message: "This browser would not keep the list (its storage is blocked or full), so nothing was saved." };
  }
  if (store.mode !== "server") return { ok: false, kind: "unavailable", message: "Watch lists cannot be saved right now. Reload the page and try again." };
  let response;
  try {
   response = await fetcher(API_URL, { method: "POST", cache: "no-store", credentials: "same-origin", headers: { "Content-Type": "application/json", Accept: "application/json", "X-CSRF-Token": token }, body: JSON.stringify({ version: store.version, lists }) });
  } catch (error) { return { ok: false, kind: "network", message: "Could not reach the server, so nothing was saved. Check the connection and try again." }; }
  let body = null;
  try { body = await response.json(); } catch (error) { body = null; }
  return interpretSave(response.status, body);
 }

 function allLists(data, store) {
  const running = data.campaigns.filter(campaign => campaign.status === "ENABLED").map(campaign => campaign.id);
  return [{ id: RUNNING, name: "All running campaigns", campaignIds: running, note: "", builtIn: true }, ...store.lists];
 }

 const pickList = (lists, id) => lists.find(list => list.id === id) || lists.find(list => !list.builtIn) || lists[0];

 // ---------- Markup ----------
 const listOptions = (lists, selectedId) => lists.map(list => `<option value="${html(list.id)}"${list.id === selectedId ? " selected" : ""}>${html(list.name)}${list.builtIn ? "" : ` · ${html(plural(list.campaignIds.length, "campaign"))}`}</option>`).join("");

 function dateControls(prefix, data, range) {
  const custom = range.preset === "custom", attributes = `min="${html(data.from)}" max="${html(data.through)}"${custom ? "" : " disabled"}`;
  return `<label><span>Dates</span><select id="${prefix}-window">${PRESETS.map(preset => `<option value="${preset}"${range.preset === preset ? " selected" : ""}>Last ${preset} days</option>`).join("")}<option value="custom"${custom ? " selected" : ""}>Choose dates</option></select></label>` +
   `<label class="watch-date"><span>From</span><input id="${prefix}-from" type="date" ${attributes} value="${html(range.from)}"></label>` +
   `<label class="watch-date"><span>To</span><input id="${prefix}-to" type="date" ${attributes} value="${html(range.to)}"></label>` +
   `<span class="tenant-cutoff">Data through ${html(dayLabel(data.through))}</span>`;
 }

 function storeNote(store) {
  if (store.mode === "local") return '<p class="watch-note" title="The shared watch-list service did not answer, so lists are kept in this browser.">Saved in this browser only (preview)</p>';
  if (store.mode === "signed-out") return '<p class="watch-note is-error" role="status">You are signed out, so saved watch lists cannot be loaded. Reload the page to sign in again.</p>';
  if (store.mode === "error") return `<p class="watch-note is-error" role="status">Saved watch lists could not be loaded (server error ${html(store.status)}). Reload the page to try again.</p>`;
  return "";
 }

 const messageHtml = message => message ? `<p class="watch-message${message.tone === "error" ? " is-error" : ""}" role="status">${html(message.text)}</p>` : "";

 function shareHtml(value, approximate, range) {
  if (!isNum(value)) return `<span title="No eligible impressions in these dates">${DASH}</span>`;
  return approximate ? `<span title="${html(APPROX_NOTE)}">≈${percent(value)}</span>` : `<span title="Google's own figure for the last ${html(range.preset)} days">${percent(value)}</span>`;
 }

 function sparkline(values, dates, name) {
  const width = 96, height = 24, peak = Math.max(0, ...values), step = width / Math.max(1, values.length);
  const top = values.indexOf(peak), label = peak > 0 ? `Daily spend for ${name}, ${rangeLabel(dates[0], dates.at(-1))}: highest ${money(peak)} on ${dayLabel(dates[top])}` : `No spend for ${name}, ${rangeLabel(dates[0], dates.at(-1))}`;
  const bars = values.map((value, index) => { const barHeight = peak > 0 && value > 0 ? Math.max(1.5, value / peak * (height - 2)) : 1; return `<rect x="${(index * step).toFixed(2)}" y="${(height - barHeight).toFixed(2)}" width="${Math.max(0.6, step - (step > 3 ? 1 : 0.2)).toFixed(2)}" height="${barHeight.toFixed(2)}"${value > 0 ? "" : ' class="is-zero"'}/>`; }).join("");
  return `<svg class="watch-spark" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="${html(label)}"><title>${html(label)}</title>${bars}</svg>`;
 }

 const CAMPAIGN_COLUMNS = [
  ["name", "Campaign", "name"], ["statusLabel", "Status", "text"], ["budgetPerDay", "Budget per day", "budget"], ["cost", "Spend", "money"], ["clicks", "Clicks", "whole"],
  ["cpc", "Avg. cost per click", "money"], ["leads", "Leads", "count", "Ad calls of 60 seconds or more, website forms and taps on the website phone number."], ["costPerLead", "Cost per lead", "cpl"],
  ["phoneCalls", "Ad calls (any length)", "whole", "Calls from the ads of any length. Only calls of 60 seconds or more count as leads."],
  ["button_clicks", "Checkout clicks (not leads)", "count", "Clicks on the checkout button. They also fire on Pay your bill, so they are not leads."],
  ["impressionShare", "Impression share", "share", "Share of the searches the ads were eligible for where they showed."], ["lostBudgetShare", "Lost to budget", "share", "Share of eligible searches missed because the daily budget ran out."],
  ["lostRankShare", "Lost to rank", "share", "Share of eligible searches missed because of a low ad rank (bid and quality)."], ["daily", "Daily spend", "spark"],
 ];

 const KEYWORD_COLUMNS = [
  ["text", "Keyword", "keyword"], ["matchLabel", "Match", "text"], ["campaign", "Campaign", "text"], ["adGroup", "Ad group", "text"],
  ["qualityScore", "Quality Score", "qs", "Google's current 1–10 rating, not a rating for the chosen dates."], ["expectedCtr", "Expected click rate", "quality"], ["adRelevance", "Ad relevance", "quality"], ["landingPage", "Landing page", "quality"],
  ["cost", "Spend", "money"], ["impressions", "Impressions", "whole"], ["clicks", "Clicks", "whole"], ["ctr", "Click rate", "percent"], ["cpc", "Avg. cost per click", "money"],
  ["leads", "Leads", "count", "Ad calls of 60 seconds or more, website forms and taps on the website phone number."], ["costPerLead", "Cost per lead", "cpl"],
  ["button_clicks", "Checkout clicks (not leads)", "count", "Clicks on the checkout button. They also fire on Pay your bill, so they are not leads."],
 ];

 const TEXT_KINDS = ["name", "text", "keyword"];
 const numberClass = kind => TEXT_KINDS.includes(kind) || kind === "spark" ? "" : "tenant-number";
 const classAttribute = name => name ? ` class="${name}"` : "";

 function headerHtml(columns, attribute, sort, direction) {
  return `<tr>${columns.map(([key, label, kind, title]) => {
   const cls = numberClass(kind), titleAttribute = title ? ` title="${html(title)}"` : "";
   if (kind === "spark") return `<th class="watch-spark-cell"${titleAttribute}>${html(label)}</th>`;
   return `<th${classAttribute(cls)} aria-sort="${sort === key ? (direction === 1 ? "ascending" : "descending") : "none"}"${titleAttribute}><button type="button" ${attribute}="${key}">${html(label)} ${sort === key ? (direction === 1 ? "↑" : "↓") : "↕"}</button></th>`;
  }).join("")}</tr>`;
 }

 function valueHtml(row, key, kind, range) {
  const value = row[key];
  if (kind === "money") return money(value);
  if (kind === "budget") return isNum(value) ? `${money(value)}/day` : DASH;
  if (kind === "whole") return count(value, 0);
  if (kind === "count") return count(value);
  if (kind === "percent") return percent(value);
  if (kind === "cpl") return isNum(value) ? money(value) : `<span title="No leads">${DASH}</span>`;
  if (kind === "share") return shareHtml(value, row.sharesApproximate, range);
  if (kind === "qs") return !isNum(value) ? `<span title="Google has no Quality Score for this keyword yet">${DASH}</span>` : row.lowQuality ? `<span class="watch-low" title="Quality Score 3 or lower">${count(value, 0)}</span>` : count(value, 0);
  if (kind === "quality") return value == null ? DASH : value === 1 ? `<span class="watch-below">${QUALITY_LABEL[value]}</span>` : QUALITY_LABEL[value];
  return html(value ?? DASH);
 }

 function renderWatch(data, store, view) {
  const lists = allLists(data, store), list = pickList(lists, view.listId), range = windowRange(data, view.preset, view.from, view.to), model = watchModel(data, list, range);
  const editable = store.mode === "local" || store.mode === "server", full = store.lists.length >= LIMITS.lists, busy = view.busy ? " disabled" : "";
  const lockedTitle = list.builtIn ? ' title="The built-in list follows the campaigns that are running now and cannot be changed."' : "";
  const bar = `<section class="watch-bar" aria-label="Watch list and dates">
   <label class="watch-wide"><span>Watch list</span><select id="watch-list"${busy}>${listOptions(lists, list.id)}</select></label>
   <div class="watch-actions" role="group" aria-label="Manage watch lists"><button type="button" class="watch-button" id="watch-new"${!editable || full || view.busy ? " disabled" : ""}${full ? ` title="There can be at most ${LIMITS.lists} watch lists. Delete one first."` : ""}>New list</button><button type="button" class="watch-button" id="watch-edit"${!editable || list.builtIn || view.busy ? " disabled" : ""}${lockedTitle}>Edit</button><button type="button" class="watch-button" id="watch-delete"${!editable || list.builtIn || view.busy ? " disabled" : ""}${lockedTitle}>Delete</button></div>
   ${dateControls("watch", data, range)}
  </section>`;
  const confirm = view.confirmDelete && !list.builtIn && editable ? `<div class="watch-confirm" role="group" aria-labelledby="watch-confirm-text"><p id="watch-confirm-text"><strong>Delete “${html(list.name)}”${store.mode === "local" ? " from this browser" : " for everyone who signs in"}?</strong> This cannot be undone.</p><button type="button" class="watch-danger" id="watch-delete-yes"${busy}>${view.busy ? "Deleting…" : "Delete list"}</button><button type="button" class="watch-button" id="watch-delete-no"${busy}>Keep it</button></div>` : "";
  const about = list.builtIn ? `Every campaign running now (${html(plural(list.campaignIds.length, "campaign"))}). This list follows Google Ads and cannot be edited.` : `${html(plural(list.campaignIds.length, "campaign"))}${list.note ? ` · ${html(list.note)}` : ""}${localDay(list.updatedAt) ? ` · Last changed ${html(localDay(list.updatedAt))}` : ""}`;
  const cards = headline(model).map(card => {
   const tone = card.better === 0 || !card.change ? "neutral" : (card.change > 0) === (card.better > 0) ? "" : "bad";
   const compared = !model.previousRange ? `No earlier ${html(plural(range.days, "day"))} in the data to compare` : isNum(card.change) ? `<span class="delta${tone ? ` ${tone}` : ""}">${signedPercent(card.change)}</span> vs ${html(card.previous)} in the previous ${html(plural(range.days, "day"))}` : `Previous ${html(plural(range.days, "day"))}: ${html(card.previous)}`;
   return `<article class="kpi-card"><div class="kpi-head">${html(card.label)}</div><div class="kpi-value"${card.title ? ` title="${html(card.title)}"` : ""}>${html(card.value)}</div><div class="report-note">${html(rangeLabel(range.from, range.to))}</div><div class="report-comparison">${compared}</div></article>`;
  }).join("");
  const t = model.total;
  const scope = `${html(rangeLabel(range.from, range.to))} · ${html(plural(range.days, "day"))} · USD · ${html(data.timeZone || "America/New_York")}.${model.previousRange ? ` Changes compare with ${html(rangeLabel(model.previousRange.from, model.previousRange.to))}.` : ""} Leads are ad calls of 60 seconds or more, website forms and taps on the website phone number. Not counted as leads: ${html(plural(t.button_clicks, "checkout-button click"))} (they also fire on “Pay your bill”) and ${html(plural(t.store_visits, "store visit"))} modelled by Google${t.other > 0 ? `, plus ${html(plural(t.other, "other conversion"))}` : ""}.`;
  const ordered = sortRows(model.rows, view.sort, view.direction);
  const body = ordered.map(row => `<tr${row.reasons.length ? ` class="watch-flag" title="${html(row.reasons.join("; "))}"` : ""}>${CAMPAIGN_COLUMNS.map(([key, , kind]) => {
   if (kind === "name") return `<td class="watch-name-cell"><button type="button" class="watch-campaign" data-watch-campaign="${html(row.id)}" title="${html(row.fullName)}: show its keywords">${html(row.name)}</button>${row.reasons.length ? `<small class="watch-reasons">${row.reasons.map(html).join(" · ")}</small>` : ""}</td>`;
   if (kind === "spark") return `<td class="watch-spark-cell">${sparkline(row.daily, model.dates, row.name)}</td>`;
   return `<td${classAttribute(numberClass(kind))}>${valueHtml(row, key, kind, range)}</td>`;
  }).join("")}</tr>`).join("") || `<tr><td colspan="${CAMPAIGN_COLUMNS.length}" class="tenant-empty">No campaign in this list is in the Google Ads data.</td></tr>`;
  const totalRow = { ...t, statusLabel: "", sharesApproximate: true };
  const foot = model.rows.length ? `<tfoot><tr>${CAMPAIGN_COLUMNS.map(([key, , kind]) => {
   if (kind === "name") return `<td class="watch-name-cell"><strong>Total · ${html(plural(model.rows.length, "campaign"))}</strong></td>`;
   if (kind === "spark") return `<td class="watch-spark-cell">${sparkline(t.daily, model.dates, "the whole list")}</td>`;
   if (key === "budgetPerDay") return `<td class="tenant-number" title="Sum of the daily budgets of the running campaigns in this list">${valueHtml(totalRow, key, kind, range)}</td>`;
   return `<td${classAttribute(numberClass(kind))}>${valueHtml(totalRow, key, kind, range)}</td>`;
  }).join("")}</tr></tfoot>` : "";
  const missing = model.missing.length ? `<p class="detail-scope watch-foot">${html(plural(model.missing.length, "campaign"))} in this list ${model.missing.length === 1 ? "is" : "are"} not in the Google Ads data (ID ${model.missing.map(html).join(", ")}).</p>` : "";
  return `<h2 class="sr-only" data-watch-heading tabindex="-1">Google Ads watch list</h2>${bar}${storeNote(store)}${messageHtml(view.message)}${confirm}
  <p class="detail-scope watch-about"><b>${html(list.name)}</b> · ${about}</p>
  <section class="kpi-grid watch-kpis" aria-label="Headline figures for the whole list">${cards}</section>
  <p class="detail-scope">${scope}</p>
  <article class="panel watch-panel"><header class="panel-header"><div><h3>Campaigns in “${html(list.name)}”</h3><p>Choose a campaign to see its keywords. Highlighted rows spent with no leads, cost more than twice the list's cost per lead, or lost more than 40% of possible impressions to budget; the reason is under the name.</p></div></header>
   <div class="tenant-table-scroll" tabindex="0" role="region" aria-label="Campaigns in this watch list"><table class="tenant-table watch-table"><thead>${headerHtml(CAMPAIGN_COLUMNS, "data-watch-sort", view.sort, view.direction)}</thead><tbody>${body}</tbody>${foot}</table></div>
   <p class="detail-scope watch-foot">${range.preset === "custom" ? "Impression shares for chosen dates are rebuilt from daily figures and marked ≈ (approximate)." : `Impression shares are Google's own figures for the last ${html(range.preset)} days.`} The total row's shares are rebuilt from summed impressions and marked ≈; Google reports days under 10% as 0.0999, so rebuilt shares can differ by several points.</p>${missing}
  </article>`;
 }

 function renderKeywords(data, store, view) {
  const kw = view.kw, lists = allLists(data, store), list = pickList(lists, kw.listId ?? view.listId), range = windowRange(data, view.preset, view.from, view.to);
  const campaigns = list.campaignIds.map(String).filter(id => data.campaignById.has(id)).map(id => data.campaignById.get(id)).sort((a, b) => (a.status !== "ENABLED") - (b.status !== "ENABLED") || shortName(a.name).localeCompare(shortName(b.name)));
  const campaign = campaigns.some(item => item.id === kw.campaign) ? kw.campaign : "all";
  const model = keywordModel(data, list.campaignIds, { ...kw, campaign }, range), summary = model.summary;
  const ordered = sortRows(model.rows, kw.sort, kw.direction), pages = Math.max(1, Math.ceil(ordered.length / PAGE_SIZE)), page = Math.min(Math.max(1, kw.page), pages), shown = ordered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const select = (id, options, value) => `<select id="${id}">${options.map(([key, label]) => `<option value="${html(key)}"${key === value ? " selected" : ""}>${html(label)}</option>`).join("")}</select>`;
  const bar = `<section class="watch-bar" aria-label="Keyword filters">
   <label class="watch-wide"><span>Watch list</span><select id="kw-list">${listOptions(lists, list.id)}</select></label>
   <label class="watch-wide"><span>Campaign</span>${select("kw-campaign", [["all", "All campaigns in this list"], ...campaigns.map(item => [item.id, `${shortName(item.name)}${item.status === "ENABLED" ? "" : ` (${STATUS[item.status] || item.status})`}`])], campaign)}</label>
   <label><span>Match type</span>${select("kw-match", [["all", "All match types"], ["BROAD", "Broad"], ["PHRASE", "Phrase"], ["EXACT", "Exact"]], kw.match)}</label>
   <label class="watch-wide"><span>Keyword status</span>${select("kw-status", [["active", "Enabled, in enabled ad groups"], ["paused", "Paused, or in a paused ad group"], ["all", "All keywords"]], kw.status)}</label>
   <label class="watch-search"><span>Search</span><input id="kw-search" type="search" value="${html(kw.search)}" placeholder="Keyword or ad group" autocomplete="off"></label>
   <label class="watch-check"><input id="kw-spend" type="checkbox"${kw.onlySpend ? " checked" : ""}><span>Only keywords with spend in these dates</span></label>
   ${dateControls("kw", data, range)}
  </section>`;
  const line = `<p class="watch-summary" role="status"><strong>${html(plural(summary.count, "keyword"))} shown</strong> · ${html(money(summary.spend))} spend · ${html(count(summary.leads))} leads · ${html(percent(summary.lowQualityShare))} of spend on Quality Score 4 or lower · ${html(percent(summary.noLeadShare))} of spend on keywords with no leads</p>`;
  const body = shown.map(row => `<tr${row.costlyNoLeads ? ` class="watch-flag" title="${html(`${money(row.cost)} spent with no leads in these dates`)}"` : ""}>${KEYWORD_COLUMNS.map(([key, , kind]) => {
   if (kind === "keyword") return `<td class="watch-keyword-cell"><span class="watch-keyword">${html(row.text)}</span>${row.duplicateOf ? ` <span class="watch-badge" title="${html(`The same keyword and match type is also enabled in ${row.duplicateOf.join(", ")} in this campaign`)}">Duplicate</span>` : ""}${row.statusNote ? `<small>${html(row.statusNote)}</small>` : ""}${row.costlyNoLeads ? `<small class="watch-reasons">${html(money(row.cost))} spent, no leads</small>` : ""}</td>`;
   if (kind === "text") return `<td class="watch-text-cell">${html(row[key])}</td>`;
   return `<td${classAttribute(numberClass(kind))}>${valueHtml(row, key, kind, range)}</td>`;
  }).join("")}</tr>`).join("") || `<tr><td colspan="${KEYWORD_COLUMNS.length}" class="tenant-empty">No keywords match these filters.</td></tr>`;
  const footer = `<footer class="table-footer"><span>${ordered.length ? `${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, ordered.length)} of ${ordered.length}` : "No matching keywords"}</span><div class="pagination"><button class="page-button" type="button" data-kw-page="${page - 1}"${page === 1 ? " disabled" : ""} aria-label="Previous page">‹</button><span>${page} / ${pages}</span><button class="page-button" type="button" data-kw-page="${page + 1}"${page === pages ? " disabled" : ""} aria-label="Next page">›</button></div></footer>`;
  const heading = campaign === "all" ? `Keywords in “${html(list.name)}”` : `Keywords in ${html(shortName(data.campaignById.get(campaign).name))}`;
  return `<h2 class="sr-only" data-watch-heading tabindex="-1">Google Ads keywords</h2>${bar}${storeNote(store)}${line}
  <article class="panel watch-panel"><header class="panel-header"><div><h3>${heading}</h3><p>${html(rangeLabel(range.from, range.to))}. Quality Score and its three parts are Google's current ratings. “Duplicate”: the same keyword and match type is enabled in another ad group of the same campaign. Red: Quality Score 3 or lower. Highlighted rows spent $50 or more with no leads.</p></div></header>
   <div class="tenant-table-scroll" tabindex="0" role="region" aria-label="Keywords"><table class="tenant-table watch-table watch-keywords"><thead>${headerHtml(KEYWORD_COLUMNS, "data-kw-sort", kw.sort, kw.direction)}</thead><tbody>${body}</tbody></table></div>
   ${footer}
  </article>`;
 }

 function renderEditor(data, draft, context = {}) {
  const chosen = new Set((draft.campaignIds || []).map(String)), sorted = [...data.campaigns].sort((a, b) => shortName(a.name).localeCompare(shortName(b.name)));
  const option = (id, name, detail) => `<label class="watch-option" data-watch-option="${html(name.toLowerCase())}"><input type="checkbox" name="campaign" value="${html(id)}"${chosen.has(id) ? " checked" : ""}><span>${html(name)}</span><small>${html(detail)}</small></label>`;
  const group = (title, items) => items.length ? `<div class="watch-group" role="group" aria-label="${html(title)}"><p class="watch-group-title">${html(title)}</p>${items.join("")}</div>` : "";
  const describe = campaign => `${STATUS[campaign.status] || campaign.status}${isNum(campaign.budgetPerDay) ? ` · ${money(campaign.budgetPerDay)}/day` : ""}`;
  const unknown = [...chosen].filter(id => !data.campaignById.has(id));
  const options = group("Running campaigns", sorted.filter(item => item.status === "ENABLED").map(item => option(item.id, shortName(item.name), describe(item)))) +
   group("Paused campaigns", sorted.filter(item => item.status === "PAUSED").map(item => option(item.id, shortName(item.name), describe(item)))) +
   group("Other campaigns", sorted.filter(item => item.status !== "ENABLED" && item.status !== "PAUSED").map(item => option(item.id, shortName(item.name), describe(item)))) +
   group("Not in the Google Ads data", unknown.map(id => option(id, `Campaign ${id}`, "Not in the data file")));
  return `<form class="tenant-dialog-shell watch-editor" id="watch-form" novalidate>
   <header><div><p class="drawer-eyebrow">${context.local ? "Saved in this browser only (preview)" : "Shared with everyone who signs in"}</p><h2 id="watch-dialog-title" tabindex="-1">${draft.id ? `Edit “${html(draft.name)}”` : "New watch list"}</h2></div><button class="close-button" type="button" data-watch-cancel aria-label="Close without saving">×</button></header>
   <div class="tenant-dialog-body">
    <p class="watch-form-error" id="watch-form-error" role="alert"${context.error ? "" : " hidden"}>${html(context.error || "")}</p>
    <label class="watch-field"><span>Name</span><input id="watch-name" type="text" maxlength="${LIMITS.name}" required autocomplete="off" value="${html(draft.name)}"></label>
    <label class="watch-field"><span>Note (optional, up to ${LIMITS.note} characters)</span><textarea id="watch-note" maxlength="${LIMITS.note}" rows="2">${html(draft.note)}</textarea></label>
    <fieldset class="watch-picker"><legend>Campaigns · <span id="watch-picked">${chosen.size} chosen</span></legend>
     <label class="watch-field"><span>Find a campaign</span><input id="watch-find" type="search" placeholder="Part of the campaign name" autocomplete="off"></label>
     <div class="watch-options">${options}</div>
     <p class="tenant-empty" id="watch-no-match" hidden>No campaign matches that search.</p>
    </fieldset>
   </div>
   <footer class="watch-editor-foot"><button type="button" class="watch-button" data-watch-cancel>Cancel</button><button type="submit" class="watch-primary" id="watch-save">Save list</button></footer>
  </form>`;
 }

 // ---------- Browser glue ----------
 // detail, switchView, setFreshness, reportingDates, definitions and onPublicHost are the page's own globals.
 const view = { listId: null, preset: "30", from: null, to: null, sort: "cost", direction: -1, confirmDelete: false, busy: false, message: null, kw: { listId: null, campaign: "all", match: "all", status: "active", search: "", onlySpend: true, sort: "cost", direction: -1, page: 1 } };
 let data = null, store = null, failed = false, dataPromise = null, listsPromise = null, editor = null, searchTimer;

 const onPublic = () => typeof onPublicHost !== "undefined" ? onPublicHost : globalThis.publicHost ? globalThis.publicHost.isPublicHost(globalThis.location?.hostname) : true;
 const tabOf = name => name === "keywords" ? "keywords" : "watch";
 const isOpen = tab => !document.getElementById(`${tab}-view`)?.classList.contains("hidden");
 const currentList = () => pickList(allLists(data, store), view.listId);

 function load() {
  if (onPublic()) return Promise.resolve();
  if (!dataPromise) dataPromise = fetch(DATA_URL, { cache: "no-store", credentials: "same-origin" }).then(response => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); }).then(raw => { data = prepare(raw); }).catch(error => { failed = true; console.warn("Google Ads watch data unavailable:", error.message); });
  if (!listsPromise) listsPromise = fetchLists().then(result => { store = result; });
  return Promise.all([dataPromise, listsPromise]);
 }

 function chrome(tab) {
  const label = tab === "keywords" ? "Google Ads keywords" : "Google Ads watch list", set = (id, text) => { const element = document.getElementById(id); if (element) element.textContent = text; };
  const refreshed = data?.extractedAt ? String(data.extractedAt).slice(0, 10) : null;
  set("mode-ribbon", data ? `${label} · data through ${dayLabel(data.through)}` : label);
  set("snapshot-label", refreshed ? `Updated ${globalThis.reportingDates?.formatDate(refreshed) ?? dayLabel(refreshed)}` : "Google Ads watch data");
  globalThis.setFreshness?.(tab === "keywords" ? "Keywords" : "Watch list", data?.through, refreshed || undefined, !data && !failed);
  set("footer-note", data ? `${label} · daily data ${rangeLabel(data.from, data.through)} · USD · ${data.timeZone || "America/New_York"} · Google Ads figures; a lead is an ad call of 60 seconds or more, a website form or a tap on the website phone number` : label);
 }

 function render(name) {
  if (typeof document === "undefined") return;
  const tab = tabOf(name ?? (typeof detail !== "undefined" ? detail.view : "watch")), rootElement = document.getElementById(`${tab}-root`);
  if (!rootElement) return;
  if (onPublic()) { rootElement.innerHTML = '<section class="panel tenant-unavailable" role="status">This tab is available on the private site only.</section>'; return; }
  chrome(tab);
  if (failed) { rootElement.innerHTML = '<section class="panel tenant-unavailable" role="status">Google Ads watch data isn\'t available on this site yet. Run the private refresh to add it.</section>'; return; }
  if (!data || !store) { rootElement.innerHTML = '<p class="tenant-loading" role="status">Loading Google Ads watch data…</p>'; load().then(() => { if (isOpen(tab)) render(tab); }); return; }
  rootElement.innerHTML = tab === "keywords" ? renderKeywords(data, store, view) : renderWatch(data, store, view);
  (tab === "keywords" ? bindKeywords : bindWatch)(rootElement);
 }

 function rerender(tab, focusId) {
  render(tab);
  if (focusId) requestAnimationFrame(() => document.getElementById(focusId)?.focus({ preventScroll: true }));
 }

 function bindDates(rootElement, prefix, tab) {
  rootElement.querySelector(`#${prefix}-window`).onchange = event => {
   if (event.target.value === "custom") { const range = windowRange(data, view.preset, view.from, view.to); view.from = range.from; view.to = range.to; }
   view.preset = event.target.value; view.kw.page = 1; view.message = null; rerender(tab, `${prefix}-window`);
  };
  for (const end of ["from", "to"]) rootElement.querySelector(`#${prefix}-${end}`).onchange = event => {
   if (!ISO_DATE.test(event.target.value)) return;
   const range = windowRange(data, "custom", view.from, view.to), value = clamp(event.target.value, data.from, data.through);
   let from = end === "from" ? value : range.from, to = end === "to" ? value : range.to;
   if (from > to) { if (end === "from") to = from; else from = to; }
   Object.assign(view, { preset: "custom", from, to, message: null }); view.kw.page = 1; rerender(tab, `${prefix}-${end}`);
  };
 }

 function sortHandler(target, key) {
  const column = [...CAMPAIGN_COLUMNS, ...KEYWORD_COLUMNS].find(item => item[0] === key), text = column && TEXT_KINDS.includes(column[2]);
  target.direction = target.sort === key ? -target.direction : text ? 1 : -1; target.sort = key;
 }

 function bindWatch(rootElement) {
  const find = selector => rootElement.querySelector(selector);
  find("#watch-list").onchange = event => { Object.assign(view, { listId: event.target.value, confirmDelete: false, message: null }); Object.assign(view.kw, { listId: null, campaign: "all", page: 1 }); rerender("watch", "watch-list"); };
  find("#watch-new").onclick = () => { view.message = null; openEditor(null, "watch-new"); };
  find("#watch-edit").onclick = () => { view.message = null; openEditor(currentList(), "watch-edit"); };
  find("#watch-delete").onclick = () => { Object.assign(view, { confirmDelete: true, message: null }); rerender("watch", "watch-delete-no"); };
  find("#watch-delete-yes")?.addEventListener("click", () => deleteList(currentList().id));
  find("#watch-delete-no")?.addEventListener("click", () => { view.confirmDelete = false; rerender("watch", "watch-delete"); });
  bindDates(rootElement, "watch", "watch");
  rootElement.querySelectorAll("[data-watch-sort]").forEach(button => button.onclick = () => { sortHandler(view, button.dataset.watchSort); rerender("watch"); });
  rootElement.querySelectorAll("[data-watch-campaign]").forEach(button => button.onclick = () => showKeywords(button.dataset.watchCampaign));
 }

 function showKeywords(campaignId) {
  Object.assign(view.kw, { listId: null, campaign: campaignId, page: 1, search: "" });
  if (typeof switchView === "function") switchView("keywords"); else render("keywords");
  requestAnimationFrame(() => document.querySelector("#keywords-root [data-watch-heading]")?.focus({ preventScroll: true }));
 }

 function bindKeywords(rootElement) {
  const find = selector => rootElement.querySelector(selector), kw = view.kw;
  find("#kw-list").onchange = event => { Object.assign(kw, { listId: event.target.value, campaign: "all", page: 1 }); rerender("keywords", "kw-list"); };
  for (const [id, key] of [["kw-campaign", "campaign"], ["kw-match", "match"], ["kw-status", "status"]]) find(`#${id}`).onchange = event => { kw[key] = event.target.value; kw.page = 1; rerender("keywords", id); };
  find("#kw-spend").onchange = event => { kw.onlySpend = event.target.checked; kw.page = 1; rerender("keywords", "kw-spend"); };
  find("#kw-search").oninput = event => {
   const cursor = event.target.selectionStart, value = event.target.value;
   clearTimeout(searchTimer);
   searchTimer = setTimeout(() => { kw.search = value; kw.page = 1; render("keywords"); requestAnimationFrame(() => { const input = document.getElementById("kw-search"); input?.focus({ preventScroll: true }); input?.setSelectionRange(cursor, cursor); }); }, 150);
  };
  bindDates(rootElement, "kw", "keywords");
  rootElement.querySelectorAll("[data-kw-sort]").forEach(button => button.onclick = () => { sortHandler(kw, button.dataset.kwSort); kw.page = 1; rerender("keywords"); });
  rootElement.querySelectorAll("[data-kw-page]").forEach(button => button.onclick = () => { kw.page = Number(button.dataset.kwPage); rerender("keywords"); rootElement.querySelector(".watch-panel")?.scrollIntoView({ block: "start" }); });
 }

 function editorDialog() {
  let dialog = document.getElementById("watch-dialog");
  if (dialog) return dialog;
  dialog = document.createElement("dialog");
  dialog.id = "watch-dialog"; dialog.className = "tenant-dialog watch-dialog"; dialog.setAttribute("aria-labelledby", "watch-dialog-title");
  dialog.addEventListener("close", () => { const target = editor?.triggerId ? document.getElementById(editor.triggerId) || document.getElementById("watch-list") : null; editor = null; dialog.innerHTML = ""; target?.focus?.(); });
  document.body.appendChild(dialog);
  return dialog;
 }

 function openEditor(list, triggerId) {
  const dialog = editorDialog();
  editor = { id: list?.id || null, triggerId };
  dialog.innerHTML = renderEditor(data, { id: editor.id, name: list?.name || "", note: list?.note || "", campaignIds: list?.campaignIds || [] }, { local: store.mode === "local" });
  bindEditor(dialog);
  if (!dialog.open) dialog.showModal();
  dialog.querySelector("#watch-name").focus();
 }

 function bindEditor(dialog) {
  const form = dialog.querySelector("#watch-form"), find = dialog.querySelector("#watch-find");
  dialog.querySelectorAll("[data-watch-cancel]").forEach(button => button.onclick = () => dialog.close());
  find.onkeydown = event => { if (event.key === "Enter") event.preventDefault(); };
  find.oninput = () => {
   const query = find.value.trim().toLowerCase();
   let shown = 0;
   dialog.querySelectorAll("[data-watch-option]").forEach(option => { const hit = !query || option.dataset.watchOption.includes(query); option.hidden = !hit; if (hit) shown++; });
   dialog.querySelectorAll(".watch-group").forEach(group => { group.hidden = !group.querySelector("[data-watch-option]:not([hidden])"); });
   dialog.querySelector("#watch-no-match").hidden = shown > 0;
  };
  form.onchange = () => { dialog.querySelector("#watch-picked").textContent = `${form.querySelectorAll('input[name="campaign"]:checked').length} chosen`; };
  form.onsubmit = event => { event.preventDefault(); submitEditor(dialog); };
 }

 function showFormError(dialog, text) {
  const box = dialog.querySelector("#watch-form-error");
  if (!box) return;
  box.textContent = text; box.hidden = false; box.scrollIntoView({ block: "nearest" });
 }

 async function submitEditor(dialog) {
  const form = dialog.querySelector("#watch-form"), save = dialog.querySelector("#watch-save"), editing = editor;
  const list = buildList({ name: form.querySelector("#watch-name").value, note: form.querySelector("#watch-note").value, campaignIds: [...form.querySelectorAll('input[name="campaign"]:checked')].map(input => input.value) }, editing.id);
  const next = applyEdit(store.lists, list), problems = validateList(list);
  if (!problems.length && next.length > LIMITS.lists) problems.push(`There can be at most ${LIMITS.lists} watch lists. Delete one first.`);
  if (problems.length) { showFormError(dialog, problems.join(" ")); return; }
  save.disabled = true; save.textContent = "Saving…";
  const result = await saveLists(store, next);
  if (result.ok) {
   store = { mode: result.mode, version: result.version, lists: result.lists };
   Object.assign(view, { listId: list.id, confirmDelete: false, message: { text: store.mode === "local" ? `Saved “${list.name}” in this browser.` : `Saved “${list.name}”. Everyone who signs in now sees it.`, tone: "ok" } });
   view.kw.listId = null;
   if (dialog.open) dialog.close();
   render(typeof detail !== "undefined" ? detail.view : "watch");
   return;
  }
  if (result.kind === "conflict") {
   store = result.latest || await fetchLists();
   render(typeof detail !== "undefined" ? detail.view : "watch");
   showFormError(dialog, "Someone else saved the watch lists while you were editing, so your change is not saved yet. The latest lists are now loaded and your changes are still in this form. Check them and press Save list again.");
  } else showFormError(dialog, result.message);
  save.disabled = false; save.textContent = "Save list";
 }

 async function deleteList(id) {
  const list = store.lists.find(item => item.id === id);
  if (!list) return;
  view.busy = true; rerender("watch");
  const result = await saveLists(store, store.lists.filter(item => item.id !== id));
  Object.assign(view, { busy: false, confirmDelete: false });
  if (result.ok) {
   store = { mode: result.mode, version: result.version, lists: result.lists };
   if (view.listId === id) view.listId = null;
   if (view.kw.listId === id) view.kw.listId = null;
   view.message = { text: `Deleted “${list.name}”.`, tone: "ok" };
  } else if (result.kind === "conflict") {
   store = result.latest || await fetchLists();
   view.message = { text: "Someone else changed the watch lists first, so nothing was deleted. The latest lists are now loaded; delete again if you still want to.", tone: "error" };
  } else view.message = { text: result.message, tone: "error" };
  rerender("watch", "watch-list");
 }

 if (typeof document !== "undefined" && !onPublic() && typeof definitions !== "undefined" && Array.isArray(definitions)) definitions.push(...DEFINITIONS);

 return {
  SCHEMA, DATA_URL, API_URL, STORAGE_KEY, SEED, LIMITS, PRESETS, RUNNING, DEFINITIONS,
  prepare, windowRange, previousWindow, campaignTotals, googleShares, campaignFlags, watchModel, headline, duplicates, keywordModel, keywordSummary, sortRows,
  makeListId, buildList, validateList, validateLists, applyEdit, normalizeLists, readLocal, writeLocal, fetchLists, interpretSave, saveLists, allLists, pickList,
  renderWatch, renderKeywords, renderEditor, sparkline, render,
 };
});
