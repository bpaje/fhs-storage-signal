# Storage Signal reporting

**Phase 1 is complete and owner accepted as of September 10, 2026.** Storage Signal is the live, manually refreshed dashboard for Family Heirloom Storage: Google Ads, Meta Ads, Google Analytics and CCStorage. It shows source aggregates with filters, monthly charts and reporting notes.

- [Live dashboard](https://bpaje.github.io/fhs-storage-signal/)
- [Phase 1 completion and delivered scope](docs/PHASE_1_COMPLETE.md)
- [Full Claude handover](docs/CLAUDE_HANDOVER.md)
- [Data definitions, connections and refresh operations](docs/DATA_AND_OPERATIONS.md)
- [Validation and release history](docs/VALIDATION_AND_RELEASE.md)
- [Claude startup instructions](CLAUDE.md)

The accepted implementation baseline is [`5dddd4c`](https://github.com/bpaje/fhs-storage-signal/commit/5dddd4ce09535c848d7fa722fca1bff89945846e). Documentation commits may follow it. Acceptance covers this reporting product; it does not close the separate legacy reporting-automation workstream or start Phase 2.

## What is available

| Tab | Coverage | Main capabilities |
| --- | --- | --- |
| Overview | June–August 2026; September 1–9 MTD | Account advertising totals; CCStorage payments, moves and occupancy; brand/facility filters; monthly trends and facility detail |
| Google Ads | January 1–September 9; monthly and YTD | Campaign/ad-group drilldown; campaign-location labels; separate audience-city report; spend, conversions, clicks and efficiency metrics |
| Google Analytics | Every elapsed 2026 month queried; first activity February 13; through September 9; direct YTD | Users, sessions, views, engagement and key events; channel, page and visitor-city tables |
| Meta Ads | June–August; September 1–9 MTD | Campaign/ad-set/ad drilldown; placement, age/gender, region and device reports; evidence-backed decision notes |

Google Ads, GA4 and Meta have selectable monthly column charts and expandable monthly-values tables. Detail tables support search, sorting and CSV export of all matching rows. August is the default complete month. September is partial; future months are not included.

## How it works

Authorized connectors and APIs are read outside the browser application. Private source extracts become public aggregate JSON snapshots after conversion and validation. GitHub Pages serves plain HTML, CSS, JavaScript and those snapshots. **The browser does not authenticate to source accounts; refreshes are manual.**

| Source | Connection used for Phase 1 |
| --- | --- |
| Google Ads | Google Ads MCP connector querying the Google Ads API |
| Meta Ads | Direct Meta Marketing/Graph API using an existing protected system-user credential |
| Google Analytics | Direct GA4 Data API using authorized Google credentials; Analytics Admin API verified the website stream |
| CCStorage | CC-Storage MCP with bounded read-only aggregate reporting queries |

There are no attribution joins, facility advertising allocations, CAC calculations or ROAS claims. Storage filters change CCStorage only; advertising retains its own source scope. Google conversions, Meta leads and GA4 key events are separate measures, not verified renters.

## Local validation and operation

Run the offline data checks from this repository:

```text
python scripts/validate-data.py
```

Serve the repository over local HTTP to preview it, for example with `python -m http.server 8000`, then open `http://localhost:8000`. Opening HTML directly from disk may prevent JSON fetches.

Converters in `scripts/` accept private source extracts without network calls. Their requirements, limitations and refresh procedure are in [Data and operations](docs/DATA_AND_OPERATIONS.md); browser checks are in [Validation and releases](docs/VALIDATION_AND_RELEASE.md). There is no public end-to-end authenticated extractor or scheduler.

## Read the limits with the numbers

- GA4 has no recorded history for January 1–February 12 in the accessible website data. Missing history is unavailable, not zero traffic. First observation does not explain the gap.
- CCStorage uses net recorded payments, not audited revenue or bank deposits. Its difference from a separate reporting view is unresolved; historical facility coverage varies.
- Users, reach and frequency are never added across months or dimension rows. Rates are recomputed from correct scoped totals.
- Meta notes describe observed performance and possible checks, not proven causation, lead quality or budget-change effects. The dashboard does not change ads or tracking.

Phase 2 suggestions are recorded in the [handover](docs/CLAUDE_HANDOVER.md#proposed-phase-2--not-started); they have not started or been accepted as requirements.
