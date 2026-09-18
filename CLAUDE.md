# Claude project entrypoint

This is the public **Storage Signal reporting dashboard** repository. Read [README.md](README.md), then [the full handover](docs/CLAUDE_HANDOVER.md), [data and operations](docs/DATA_AND_OPERATIONS.md), and [validation and releases](docs/VALIDATION_AND_RELEASE.md) before changing reporting behavior.

## Current accepted state

The owner accepted Phase 1 on September 10, 2026: **"Consider this as phase 1 complete."** The implementation baseline is `5dddd4ce09535c848d7fa722fca1bff89945846e`, deployed to [GitHub Pages](https://bpaje.github.io/fhs-storage-signal/). Later documentation commits do not change that implementation baseline.

Phase 1 is a manual, static reporting product with four tabs: Overview, Google Ads, Google Analytics and Meta Ads. It is separate from the older reporting-automation repository. Do not infer that legacy delivery, transport, runtime or governance work is closed by this acceptance. Do not start proposed Phase 2 work merely because it is listed in the handover.

## Product intent to preserve

- Fill the existing dashboard with direct Google Ads, Meta and CCStorage figures; include GA4 website reporting and useful drilldowns.
- Preserve the owner's simplification: **no attribution**. Do not allocate advertising to facilities, infer renters from platform conversions, or label payment-register values as audited revenue. The one exception is the identity-based
  lead matching approved on 2026-09-18 (below).
- Keep the interface readable. Explain source coverage, incomplete months and materially different metric meanings where the user needs them.
- Challenge unsupported conclusions. An observation and a plausible cause are different statements; recommendations must retain their evidence and limitations.

## Restricted tenant data (owner-approved exception, 2026-09-17)

The owner approved showing renter names behind the **Tenants** tab, for their own login only,
on the private host — never on GitHub Pages. Read [the Tenants plan](docs/RENTER_LISTS_PLAN.md)
before touching any of it. Boundaries:

- Names live only in `data/restricted/tenants-*.json`, built by `scripts/build-tenants.py` from
  `private-scripts/ccstorage-tenants-source.json`. Both paths are git-ignored. Never commit
  them, never copy names into `data/*.json`, and never add an export of them.
- Rows carry name, IDs, unit, rate, dates, amounts, address and account flags. **Never**
  phone, email, gate codes, free-text notes, or message bodies. Email- and phone-like values in
  name and address fields are withheld by the builder.
- The build aborts unless every facility-month reconciles with `data/reporting.json` and the
  source `extractedAt` equals `reporting.json`'s `ccExtractedAt`. Build both from one extraction.
- Activity lists stop at the reporting `cutoff`; balances, past due, tenant status and upcoming
  rate changes are as of `balancesAsOf` (the extraction date). Do not relabel one as the other.
- `refresh-dashboard.ps1` and `validate-data.py` fail if anything under `data/restricted/` is
  tracked. Keep those guards.
- Access is the owner's login alone. **If access widens, stop and re-confirm with the owner.**

## Lead matching and visitor journeys (owner-approved exception, 2026-09-18)

The owner approved linking renters to Meta leads and showing anonymous website journeys, both
restricted to the private host. Read [the leads and journeys plan](docs/LEAD_JOURNEYS_PLAN.md)
first.
- **Confirmed** means an exact normalized email or phone match.
- **Possible** means a name-plus-timing match. Always label it unconfirmed and keep it out of
  confirmed totals.
- No modeled or estimated attribution.
- Contact values stay hashed and are never output.
- Website visitors are not linked to named renters until CCStorage passes an identifier across
  domains.

## Data and engineering rules

1. Verify the current branch, working tree and deployed revision before acting; preserve other work. This document records a baseline, not a promise that later checkouts are unchanged.
2. Keep credentials, raw source extracts, private page identifiers and customer or lead records outside the public repository. Existing public aggregates do not make private evidence suitable for publication.
3. Use exact source summaries for GA4 users and Meta reach/frequency. Recompute rates; do not sum or average source ratios. Preserve null when the source does not support a metric.
4. Keep reporting dates and scopes explicit. Google/GA4 include January–September and YTD; Overview/Meta/CCStorage currently start in June. The cutoff is September 17, 2026 (moved from September 9 on 2026-09-18; UI labels derive it from `data/reporting.json`). GA4 first recorded activity is February 13.
5. Run `python scripts/validate-data.py` for data changes and the relevant browser checks in [the validation guide](docs/VALIDATION_AND_RELEASE.md). A local check is not a live deployment check.
6. Source extraction is manual. Public converter scripts do not authenticate or fetch data. Obtain authorized private operational context for refreshes; do not place secrets in browser code or assume this public repository alone reproduces extraction.
7. Publication and changes to source accounts are separate actions. Follow the owner's current request and applicable authorization; do not treat historical approvals as general authority for a new sensitive dataset or ad/tracking changes.

No package install or application build is needed for this plain HTML/CSS/JavaScript site. Python is used for offline conversion and validation. The entrypoint is `index.html`; snapshots live in `data/`.
