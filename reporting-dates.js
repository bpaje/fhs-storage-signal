"use strict";

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.reportingDates = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const monthName = iso => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });
  const day = iso => Number(iso.slice(8, 10));

  function formatDate(iso) {
    return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });
  }

  function formatRange(start, end) {
    if (start.slice(0, 7) === end.slice(0, 7)) return `${monthName(start)} ${day(start)}–${day(end)}`;
    return `${formatDate(start)}–${formatDate(end)}`;
  }

  function periodRangeLabel(period) {
    if (period.partial && period.label) {
      return period.label.replace(/,\s*\d{4}\s*\(MTD\)$/i, "").replace(/\s*\(MTD\)$/i, "");
    }
    return formatRange(period.start, period.end);
  }

  function monthSpan(periods) {
    const first = periods[0], last = periods.at(-1);
    return first && last ? `${monthName(first.start)}–${monthName(last.end)}` : "";
  }

  function latestPeriod(report) {
    return report.periods.at(-1);
  }

  function partialPeriodSentence(period) {
    return `${monthName(period.start)} covers days ${day(period.start)}–${day(period.end)} only.`;
  }

  function occupancyDefinition(report) {
    const last = latestPeriod(report);
    const timing = last.partial ? `month end, or ${formatDate(last.end)} for MTD` : "month end";
    return `Reported occupied leases divided by reported storage units at ${timing}. Portfolio occupancy is weighted by units. Missing facilities are excluded. Counts exceeding capacity are flagged.`;
  }

  function comparisonDefinition(report) {
    const last = latestPeriod(report);
    const partial = last.partial ? ` ${periodRangeLabel(last)} is not compared with a full prior month.` : "";
    return `The current roster contains 39 facilities. Historical coverage varies. CCStorage percentage comparisons are suppressed when the facilities with data differ.${partial} These snapshots are manually refreshed and source systems may revise historical results.`;
  }

  function periodRefresh(period, refreshed) {
    const coverage = period.partial ? partialPeriodSentence(period) : "Complete calendar month.";
    return `${coverage} Refreshed ${formatDate(refreshed)}. Updates are manual.`;
  }

  function trendSubtitle(periods, accountWide) {
    const last = periods.at(-1);
    const partial = last?.partial ? ` · ${monthName(last.start)} is ${day(last.start)}–${day(last.end)} only` : "";
    return `${monthSpan(periods)}${partial} · ${accountWide ? "account-wide" : "selected facilities"}`;
  }

  function chartPeriodLabel(period) {
    return period.partial ? periodRangeLabel(period) : monthName(period.start);
  }

  function detailCoverageDefinition(report) {
    const last = latestPeriod(report);
    return `Google Ads and GA4 offer monthly reporting and a year-to-date view through ${formatDate(last.end)}. The year is still in progress. Overview, Meta and CCStorage retain their available ${monthSpan(report.periods)} periods. The selected period falls back to August when it is unavailable in the next view.`;
  }

  // Freshness: whole calendar days from a source's own cutoff date to the local date of `now` (always passed in, never read here).
  const STALE_AFTER_DAYS = 7;

  function ageInDays(iso, now) {
    const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
    return Math.max(0, Math.round((Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) - Date.UTC(y, m - 1, d)) / 86400000));
  }

  function freshness(iso, now) {
    if (!/^\d{4}-\d{2}-\d{2}/.test(String(iso ?? ""))) return { days: null, stale: true, label: "Data date unavailable", warning: "Freshness unknown", text: "Data date unavailable · Freshness unknown" };
    const days = ageInDays(iso, now), stale = days > STALE_AFTER_DAYS;
    const label = `Data through ${formatDate(iso.slice(0, 10))} (${days} ${days === 1 ? "day" : "days"} old)`;
    const warning = stale ? `Stale: older than ${STALE_AFTER_DAYS} days` : "";
    return { days, stale, label, warning, text: warning ? `${label} · ${warning}` : label };
  }

  function dashboardLabels(report) {
    const last = latestPeriod(report);
    return {
      occupancy: occupancyDefinition(report),
      comparison: comparisonDefinition(report),
      periodRefresh: periodRefresh(last, report.refreshed),
      trend: trendSubtitle(report.periods, true),
      chartPeriods: report.periods.map(chartPeriodLabel),
      detailCoverage: detailCoverageDefinition(report),
    };
  }

  return {
    ageInDays,
    chartPeriodLabel,
    comparisonDefinition,
    dashboardLabels,
    detailCoverageDefinition,
    formatDate,
    freshness,
    latestPeriod,
    occupancyDefinition,
    partialPeriodSentence,
    periodRefresh,
    periodRangeLabel,
    trendSubtitle,
  };
});
