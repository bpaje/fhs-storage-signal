# Validation and release record

This record separates implementation, validation, publication and owner acceptance. It covers the Phase 1 implementation baseline, not later documentation-only revisions.

## Accepted implementation and deployment

- **Implementation:** [`5dddd4ce09535c848d7fa722fca1bff89945846e`](https://github.com/bpaje/fhs-storage-signal/commit/5dddd4ce09535c848d7fa722fca1bff89945846e).
- **Pages run:** [`34468500012`](https://github.com/bpaje/fhs-storage-signal/actions/runs/34468500012), successful for that revision.
- **Site:** [bpaje.github.io/fhs-storage-signal](https://bpaje.github.io/fhs-storage-signal/).
- **Owner acceptance:** September 10, 2026: **"Consider this as phase 1 complete."**

Pages serves static repository files. There is no application bundle build or repository-owned deployment workflow file in this baseline. Verify current Pages configuration and workflow state before publishing again; a local save does not update the site.

## Implementation history

Five implementation releases delivered this Phase 1 scope on September 10, 2026:

| Commit | Change |
| --- | --- |
| [`dc3cff8`](https://github.com/bpaje/fhs-storage-signal/commit/dc3cff87619ef3a6aff0bb14ca599465d478e370) | Populate monthly Google Ads, Meta Ads and CCStorage reporting; use direct source reporting in the existing dashboard |
| [`79e6a56`](https://github.com/bpaje/fhs-storage-signal/commit/79e6a56b85e398cb7e3d65b595711f1002064e60) | Add Google Analytics and Google Ads reporting detail tabs |
| [`4071634`](https://github.com/bpaje/fhs-storage-signal/commit/40716341b60f6b7d9a4a4dd708f5364f0b9724b2) | Add detailed Meta Ads reporting and decision insights |
| [`b4dc308`](https://github.com/bpaje/fhs-storage-signal/commit/b4dc308b3b354ba8cafa900eb7f45f2fc8e942dc) | Extend Google Ads/GA4 across elapsed 2026 with YTD |
| [`5dddd4c`](https://github.com/bpaje/fhs-storage-signal/commit/5dddd4ce09535c848d7fa722fca1bff89945846e) | Add selectable monthly metric charts across reporting tabs |

The preceding inherited commit was `a12dd66b76d256a56ef7f6c2b715e3816bc92ae2`, “Issue #57: clarify partial portfolio location coverage,” August 24, 2026. It is existing-dashboard context, not a sixth Phase 1 implementation release.

The owner explicitly approved Google/GA4 detail publication, the separate Meta expansion and the expanded January–September Google/GA4 scope. Automatic publication review required clarification when a newly expanded dataset exceeded the earlier scope; explicit approval resolved those blocks. A separate Pages availability issue was resolved after the owner restored public visibility. These events do not authorize arbitrary future publication or ad-account changes.

## Validation completed

| Layer | Evidence established | Limit |
| --- | --- | --- |
| Source reads | Authorized Google Ads/Meta/GA4/CCStorage aggregates; Meta connectivity and GA4 stream verification | Does not prove future credentials remain valid or every metric exists at every grain |
| Conversion | Google account/detail/YTD checks; GA4 pagination, coverage and privacy; Meta hierarchy and insight calculations | Public converters need private inputs and do not authenticate |
| Dataset checks | `python scripts/validate-data.py` passed | Does not explain alternate CCStorage totals or validate GA4 key-event business meaning |
| Browser checks | Tabs, periods, filters, drilldown, numeric scopes, charts, search/export and responsive behavior checked | Not an exhaustive accessibility audit or performance/load test |
| Live checks | Published data, monthly metric switching and filters verified; no browser errors reported in those checks | Does not establish automatic refresh or freshness beyond cutoff |
| Acceptance | Owner marked Phase 1 complete | Reporting scope with disclosed limits, not legacy automation |

Detailed browser automation, screenshots and extraction evidence remain private operational artifacts. This guide records their scope; it does not imply a full public browser test suite exists in this repository.

## Offline validation

```text
python scripts/validate-data.py
```

Run from the repository root with Python's standard library. No credentials or network are used. Checks include:

- Google Ads/GA4 cutoff alignment with Overview; elapsed 2026 month/YTD period sets and boundaries.
- Google account/campaign/ad-group delivery totals, conversion tolerance, unique entity rows and valid hierarchy references.
- Monthly additive Google values against independent YTD and overlapping Overview values.
- GA4 absence/coverage consistency, finite nonnegative values, engagement counts, applicable page-view reconciliation, private-path identifier exclusion and null users in the omitted-path bucket.
- CCStorage per-facility payment arithmetic.
- Meta Overview/account consistency, hierarchy spend/leads, regional unsupported categories and grouped leads, exact adjacent seven-day evidence windows.

Converters add private-input checks: Google capped-report completeness and geography labels, GA4 pagination/row counts and exact periods, and Meta normalization. A validator pass alone does not prove arbitrary input files came from an authorized source.

## Browser checklist for future changes

Serve over local HTTP so JSON fetches work. Check changed areas and shared dependencies; repeat broader checks when changes or failures justify them.

| Area | Behaviors to preserve |
| --- | --- |
| Overview | August default; June–September; all 39 facilities; storage-only brand/facility scope; missing-history and changed-coverage notes; MTD comparison suppression |
| Google Ads | January–September/YTD; account/campaign/ad-group totals; campaign drilldown; separate city/presence-interest grain; unsupported ad-group filter disabled; precision retained |
| GA4 | January unavailable; February first date; direct monthly/YTD users; dimensions/search do not change headlines or chart; private-path bucket has null users |
| Meta | Exact hierarchy totals; dimensions clear unsupported ad selection; regional n/a; source reach/frequency; account-wide insight scope |
| Monthly charts | Metric buttons update columns/table; source scope across months; YTD figure not column; missing/partial values marked; rates recomputed |
| Tables/CSV | Sorting, search, empty state, pagination, all-matching-row export, numeric rate fractions and formula safety |
| Presentation | Desktop/mobile; contained table/chart horizontal scrolling; keyboard metric controls; readable labels; no exceptions or failed loads |

Representative Meta source checks included August account spend $2,168.06 → prospecting campaign $1,856.91 → Chattanooga ad set $900.60 → ad “02” $778.45. An ad-set-grain dimension selection restores the appropriate ad-set summary. These are accepted-snapshot fixtures, not fixed expected values after refresh.

## Release procedure

1. Verify branch, working tree and remote revision; preserve unrelated work.
2. Prepare intended artifacts, date/scope metadata and public-data review. Keep credentials, raw responses and private page identifiers outside the repository.
3. Run relevant offline/browser checks and record unresolved limitations.
4. Confirm the actual publication scope is covered by the owner's applicable request/approval. Earlier approvals are historical evidence, not permanent authority for any new dataset.
5. Publish the reviewed files without overwriting unrelated remote changes. Record the commit and wait for Pages.
6. Verify deployed revision and behavior. A Git write is not a deployment check; a successful workflow is not proof of every calculation.
7. Report outcome, cutoff and material limits. Keep implementation and documentation revisions distinguishable.

If refresh/publication fails, preserve the last validated state and identify the failed step. Do not describe local preparation as publication or a stale snapshot as newly refreshed.
