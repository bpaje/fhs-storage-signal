"use strict";

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.googleAdsConversions = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const GROUPS = [
    ["leads_and_calls", "Leads & calls"],
    ["phone_clicks", "Phone-number clicks"],
    ["button_clicks", "Rent Now / Pay bill button clicks"],
    ["store_visits", "Store visits (modeled)"],
    ["rentals", "Rentals"],
    ["other", "Other"],
  ];
  const labels = Object.fromEntries(GROUPS);
  const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
  const number = value => value == null ? "n/a" : new Intl.NumberFormat("en-US", {maximumFractionDigits: 2}).format(value);
  const money = value => value == null ? "n/a" : new Intl.NumberFormat("en-US", {style:"currency", currency:"USD", maximumFractionDigits:2}).format(value);
  const percent = value => value == null ? "n/a" : new Intl.NumberFormat("en-US", {style:"percent", maximumFractionDigits:1}).format(value);

  function aggregate(rows) {
    if (!rows.length || rows.some(row => !row.conversionsByGroup || !Array.isArray(row.conversionsByAction))) return null;
    const conversionsByGroup = Object.fromEntries(GROUPS.map(([key]) => [key, 0]));
    const actions = new Map();
    for (const row of rows) {
      for (const [key] of GROUPS) conversionsByGroup[key] += row.conversionsByGroup[key] || 0;
      for (const action of row.conversionsByAction) {
        const current = actions.get(action.id);
        if (current) current.conversions += action.conversions;
        else actions.set(action.id, {...action});
      }
    }
    return {conversionsByGroup, conversionsByAction:[...actions.values()].sort((a,b) => a.name.localeCompare(b.name))};
  }

  function summary(spend, split) {
    if (!split?.conversionsByGroup || !Array.isArray(split.conversionsByAction)) return null;
    const leadsAndCalls = split.conversionsByGroup.leads_and_calls || 0;
    return {
      leadsAndCalls,
      costPerLeadAndCall: leadsAndCalls ? spend / leadsAndCalls : null,
      buttonClicks: split.conversionsByGroup.button_clicks || 0,
    };
  }

  function renderLeadCard(spend, split, formatMoney=money) {
    const result = summary(spend, split);
    if (!result) return "";
    return `<article class="kpi-card"><div class="kpi-head">Leads &amp; calls</div><div class="kpi-value">${escapeHtml(number(result.leadsAndCalls))}</div><div class="report-note">Cost / lead &amp; call: ${escapeHtml(formatMoney(result.costPerLeadAndCall))}</div></article>`;
  }

  function renderBreakdown(split) {
    if (!split?.conversionsByGroup || !Array.isArray(split.conversionsByAction)) return "";
    const total = GROUPS.reduce((sum, [key]) => sum + (split.conversionsByGroup[key] || 0), 0);
    const rows = GROUPS.map(([key, label]) => {
      const value = split.conversionsByGroup[key] || 0;
      return `<tr><th scope="row">${escapeHtml(label)}</th><td>${escapeHtml(number(value))}</td><td>${escapeHtml(percent(total ? value / total : null))}</td></tr>`;
    }).join("");
    const actions = split.conversionsByAction.map(action => {
      const share = total ? action.conversions / total : null;
      return `<li><div><strong>${escapeHtml(action.name)}</strong><small>${escapeHtml(action.category)} · ${escapeHtml(labels[action.group] || "Other")}</small></div><span>${escapeHtml(number(action.conversions))} · ${escapeHtml(percent(share))}</span></li>`;
    }).join("") || '<li class="conversion-action-empty">No primary conversions recorded for this period.</li>';
    return `<article class="panel conversion-breakdown" aria-labelledby="conversion-breakdown-title"><header class="panel-header"><div><h3 id="conversion-breakdown-title">Conversions by type</h3><p>Google Ads primary conversions, separated by conversion-action meaning.</p></div></header><div class="conversion-breakdown-table"><table><caption class="sr-only">Primary conversions by type</caption><thead><tr><th scope="col">Type</th><th scope="col">Count</th><th scope="col">Share</th></tr></thead><tbody>${rows}</tbody></table></div><details class="conversion-actions"><summary>View conversion actions</summary><ul>${actions}</ul></details></article>`;
  }

  return {GROUPS, aggregate, summary, renderLeadCard, renderBreakdown, labels, money};
});
