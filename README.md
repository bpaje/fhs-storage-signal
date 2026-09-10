# Storage Signal reporting

Static monthly reporting for Google Ads, Meta Ads and CCStorage. No attribution joins, advertising allocation to facilities, CAC or ROAS calculations.

The dashboard reads `data/reporting.json`. The current release covers June, July and August 2026, plus September 1–9 MTD. August is the default complete month. Storage filters affect CCStorage only; advertising remains account-wide.

## Refresh

1. Read the authorized FHS Google Ads account totals (cost, impressions, clicks and conversions) for each calendar month through the chosen cutoff.
2. Read the FHS Meta Ads account insights for the identical dates. Keep the `lead` action separate from overlapping lead subtypes.
3. Read CCStorage through the CC-Storage MCP: monthly payment-register aggregates, non-void lease moves and period-end occupancy for the current facility roster.
4. Update the source totals, period labels, cutoff and refresh dates in `data/reporting.json`. Include every roster facility; use null for missing source history. Do not include credentials, customer records, contact details, SQL or raw transaction rows.
5. Check payment arithmetic, source totals, coverage and date alignment; preview month/filter changes, then publish the static files.

Refreshes are currently manual. The browser never connects to source accounts. Historical results may change when sources revise payments or platform results.

## Payment basis

Net recorded payments equal eligible original amounts less current refunds, assigned to the original payment month. Eligible statuses are Complete, Manually Entered, Partially Refunded and Refunded. These are register figures, not audited revenue or bank settlements. The separate reporting-view volume differs and is disclosed in the dashboard notes.

Occupancy is reported leases divided by storage units, weighted by units across facilities with a snapshot. Historical coverage changes are disclosed; missing data is not zero. September MTD is not compared with a full prior month.
