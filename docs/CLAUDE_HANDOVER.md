# Claude handover: accepted Phase 1

This is the public handover for Storage Signal as accepted September 10, 2026. Read [data and operations](DATA_AND_OPERATIONS.md) before extracting or interpreting numbers, and [validation and releases](VALIDATION_AND_RELEASE.md) before changing or publishing them.

## Current state to recover first

- The owner accepted Phase 1: **"Consider this as phase 1 complete."**
- The implementation baseline is `5dddd4ce09535c848d7fa722fca1bff89945846e` on `bpaje/fhs-storage-signal`, deployed to [the public dashboard](https://bpaje.github.io/fhs-storage-signal/).
- Pages run `34468500012` succeeded for that implementation revision.
- The cutoff is September 9, 2026; refresh date September 10. A later current date does not imply current data.
- Four tabs are delivered: Overview, Google Ads, Google Analytics and Meta Ads. Selectable monthly charts are live in all three detail tabs.
- This is a manually refreshed reporting product. There is no running source ingestion service or automatic refresh behind the page.
- The next requested deliverable is this handover and repository documentation. Proposed Phase 2 items below have not started and are not accepted implementation work.

Before continuing, inspect the actual checkout and deployed revision. Documentation commits following the baseline will have different hashes. Preserve local edits and avoid replacing later work with this historical state.

## How the work evolved

1. **Recover reporting context and deliver CCStorage Excel.** The owner asked what was built and whether CCStorage could be pulled into Excel by separate months beginning in June. The CC-Storage MCP supplied bounded read-only reporting for the current 39-facility roster. A workbook was delivered for June–September 1–9.
2. **Simplify the product.** The owner clarified that the purpose was to populate the existing dashboard with Google Ads, Meta Ads and CCStorage numbers, leaving attribution out. Direct source reporting and explicit coverage/metric notes became the product. This is the central decision to preserve.
3. **Add Google Ads drilldowns and GA4.** The owner requested Analytics and more granular advertising data. The supplied measurement ID was `G-TCSG6BY1KK`. Authorized Analytics Admin access resolved/verified the stream; direct GA4 Data API reports supplied website aggregates. Campaign/ad-group and audience-city Google Ads reporting was added. No tracking configuration changed.
4. **Publish Google/GA4 detail aggregates.** The owner explicitly approved campaign/ad-group performance, city totals and website page/city aggregates in the public repository/dashboard. Individual visitor records and credentials were excluded.
5. **Expand Meta and add insights.** The owner requested specific Meta data, high-level decision support and confirmation of API connectivity. Live access was verified. Four months of hierarchy and delivery/audience reports plus adjacent seven-day evidence windows became the Meta tab and deterministic insight cards. The owner explicitly approved this new public scope.
6. **Resolve hosting visibility.** Pages availability was interrupted when the repository was private under the active plan. The owner made it public and requested another attempt; publication succeeded. This was a hosting issue, not a source-data failure.
7. **Expand elapsed 2026 Google/GA4 history.** January–September and YTD were retrieved. Google Ads reconciled to independent account/YTD totals. GA4 first recorded activity was February 13; no earlier history or alternate same-site accessible property/stream was found. The gap was clearly labeled. The owner approved publishing the expanded range.
8. **Add selectable monthly metrics.** The owner asked for monthly columns changing with the metric selection, matching Overview. Shared column charts and expandable values tables were added to Google Ads, GA4 and Meta while preserving source scope, nulls, partial periods and non-additive metrics. Live switching/filter checks passed.
9. **Accept and hand over.** The owner marked Phase 1 complete and requested full context for Claude saved as readable repository Markdown.

See [release history](VALIDATION_AND_RELEASE.md#implementation-history) for the five implementation commits. Historical publication approvals are evidence for those releases, not a general grant for future datasets or source changes.

## Product intent

The dashboard helps the owner read monthly performance and investigate source-specific changes. It should remain understandable without knowledge of the older automation pipeline.

Google conversions, GA4 key events, Meta leads/conversations and CCStorage lease events have different definitions. Do not total them into a synthetic lead or renter count. The owner deliberately removed attribution: a campaign name containing a location must not become an inferred link to a facility's payments.

The UI combines selected-period detail with cross-month charts. Selecting a chart metric changes monthly values without changing definitions. Text searches narrow table/export rows, not chart/headline totals. GA4 table views do not change whole-website summaries. [Filter behavior](DATA_AND_OPERATIONS.md#scope-and-filter-behavior) is a reporting contract, not merely a UI detail.

## Architecture and ownership map

| Item | Responsibility |
| --- | --- |
| `index.html` | Shell, navigation, panels and script/style entrypoints |
| `app.js` | Overview state, facility aggregation, definitions, comparisons, filters and drawer |
| `details.js` | Tab/period coordination; Google Ads/GA4 filters, charts, tables and exports |
| `meta.js` | Meta hierarchy/breakdown views, exact source summaries, insights, chart and export |
| `monthly-trend.js` | Shared column/values-table renderer; presentation only, no aggregation |
| `styles.css`, `meta.css`, `monthly-trend.css` | Core/view presentation and responsive behavior |
| `data/reporting.json` | Four-month Overview Google/Meta account totals and CCStorage facility operations |
| `data/google-ads.json` | Monthly/YTD account, campaign, ad-group and city delivery |
| `data/analytics.json` | Monthly/direct-YTD website summaries and channel/page/city aggregates with privacy/coverage metadata |
| `data/meta.json` | Four-month hierarchy/breakdowns, weekly evidence and generated insights |
| `scripts/build-google-ads.py` | Offline public aggregate conversion and reconciliation |
| `scripts/build-analytics.py` | Offline conversion, pagination/coverage checks and private-path grouping |
| `scripts/build-meta.py` | Offline conversion, insights and matching Meta Overview update |
| `scripts/validate-data.py` | Offline dataset reconciliation and metric-contract checks |

The site is plain HTML/CSS/JavaScript and JSON: no frontend build, browser source authorization, backend, AI service or scheduler. Meta insight text is generated by Python rules during refresh, not an AI model at page load.

Protected extractors, authentication, raw source responses, the CCStorage workbook, browser QA scripts and screenshots remain private operational artifacts. This public repository does not contain a complete authenticated extraction pipeline. Obtain the private handover when refreshing sources; do not publish those private files to make extraction convenient.

The older **FHS Reporting Automation** repository is a separate workstream with its own accepted states and restrictions. The private handover records its recovery context. Reusing that machinery is a future design decision, not a prerequisite for this accepted dashboard.

## Findings and limitations to retain

**GA4 history.** January 1–February 12 returned no recorded activity. January's summary is null; February is partial recorded history. The property/stream existed before 2026, so February 13 is an observation date, not proof of tracking installation. No alternate accessible same-site history was found. Completeness after that date was not independently established. Latest-day results can still process; see [Google's freshness guidance](https://support.google.com/analytics/answer/11198161?hl=en).

**GA4 key events.** The snapshot reports 20 in July, 174 in August and 322 in September 1–9. These configured events are not validated leads. The increase warrants a definition/collection review; it does not prove business demand rose. No key-event audit or tracking correction was completed.

**CCStorage.** Use payment-register net amounts, non-void lease-event counts and period-end occupancy. The roster is 39; historical payment/occupancy coverage progresses from 28 to 33 to 38 facilities. Consider coverage before inferring portfolio growth. The payment-register/reporting-view discrepancy is unresolved. Occupancy above capacity is flagged rather than silently capped.

**Meta.** `lead` is the headline count. Grouped leads, pixel leads and conversations can overlap and are not added. Some regional action categories were never returned and remain unavailable. Exact source summary rows supply reach/frequency. August's Chattanooga ad set returned 45 leads at $20.01 CPL; remarketing returned 8 at $38.89. That is an observed cost gap, not lead quality or proof of how reallocation would perform.

**Insights.** Account-wide notes are independent of hierarchy filters. Volume/fatigue thresholds are operational screens, not significance tests. No fatigue flag does not prove no fatigue. Notes propose checks or controlled tests; the dashboard does not execute campaign changes.

**Dates and updates.** September 1–9 is not compared against a full prior month in Overview. Meta uses equal seven-day windows for recent movement. Sources can revise history. Refreshing a detail dataset while leaving its overlapping Overview values stale breaks consistency.

## Proposed Phase 2 — not started

These are recommendations for discussion, not accepted requirements or permission to execute.

| Priority | Candidate | Purpose | Reviewable next result |
| --- | --- | --- | --- |
| 1 | GA4 key-event audit | Establish what current event growth means | Read-only definition and dated volume review; explanation or remaining uncertainty; any tracking changes proposed separately |
| 2 | Google Ads insights and matched-period comparisons | Turn the existing detail into source-backed decision support | Defined metrics/windows, coverage rules and example observations with evidence/limits |
| 3 | Reliable scheduled refresh design | Keep snapshots current without manual work | Source contracts, protected credentials, pagination checks, publication failure handling, revision logging and an approved schedule |
| 4 | CCStorage reporting-view reconciliation | Explain the alternate total without changing basis prematurely | Traceable comparison of definitions and exclusions |
| 5 | Earlier Meta/CCStorage history if useful | Extend current June-onward coverage | Verified source availability and period/coverage design before publication |

Do not revive attribution as an implicit prerequisite. If future work needs qualified leads or rentals by channel, first establish the required measurement and data work with the owner.

## Continuation sequence

1. Read this handover and the private counterpart when source access is needed.
2. Verify the current checkout, outstanding work and deployment against the accepted baseline.
3. Select only the concrete next outcome the owner requests.
4. Preserve metric/scope contracts, make a reviewable change, and perform relevant offline/browser checks.
5. Review the actual aggregate files and public scope before publication; follow applicable authorization and verify the deployment afterward.

Phase 1 is complete with its disclosed limits. Future work should improve a specific business need without describing those limits as already solved.
