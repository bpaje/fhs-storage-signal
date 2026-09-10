# Claude project entrypoint

This is the public **Storage Signal reporting dashboard** repository. Read [README.md](README.md), then [the full handover](docs/CLAUDE_HANDOVER.md), [data and operations](docs/DATA_AND_OPERATIONS.md), and [validation and releases](docs/VALIDATION_AND_RELEASE.md) before changing reporting behavior.

## Current accepted state

The owner accepted Phase 1 on September 10, 2026: **"Consider this as phase 1 complete."** The implementation baseline is `5dddd4ce09535c848d7fa722fca1bff89945846e`, deployed to [GitHub Pages](https://bpaje.github.io/fhs-storage-signal/). Later documentation commits do not change that implementation baseline.

Phase 1 is a manual, static reporting product with four tabs: Overview, Google Ads, Google Analytics and Meta Ads. It is separate from the older reporting-automation repository. Do not infer that legacy delivery, transport, runtime or governance work is closed by this acceptance. Do not start proposed Phase 2 work merely because it is listed in the handover.

## Product intent to preserve

- Fill the existing dashboard with direct Google Ads, Meta and CCStorage figures; include GA4 website reporting and useful drilldowns.
- Preserve the owner's simplification: **no attribution**. Do not allocate advertising to facilities, infer renters from platform conversions, or label payment-register values as audited revenue.
- Keep the interface readable. Explain source coverage, incomplete months and materially different metric meanings where the user needs them.
- Challenge unsupported conclusions. An observation and a plausible cause are different statements; recommendations must retain their evidence and limitations.

## Data and engineering rules

1. Verify the current branch, working tree and deployed revision before acting; preserve other work. This document records a baseline, not a promise that later checkouts are unchanged.
2. Keep credentials, raw source extracts, private page identifiers and customer or lead records outside the public repository. Existing public aggregates do not make private evidence suitable for publication.
3. Use exact source summaries for GA4 users and Meta reach/frequency. Recompute rates; do not sum or average source ratios. Preserve null when the source does not support a metric.
4. Keep reporting dates and scopes explicit. Google/GA4 include January–September and YTD; Overview/Meta/CCStorage currently start in June. The cutoff is September 9, 2026. GA4 first recorded activity is February 13.
5. Run `python scripts/validate-data.py` for data changes and the relevant browser checks in [the validation guide](docs/VALIDATION_AND_RELEASE.md). A local check is not a live deployment check.
6. Source extraction is manual. Public converter scripts do not authenticate or fetch data. Obtain authorized private operational context for refreshes; do not place secrets in browser code or assume this public repository alone reproduces extraction.
7. Publication and changes to source accounts are separate actions. Follow the owner's current request and applicable authorization; do not treat historical approvals as general authority for a new sensitive dataset or ad/tracking changes.

No package install or application build is needed for this plain HTML/CSS/JavaScript site. Python is used for offline conversion and validation. The entrypoint is `index.html`; snapshots live in `data/`.
