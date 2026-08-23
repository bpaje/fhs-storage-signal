"use strict";

const DATA_FILES = ["portfolio.json", "channels.json", "web_analytics.json", "leads.json", "facilities.json", "attribution.json", "health.json"];
const DISPLAY_METRICS = ["advertising_spend", "leads", "cost_per_lead", "sessions", "engagement_rate", "lead_source_coverage"];
const MISSING_STATUSES = new Set(["PENDING", "UNAVAILABLE"]);
const state = { brand: "all", facility: "all", compare: "previous", chart: "advertising_spend", mapping: "all", search: "", sort: { key: "leads", direction: "desc" }, page: 1, pageSize: 8 };
let bundle = null;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[char]);
const metricMap = (metrics = []) => Object.fromEntries(metrics.map((metric) => [metric.metric_id, metric]));
const isReported = (metric) => metric && !MISSING_STATUSES.has(metric.status) && Number.isFinite(metric.value);
const statusClass = (status) => status === "CONFIRMED" ? "ok" : status === "FIXTURE" ? "fixture" : status === "PARTIAL" ? "warn" : "pending";

function formatValue(metric) {
  if (!isReported(metric)) return metric?.status || "PENDING";
  if (metric.unit === "USD") return new Intl.NumberFormat("en-US", { style: "currency", currency: bundle.manifest.currency, maximumFractionDigits: metric.metric_id === "cost_per_lead" ? 2 : 0 }).format(metric.value);
  if (metric.unit === "ratio") return `${(metric.value * 100).toFixed(1)}%`;
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(metric.value);
}

function fixedError(code) {
  $("#mode-ribbon").innerHTML = `<span class="ribbon-dot"></span>Storage Signal unavailable · ${escapeHtml(code)}`;
  $("#content").innerHTML = `<section class="panel load-failure"><h2>Reporting snapshot unavailable</h2><p>The client view stopped before rendering because its governed snapshot did not pass validation.</p><code>${escapeHtml(code)}</code></section>`;
}

async function loadJson(path) {
  const response = await fetch(path, { cache: "no-store", credentials: "same-origin" });
  if (!response.ok) throw new Error("SNAPSHOT_FETCH_FAILED");
  return response.json();
}

function containsFixture(value) {
  if (Array.isArray(value)) return value.some(containsFixture);
  if (value && typeof value === "object") return Object.entries(value).some(([key, item]) => (key === "status" && item === "FIXTURE") || containsFixture(item));
  return false;
}

async function loadBundle() {
  const manifest = await loadJson("data/manifest.json");
  if (manifest.schema_version !== "storage-signal.snapshot.v1" || !["development", "client"].includes(manifest.mode)) throw new Error("MANIFEST_INVALID");
  if (JSON.stringify(Object.keys(manifest.files).sort()) !== JSON.stringify([...DATA_FILES].sort())) throw new Error("MANIFEST_FILE_SET_INVALID");
  const documents = Object.fromEntries(await Promise.all(DATA_FILES.map(async (filename) => [filename, await loadJson(`data/${filename}`)])));
  if (Object.values(documents).some((document) => document.schema_version !== manifest.schema_version)) throw new Error("DOCUMENT_SCHEMA_INVALID");
  if (manifest.mode === "client" && Object.values(documents).some(containsFixture)) throw new Error("CLIENT_FIXTURE_FORBIDDEN");
  return { manifest, documents };
}

function selectedFacilities() {
  return bundle.documents["facilities.json"].facilities.filter((facility) => (state.brand === "all" || facility.brand === state.brand) && (state.facility === "all" || String(facility.company_id) === state.facility));
}

function combinedStatus(metrics) {
  if (!metrics.length || metrics.every((metric) => !isReported(metric))) return "PENDING";
  if (metrics.some((metric) => !isReported(metric))) return "PARTIAL";
  if (metrics.some((metric) => metric.status === "FIXTURE")) return "FIXTURE";
  if (metrics.some((metric) => metric.status === "PARTIAL")) return "PARTIAL";
  return "CONFIRMED";
}

function aggregateFacilityMetric(metricId, facilities) {
  const metrics = facilities.map((facility) => metricMap(facility.metrics)[metricId]).filter(Boolean);
  const reported = metrics.filter(isReported);
  const template = metrics[0];
  if (!template || !reported.length) return { metric_id: metricId, label: metricId.replaceAll("_", " "), value: null, unit: template?.unit || "count", status: "PENDING", source: template?.source || "facility_mapping", period: bundle.manifest.reporting_period, as_of: bundle.manifest.generated_at, definition: template?.definition || "Unavailable for the selected facility scope." };
  return { ...template, value: reported.reduce((sum, metric) => sum + metric.value, 0), status: combinedStatus(metrics) };
}

function displayedMetrics() {
  const portfolio = metricMap(bundle.documents["portfolio.json"].metrics);
  if (state.brand === "all" && state.facility === "all") return portfolio;
  const facilities = selectedFacilities();
  const spend = aggregateFacilityMetric("advertising_spend", facilities);
  const leads = aggregateFacilityMetric("leads", facilities);
  const sessions = aggregateFacilityMetric("sessions", facilities);
  const cpl = { ...portfolio.cost_per_lead, value: isReported(spend) && isReported(leads) && leads.value > 0 ? spend.value / leads.value : null, status: isReported(spend) && isReported(leads) && leads.value > 0 ? combinedStatus([spend, leads]) : "PENDING", source: "facility_snapshot_derived" };
  const pending = (metricId) => ({ ...portfolio[metricId], value: null, status: "PENDING", source: "facility_mapping_unavailable" });
  return { ...portfolio, advertising_spend: spend, leads, cost_per_lead: cpl, sessions, engagement_rate: pending("engagement_rate"), lead_source_coverage: pending("lead_source_coverage") };
}

function comparison(metric) {
  if (state.compare === "none" || !isReported(metric) || !Number.isFinite(metric.previous_value)) return "No comparison available";
  if (metric.previous_value === 0) return "Previous value was zero";
  const delta = (metric.value - metric.previous_value) / Math.abs(metric.previous_value);
  return `${delta >= 0 ? "↑" : "↓"} ${Math.abs(delta * 100).toFixed(1)}% vs previous period`;
}

function renderHeader() {
  const modeLabel = bundle.manifest.mode === "client" ? "Client snapshot" : "Development fixture — not for client use";
  $("#mode-ribbon").innerHTML = `<span class="ribbon-dot"></span>${escapeHtml(modeLabel)} · ${escapeHtml(bundle.manifest.snapshot_id)}`;
  $("#mode-ribbon").classList.toggle("development-mode", bundle.manifest.mode === "development");
  const period = bundle.manifest.reporting_period;
  $("#period-filter").innerHTML = `<option>${escapeHtml(period.start)} – ${escapeHtml(period.end)}</option>`;
  $("#snapshot-label").textContent = `${bundle.manifest.mode === "client" ? "Client" : "Fixture"} snapshot`;
  $("#freshness").innerHTML = `<span class="freshness-dot"></span><div><strong>${bundle.manifest.mode === "client" ? "Governed reporting snapshot" : "Development fixture"}</strong><small>As of ${escapeHtml(bundle.manifest.generated_at)}</small></div>`;
  $("#footer-note").innerHTML = bundle.manifest.mode === "client" ? `<strong>Governed snapshot:</strong> Values retain source, period, freshness, definition, and status. Missing outcomes are never rendered as zero.` : `<strong>Development only:</strong> Every non-pending number is explicitly marked FIXTURE and the build pipeline forbids this snapshot in client mode.`;
}

function renderFilters() {
  const facilities = bundle.documents["facilities.json"].facilities;
  const brands = [...new Set(facilities.map((facility) => facility.brand))].sort();
  const brandLabels = { family: "Family Heirloom Storage", southeastern: "Southeastern Self Storage", eagles: "Eagles Landing Storage", other: "Other portfolio brands" };
  $("#brand-filter").innerHTML = `<option value="all">All brands</option>${brands.map((brand) => `<option value="${escapeHtml(brand)}">${escapeHtml(brandLabels[brand] || brand)}</option>`).join("")}`;
  $("#facility-count").textContent = `${facilities.length} facility records`;
  renderFacilityOptions();
}

function renderFacilityOptions() {
  const facilities = bundle.documents["facilities.json"].facilities.filter((facility) => state.brand === "all" || facility.brand === state.brand);
  if (!facilities.some((facility) => String(facility.company_id) === state.facility)) state.facility = "all";
  $("#facility-filter").innerHTML = `<option value="all">All facilities (${facilities.length})</option>${facilities.map((facility) => `<option value="${facility.company_id}">${escapeHtml(facility.facility_label)}</option>`).join("")}`;
  $("#facility-filter").value = state.facility;
}

function renderSources() {
  const sources = bundle.documents["health.json"].sources;
  $("#source-strip").innerHTML = `<div class="source-summary"><span class="pulse"></span><div><strong>Reporting stack</strong><small>Truthful source status</small></div></div>${sources.map((source) => `<div class="source-item"><i class="source-logo ${source.source_id === "ccstorage" ? "cc" : source.source_id === "meta_ads" ? "meta" : source.source_id === "google_ads" ? "google" : "ga"}">${escapeHtml(source.label.slice(0, 1))}</i><span>${escapeHtml(source.label)}</span><b class="state ${statusClass(source.status)}">${escapeHtml(source.status)}</b></div>`).join("")}<button class="strip-info" id="source-info">Source details</button>`;
  $("#source-info").addEventListener("click", openSourceInfo);
}

function renderKpis() {
  const metrics = displayedMetrics();
  $("#kpi-grid").innerHTML = DISPLAY_METRICS.map((metricId) => {
    const metric = metrics[metricId];
    return `<article class="kpi-card" data-metric="${escapeHtml(metricId)}"><div class="kpi-head"><span>${escapeHtml(metric.label)}</span><button class="kpi-info" aria-label="Define ${escapeHtml(metric.label)}">i</button></div><div class="kpi-value ${isReported(metric) ? "" : "pending-value"}">${escapeHtml(formatValue(metric))}</div><div class="kpi-foot"><span class="state ${statusClass(metric.status)}">${escapeHtml(metric.status)}</span><small>${escapeHtml(comparison(metric))}</small></div></article>`;
  }).join("");
  $$('[data-metric] .kpi-info').forEach((button) => button.addEventListener("click", () => openDefinition(button.closest("[data-metric]").dataset.metric)));
}

function trendMetric(row, metricId) { return metricMap(row.metrics)[metricId]; }
function renderTrend() {
  const rows = bundle.documents["portfolio.json"].trend;
  const metrics = rows.map((row) => trendMetric(row, state.chart));
  const reported = metrics.filter(isReported);
  const total = reported.length === metrics.length ? { ...reported[0], value: reported.reduce((sum, metric) => sum + metric.value, 0), status: combinedStatus(metrics) } : { ...(metrics[0] || {}), value: null, status: "PENDING" };
  const width = 760, height = 205, left = 48, right = 18, top = 14, bottom = 31;
  const max = Math.max(1, ...reported.map((metric) => metric.value));
  const step = (width - left - right) / Math.max(1, rows.length - 1);
  const points = metrics.map((metric, index) => [left + index * step, isReported(metric) ? top + (height - top - bottom) * (1 - metric.value / max) : null]);
  const linePoints = points.filter((point) => point[1] !== null);
  const path = linePoints.map(([x, y], index) => `${index ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const grid = [0, .25, .5, .75, 1].map((ratio) => { const y = top + (height - top - bottom) * (1 - ratio); return `<line class="grid-line" x1="${left}" y1="${y}" x2="${width-right}" y2="${y}"/>`; }).join("");
  const dots = points.map(([x, y], index) => y === null ? "" : `<circle class="chart-dot" cx="${x}" cy="${y}" r="4"><title>${escapeHtml(rows[index].label)}: ${escapeHtml(formatValue(metrics[index]))}</title></circle>`).join("");
  const labels = rows.map((row, index) => `<text class="axis-label" x="${points[index][0]}" y="${height-8}" text-anchor="middle">${escapeHtml(row.label)}</text>`).join("");
  $("#trend-chart").innerHTML = linePoints.length ? `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">${grid}<path class="chart-path" d="${path}"/>${dots}${labels}</svg>` : `<div class="empty-chart">PENDING — no supported trend values</div>`;
  const label = metrics[0]?.label || state.chart.replaceAll("_", " ");
  $("#trend-label").textContent = label;
  $("#trend-total").textContent = formatValue(total);
  $("#trend-delta").textContent = state.brand === "all" && state.facility === "all" ? comparison(displayedMetrics()[state.chart] || total) : "Portfolio trend is not reallocated to facilities";
  $("#trend-subtitle").textContent = `${bundle.manifest.reporting_period.start} – ${bundle.manifest.reporting_period.end} · portfolio snapshot`;
}

function renderOutcomes() {
  const portfolio = metricMap(bundle.documents["portfolio.json"].metrics);
  const attribution = metricMap(bundle.documents["attribution.json"].metrics);
  const metrics = [portfolio.collected_revenue, portfolio.move_ins, portfolio.cac, portfolio.roas, attribution.internally_proven_revenue, attribution.revenue_attribution_coverage];
  $("#outcome-list").innerHTML = metrics.map((metric) => `<div class="outcome-row"><div><strong>${escapeHtml(metric.label)}</strong><small>${escapeHtml(metric.source)}</small></div><div><b>${escapeHtml(formatValue(metric))}</b><span class="state ${statusClass(metric.status)}">${escapeHtml(metric.status)}</span></div></div>`).join("");
}

function renderChannels() {
  const channels = bundle.documents["channels.json"].channels;
  $("#channel-mode").textContent = bundle.manifest.mode === "client" ? "Governed" : "Fixture";
  $("#channel-list").innerHTML = `<div class="channel-head"><span>Channel</span><span>Spend</span><span>Lead metric</span><span>Cost / lead</span><span>Status</span></div>${channels.map((channel) => { const metrics = metricMap(channel.metrics); const leadMetric = metrics.platform_reported_leads || metrics.leads; const status = combinedStatus(channel.metrics); return `<div class="channel-row"><div class="channel-name"><i>${escapeHtml(channel.label.slice(0,1))}</i><div><strong>${escapeHtml(channel.label)}</strong><small>Platform and governed lead evidence</small></div></div><span>${escapeHtml(formatValue(metrics.advertising_spend))}</span><span class="channel-lead"><small>${escapeHtml(leadMetric.label)}</small><strong>${escapeHtml(formatValue(leadMetric))}</strong></span><span>${escapeHtml(formatValue(metrics.cost_per_lead))}</span><span class="state ${statusClass(status)}">${escapeHtml(status)}</span></div>`; }).join("")}`;
}

function renderHealth() {
  const sources = bundle.documents["health.json"].sources;
  const attention = sources.filter((source) => source.status !== "CONFIRMED");
  $("#attention-count").textContent = `${attention.length} open`;
  $("#attention-list").innerHTML = attention.map((source) => `<button data-source="${escapeHtml(source.source_id)}"><span class="alert-icon ${MISSING_STATUSES.has(source.status) ? "warn" : "info"}">${MISSING_STATUSES.has(source.status) ? "!" : "i"}</span><div><strong>${escapeHtml(source.label)} · ${escapeHtml(source.status)}</strong><small>${escapeHtml(source.detail)}</small></div><b>Details</b></button>`).join("") || `<div class="all-clear"><span>✓</span><p><strong>All sources confirmed</strong><small>No current snapshot health exceptions.</small></p></div>`;
  $$('[data-source]').forEach((button) => button.addEventListener("click", openSourceInfo));
}

function facilityRows() {
  let rows = bundle.documents["facilities.json"].facilities.map((facility) => ({ ...facility, byMetric: metricMap(facility.metrics) }));
  if (state.brand !== "all") rows = rows.filter((row) => row.brand === state.brand);
  if (state.mapping !== "all") rows = rows.filter((row) => row.mapping_status === state.mapping);
  if (state.search) { const needle = state.search.toLowerCase(); rows = rows.filter((row) => row.facility_label.toLowerCase().includes(needle) || String(row.company_id).includes(needle)); }
  const value = (row, key) => key === "facility_label" ? row.facility_label : isReported(row.byMetric[key]) ? row.byMetric[key].value : Number.NEGATIVE_INFINITY;
  rows.sort((left, right) => { const a = value(left, state.sort.key), b = value(right, state.sort.key); const result = typeof a === "string" ? a.localeCompare(b) : a - b; return state.sort.direction === "asc" ? result : -result; });
  return rows;
}

function facilityCpl(row) {
  const spend = row.byMetric.advertising_spend, leads = row.byMetric.leads;
  if (!isReported(spend) || !isReported(leads) || leads.value <= 0) return { ...spend, metric_id: "cost_per_lead", label: "Cost per lead", value: null, status: "PENDING", unit: "USD" };
  return { ...spend, metric_id: "cost_per_lead", label: "Cost per lead", value: spend.value / leads.value, status: combinedStatus([spend, leads]), unit: "USD" };
}

function renderTable() {
  const rows = facilityRows();
  const pages = Math.max(1, Math.ceil(rows.length / state.pageSize));
  state.page = Math.min(state.page, pages);
  const start = (state.page - 1) * state.pageSize;
  const visible = rows.slice(start, start + state.pageSize);
  $("#facility-tbody").innerHTML = visible.length ? visible.map((row) => `<tr data-facility-id="${row.company_id}"><td><div class="facility-cell"><span class="facility-monogram">${escapeHtml(row.facility_label.split(/\s+/).slice(0,2).map((word) => word[0]).join(""))}</span><div class="facility-name"><strong>${escapeHtml(row.facility_label)}</strong><small>Company ${row.company_id}</small></div></div></td><td>${escapeHtml(formatValue(row.byMetric.advertising_spend))}</td><td>${escapeHtml(formatValue(row.byMetric.leads))}</td><td>${escapeHtml(formatValue(facilityCpl(row)))}</td><td>${escapeHtml(formatValue(row.byMetric.sessions))}</td><td><span class="health-pill ${row.mapping_status === "deterministic" ? "healthy" : "review"}">${escapeHtml(row.mapping_status)}</span></td></tr>`).join("") : `<tr><td class="empty-row" colspan="6">No facilities match the selected filters.</td></tr>`;
  $("#table-result-count").textContent = rows.length ? `Showing ${start + 1}–${Math.min(start + state.pageSize, rows.length)} of ${rows.length} facilities` : "No matching facilities";
  $("#pagination").innerHTML = Array.from({ length: pages }, (_, index) => `<button class="page-button ${state.page === index + 1 ? "active" : ""}" data-page="${index + 1}">${index + 1}</button>`).join("");
  $$('[data-facility-id]').forEach((row) => row.addEventListener("click", () => openFacility(Number(row.dataset.facilityId))));
  $$('[data-page]').forEach((button) => button.addEventListener("click", () => { state.page = Number(button.dataset.page); renderTable(); }));
}

function openFacility(id) {
  const facility = bundle.documents["facilities.json"].facilities.find((item) => item.company_id === id);
  if (!facility) return;
  const metrics = metricMap(facility.metrics);
  $("#drawer-eyebrow").textContent = `Company ${facility.company_id} · ${facility.mapping_status}`;
  $("#drawer-title").textContent = facility.facility_label;
  $("#drawer-body").innerHTML = `<p class="drawer-note">Aggregate demand only. No renter, customer, unit, invoice, or payment records are included in this browser payload.</p><div class="drawer-kpis">${[metrics.advertising_spend, metrics.leads, facilityCpl({ byMetric: metrics }), metrics.sessions].map((metric) => `<div class="drawer-kpi"><span>${escapeHtml(metric.label)}</span><strong>${escapeHtml(formatValue(metric))}</strong><small class="state ${statusClass(metric.status)}">${escapeHtml(metric.status)}</small></div>`).join("")}</div><section class="drawer-section"><h3>Source lineage</h3>${facility.metrics.map((metric) => `<div class="source-row"><div><strong>${escapeHtml(metric.label)}</strong><small>${escapeHtml(metric.source)} · as of ${escapeHtml(metric.as_of)}</small></div><b>${escapeHtml(metric.status)}</b></div>`).join("")}</section>`;
  $("#backdrop").classList.remove("hidden"); $("#drawer").classList.add("open"); $("#drawer").setAttribute("aria-hidden", "false");
}

function allMetrics() { return Object.values(bundle.documents).flatMap((document) => Array.from(function* walk(value) { if (Array.isArray(value)) for (const item of value) yield* walk(item); else if (value && typeof value === "object") { if (value.metric_id) yield value; else for (const item of Object.values(value)) yield* walk(item); } }(document))); }
function openDefinition(metricId) { const metric = allMetrics().find((item) => item.metric_id === metricId); if (metric) openModal(metric.label, `<div class="definition-card"><strong>${escapeHtml(metric.label)}</strong><p>${escapeHtml(metric.definition)}</p><p>Source: ${escapeHtml(metric.source)} · Status: ${escapeHtml(metric.status)} · As of: ${escapeHtml(metric.as_of)}</p></div>`); }
function openDefinitions() { const unique = new Map(allMetrics().map((metric) => [metric.metric_id, metric])); openModal("Metric definitions", `<div class="modal-callout">GA4 is website behaviour, platform attribution remains separate, and unsupported CCStorage outcomes stay pending.</div><div class="definition-grid">${Array.from(unique.values()).map((metric) => `<div class="definition-card"><strong>${escapeHtml(metric.label)}</strong><p>${escapeHtml(metric.definition)}</p></div>`).join("")}</div>`); }
function openSourceInfo() { const sources = bundle.documents["health.json"].sources; openModal("Source status", `<div class="modal-callout">Freshness and status come from the governed release snapshot. Credentials and provider payloads are never exposed.</div><div class="definition-grid">${sources.map((source) => `<div class="definition-card"><strong>${escapeHtml(source.label)} · ${escapeHtml(source.status)}</strong><p>${escapeHtml(source.detail)} As of ${escapeHtml(source.as_of)}.</p></div>`).join("")}</div>`); }
function openModal(title, content) { $("#modal-title").textContent = title; $("#modal-body").innerHTML = content; $("#backdrop").classList.remove("hidden"); $("#info-modal").classList.remove("hidden"); }
function closeOverlays() { $("#drawer").classList.remove("open"); $("#drawer").setAttribute("aria-hidden", "true"); $("#info-modal").classList.add("hidden"); $("#backdrop").classList.add("hidden"); }

function renderAll() { renderKpis(); renderTrend(); renderOutcomes(); renderChannels(); renderHealth(); renderTable(); }
function bindEvents() {
  $("#brand-filter").addEventListener("change", (event) => { state.brand = event.target.value; state.facility = "all"; state.page = 1; renderFacilityOptions(); renderAll(); });
  $("#facility-filter").addEventListener("change", (event) => { state.facility = event.target.value; state.page = 1; renderAll(); });
  $("#compare-filter").addEventListener("change", (event) => { state.compare = event.target.value; renderKpis(); renderTrend(); });
  $("#health-filter").addEventListener("change", (event) => { state.mapping = event.target.value; state.page = 1; renderTable(); });
  $("#table-search").addEventListener("input", (event) => { state.search = event.target.value.trim(); state.page = 1; renderTable(); });
  $("#reset-filters").addEventListener("click", () => { Object.assign(state, { brand: "all", facility: "all", compare: "previous", mapping: "all", search: "", page: 1 }); $("#brand-filter").value = "all"; $("#compare-filter").value = "previous"; $("#health-filter").value = "all"; $("#table-search").value = ""; renderFacilityOptions(); renderAll(); });
  $$('.chart-toggle button').forEach((button) => button.addEventListener("click", () => { $$('.chart-toggle button').forEach((item) => item.classList.remove("active")); button.classList.add("active"); state.chart = button.dataset.chart; renderTrend(); }));
  $$('th.sortable').forEach((header) => header.addEventListener("click", () => { const key = header.dataset.sort; state.sort = { key, direction: state.sort.key === key && state.sort.direction === "desc" ? "asc" : "desc" }; state.page = 1; renderTable(); }));
  $("#drawer-close").addEventListener("click", closeOverlays); $("#backdrop").addEventListener("click", closeOverlays); $$('[data-close-modal]').forEach((button) => button.addEventListener("click", closeOverlays));
  $("#definitions-button").addEventListener("click", openDefinitions); $("#outcome-info").addEventListener("click", () => openModal("Outcome boundary", `<div class="modal-callout">Revenue, move-ins, CAC, ROAS, and internal revenue attribution require separately governed CCStorage outcomes. Until supported, Storage Signal displays PENDING rather than zero.</div>`));
  $("#help-button").addEventListener("click", () => openModal("About Storage Signal", `<div class="modal-callout">This client summary reads immutable governed snapshots. It performs no source, OAuth, credential, or write operation.</div>`));
  $$('.nav-item.disabled').forEach((button) => button.addEventListener("click", () => openModal("Future module", `<div class="modal-callout">The v0.1 delivery remains focused on the portfolio overview.</div>`)));
  $("#mobile-menu").addEventListener("click", () => $("#sidebar").classList.toggle("open")); document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeOverlays(); });
}

(async () => { try { bundle = await loadBundle(); renderHeader(); renderFilters(); renderSources(); renderAll(); bindEvents(); } catch (_error) { fixedError("SNAPSHOT_VALIDATION_FAILED"); } })();
