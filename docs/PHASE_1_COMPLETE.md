# Phase 1 completion record

**Status: complete and owner accepted.**

**Acceptance date: September 10, 2026.**

**Implementation baseline: `5dddd4ce09535c848d7fa722fca1bff89945846e`.**

**Live product: [Storage Signal](https://bpaje.github.io/fhs-storage-signal/).**

The owner stated: **"Consider this as phase 1 complete."** The next requested deliverable was a full, readable Claude handover and repository Markdown documentation. This record documents that acceptance; it does not extend the source cutoff or declare the separate legacy automation project complete.

## The outcome

Family Heirloom Storage now has one dashboard for monthly business reporting from Google Ads, Meta Ads, Google Analytics and CCStorage. It shows real source aggregates, supports exploration at each source's available grain, and states where comparisons or interpretations would be misleading.

The delivery followed a deliberate scope change. The owner wanted numbers populated into the existing dashboard and explicitly removed attribution: **"We just want the Google Meta and CC Storage numbers filled. No need to over complicate."** GA4, deeper advertising drilldowns, high-level Meta insights and selectable monthly charts were then added at the owner's request.

## Delivered capabilities

| Area | Completed behavior |
| --- | --- |
| Overview | Monthly Google/Meta account totals beside CCStorage operations; spend/payment/move-in trends; source and coverage notes |
| CCStorage | Current roster of 39 facilities; brand/facility filters; payments/refunds, payment counts, lease moves, occupancy, autopay and facility detail |
| Google Ads | Monthly/YTD account, campaign and ad-group reporting; campaign-to-ad-group drilldown; campaign-location labels; separate audience-city and presence/interest filters |
| GA4 | Stream-scoped monthly/direct-YTD summaries; traffic-channel/page/visitor-city tables; coverage/processing notes; private-path aggregation |
| Meta Ads | Monthly account/campaign/ad-set/ad hierarchy; delivery/engagement metrics; placement, demographic, regional and device breakdowns |
| Meta insights | Evidence-backed CPL, efficiency, higher-cost enquiry, concentration and possible-fatigue observations; matched seven-day comparisons for partial September |
| Monthly comparison | Selectable column charts and expandable monthly-values tables for Google Ads, GA4 and Meta, alongside Overview trends |
| Usability | Search, sorting, pagination and all-matching-row CSV export for detail tables; responsive layout |
| Reproducibility | Public Google Ads, GA4 and Meta converters and offline reconciliation validator; extraction/refresh remain manual |
| Publication | Public aggregate snapshots deployed through GitHub Pages; live metrics and filter behavior verified |

A separate CCStorage Excel workbook was produced for June, July, August and September 1–9: `FHS_CCStorage_Monthly_Jun-Sep_2026.xlsx`. It is retained with private project reporting artifacts, not bundled into this public repository. It is a dated report, not an automatically synchronized dashboard export.

## Coverage at acceptance

The included dates end September 9, 2026; refresh date is September 10. Currency is USD.

| Source/view | Requested start | Cutoff | Period choices | Qualification |
| --- | --- | --- | --- | --- |
| Overview / CCStorage | June 1 | September 9 | June, July, August, September MTD | All 39 roster facilities represented; historical coverage varies |
| Google Ads detail | January 1 | September 9 | January–September, 2026 YTD | Independent account/YTD totals reconcile to detail delivery |
| GA4 | January 1 | September 9 | January–September, 2026 YTD | First recorded activity February 13; earlier history unavailable |
| Meta detail | June 1 | September 9 | June, July, August, September MTD | Some regional conversion categories unsupported, retained as null |

“Complete 2026 data” means all elapsed 2026 dates through the reporting cutoff for Google Ads/GA4. It does not include future months or fill the GA4 gap with invented values. Meta and CCStorage were not expanded to January. August remains the default complete month.

## Snapshot reference values

These are checks against the accepted JSON, not a promise that later source reads will be identical. Payment and occupancy coverage happen to match in this snapshot; their meanings remain separate.

| Period | Google spend | Meta spend | Meta leads | Net recorded payments | Payment / occupancy coverage |
| --- | ---: | ---: | ---: | ---: | --- |
| June | $7,133.85 | $1,314.17 | 60 | $374,747.87 | 28 / 39 facilities |
| July | $6,655.49 | $2,169.78 | 80 | $425,911.92 | 33 / 39 facilities |
| August | $6,997.62 | $2,168.06 | 85 | $467,763.25 | 38 / 39 facilities |
| September 1–9 | $2,222.71 | $628.27 | 17 | $324,306.85 | 38 / 39 facilities |

Google Ads YTD spend is $84,058.70, with 8,964 clicks and 495 reported conversions. GA4's directly queried YTD summary is 25,429 users and 31,494 sessions. GA4 users are not the sum of monthly users. Consult the JSON for source precision and [metric definitions](DATA_AND_OPERATIONS.md#metric-contracts) before comparing values.

## Accepted limits

- Refresh is manual, without scheduled ingestion or browser API access.
- There are no joins attributing ads to CCStorage payments, customers or rentals. Platform results are not cross-platform deduplicated.
- Payment-register totals differ from a separate CCStorage reporting-view total. The register is used consistently; the difference remains unresolved.
- GA4 key-event definitions need review before interpreting their increase as more business leads.
- Meta recommendations are descriptive decision support; no budget, audience, creative, tracking or source records were changed by the dashboard.
- The three public detail converters do not replace the private authenticated extractors or the private initial Overview/CCStorage preparation workflow.
- Legacy reporting-automation transport, governance and delivery remain a separate workstream. Its completion is not asserted here.

For continuation, read [the full Claude handover](CLAUDE_HANDOVER.md).
