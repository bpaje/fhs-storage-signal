"use strict";

(function (root, factory) {
 const api = factory();
 if (typeof module !== "undefined" && module.exports) module.exports = api;
 if (root) root.tenantDashboard = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
 const PAGE_SIZE = 50;
 const SCHEMA = "storage-signal.tenants.v2";
 const COLORS = ["#67503c", "#8f755c", "#b69b7e", "#d3b792", "#9c6e4c", "#d8c9b5"];
 const activityMeta = {
  moveIns: { label: "Move-ins", empty: "No matching records." },
  moveOuts: { label: "Move-outs", empty: "No matching records." },
  payments: { label: "Payments", empty: "No matching records." },
  pastDue: { label: "Past due", empty: "No matching records." },
  rateChanges: { label: "Rate changes", empty: "No matching records." },
 };
 let indexPromise;
 let tenantIndex;
 let unavailable = false;
 let view;
 let pendingScope;
 let dialogState;
 let dialogTrigger;
 let searchTimer;
 const profilePromises = new Map();

 const html = value => String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
 const number = value => value == null ? "No data" : new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(Number(value));
 const currency = value => value == null ? "n/a" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(Number(value));
 const percent = value => value == null ? "No data" : new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 }).format(Number(value));
 const dateOnly = value => value ? String(value).slice(0, 10) : "Not recorded";
 const sumMoney = (rows, key) => rows.reduce((total, row) => total + Number(row[key] || 0), 0);
 const uniqueTenants = rows => new Set(rows.map(row => `${row.company_id}:${row.customer_id}`)).size;
 const toDate = value => new Date(`${value}T00:00:00Z`);
 const iso = value => value.toISOString().slice(0, 10);
 const addDays = (value, amount) => { const result = toDate(value); result.setUTCDate(result.getUTCDate() + amount); return iso(result); };
 const clamp = (value, minimum, maximum) => value < minimum ? minimum : value > maximum ? maximum : value;

 function coverageStart(data) {
  const dates = ["moveIns", "moveOuts", "payments", "occupancyDaily"].flatMap(key => data[key].map(row => row.date)).filter(Boolean).filter(day => day <= data.cutoff);
  return dates.sort()[0] || data.cutoff;
 }

 function presetRange(data, preset) {
  const cutoff = data.cutoff, minimum = coverageStart(data);
  let from, to = cutoff;
  if (preset === "this-month") from = `${cutoff.slice(0, 7)}-01`;
  else if (preset === "last-month") {
   const first = toDate(`${cutoff.slice(0, 7)}-01`); first.setUTCMonth(first.getUTCMonth() - 1);
   from = iso(first); first.setUTCMonth(first.getUTCMonth() + 1); first.setUTCDate(0); to = iso(first);
  } else if (preset === "last-7") from = addDays(cutoff, -6);
  else if (preset === "last-30") from = addDays(cutoff, -29);
  else return null;
  from = clamp(from, minimum, cutoff); to = clamp(to, minimum, cutoff);
  if (from > to) from = to;
  return { from, to };
 }

 function createInitialView(data) {
  const range = presetRange(data, "this-month");
  return { facility: "all", preset: "this-month", from: range.from, to: range.to, search: "", activity: "moveIns", sort: "date", direction: -1, page: 1 };
 }

 function matchesSearch(row, search) {
  if (!search) return true;
  return [row.name, row.customer_number, row.lease_number, row.unit].some(value => String(value || "").toLowerCase().includes(search));
 }

 function scoped(data, currentView) {
  const search = currentView.search.trim().toLowerCase();
  const facilityMatch = row => currentView.facility === "all" || String(row.company_id) === currentView.facility;
  const namedMatch = row => facilityMatch(row) && matchesSearch(row, search);
  const inRange = row => row.date >= currentView.from && row.date <= currentView.to;
  return {
   moveIns: data.moveIns.filter(row => namedMatch(row) && inRange(row)),
   moveOuts: data.moveOuts.filter(row => namedMatch(row) && inRange(row)),
   payments: data.payments.filter(row => namedMatch(row) && inRange(row)),
   pastDue: data.pastDue.filter(namedMatch),
   rateChanges: data.rateChanges.filter(row => namedMatch(row) && ((inRange(row) && !row.upcoming) || row.upcoming)),
   occupancy: data.occupancyDaily.filter(row => facilityMatch(row) && row.date === currentView.to),
  };
 }

 function scorecardModels(data, currentView) {
  const rows = scoped(data, currentView);
  const occupied = rows.occupancy.length ? rows.occupancy.reduce((total, row) => total + Number(row.leases || 0), 0) : null;
  const units = rows.occupancy.length ? rows.occupancy.reduce((total, row) => total + Number(row.storage_units || 0), 0) : null;
  const pastDueTotal = sumMoney(rows.pastDue, "balance_due");
  return [
   { key: "moveIns", label: "Move-ins", value: number(rows.moveIns.length), note: `${currentView.from} through ${currentView.to}`, rows: rows.moveIns },
   { key: "moveOuts", label: "Move-outs", value: number(rows.moveOuts.length), note: `${currentView.from} through ${currentView.to}`, rows: rows.moveOuts },
   { key: "netChange", label: "Net change", value: number(rows.moveIns.length - rows.moveOuts.length), note: "Move-ins minus move-outs", rows: [...rows.moveIns.map(row => ({ ...row, activityType: "Move-in" })), ...rows.moveOuts.map(row => ({ ...row, activityType: "Move-out" }))] },
   { key: "payments", label: "Collected", value: currency(sumMoney(rows.payments, "effective_amount")), note: `${number(rows.payments.length)} payments`, rows: rows.payments },
   { key: "pastDue", label: "Past due", value: currency(pastDueTotal), note: `${number(uniqueTenants(rows.pastDue))} tenants · as of ${data.balancesAsOf || data.cutoff} · date range ignored`, rows: rows.pastDue },
   { key: "occupancy", label: "Occupancy", value: units ? percent(occupied / units) : "No data", note: units ? `${number(occupied)} leases / ${number(units)} units · ${currentView.to}` : `No snapshot at ${currentView.to}`, rows: rows.occupancy },
  ];
 }

 function weekStart(day) {
  const value = toDate(day), weekday = (value.getUTCDay() + 6) % 7;
  value.setUTCDate(value.getUTCDate() - weekday);
  return iso(value);
 }

 function weekLabel(day) {
  const value = toDate(day);
  return `${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][value.getUTCMonth()]} ${value.getUTCDate()}`;
 }

 function axisScale(maximum) {
  if (maximum <= 4) return { maximum: Math.max(1, maximum), step: 1 };
  const rawStep = maximum / 4, power = 10 ** Math.floor(Math.log10(rawStep)), fraction = rawStep / power;
  const step = (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10) * power;
  return { maximum: Math.ceil(maximum / step) * step, step };
 }

 function weeklyChart(moveIns, moveOuts, from, to) {
  const buckets = new Map();
  if (!moveIns.length && !moveOuts.length) return '<p class="tenant-empty">No matching records.</p>';
  const datedRows = [...moveIns, ...moveOuts].filter(row => row.date);
  const first = weekStart(from || datedRows.map(row => row.date).sort()[0]);
  const last = weekStart(to || datedRows.map(row => row.date).sort().at(-1));
  for (let cursor = first; cursor <= last; cursor = addDays(cursor, 7)) buckets.set(cursor, { start: cursor, ins: 0, outs: 0 });
  for (const [key, rows] of [["ins", moveIns], ["outs", moveOuts]]) for (const row of rows) {
   const start = weekStart(row.date), bucket = buckets.get(start) || { start, ins: 0, outs: 0 };
   bucket[key] += 1; buckets.set(start, bucket);
  }
  const values = [...buckets.values()].sort((a, b) => a.start.localeCompare(b.start));
  const scale = axisScale(Math.max(1, ...values.flatMap(item => [item.ins, item.outs])));
  const width = Math.max(720, values.length * 78), height = 224, left = 48, right = 16, top = 22, baseline = 178;
  const plotWidth = width - left - right, plotHeight = baseline - top, slot = plotWidth / values.length;
  const barWidth = values.length === 1 ? 44 : Math.max(14, Math.min(30, slot * .28)), gap = Math.max(4, Math.min(8, slot * .08));
  const ticks = [];
  for (let value = 0; value <= scale.maximum; value += scale.step) ticks.push(value);
  const grid = ticks.map(value => {
   const y = baseline - value / scale.maximum * plotHeight;
   return `<g class="tenant-chart-gridline"><line x1="${left}" y1="${y}" x2="${width-right}" y2="${y}"/><text x="${left-9}" y="${y+3}" text-anchor="end">${value}</text></g>`;
  }).join("");
  const bars = values.map((item, index) => {
   const center = left + slot * index + slot / 2, inHeight = item.ins / scale.maximum * plotHeight, outHeight = item.outs / scale.maximum * plotHeight;
   const inX = center - gap / 2 - barWidth, outX = center + gap / 2;
   return `<g><title>Week of ${html(item.start)}: ${item.ins} move-ins, ${item.outs} move-outs</title><rect class="tenant-bar tenant-bar-in" x="${inX}" y="${baseline-inHeight}" width="${barWidth}" height="${inHeight}" rx="3"/><rect class="tenant-bar tenant-bar-out" x="${outX}" y="${baseline-outHeight}" width="${barWidth}" height="${outHeight}" rx="3"/><text class="tenant-bar-value" x="${inX+barWidth/2}" y="${Math.max(13,baseline-inHeight-6)}" text-anchor="middle">${item.ins}</text><text class="tenant-bar-value" x="${outX+barWidth/2}" y="${Math.max(13,baseline-outHeight-6)}" text-anchor="middle">${item.outs}</text><text class="tenant-week-label" x="${center}" y="${baseline+24}" text-anchor="middle">${html(weekLabel(item.start))}</text></g>`;
  }).join("");
  return `<div class="tenant-chart-scroll"><svg class="tenant-weekly-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Weekly move-ins and move-outs with values from ${html(from || first)} through ${html(to || last)}"><g>${grid}</g><g>${bars}</g></svg></div><div class="tenant-chart-legend"><span><i class="is-in"></i>Move-ins</span><span><i class="is-out"></i>Move-outs</span></div>`;
 }

 function normalizeUnitFootprint(value) {
  const raw = String(value || "Not recorded").trim() || "Not recorded";
  const match = raw.match(/(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/i);
  if (!match) return raw;
  const dimension = part => String(Number(part));
  return `${dimension(match[1])}x${dimension(match[2])}`;
 }

 function sizeMixChart(rows) {
  const counts = new Map();
  for (const row of rows) {
   const footprint = normalizeUnitFootprint(row.unitType);
   counts.set(footprint, (counts.get(footprint) || 0) + 1);
  }
  const ranked = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (!ranked.length) return '<p class="tenant-empty">No matching records.</p>';
  const kept = ranked.slice(0, 5), other = ranked.slice(5).reduce((total, item) => total + item[1], 0);
  if (other) kept.push(["Other", other]);
  const total = kept.reduce((sum, item) => sum + item[1], 0);
  let offset = 0;
  const segments = kept.map(([label, count], index) => { const share = count / total * 100, segment = `<circle cx="58" cy="58" r="42" pathLength="100" fill="none" stroke="${COLORS[index]}" stroke-width="22" stroke-dasharray="${share} ${100-share}" stroke-dashoffset="${-offset}"><title>${html(label)}: ${count}</title></circle>`; offset += share; return segment; }).join("");
  return `<div class="tenant-pie-layout"><svg class="tenant-pie" viewBox="0 0 116 116" role="img" aria-label="Unit-size mix for move-ins">${segments}<text x="58" y="55" text-anchor="middle">${total}</text><text x="58" y="69" text-anchor="middle">move-ins</text></svg><ul>${kept.map(([label, count], index) => `<li><i style="--tenant-color:${COLORS[index]}"></i><span>${html(label)}</span><strong>${count}</strong></li>`).join("")}</ul></div>`;
 }

 function tenantNameButton(row) {
  if (!row.customer_id) return html(row.name || "n/a");
  return `<button class="tenant-name" type="button" title="${html(row.name)}" data-tenant-profile="${html(row.customer_id)}" data-tenant-company="${html(row.company_id)}">${html(row.name)}</button>`;
 }

 function columnsFor(type) {
  if (type === "moveIns") return [["date","Date"],["name","Tenant","name"],["customer_number","Customer #"],["lease_number","Lease #"],["unit","Unit"],["unitType","Unit type"],["rate","Rate","money"],["moveInInvoice","Move-in invoice","invoice"]];
  if (type === "moveOuts") return [["date","Date"],["name","Tenant","name"],["customer_number","Customer #"],["lease_number","Lease #"],["unit","Unit"],["unitType","Unit type"],["move_in_date","Move-in"]];
  if (type === "payments") return [["date","Date"],["name","Tenant","name"],["customer_number","Customer #"],["payment_number","Payment #"],["payment_method","Method"],["status","Status"],["effective_amount","Net","money"]];
  if (type === "pastDue") return [["tenantStatus","Tenant status"],["name","Tenant","name"],["customer_number","Customer #"],["invoice_number","Invoice #"],["lease_number","Lease #"],["unit","Unit"],["date","Due date"],["days_late","Days late"],["balance_due","Balance","money"]];
  if (type === "rateChanges") return [["date","Effective"],["name","Tenant","name"],["customer_number","Customer #"],["lease_number","Lease #"],["unit","Unit"],["old_rate","Old rate","money"],["new_rate","New rate","money"],["upcoming","Timing","upcoming"]];
  if (type === "netChange") return [["activityType","Activity"],["date","Date"],["name","Tenant","name"],["customer_number","Customer #"],["lease_number","Lease #"],["unit","Unit"]];
  return [["date","Date"],["facility","Facility"],["leases","Leases"],["auto_pay_leases","Autopay leases"],["storage_units","Storage units"]];
 }

 function cell(row, key, kind) {
  if (kind === "name") return tenantNameButton(row);
  if (kind === "money") return currency(row[key]);
  if (kind === "invoice") return row[key] ? `${html(row[key].invoice_number)} · ${currency(row[key].total_billed)} billed · ${currency(row[key].total_paid)} paid` : "No move-in invoice";
  if (kind === "upcoming") return row[key] ? '<span class="state warn">Upcoming</span>' : '<span class="state ok">Applied</span>';
  return html(row[key] ?? "n/a");
 }

 function sortedRows(rows, currentView) {
  return [...rows].sort((left, right) => {
   const a = left[currentView.sort], b = right[currentView.sort];
   if (a == null) return b == null ? 0 : 1;
   if (b == null) return -1;
   return (typeof a === "number" ? a - b : String(a).localeCompare(String(b), undefined, { numeric: true })) * currentView.direction;
  });
 }

 function columnClass(key, kind) {
  const classes = [];
  if (kind === "money" || ["days_late", "leases", "auto_pay_leases", "storage_units"].includes(key)) classes.push("tenant-number");
  if (kind === "name") classes.push("tenant-name-cell");
  if (key === "facility") classes.push("tenant-facility-cell");
  return classes.join(" ");
 }

 function renderRowsTable(type, rows, currentView, paginate = true) {
  const columns = columnsFor(type), ordered = sortedRows(rows, currentView);
  const pages = Math.max(1, Math.ceil(ordered.length / PAGE_SIZE));
  const page = Math.min(currentView.page, pages), shown = paginate ? ordered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE) : ordered;
  let body = shown.map(row => `<tr>${columns.map(([key,,kind]) => `<td class="${columnClass(key,kind)}">${cell(row,key,kind)}</td>`).join("")}</tr>`).join("");
  if (type === "pastDue" && shown.length) {
   body = ["Current", "Moved out"].map(status => { const statusRows = shown.filter(row => row.tenantStatus === status); return statusRows.length ? `<tr class="tenant-group-row"><th colspan="${columns.length}">${status} tenants</th></tr>${statusRows.map(row => `<tr>${columns.map(([key,,kind]) => `<td class="${columnClass(key,kind)}">${cell(row,key,kind)}</td>`).join("")}</tr>`).join("")}` : ""; }).join("");
  }
  if (!shown.length) body = `<tr><td colspan="${columns.length}" class="tenant-empty">No matching records.</td></tr>`;
  const head = `<tr>${columns.map(([key,label,kind]) => paginate ? `<th class="${columnClass(key,kind)}" aria-sort="${currentView.sort===key?(currentView.direction===1?'ascending':'descending'):'none'}"><button type="button" data-tenant-sort="${key}" aria-label="Sort by ${html(label)}">${html(label)} ${currentView.sort===key?(currentView.direction===1?'↑':'↓'):'↕'}</button></th>` : `<th class="${columnClass(key,kind)}">${html(label)}</th>`).join("")}</tr>`;
  const footer = paginate ? `<footer class="table-footer"><span>${ordered.length ? `${(page-1)*PAGE_SIZE+1}–${Math.min(page*PAGE_SIZE,ordered.length)} of ${ordered.length}` : "No matching records."}</span><div class="pagination"><button class="page-button" type="button" data-tenant-page="${page-1}" ${page===1?'disabled':''} aria-label="Previous page">‹</button><span>${page} / ${pages}</span><button class="page-button" type="button" data-tenant-page="${page+1}" ${page===pages?'disabled':''} aria-label="Next page">›</button></div></footer>` : "";
  return `<div class="tenant-table-scroll" tabindex="0" role="region" aria-label="${html(activityMeta[type]?.label || type)} records"><table class="tenant-table"><thead>${head}</thead><tbody>${body}</tbody></table></div>${footer}`;
 }

 function renderTenantView(data, currentView) {
  const rows = scoped(data, currentView), cards = scorecardModels(data, currentView), minimum = coverageStart(data);
  const activityRows = rows[currentView.activity];
  const searchNote = currentView.search.trim() ? "<br><span class=\"tenant-search-note\">Filtered by search</span>" : "";
  return `<h2 class="sr-only" data-tenant-heading tabindex="-1">Tenant reporting</h2>
  <section class="tenant-filter-bar" aria-label="Tenant filters">
   <label><span>Facility</span><select id="tenant-facility"><option value="all">All facilities</option>${data.facilities.map(facility => `<option value="${html(facility.id)}"${currentView.facility===String(facility.id)?' selected':''}>${html(facility.name)}</option>`).join("")}</select></label>
   <label><span>Date range</span><select id="tenant-preset"><option value="this-month"${currentView.preset==='this-month'?' selected':''}>This month</option><option value="last-month"${currentView.preset==='last-month'?' selected':''}>Last month</option><option value="last-7"${currentView.preset==='last-7'?' selected':''}>Last 7 days</option><option value="last-30"${currentView.preset==='last-30'?' selected':''}>Last 30 days</option><option value="custom"${currentView.preset==='custom'?' selected':''}>Custom</option></select></label>
   <label><span>From</span><input id="tenant-from" type="date" min="${minimum}" max="${data.cutoff}" value="${currentView.from}" ${currentView.preset==='custom'?'':'disabled'}></label>
   <label><span>To</span><input id="tenant-to" type="date" min="${minimum}" max="${data.cutoff}" value="${currentView.to}" ${currentView.preset==='custom'?'':'disabled'}></label>
   <label class="tenant-search"><span>Search</span><input id="tenant-search" type="search" value="${html(currentView.search)}" placeholder="Name, customer #, lease # or unit"></label>
   <span class="tenant-cutoff">Data through ${html(data.cutoff)}</span>
  </section>
  <section class="tenant-scorecards" aria-label="Tenant activity summary">${cards.map(card => `<button type="button" class="tenant-scorecard" data-tenant-scorecard="${card.key}" aria-haspopup="dialog"><span>${html(card.label)}</span><strong>${html(card.value)}</strong><small>${html(card.note)}${searchNote}</small></button>`).join("")}</section>
  <section class="tenant-chart-grid">
   <article class="panel tenant-chart-panel"><header class="panel-header"><div><h3>Weekly move activity</h3><p>Lease events in the selected range</p></div></header>${weeklyChart(rows.moveIns,rows.moveOuts,currentView.from,currentView.to)}</article>
   <article class="panel tenant-chart-panel"><header class="panel-header"><div><h3>Move-in unit-size mix</h3><p>Top five floor footprints; remaining sizes are grouped</p></div></header>${sizeMixChart(rows.moveIns)}</article>
  </section>
  <section class="panel tenant-activity-panel"><header class="panel-header"><div><h3>Tenant activity</h3><p>${currentView.activity==='pastDue'?`Balances are as of ${html(data.balancesAsOf || data.cutoff)} and ignore the selected date range.`:currentView.activity==='rateChanges'?'Applied changes in range plus all upcoming changes.':'Filtered by the selected date range.'}</p></div></header>
   <div class="tenant-tabs" role="tablist" aria-label="Tenant activity type">${Object.entries(activityMeta).map(([key,meta]) => `<button type="button" role="tab" data-tenant-activity="${key}" aria-selected="${key===currentView.activity}" class="${key===currentView.activity?'active':''}">${html(meta.label)}</button>`).join("")}</div>
   ${renderRowsTable(currentView.activity,activityRows,currentView,true)}
  </section>`;
 }

 function dialogSummary(type, rows, allRows = rows) {
  const prefix = rows.length === allRows.length ? `${rows.length} records` : `${rows.length} of ${allRows.length} records`;
  if (type === "payments") return `${prefix} · ${currency(sumMoney(rows,"effective_amount"))} collected`;
  if (type === "pastDue") return `${prefix} · ${uniqueTenants(rows)} tenants · ${currency(sumMoney(rows,"balance_due"))} past due`;
  if (type === "netChange") return `${prefix} · ${rows.filter(row=>row.activityType==='Move-in').length - rows.filter(row=>row.activityType==='Move-out').length} net change`;
  if (type === "occupancy") { const leases=sumMoney(rows,"leases"),units=sumMoney(rows,"storage_units");return `${prefix} · ${units?percent(leases/units):'No data'} occupancy`; }
  return prefix;
 }

 function renderScorecardDialog(title, type, rows, search = "", listView = {sort:"date",direction:-1,page:1}) {
  const query = search.trim().toLowerCase(), filtered = rows.filter(row => !query || Object.values(row).some(value => String(value ?? "").toLowerCase().includes(query)));
  return `<div class="tenant-dialog-toolbar"><label><span>Search ${html(title)}</span><input id="tenant-dialog-search" type="search" value="${html(search)}" placeholder="Search this list"></label><strong>${html(dialogSummary(type,filtered,rows))}</strong></div>${renderRowsTable(type,filtered,listView,true)}`;
 }

 function listText(items, formatter) {
  return items?.length ? `<ul class="tenant-inline-list">${items.map(item => `<li>${formatter(item)}</li>`).join("")}</ul>` : "None recorded";
 }

 function renderJourneySection(profile, journeyLeads = []) {
  if (journeyLeads === null) return '<section class="tenant-profile-section journey-profile-section"><h4>Journey</h4><p class="tenant-empty">Lead journey data isn\'t available on this site.</p></section>';
  if (!journeyLeads.length) return '<section class="tenant-profile-section journey-profile-section"><h4>Journey</h4><p class="tenant-empty">No Meta lead found for this renter.</p></section>';
  const items=journeyLeads.map(lead=>{
   const match=lead.match?.matches?.find(item=>String(item.customer_id)===String(profile.customer_id));
   const badge=lead.match?.status==='possible'?'Possible match - unconfirmed':`Confirmed via ${html(match?.via||"contact")}`;
   const answers=Object.entries(lead.answers||{}).map(([question,answer])=>`<li><span>${html(question.replaceAll("_"," "))}</span><strong>${html(answer)}</strong></li>`).join("");
   return `<article class="journey-profile-lead"><header><div><strong>${html(dateOnly(lead.created_date))} · ${html(lead.campaign?.name||"Unknown campaign")}</strong><span>${html(lead.form||"Unknown form")}</span></div><span class="journey-match-badge ${lead.match?.status||"none"}">${badge}</span></header>${answers?`<ul>${answers}</ul>`:""}</article>`;
  }).join("");
  return `<section class="tenant-profile-section journey-profile-section"><h4>Journey</h4><div class="journey-profile-list">${items}</div></section>`;
 }

 function renderProfile(profile, facilityName, journeyLeads = []) {
  const flags = Object.entries(profile.flags || {}).filter(([,active])=>active).map(([key])=>key.replaceAll("_"," "));
  const address = [profile.address,profile.address2,[profile.city,profile.state,profile.postal_code].filter(Boolean).join(" ")].filter(Boolean).join(", ") || "Not recorded";
  const leases = profile.leases?.map(lease => {
   const moveOut = lease.move_out_date ? dateOnly(lease.move_out_date) : lease.scheduled_move_out ? `Scheduled ${dateOnly(lease.scheduled_move_out)}` : "Still renting";
   return `<tr><td>${html(lease.lease_number)}</td><td>${html(lease.unit)}</td><td>${html(lease.unitType?.name)}<small>${html([lease.unitType?.width,lease.unitType?.length].filter(Boolean).join(" × "))}${lease.unitType?.amenities?.length?` · ${html(lease.unitType.amenities.join(", "))}`:""}</small></td><td>${html(dateOnly(lease.signedDate))}</td><td>${html(dateOnly(lease.move_in_date))}</td><td>${html(moveOut)}</td><td class="tenant-number">${currency(lease.currentRate)}</td><td>${listText(lease.rateHistory,item=>`${html(dateOnly(item.effective_date))}: ${currency(item.old_rate)} → ${currency(item.new_rate)}`)}</td><td>${listText(lease.discounts,item=>`${html(item.discount_name)} (${html(dateOnly(item.active_start))}–${html(dateOnly(item.active_end))})`)}</td><td>${listText(lease.protection,item=>`${html(item.plan_name)} · ${currency(item.monthly_amount)}/mo · ${currency(item.coverage_amount)} coverage`)}</td><td>${listText(lease.deposits,item=>`${currency(item.collected_amount)} collected · ${item.returned_amount == null ? "Not returned" : `${currency(item.returned_amount)} returned`}`)}</td></tr>`;
  }).join("") || '<tr><td colspan="11">No matching records.</td></tr>';
  const payments = profile.payments?.map(row=>`<tr><td>${html(dateOnly(row.effective_date))}</td><td>${html(row.payment_number)}</td><td>${html(row.payment_method)}</td><td>${html(row.status)}</td><td class="tenant-number">${currency(row.original_amount)}</td><td class="tenant-number">${currency(row.refund_amount)}</td><td class="tenant-number">${currency(row.effective_amount)}</td><td>${html(row.source)}</td></tr>`).join("") || '<tr><td colspan="8">No matching records.</td></tr>';
  const invoices = profile.invoices?.map(row=>`<tr><td>${html(row.invoice_number)}</td><td>${html(dateOnly(row.created_at))}</td><td>${html(dateOnly(row.due_date))}</td><td class="tenant-number">${currency(row.total_billed)}</td><td class="tenant-number">${currency(row.total_paid)}</td><td class="tenant-number">${currency(row.balance_due)}</td></tr>`).join("") || '<tr><td colspan="6">No matching records.</td></tr>';
  return `<section class="tenant-profile-head"><div><p>${html(facilityName)}</p><h3>${html(profile.name)}</h3><span>Customer #${html(profile.customer_number)} · ${html(profile.tenantStatus)}</span></div><div class="tenant-flags">${flags.map(flag=>`<span>${html(flag)}</span>`).join("")}${profile.pricing_type?`<span>${html(profile.pricing_type)}</span>`:""}</div></section>
   <section class="tenant-profile-stats">${[["Balance due",currency(profile.balanceDue)],["Past due",currency(profile.pastDue)],["Autopay",profile.autopay?"Active":"Not active"],[`Lifetime paid since ${dateOnly(profile.firstPaymentDate)}`,currency(profile.lifetimePaid)],["Tenant since",dateOnly(profile.tenantSince)]].map(([label,value])=>`<div><span>${html(label)}</span><strong>${html(value)}</strong></div>`).join("")}</section>
   <section class="tenant-profile-contact"><div><h4>Address</h4><p>${html(address)}</p></div><div><h4>Alternate contact</h4><p>${html(profile.alternate_contact_name||"Not recorded")}</p></div></section>
   ${renderJourneySection(profile,journeyLeads)}
   <section class="tenant-profile-section"><h4>Leases</h4><div class="tenant-table-scroll" tabindex="0"><table class="tenant-table tenant-profile-table"><thead><tr><th>Lease #</th><th>Unit</th><th>Size and amenities</th><th>Signed</th><th>Move-in</th><th>Move-out / scheduled</th><th class="tenant-number">Current rate</th><th>Rate history</th><th>Discounts</th><th>Protection plan</th><th>Deposit</th></tr></thead><tbody>${leases}</tbody></table></div></section>
   <section class="tenant-profile-section"><div class="tenant-profile-title"><h4>Payments</h4><p>Payment history starts when this facility joined CCStorage.</p></div><div class="tenant-table-scroll" tabindex="0"><table class="tenant-table"><thead><tr><th>Date</th><th>Payment #</th><th>Method</th><th>Status</th><th class="tenant-number">Original</th><th class="tenant-number">Refund</th><th class="tenant-number">Net</th><th>Source</th></tr></thead><tbody>${payments}</tbody></table></div></section>
   <section class="tenant-profile-section"><h4>Invoices</h4><div class="tenant-table-scroll" tabindex="0"><table class="tenant-table"><thead><tr><th>Invoice #</th><th>Created</th><th>Due</th><th class="tenant-number">Billed</th><th class="tenant-number">Paid</th><th class="tenant-number">Balance</th></tr></thead><tbody>${invoices}</tbody></table></div></section>`;
 }

 function loadIndex() {
  if (!indexPromise) indexPromise = fetch("data/restricted/tenants-index.json", { cache: "no-store", credentials: "same-origin" }).then(response => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); }).then(data => { if (data?.schema !== SCHEMA) throw new Error("Invalid tenant index"); tenantIndex=data; view=createInitialView(data); if(pendingScope){Object.assign(view,pendingScope,{preset:"custom",page:1});pendingScope=undefined;} return data; }).catch(error => { unavailable=true; console.warn("Restricted tenant data unavailable:",error.message); return null; });
  return indexPromise;
 }

 function rerender(focusId) {
  render();
  if (focusId && typeof document !== "undefined") requestAnimationFrame(()=>document.getElementById(focusId)?.focus({preventScroll:true}));
 }

 function bindTenantView() {
  const rootElement=document.getElementById("tenants-root"); if(!rootElement||!tenantIndex)return;
  rootElement.querySelector("#tenant-facility").onchange=event=>{view.facility=event.target.value;view.page=1;rerender("tenant-facility");};
  rootElement.querySelector("#tenant-preset").onchange=event=>{view.preset=event.target.value;const range=presetRange(tenantIndex,view.preset);if(range)Object.assign(view,range);view.page=1;rerender("tenant-preset");};
  for(const id of ["tenant-from","tenant-to"])rootElement.querySelector(`#${id}`).onchange=event=>{view.preset="custom";view[id==="tenant-from"?"from":"to"]=clamp(event.target.value,coverageStart(tenantIndex),tenantIndex.cutoff);if(view.from>view.to){if(id==="tenant-from")view.to=view.from;else view.from=view.to;}view.page=1;rerender(id);};
  rootElement.querySelector("#tenant-search").oninput=event=>{const cursor=event.target.selectionStart,value=event.target.value;clearTimeout(searchTimer);searchTimer=setTimeout(()=>{view.search=value;view.page=1;render();requestAnimationFrame(()=>{const input=document.getElementById("tenant-search");input?.focus({preventScroll:true});input?.setSelectionRange(cursor,cursor);});},120);};
  rootElement.querySelectorAll("[data-tenant-scorecard]").forEach(button=>button.onclick=()=>openScorecard(button.dataset.tenantScorecard,button));
  rootElement.querySelectorAll("[data-tenant-activity]").forEach(button=>button.onclick=()=>{view.activity=button.dataset.tenantActivity;view.sort="date";view.direction=-1;view.page=1;rerender();});
  rootElement.querySelectorAll("[data-tenant-sort]").forEach(button=>button.onclick=()=>{view.direction=view.sort===button.dataset.tenantSort?-view.direction:-1;view.sort=button.dataset.tenantSort;view.page=1;rerender();});
  rootElement.querySelectorAll("[data-tenant-page]").forEach(button=>button.onclick=()=>{view.page=Number(button.dataset.tenantPage);rerender();});
  rootElement.querySelectorAll("[data-tenant-profile]").forEach(button=>button.onclick=()=>openActivityProfile(button));
 }

 function render() {
  if(typeof document==="undefined")return;
  const rootElement=document.getElementById("tenants-root");if(!rootElement)return;
  document.getElementById("mode-ribbon").textContent="Restricted tenant reporting · CCStorage";
  document.getElementById("snapshot-label").textContent=tenantIndex?`Data through ${tenantIndex.cutoff}`:"Restricted data";
  document.getElementById("footer-note").textContent="Restricted tenant data · No export controls · CCStorage history varies by facility";
  if(unavailable){rootElement.innerHTML='<section class="panel tenant-unavailable" role="status">Tenant data isn\'t available on this site.</section>';return;}
  if(!tenantIndex){rootElement.innerHTML='<p class="tenant-loading" role="status">Loading restricted tenant data…</p>';loadIndex().then(()=>{if(!document.getElementById("tenants-view")?.classList.contains("hidden"))render();});return;}
  rootElement.innerHTML=renderTenantView(tenantIndex,view);bindTenantView();
 }

 function dialogElement(){return typeof document==="undefined"?null:document.getElementById("tenant-dialog");}
 function dialogHeaderText(title,filteredBySearch){return filteredBySearch?`${title} · Filtered by search`:title;}
 function dialogTriggerKey(trigger){
  if(trigger?.dataset?.tenantScorecard)return {kind:"scorecard",scorecard:trigger.dataset.tenantScorecard};
  if(trigger?.dataset?.tenantProfile)return {kind:"profile",profile:trigger.dataset.tenantProfile,company:trigger.dataset.tenantCompany};
  return null;
 }
 function findDialogReturnTarget(saved, documentObject=typeof document==="undefined"?null:document){
  if(saved?.element?.isConnected&&typeof saved.element.focus==="function")return saved.element;
  if(saved?.key?.kind==="scorecard"){
   const match=[...(documentObject?.querySelectorAll?.("[data-tenant-scorecard]")||[])].find(element=>element.dataset.tenantScorecard===saved.key.scorecard);
   if(match)return match;
  }
  if(saved?.key?.kind==="profile"){
   const match=[...(documentObject?.querySelectorAll?.("[data-tenant-profile][data-tenant-company]")||[])].find(element=>element.dataset.tenantProfile===saved.key.profile&&element.dataset.tenantCompany===saved.key.company);
   if(match)return match;
  }
  return documentObject?.querySelector?.("#tenants-root [data-tenant-heading]")||null;
 }
 function showDialog(trigger){const dialog=dialogElement(),element=trigger||document.activeElement;dialogTrigger={element,key:dialogTriggerKey(element)};if(!dialog.open)dialog.showModal();document.getElementById("tenant-dialog-title")?.focus();}
 function renderDialogList(restoreScroll=false){
  const body=document.getElementById("tenant-dialog-body"),title=document.getElementById("tenant-dialog-title");if(!body||!dialogState)return;
  const back=document.getElementById("tenant-dialog-back");if(back){back.hidden=true;back.onclick=null;}
  title.textContent=dialogHeaderText(dialogState.title,dialogState.filteredBySearch);body.innerHTML=renderScorecardDialog(dialogState.title,dialogState.type,dialogState.rows,dialogState.search,dialogState);
  if(restoreScroll)requestAnimationFrame(()=>{body.scrollTop=dialogState.scroll||0;});
  const searchInput=document.getElementById("tenant-dialog-search");searchInput.oninput=event=>{dialogState.search=event.target.value;dialogState.page=1;renderDialogList();const input=document.getElementById("tenant-dialog-search");input.focus();input.setSelectionRange(input.value.length,input.value.length);};
  body.querySelectorAll("[data-tenant-sort]").forEach(button=>button.onclick=()=>{dialogState.direction=dialogState.sort===button.dataset.tenantSort?-dialogState.direction:-1;dialogState.sort=button.dataset.tenantSort;dialogState.page=1;renderDialogList();});
  body.querySelectorAll("[data-tenant-page]").forEach(button=>button.onclick=()=>{dialogState.page=Number(button.dataset.tenantPage);renderDialogList();});
  body.querySelectorAll("[data-tenant-profile]").forEach(button=>button.onclick=()=>openProfile(button.dataset.tenantCompany,button.dataset.tenantProfile));
 }

 function openList(title,type,rows,trigger){dialogState={title,type,rows,search:"",scroll:0,sort:"date",direction:-1,page:1,filteredBySearch:Boolean(view.search.trim())};renderDialogList();showDialog(trigger);}
 function openScorecard(key,trigger){const card=scorecardModels(tenantIndex,view).find(item=>item.key===key);openList(card.label,key,card.rows,trigger);}
 function openActivityProfile(button){const rows=scoped(tenantIndex,view)[view.activity];dialogState={title:activityMeta[view.activity].label,type:view.activity,rows,search:"",scroll:0,sort:view.sort,direction:view.direction,page:view.page};showDialog(button);openProfile(button.dataset.tenantCompany,button.dataset.tenantProfile);}

 function loadProfiles(companyId){
  if(!profilePromises.has(companyId))profilePromises.set(companyId,fetch(`data/restricted/tenants-${encodeURIComponent(companyId)}.json`,{cache:"no-store",credentials:"same-origin"}).then(response=>{if(!response.ok)throw new Error(`HTTP ${response.status}`);return response.json();}).then(data=>{if(data?.schema!==SCHEMA)throw new Error("Invalid tenant profiles");return data;}));
  return profilePromises.get(companyId);
 }

 function openProfile(companyId,customerId,options={}){
  const body=document.getElementById("tenant-dialog-body"),title=document.getElementById("tenant-dialog-title");if(dialogState)dialogState.scroll=body.scrollTop;title.textContent="Tenant profile";body.innerHTML='<p class="tenant-loading" role="status">Loading tenant profile…</p>';
  const back=document.getElementById("tenant-dialog-back"),backLabel=options.backLabel||dialogState?.title||"list";
  if(back){back.hidden=false;back.textContent=`← Back to ${backLabel}`;back.onclick=()=>{if(typeof options.onBack==="function")options.onBack();else renderDialogList(true);requestAnimationFrame(()=>document.getElementById("tenant-dialog-title")?.focus());};}
  const journeys=globalThis.journeyDashboard?.loadLeadsIndex?globalThis.journeyDashboard.loadLeadsIndex().then(()=>globalThis.journeyDashboard.getCustomerLeads(customerId)):Promise.resolve(null);
  Promise.all([loadProfiles(companyId),journeys]).then(([data,journeyLeads])=>{const profile=data.profiles?.[customerId];if(!profile)throw new Error("Profile missing");title.textContent=profile.name;body.innerHTML=renderProfile(profile,data.facility?.name||companyId,journeyLeads);}).catch(()=>{body.innerHTML='<p class="tenant-empty">Tenant data isn\'t available on this site.</p>';});
 }

 function openForFacility(companyId,from,to){
  pendingScope={facility:String(companyId),from,to};
  if(view){Object.assign(view,pendingScope,{preset:"custom",page:1});pendingScope=undefined;}
  if(typeof globalThis.switchView==="function")globalThis.switchView("tenants");
 }

 if(typeof document!=="undefined"){
  const dialog=document.getElementById("tenant-dialog");
  document.getElementById("tenant-dialog-close")?.addEventListener("click",()=>dialog.close());
  dialog?.addEventListener("click",event=>{if(event.target===dialog)dialog.close();});
  dialog?.addEventListener("close",()=>{const target=findDialogReturnTarget(dialogTrigger);dialogTrigger=null;dialogState=null;target?.focus?.();});
 }

 return {createInitialView,renderTenantView,renderScorecardDialog,renderProfile,renderJourneySection,scorecardModels,scoped,normalizeUnitFootprint,weeklyChart,sizeMixChart,openForFacility,openProfileInDialog:openProfile,showDialog,render,dialogHeaderText,findDialogReturnTarget};
});
