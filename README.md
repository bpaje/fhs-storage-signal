# Storage Signal reporting

Static monthly reporting for Google Ads, Meta Ads, Google Analytics and CCStorage. No attribution joins, advertising allocation to facilities, CAC or ROAS calculations.

The overview reads `data/reporting.json` and covers June, July and August 2026, plus September 1–9 MTD. Meta and CCStorage retain that coverage. Google Ads and GA4 have their own January–September selectors and a January 1–September 9 year-to-date view. August remains the default complete month. Switching tabs preserves a supported period and otherwise returns to August. Storage filters affect CCStorage only; advertising remains account-wide.

2026 is still in progress: September is partial and future months are not included. GA4 returned no recorded activity for January 1–February 12; its first observed 2026 activity is February 13. Missing history is displayed as unavailable, not zero website traffic. The current property and stream were created before 2026, so the first observed event date does not establish when tracking was installed or why earlier history is absent. GA4's latest 24–48 hours may still be processing.

## Refresh

1. Read the authorized FHS Google Ads account totals (cost, impressions, clicks and conversions) for each calendar month through the chosen cutoff.
2. Read the FHS Meta Ads account insights for the identical dates. Keep the `lead` action separate from overlapping lead subtypes.
3. Read CCStorage through the CC-Storage MCP: monthly payment-register aggregates, non-void lease moves and period-end occupancy for the current facility roster.
4. Update the source totals, period labels, cutoff and refresh dates in `data/reporting.json`. Include every roster facility; use null for missing source history. Do not include credentials, customer records, contact details, SQL or raw transaction rows.
5. Check payment arithmetic, source totals, coverage and date alignment; preview month/filter changes, then publish the static files.

Refreshes are currently manual. The browser never connects to source accounts. Historical results may change when sources revise payments or platform results.

## Detail tabs

Google Ads reads `data/google-ads.json`: monthly campaign totals, ad-group totals and the separate city report, with independent account totals for reconciliation. Year-to-date rows aggregate additive monthly metrics; rates are recomputed. Campaign-location labels are extracted from campaign names, not joined to storage facilities. Campaign rows drill into ad groups. Audience-city and presence/interest filters apply to the geography report; ad-group filtering is disabled there. Geographic totals do not cover all account delivery. Monetary sums retain source micros until display. Fractional conversions can vary slightly between reporting levels; source values are retained with a reconciliation tolerance below 0.005 conversions. A small source difference can cross a two-decimal rounding boundary.

Google Analytics reads `data/analytics.json`, scoped to the supplied website stream `G-TCSG6BY1KK`. It includes monthly and directly queried year-to-date summary metrics, traffic channels, page paths and visitor cities. Users come from the summary report for the exact selected date range, never sums of monthly, daily or dimension rows. Page paths exclude query strings and opaque account, payment or invoice identifiers. Such pages are combined as `[Private paths omitted]`, retaining additive page views and engagement duration, with users left null because they cannot be deduplicated across those rows. Coverage notes distinguish the requested period from observed activity and retain sampling, thresholding and grouped-away-row metadata. The Analytics Admin API was enabled on the existing reporting project to verify this stream. No tracking configuration was changed.

Both tabs support searchable, sortable tables and CSV export of all matching rows, not only the visible page. Exported rates are numeric fractions. Website and advertising filters are independent of the storage filters.

## Meta reporting and decision notes

The Meta tab reads `data/meta.json`: monthly account, campaign, ad-set and ad summaries; ad-set-level placement, demographic, region and device reports; plus two adjacent seven-day windows per reporting month. Filters use exact source summaries, so reach and frequency are never summed across ads or breakdown rows. Meta-reported leads, grouped Meta leads, website pixel leads and messaging conversations remain separate action categories. Regional total leads, website leads, conversations and landing-page views were not returned and remain null; regional grouped Meta leads are available.

The account-wide decision notes cover monthly or matched-week CPL changes, ad-set lead efficiency, higher-cost enquiries, ad concentration and possible fatigue. Every note includes its evidence and limits. Low-volume candidates are screened; the thresholds are operational rules, not significance tests. No budget, audience, creative or tracking settings are changed by this dashboard. Lead quality, qualified enquiries, rentals and attributed revenue are not measured here.

To refresh, retrieve the same bounded Meta reports with complete pagination, then run `python scripts/build-meta.py /private/path/meta-complete-source.json`. This writes the public aggregate Meta dataset and updates matching Meta overview totals. The source extract stays outside the public repository. Re-run `python scripts/validate-data.py` and browser checks. Insight rules are deterministic and regenerate with the snapshot; the browser does not make API or AI calls.

For Google/GA4 refreshes, retrieve every calendar month from January 1 through the chosen cutoff and an explicit year-to-date period. Use the overview cutoff for the overlapping months. Retrieve Google Ads independent account totals, campaigns and ad groups by month, the city report and geographic names. Retrieve GA4 monthly and year-to-date totals directly, then separate channel, page and city reports with the same stream filter. Check daily activity coverage and preserve threshold/sampling metadata. Refresh overlapping Google overview totals from the new source account totals. Run `python scripts/validate-data.py` before publication.

The public converters accept private source extracts and do not authenticate or make network requests:

```text
python scripts/build-google-ads.py /private/path/google-ads-2026-source.json
python scripts/build-analytics.py /private/path/ga-2026-source.json
python scripts/validate-data.py
```

No alternate accessible FHS property or same-site stream was found for the missing January–February GA4 history. See Google's [data freshness guidance](https://support.google.com/analytics/answer/11198161?hl=en) for processing expectations. GA4 key events reflect the configured event definitions, not independently verified enquiries or rentals.

## Payment basis

Net recorded payments equal eligible original amounts less current refunds, assigned to the original payment month. Eligible statuses are Complete, Manually Entered, Partially Refunded and Refunded. These are register figures, not audited revenue or bank settlements. The separate reporting-view volume differs and is disclosed in the dashboard notes.

Occupancy is reported leases divided by storage units, weighted by units across facilities with a snapshot. Historical coverage changes are disclosed; missing data is not zero. September MTD is not compared with a full prior month.
