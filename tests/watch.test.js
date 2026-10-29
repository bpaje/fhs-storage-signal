"use strict";

// Watch list and Keywords tabs: period sums and shares from summed impressions, Google's own shares for preset windows,
// leads without checkout clicks or store visits, cost per lead, previous-period windows, duplicate keywords, watch-list
// validation, the API and browser-storage fallback, escaping, and the private-host-only wiring. Synthetic fixture only.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const watch = require("../watch.js");
const { resolveView } = require("../public-host.js");

const ROOT = path.join(__dirname, "..");
const raw = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/ads-watch.json"), "utf8"));
const data = watch.prepare(raw);
const close = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-9, `${message}: ${actual} != ${expected}`);
const range = (preset, from, to) => watch.windowRange(data, preset, from, to);
const r7 = range("7");
const list = (over = {}) => ({ id: "test-list-aaaaaa", name: "Test list", campaignIds: ["1001", "1002"], note: "", ...over });
const baseView = (over = {}) => ({ listId: null, preset: "7", from: null, to: null, sort: "cost", direction: -1, confirmDelete: false, busy: false, message: null, kw: { listId: null, campaign: "all", match: "all", status: "active", search: "", onlySpend: true, sort: "cost", direction: -1, page: 1 }, ...over });
const kwFilters = (over = {}) => ({ campaign: "all", match: "all", status: "active", search: "", onlySpend: true, ...over });
const memoryStorage = (initial = {}) => { const items = { ...initial }; return { items, getItem: key => key in items ? items[key] : null, setItem: (key, value) => { items[key] = String(value); } }; };
const throwingStorage = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
const reply = (status, body, url = "") => async () => ({ status, ok: status >= 200 && status < 300, url, json: async () => { if (body instanceof Error) throw body; return body; } });

async function run() {
 // Date windows: presets end at `through`, clamp to the data range, custom dates are clamped and ordered.
 assert.deepEqual(r7, { preset: "7", from: "2026-10-22", to: "2026-10-28", days: 7 });
 assert.deepEqual(range("14"), { preset: "14", from: "2026-10-15", to: "2026-10-28", days: 14 });
 assert.deepEqual(range("30"), { preset: "30", from: "2026-10-01", to: "2026-10-28", days: 28 }, "a preset longer than the data is clamped");
 assert.deepEqual(range("custom", "2026-09-01", "2026-11-30"), { preset: "custom", from: "2026-10-01", to: "2026-10-28", days: 28 });
 assert.deepEqual(range("custom", "2026-10-25", "2026-10-20"), { preset: "custom", from: "2026-10-20", to: "2026-10-25", days: 6 });
 assert.deepEqual(range("custom", "nonsense", null), { preset: "custom", from: "2026-10-01", to: "2026-10-28", days: 28 });

 // Previous period: the same length just before, only when all of it is inside the data.
 assert.deepEqual(watch.previousWindow(data, r7), { preset: "custom", from: "2026-10-15", to: "2026-10-21", days: 7 });
 assert.deepEqual(watch.previousWindow(data, range("14")), { preset: "custom", from: "2026-10-01", to: "2026-10-14", days: 14 });
 assert.equal(watch.previousWindow(data, range("30")), null);
 assert.equal(watch.previousWindow(data, range("custom", "2026-10-01", "2026-10-05")), null);
 assert.deepEqual(watch.previousWindow(data, range("custom", "2026-10-06", "2026-10-10")), { preset: "custom", from: "2026-10-01", to: "2026-10-05", days: 5 }, "a previous period that starts on the first data day counts");

 // Period sums. Leads are leads_and_calls + phone_clicks only; shares are ratios of summed impressions.
 const sums = watch.campaignTotals(data, ["1001", "1002"], r7), alpha = sums.rows.get("1001"), beta = sums.rows.get("1002"), total = sums.total;
 assert.equal(alpha.cost, 60); assert.equal(alpha.impressions, 150); assert.equal(alpha.clicks, 15); assert.equal(alpha.phoneCalls, 1);
 assert.equal(alpha.leads, 3, "a late call on a day with no delivery still counts; checkout clicks, store visits and other do not");
 assert.equal(alpha.button_clicks, 1); assert.equal(alpha.store_visits, 1); assert.equal(alpha.other, 0.5);
 assert.equal(alpha.costPerLead, 20); assert.equal(alpha.cpc, 4);
 close(alpha.impressionShare, 150 / 250, "Alpha impression share"); close(alpha.lostBudgetShare, 50 / 250, "Alpha lost to budget"); close(alpha.lostRankShare, 50 / 250, "Alpha lost to rank");
 assert.equal(beta.leads, 0); assert.equal(beta.costPerLead, null, "no leads means no cost per lead");
 close(beta.lostBudgetShare, 290 / 500, "Beta lost to budget");
 assert.equal(total.cost, 210); assert.equal(total.clicks, 25); assert.equal(total.leads, 3); assert.equal(total.costPerLead, 70); assert.equal(total.button_clicks, 4);
 close(total.impressionShare, 250 / 750, "list share is summed impressions over summed eligible impressions");
 close(total.lostBudgetShare, 340 / 750, "list lost to budget from sums");
 assert.notEqual(Math.round(total.impressionShare * 1000), Math.round((alpha.impressionShare + beta.impressionShare) / 2 * 1000), "never an average of shares");
 assert.equal(total.sharesApproximate, true);
 assert.deepEqual(sums.dates, ["2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25", "2026-10-26", "2026-10-27", "2026-10-28"]);
 assert.deepEqual(total.daily, [120, 0, 0, 60, 30, 0, 0]);

 // Days without an eligible-impression figure stay out of both sides of the share.
 const gap = watch.prepare({ ...raw, from: "2026-10-01", through: "2026-10-03", windowShares: {}, campaignDays: { columns: raw.campaignDays.columns, rows: [["2026-10-02", "9", 10, 40, 1, 0, null, null, null, 0, 0, 0, 0, 0, 0], ["2026-10-03", "9", 10, 60, 1, 0, 120, 30, 30, 1, 0, 0, 0, 0, 0]] }, campaigns: [{ id: "9", name: "Gap", status: "ENABLED", budgetPerDay: 5 }] });
 const gapTotals = watch.campaignTotals(gap, ["9"], watch.windowRange(gap, "custom", "2026-10-01", "2026-10-03")).rows.get("9");
 assert.equal(gapTotals.impressions, 100);
 close(gapTotals.impressionShare, 60 / 120, "impressions on a day with no eligible count are left out");
 assert.equal(watch.campaignTotals(gap, ["9"], watch.windowRange(gap, "custom", "2026-10-02", "2026-10-02")).rows.get("9").impressionShare, null, "no eligible impressions gives no share");

 // Watch model: Google's own shares for preset windows (absent campaign = no impressions), rebuilt ≈ shares otherwise.
 const model = watch.watchModel(data, list({ campaignIds: ["1001", "1002", "9999"] }), r7);
 assert.deepEqual(model.missing, ["9999"]);
 assert.equal(model.rows.length, 2);
 const alphaRow = model.rows.find(row => row.id === "1001"), betaRow = model.rows.find(row => row.id === "1002");
 assert.equal(alphaRow.name, "Alpha Search", "the [FHS] prefix is dropped");
 assert.equal(alphaRow.impressionShare, 0.62); assert.equal(alphaRow.lostBudgetShare, 0.08); assert.equal(alphaRow.sharesApproximate, false);
 assert.equal(betaRow.lostBudgetShare, 0.39, "Google's figure, not the rebuilt 58%");
 assert.deepEqual(betaRow.reasons, ["$150.00 spent, no leads"], "Google's 39% lost to budget is not over 40%");
 assert.equal(model.total.budgetPerDay, 70, "total budget sums the running campaigns");
 close(model.total.impressionShare, 250 / 750, "total row stays rebuilt");
 assert.equal(model.total.sharesApproximate, true);
 assert.deepEqual(model.previous && [model.previous.cost, model.previous.leads, model.previous.clicks, model.previous.costPerLead], [40, 2, 10, 20]);
 const cards = watch.headline(model);
 assert.deepEqual(cards.map(card => card.label), ["Spend", "Leads", "Cost per lead", "Clicks"]);
 assert.deepEqual(cards.map(card => card.change), [4.25, 0.5, 2.5, 1.5]);
 assert.deepEqual(watch.headline(watch.watchModel(data, list(), range("30"))).map(card => card.change), [null, null, null, null], "no comparison when the previous period is outside the data");

 const customBeta = watch.watchModel(data, list(), range("custom", "2026-10-22", "2026-10-28")).rows.find(row => row.id === "1002");
 assert.equal(customBeta.sharesApproximate, true);
 close(customBeta.lostBudgetShare, 0.58, "custom dates rebuild the share");
 assert.deepEqual(customBeta.reasons, ["$150.00 spent, no leads", "≈58% of possible impressions lost to budget"]);
 const ninety = watch.watchModel(data, list(), range("90")).rows.find(row => row.id === "1001");
 assert.equal(ninety.sharesApproximate, true, "a preset with no Google figures in the file falls back to rebuilt shares");

 const echo = watch.watchModel(data, list({ campaignIds: ["1001", "1004", "1005"] }), r7);
 assert.equal(echo.total.costPerLead, 74);
 assert.deepEqual(echo.rows.find(row => row.id === "1005").reasons, ["Cost per lead $300.00 is more than twice the list's $74.00"]);
 assert.deepEqual(echo.rows.find(row => row.id === "1001").reasons, []);
 assert.equal(echo.rows.find(row => row.id === "1004").impressionShare, null, "a campaign missing from Google's window had no impressions");
 assert.equal(echo.rows.find(row => row.id === "1005").lostBudgetShare, null, "a null Google share stays null");

 assert.deepEqual(watch.campaignFlags({ cost: 0, leads: 0, costPerLead: null, lostBudgetShare: 0.41, sharesApproximate: false }, 10), ["41% of possible impressions lost to budget"]);
 assert.deepEqual(watch.campaignFlags({ cost: 50, leads: 2, costPerLead: 25, lostBudgetShare: 0.4 }, 12.5), [], "exactly twice and exactly 40% are not flagged");
 assert.deepEqual(watch.campaignFlags({ cost: 50, leads: 2, costPerLead: 25, lostBudgetShare: null }, null), [], "no list cost per lead, no comparison");

 // Duplicates: same campaign, same normalized text and match type, enabled in another enabled ad group.
 assert.deepEqual([...data.duplicates.entries()].sort(), [["11~1", ["Near me"]], ["12~2", ["Units"]]]);

 // Keywords: filters, sums, badges and the summary line.
 const keywords = watch.keywordModel(data, ["1001", "1002"], kwFilters(), r7);
 assert.deepEqual(keywords.rows.map(row => row.id), ["11~1", "12~2", "21~5", "21~6"]);
 const k1 = keywords.rows[0], k2 = keywords.rows[1], k5 = keywords.rows[2];
 assert.deepEqual([k1.cost, k1.impressions, k1.clicks, k1.leads, k1.button_clicks], [40, 90, 9, 3, 1]);
 close(k1.costPerLead, 40 / 3, "keyword cost per lead"); close(k1.ctr, 0.1, "keyword click rate");
 assert.deepEqual([k1.expectedCtr, k1.adRelevance, k1.landingPage], [3, 2, 1]);
 assert.equal(k2.lowQuality, true); assert.equal(k2.leads, 0, "a store visit is not a lead"); assert.deepEqual(k2.duplicateOf, ["Units"]);
 assert.equal(k5.costlyNoLeads, true); assert.equal(k5.lowQuality, false); assert.equal(k5.duplicateOf, null);
 assert.equal(keywords.summary.count, 4); assert.equal(keywords.summary.spend, 150); assert.equal(keywords.summary.leads, 3);
 close(keywords.summary.lowQualityShare, 80 / 150, "share of spend on Quality Score 4 or lower");
 close(keywords.summary.noLeadShare, 110 / 150, "share of spend on keywords with no leads");
 const ids = filters => watch.keywordModel(data, ["1001", "1002", "1004"], kwFilters(filters), r7).rows.map(row => row.id);
 assert.deepEqual(ids({ onlySpend: false }), ["11~1", "12~2", "12~3", "21~5", "21~6", "11~8"]);
 assert.deepEqual(ids({ status: "paused", onlySpend: false }), ["13~4", "41~7"]);
 assert.deepEqual(ids({ status: "all", match: "PHRASE", onlySpend: false }), ["12~3", "13~4", "41~7"]);
 assert.deepEqual(ids({ campaign: "1002" }), ["21~5", "21~6"]);
 assert.deepEqual(ids({ search: "<B>" }), ["21~5"]);
 assert.deepEqual(ids({ search: "cheap", onlySpend: false }), ["11~8"]);
 assert.equal(watch.keywordModel(data, ["1001"], kwFilters({ status: "all", onlySpend: false }), r7).rows.find(row => row.id === "13~4").statusNote, "Ad group paused");
 assert.equal(watch.keywordSummary([]).lowQualityShare, null);
 assert.deepEqual(watch.sortRows(keywords.rows, "cost", -1).map(row => row.id), ["21~5", "11~1", "21~6", "12~2"]);
 assert.deepEqual(watch.sortRows(watch.keywordModel(data, ["1001"], kwFilters({ onlySpend: false }), r7).rows, "qualityScore", 1).map(row => row.qualityScore), [3, 7, 8, null], "blanks sort last");

 // Watch-list validation mirrors the server's limits.
 assert.deepEqual(watch.validateList(list()), []);
 assert.deepEqual(watch.validateList(list({ name: "📦".repeat(60) })), [], "60 characters, counted as characters");
 for (const [over, pattern] of [[{ name: "  " }, /name/], [{ name: "x".repeat(61) }, /60 characters/], [{ note: "x".repeat(201) }, /200 characters/], [{ id: "Bad_ID" }, /id/], [{ id: "a".repeat(41) }, /id/],
  [{ campaignIds: [] }, /at least one/], [{ campaignIds: Array.from({ length: 201 }, (_, i) => String(i + 1)) }, /200 campaigns/], [{ campaignIds: ["12a"] }, /digits/], [{ campaignIds: [1001] }, /digits/], [{ campaignIds: ["1", "1"] }, /twice/]])
  assert.match(watch.validateList(list(over)).join(" "), pattern, JSON.stringify(over).slice(0, 60));
 assert.match(watch.validateLists(Array.from({ length: 51 }, (_, i) => list({ id: `l-${i}` }))).join(" "), /at most 50/);
 assert.match(watch.validateLists([list(), list()]).join(" "), /share the id/);
 assert.deepEqual(watch.validateLists(Array.from({ length: 50 }, (_, i) => list({ id: `l-${i}` }))), []);

 assert.equal(watch.makeListId("Meeting 30 Oct", () => 0), "meeting-30-oct-aaaaaa");
 assert.equal(watch.makeListId("Été / Ünïcode!!", () => 0.9999), "ete-unicode-999999");
 assert.equal(watch.makeListId("!!!", () => 0), "list-aaaaaa");
 for (const name of ["A very long watch list name that keeps going and going", "x".repeat(60), "a-".repeat(30)]) { const id = watch.makeListId(name); assert.match(id, /^[a-z0-9-]{1,40}$/); assert.ok(!id.includes("--"), id); }
 const built = watch.buildList({ name: "  New list ", note: " watch these ", campaignIds: ["1001", "1001", 1002] }, null, new Date("2026-10-30T12:00:00Z"));
 assert.match(built.id, /^new-list-[a-z0-9]{6}$/);
 assert.deepEqual({ ...built, id: "x" }, { id: "x", name: "New list", campaignIds: ["1001", "1002"], note: "watch these", updatedAt: "2026-10-30T12:00:00.000Z" });
 assert.equal(watch.buildList({ name: "Renamed", campaignIds: ["1"] }, "kept-id").id, "kept-id");
 assert.deepEqual(watch.applyEdit([list({ id: "a" }), list({ id: "b" })], list({ id: "b", name: "B2" })).map(item => item.name), ["Test list", "B2"]);
 assert.deepEqual(watch.applyEdit([list({ id: "a" })], list({ id: "c" })).map(item => item.id), ["a", "c"], "an edited list someone else deleted is added back");

 // API replies and the browser-storage fallback.
 assert.deepEqual(watch.normalizeLists({ version: 3, lists: [{ id: "a", name: "A", campaignIds: [1, "2"], note: null, extra: true, updatedAt: "2026-10-30T00:00:00Z" }] }), { version: 3, lists: [{ id: "a", name: "A", campaignIds: ["1", "2"], note: "", updatedAt: "2026-10-30T00:00:00Z" }] });
 for (const body of [null, "x", { version: "3", lists: [] }, { version: 3 }, { version: 3, lists: [{ id: "a", campaignIds: [] }] }]) assert.equal(watch.normalizeLists(body), null, JSON.stringify(body));
 const seed = watch.readLocal(null);
 assert.deepEqual(seed, watch.SEED);
 seed.lists[0].name = "changed"; assert.equal(watch.SEED.lists[0].name, "Meeting 30 Oct", "the seed is copied, never shared");
 assert.deepEqual(watch.SEED.lists[0].campaignIds, ["23501980267", "24329125185", "23740930692", "23390764985"]);
 assert.deepEqual(watch.readLocal(throwingStorage), watch.SEED, "blocked storage falls back to the seed");
 assert.deepEqual(watch.readLocal(memoryStorage({ [watch.STORAGE_KEY]: "{not json" })), watch.SEED);
 assert.equal(watch.readLocal(memoryStorage({ [watch.STORAGE_KEY]: JSON.stringify({ version: 7, lists: [list()] }) })).version, 7);
 assert.equal(watch.writeLocal(throwingStorage, watch.SEED), false);
 assert.equal(watch.writeLocal(null, watch.SEED), false);

 const calls = [];
 const recording = fetcher => async (url, options) => { calls.push([url, options]); return fetcher(url, options); };
 const server = await watch.fetchLists(recording(reply(200, { version: 3, lists: [list()] })), throwingStorage);
 assert.deepEqual([server.mode, server.version, server.lists.length], ["server", 3, 1]);
 assert.equal(calls[0][0], "/api/watchlists"); assert.equal(calls[0][1].credentials, "same-origin");
 assert.equal((await watch.fetchLists(async () => { throw new TypeError("offline"); }, null)).mode, "local");
 const preview = await watch.fetchLists(reply(404, new SyntaxError("html")), throwingStorage);
 assert.deepEqual([preview.mode, preview.lists[0].id], ["local", "meeting-2026-10-30"], "no API on a local preview: the seeded list in this browser");
 assert.equal((await watch.fetchLists(reply(200, new SyntaxError("html")), null)).mode, "local", "a non-JSON reply means no API");
 assert.equal((await watch.fetchLists(reply(401, { error: "signed out" }), null)).mode, "signed-out");
 assert.equal((await watch.fetchLists(reply(200, new SyntaxError("html"), "https://fhs.example/login.php?next=%2F"), null)).mode, "signed-out", "a redirect to sign-in is signed out");
 assert.deepEqual(await watch.fetchLists(reply(500, { error: "broken" }), null), { mode: "error", status: 500, version: null, lists: [] });

 const storage = memoryStorage();
 const savedLocal = await watch.saveLists({ mode: "local", version: 1, lists: [] }, [list()], async () => { throw new Error("must not call the API"); }, storage);
 assert.deepEqual([savedLocal.ok, savedLocal.mode, savedLocal.version], [true, "local", 2]);
 assert.equal(JSON.parse(storage.items[watch.STORAGE_KEY]).lists[0].id, "test-list-aaaaaa");
 assert.equal((await watch.saveLists({ mode: "local", version: 1, lists: [] }, [list()], null, throwingStorage)).kind, "storage");

 let posted;
 const poster = response => async (url, options) => { posted = [url, options]; return response(); };
 const ok = await watch.saveLists({ mode: "server", version: 3, lists: [] }, [list()], poster(reply(200, { version: 4, lists: [list()] })), null, "token-123");
 assert.deepEqual([ok.ok, ok.version], [true, 4]);
 assert.equal(posted[0], "/api/watchlists"); assert.equal(posted[1].method, "POST");
 assert.equal(posted[1].headers["Content-Type"], "application/json"); assert.equal(posted[1].headers["X-CSRF-Token"], "token-123");
 assert.deepEqual(JSON.parse(posted[1].body), { version: 3, lists: [list()] }, "the whole new set with the version that was loaded");
 const conflict = await watch.saveLists({ mode: "server", version: 3, lists: [] }, [list()], reply(409, { error: "conflict", version: 5, lists: [list({ name: "Theirs" })] }), null, "t");
 assert.deepEqual([conflict.ok, conflict.kind, conflict.latest.version, conflict.latest.lists[0].name], [false, "conflict", 5, "Theirs"]);
 assert.match((await watch.saveLists({ mode: "server", version: 3, lists: [] }, [list()], reply(400, { error: "invalid", detail: "name too long" }), null, "t")).message, /name too long/);
 assert.equal((await watch.saveLists({ mode: "server", version: 3, lists: [] }, [list()], reply(403, null), null, "t")).kind, "token");
 assert.equal((await watch.saveLists({ mode: "server", version: 3, lists: [] }, [list()], reply(401, null), null, "t")).kind, "signed-out");
 assert.equal((await watch.saveLists({ mode: "server", version: 3, lists: [] }, [list()], async () => { throw new TypeError("offline"); }, null, "t")).kind, "network");
 assert.equal((await watch.saveLists({ mode: "server", version: 3, lists: [] }, [list({ name: "" })], async () => { throw new Error("must not post an invalid set"); }, null, "t")).kind, "invalid");
 assert.equal((await watch.saveLists({ mode: "signed-out", version: null, lists: [] }, [list()], null, null, "t")).kind, "unavailable");
 assert.equal(watch.interpretSave(200, { nope: true }).ok, false, "a 200 without lists is not a save");

 // Markup: every data and API string is escaped; shares say when they are approximate; no rentals column.
 const hostile = { id: "evil-aaaaaa", name: "<img src=x onerror=alert(1)>", campaignIds: ["1001", "1002", "9999"], note: "<script>alert(1)</script>", updatedAt: "2026-10-30T10:00:00Z" };
 const localStore = { mode: "local", version: 1, lists: [hostile] };
 const page = watch.renderWatch(data, localStore, baseView());
 assert.doesNotMatch(page, /<img src=x|<script>alert|<b>Search<\/b>/);
 assert.match(page, /&lt;img src=x onerror=alert\(1\)&gt;/); assert.match(page, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/); assert.match(page, /Beta &lt;b&gt;Search&lt;\/b&gt;/);
 assert.match(page, /Saved in this browser only \(preview\)/);
 assert.match(page, /Data through 28 Oct 2026/);
 assert.match(page, />Alpha Search</); assert.doesNotMatch(page, />\[FHS\] Alpha Search</);
 assert.match(page, /title="Google's own figure for the last 7 days">62%/);
 assert.match(page, /≈33\.3%/, "the total row's share is rebuilt and marked approximate");
 assert.match(page, /Checkout clicks \(not leads\)/); assert.match(page, /Ad calls \(any length\)/);
 assert.doesNotMatch(page, /Rentals/i);
 assert.match(page, /class="watch-flag" title="\$150\.00 spent, no leads"/);
 assert.match(page, /\+425%/); assert.match(page, /Changes compare with 15–21 Oct 2026/);
 assert.match(page, /1 campaign in this list is not in the Google Ads data \(ID 9999\)/);
 assert.match(page, /4 checkout-button clicks/); assert.match(page, /1 store visit modelled by Google, plus 0\.5 other conversions/);
 assert.match(page, /<svg class="watch-spark"[^>]*role="img"/);
 assert.match(page, /id="watch-window"/); assert.match(page, /id="watch-from" type="date" min="2026-10-01" max="2026-10-28" disabled/);
 assert.match(watch.renderWatch(data, localStore, baseView({ preset: "30" })), /No earlier 28 days in the data to compare/);
 assert.match(watch.renderWatch(data, localStore, baseView({ preset: "custom", from: "2026-10-22", to: "2026-10-28" })), /Impression shares for chosen dates are rebuilt from daily figures and marked ≈/);
 assert.match(watch.renderWatch(data, localStore, baseView({ preset: "custom", from: "2026-10-22", to: "2026-10-28" })), /≈20%/);
 const serverStore = { mode: "server", version: 3, lists: [hostile] };
 const serverPage = watch.renderWatch(data, serverStore, baseView({ confirmDelete: true }));
 assert.doesNotMatch(serverPage, /Saved in this browser only/);
 assert.match(serverPage, /Delete “&lt;img src=x onerror=alert\(1\)&gt;” for everyone who signs in\?/);
 const builtIn = watch.renderWatch(data, serverStore, baseView({ listId: watch.RUNNING, confirmDelete: true }));
 assert.match(builtIn, /id="watch-edit" disabled/); assert.match(builtIn, /id="watch-delete" disabled/); assert.doesNotMatch(builtIn, /watch-delete-yes/);
 assert.match(builtIn, /Every campaign running now \(4 campaigns\)/);
 assert.match(watch.renderWatch(data, { mode: "signed-out", version: null, lists: [] }, baseView()), /id="watch-new" disabled[\s\S]*You are signed out/);
 assert.match(watch.renderWatch(data, { mode: "local", version: 1, lists: Array.from({ length: 50 }, (_, i) => list({ id: `l-${i}` })) }, baseView()), /id="watch-new" disabled title="There can be at most 50/);

 const keywordPage = watch.renderKeywords(data, serverStore, baseView());
 assert.doesNotMatch(keywordPage, /<b>storage<\/b>|<script>x/);
 assert.match(keywordPage, /boat &lt;b&gt;storage&lt;\/b&gt;/); assert.match(keywordPage, /Boat &lt;script&gt;x&lt;\/script&gt;/);
 assert.match(keywordPage, /4 keywords shown/); assert.match(keywordPage, /53\.3% of spend on Quality Score 4 or lower/); assert.match(keywordPage, /73\.3% of spend on keywords with no leads/);
 assert.match(keywordPage, /class="watch-badge"[^>]*>Duplicate</); assert.match(keywordPage, /class="watch-low"[^>]*>3</); assert.match(keywordPage, />Below</);
 assert.match(keywordPage, /class="watch-flag" title="\$60\.00 spent with no leads in these dates"/);
 assert.match(keywordPage, /Keywords in “&lt;img src=x/, "the Keywords tab follows the Watch list tab's list by default");
 assert.match(watch.renderKeywords(data, serverStore, baseView({ kw: { ...baseView().kw, campaign: "1002" } })), /Keywords in Beta &lt;b&gt;Search&lt;\/b&gt;/);
 assert.match(watch.renderKeywords(data, serverStore, baseView({ kw: { ...baseView().kw, campaign: "1003" } })), /Keywords in “/, "a campaign outside the list falls back to all campaigns");
 const many = { ...raw, keywords: Array.from({ length: 120 }, (_, i) => ({ ...raw.keywords[0], id: `11~${i + 100}`, text: `kw ${i}` })), keywordDays: { columns: raw.keywordDays.columns, rows: Array.from({ length: 120 }, (_, i) => ["2026-10-25", `11~${i + 100}`, i + 1, 1, 1, 0, 0, 0, 0, 0, 0]) } };
 const paged = watch.renderKeywords(watch.prepare(many), { mode: "server", version: 1, lists: [list()] }, baseView({ kw: { ...baseView().kw, page: 3 } }));
 assert.match(paged, /101–120 of 120/); assert.match(paged, /3 \/ 3/); assert.equal((paged.match(/<tr/g) || []).length, 21, "50 per page: header plus the 20 left on page 3");

 const editor = watch.renderEditor(data, { id: "evil-aaaaaa", name: hostile.name, note: hostile.note, campaignIds: ["1001", "9999"] }, { local: true });
 assert.doesNotMatch(editor, /<img src=x|<script>alert|<b>Search/);
 assert.match(editor, /Saved in this browser only \(preview\)/);
 assert.match(editor, /Running campaigns[\s\S]*Paused campaigns[\s\S]*Not in the Google Ads data/);
 assert.match(editor, /value="1001" checked/); assert.match(editor, /value="9999" checked/); assert.match(editor, /2 chosen/);
 assert.match(editor, /maxlength="60"/); assert.match(editor, /maxlength="200"/);
 assert.equal((watch.sparkline([1, 0, 3], ["2026-10-01", "2026-10-02", "2026-10-03"], "x").match(/<rect/g) || []).length, 3);
 assert.match(watch.sparkline([0, 0], ["2026-10-01", "2026-10-02"], "<x>"), /aria-label="No spend for &lt;x&gt;/);

 // Wiring: private host only, after Google Ads in the nav, loaded on first open, no window.confirm, storage guarded.
 for (const view of ["watch", "keywords"]) { assert.equal(resolveView(view, "bpaje.github.io"), "overview"); assert.equal(resolveView(view, "127.0.0.1"), view); }
 const index = fs.readFileSync(path.join(ROOT, "index.html"), "utf8"), details = fs.readFileSync(path.join(ROOT, "details.js"), "utf8"), source = fs.readFileSync(path.join(ROOT, "watch.js"), "utf8");
 const at = text => index.indexOf(text);
 assert.ok(at('data-view="ads"') < at('data-view="watch"') && at('data-view="watch"') < at('data-view="keywords"') && at('data-view="keywords"') < at('data-view="meta"'), "Watch list and Keywords follow Google Ads");
 assert.match(index, /<section id="watch-view" class="hidden"[^>]*>\s*<div id="watch-root">/); assert.match(index, /<section id="keywords-view" class="hidden"[^>]*>\s*<div id="keywords-root">/);
 assert.match(index, /href="watch.css"/); assert.ok(at('src="watch.js"') > at('src="details.js"') && at('src="watch.js"') > at('src="app.js"'));
 assert.match(details, /restricted=\['tenants','leads','visitors','watch','keywords'\]/);
 assert.match(details, /if\(detail\.view==='watch'\|\|detail\.view==='keywords'\)\{globalThis\.adsWatch\?\.render\(detail\.view\);return;\}/);
 assert.match(source, /function load\(\) \{\n  if \(onPublic\(\)\) return Promise\.resolve\(\);/, "the restricted file is never fetched on the public host");
 assert.equal((source.match(/fetch\(DATA_URL/g) || []).length, 1);
 assert.doesNotMatch(source, /window\.confirm|[^.\w]confirm\(/);
 let unguarded = source;
 for (const name of ["browserStorage", "readLocal", "writeLocal"]) {
  const body = source.match(new RegExp(`\\n function ${name}\\([^)]*\\) \\{\\n[\\s\\S]*?\\n \\}\\n`))?.[0];
  assert.ok(body && /try \{/.test(body), `${name} wraps storage access in try/catch`);
  unguarded = unguarded.replace(body, "");
 }
 assert.doesNotMatch(unguarded, /localStorage|\.getItem\(|\.setItem\(/, "storage is only touched inside the guarded helpers");
 assert.doesNotMatch(source, /sessionStorage|document\.cookie/);
 watch.render("watch");
 console.log("watch list and keywords: sums and shares from totals, Google shares for presets, leads without checkout clicks, validation, API fallback, escaping and private-host wiring passed");
}

run().catch(error => { console.error(error); process.exit(1); });
