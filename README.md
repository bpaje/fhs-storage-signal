# Storage Signal reporting

Static monthly reporting for Google Ads, Meta Ads, Google Analytics and CCStorage. No attribution joins, advertising allocation to facilities, CAC or ROAS calculations.

The dashboard reads `data/reporting.json`. The current release covers June, July and August 2026, plus September 1–9 MTD. August is the default complete month. Storage filters affect CCStorage only; advertising remains account-wide.

## Refresh

1. Read the authorized FHS Google Ads account totals (cost, impressions, clicks and conversions) for each calendar month through the chosen cutoff.
2. Read the FHS Meta Ads account insights for the identical dates. Keep the `lead` action separate from overlapping lead subtypes.
3. Read CCStorage through the CC-Storage MCP: monthly payment-register aggregates, non-void lease moves and period-end occupancy for the current facility roster.
4. Update the source totals, period labels, cutoff and refresh dates in `data/reporting.json`. Include every roster facility; use null for missing source history. Do not include credentials, customer records, contact details, SQL or raw transaction rows.
5. Check payment arithmetic, source totals, coverage and date alignment; preview month/filter changes, then publish the static files.

Refreshes are currently manual. The browser never connects to source accounts. Historical results may change when sources revise payments or platform results.

## Detail tabs

Google Ads reads `data/google-ads.json`: monthly campaign totals, ad-group totals and the separate city report. Campaign-location labels are extracted from campaign names, not joined to storage facilities. Campaign rows drill into ad groups. Audience-city and presence/interest filters apply to the geography report; ad-group filtering is disabled there. Geographic totals do not cover all account delivery. Monetary sums retain source micros until display; rates are recomputed from totals. Fractional conversions can vary slightly between reporting levels; source values are retained and checked for agreement at the displayed two-decimal precision.

Google Analytics reads `data/analytics.json`, scoped to the supplied website stream `G-TCSG6BY1KK`. It includes monthly summary metrics, traffic channels, page paths and visitor cities. Monthly users come from the summary report, not sums of daily or dimension rows. Page paths exclude query strings; customer-level data is not included. The Analytics Admin API was enabled on the existing reporting project to verify this stream. No tracking configuration was changed.

Both tabs support searchable, sortable tables and CSV export of all matching rows, not only the visible page. Exported rates are numeric fractions. Website and advertising filters are independent of the storage filters.

## Meta reporting and decision notes

The Meta tab reads `data/meta.json`: monthly account, campaign, ad-set and ad summaries; ad-set-level placement, demographic, region and device reports; plus two adjacent seven-day windows per reporting month. Filters use exact source summaries, so reach and frequency are never summed across ads or breakdown rows. Meta-reported leads, grouped Meta leads, website pixel leads and messaging conversations remain separate action categories. Regional total leads, website leads, conversations and landing-page views were not returned and remain null; regional grouped Meta leads are available.

The account-wide decision notes cover monthly or matched-week CPL changes, ad-set lead efficiency, higher-cost enquiries, ad concentration and possible fatigue. Every note includes its evidence and limits. Low-volume candidates are screened; the thresholds are operational rules, not significance tests. No budget, audience, creative or tracking settings are changed by this dashboard. Lead quality, qualified enquiries, rentals and attributed revenue are not measured here.

To refresh, retrieve the same bounded Meta reports with complete pagination, then run `python scripts/build-meta.py /private/path/meta-complete-source.json`. This writes the public aggregate Meta dataset and updates matching Meta overview totals. The source extract stays outside the public repository. Re-run `python scripts/validate-data.py` and browser checks. Insight rules are deterministic and regenerate with the snapshot; the browser does not make API or AI calls.

For refreshes, use the same reporting dates as the overview. Retrieve Google Ads campaigns and ad groups by month, the city report and geographic names. Retrieve GA4 monthly totals directly, then separate channel, page and city reports with the same stream filter. Preserve threshold/sampling metadata. Run `python scripts/validate-data.py` before publication.

## Payment basis

Net recorded payments equal eligible original amounts less current refunds, assigned to the original payment month. Eligible statuses are Complete, Manually Entered, Partially Refunded and Refunded. These are register figures, not audited revenue or bank settlements. The separate reporting-view volume differs and is disclosed in the dashboard notes.

Occupancy is reported leases divided by storage units, weighted by units across facilities with a snapshot. Historical coverage changes are disclosed; missing data is not zero. September MTD is not compared with a full prior month.
