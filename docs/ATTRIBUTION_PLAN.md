# Attribution: proposed rule change and "Source of rentals" panel

**Status (2026-10-27): rule, naming standard, staff process and private-first build approved by the owner.**
The rule is in `CLAUDE.md`. The "Source of rentals" panel is built for the private host only (`scripts/build-sources.py`,
`sources.js`, `data/restricted/tenants-sources.json`, tests `tests/test_sources.py` and `tests/sources-render.test.js`);
it is not yet deployed. Not done: section 5 A to C (collection fixes), the Meta `RentalCompleted` pull, and any
public aggregate. Tracking and ad-account changes still need the owner's go-ahead each time.
This file is uncommitted. The repository is public: it contains aggregate counts only, no personal data.

**Refresh:** add the `/*fhs:sources*/` query to the standard extraction (see `private-scripts/assemble-sources.py`),
then run `py -3.14 scripts/build-sources.py` after `build-tenants.py`. The builder aborts if move-ins do not reconcile
to `reporting.json` per facility-month, or if the extractions are more than 24 hours apart.

## 1. Why this is being reopened

Phase 1 removed attribution on purpose: a campaign name containing a location must not become an inferred
link to a facility's payments. That decision stands for **modeled or inferred** attribution. What has
changed is that real, checkable evidence now exists, and the dashboard cannot answer "where do our renters
come from?" without it.

## 2. What the evidence looks like today (read-only checks, 2026-10-07)

| Fact | Number |
| --- | --- |
| Non-void move-ins, June to 7 Oct (39 facilities) | 797 |
| Of those, rented through online checkout | about 76 (about 10%) |
| Of those, with a marketing campaign credited in CCStorage | **0** |
| Campaigns defined in CCStorage for FHS | 2 (`fb_book_now`, `fb_text_offer`) |
| Online-checkout sessions arriving via a campaign link | 21 in Sept, 44 in Oct; none converted yet |
| Meta Instant Form leads confirmed as renters (identity match) | 4 of 459 (a lower bound) |
| Meta `RentalCompleted` events sent so far | 5 (35 more queued) |
| GA4 visitor continuity site to portal | broken: `ccstorage / link` and the site's own domain appear as traffic sources |

CCStorage already provides the mechanism: `marketing_campaigns.slug` is the permanent Campaign ID used in
`utm_campaign`; `online_rentals` records which campaign link a shopper arrived through; and
`leases.marketing_campaign_id` is the campaign credited at move-in. It is simply not being used.

Two limits shape everything else. About 90% of rentals are not online, so link tracking alone misses them.
And phone, walk-in and Instant-Form-then-call rentals have no source recorded anywhere.

## 3. Proposed rule change

**Replace** the current "no attribution" wording in `CLAUDE.md` (Product intent, Lead matching) and
`docs/CLAUDE_HANDOVER.md` (Product intent, Phase 2 note) with the following. **Not applied yet.**

> Attribution is allowed only as labeled evidence tiers. It is never modeled, estimated or inferred from names.
>
> 1. **Confirmed**: an exact normalized email or phone match between a Meta lead and a CCStorage customer
>    (existing rule; "Possible" name-plus-timing matches stay separate and unconfirmed).
> 2. **Credited**: a source recorded in CCStorage itself, meaning the campaign credited on the lease at
>    move-in, or the campaign link on the online-checkout session that became the lease.
> 3. **Platform-reported**: what Meta, Google Ads or GA4 claim, shown on that platform's own tab, labeled with
>    the platform, never merged into tiers 1 or 2.
> 4. **Not recorded**: move-ins with no evidence in tiers 1 or 2. Always shown, never hidden or reallocated.
>
> Rules: tiers are never summed into one number. Spend is never split across facilities by campaign name.
> A campaign is linked to spend only through an explicit owner-maintained mapping (slug to Meta/Google
> campaign), never by matching text. Cost per rental is shown only for tiers 1 and 2 and labeled "at least".
> Any new dataset starts on the private host; publishing it publicly needs a separate owner approval.

What stays prohibited: modeled allocation, last-touch or multi-touch estimates, crediting a channel by
campaign or ad-set name, and combining platform conversion counts into a synthetic rental or lead count.

## 4. The "Source of rentals" panel

**Where:** Overview tab, below "Storage operations". It follows the same month selector and facility filter.
**Who sees it first:** private host only. Aggregate publication is a later, separately approved step.

Illustrative layout only. The Sept figures 101 (move-ins) and 26 (online checkout) are real; every
`n` is a placeholder to be filled from data, not an estimate.

```
Source of rentals                                   [ Sep 2026 v ]  [ All facilities v ]
CCStorage move-ins (non-void)                                     101

 Evidence of source (a move-in counts once; precedence top to bottom)
 Confirmed   Meta lead matched to renter                            n
 Credited    campaign on lease at move-in                           n
             campaign link on the online checkout                   n
 Not recorded                                                       n   <- always shown
             of which rented online, no campaign link              26   (channel known, source not)

 Sources disagree (credited campaign differs from lead)             n   (flag)

 Platform-reported (each platform's own claim; not part of the above)
 Meta        RentalCompleted ......... n   (Meta's matching)
 GA4         ccstorage_rental_completed by source/medium ... (table)
 Google Ads  conversions by action ........ (existing breakdown)

 Cost per rental, at least:  by mapped campaign, tiers 1-2 only
```

Behavior rules:

1. **Precedence for the counted rows:** Confirmed over Credited over Not recorded. A move-in appears once.
2. **Disagreement flag:** if a confirmed lead and a credited campaign point to different channels, count it
   under "Sources disagree" and show both; do not pick a winner.
3. **Day-one honesty:** with 0 credited move-ins and only a handful of confirmed matches, the panel would
   show almost everything as "Not recorded" until the fixes in section 5 are adopted. That is the correct
   reading of today's data, and the panel is how adoption is measured. Rentals made through online checkout
   without a campaign link are shown as a sub-line of "Not recorded": the channel is known, the source is not.
4. **Definitions:** every row has an "i" entry in the existing definitions modal, with the tier name and
   what it does not prove.
5. **No total** is computed across tiers, and the platform-reported block has no sum.

### Data and build

| Piece | Detail |
| --- | --- |
| New CCStorage extract | Tagged `/*fhs:sources*/` query: per non-void lease, the credited campaign name/slug, online-checkout flag and campaign-link flag. Hashes and IDs only; no contact data. |
| Existing inputs | `reporting.json` move-ins, `leads-index` confirmed matches, `meta.json` spend. |
| New builder | `scripts/build-sources.py` writes `data/restricted/sources-<month>.json`. It refuses to write if the extractions differ in time, or if move-in totals fail to reconcile to `reporting.json`. |
| Meta custom event | Pull `RentalCompleted` through the Insights API. **To verify at build:** whether it surfaces as a custom event or needs a Custom Conversion created from it. |
| Mapping file | `data/sources-mapping.json`, owner-maintained: CCStorage slug to Meta campaign ID and Google campaign ID. No text matching. |
| UI | New module beside `app.js`; reuse `monthly-trend.js` conventions; no new framework. |

### Tests (synthetic fixtures only)

- tier precedence and one-row-per-move-in
- disagreement flag
- "Not recorded" equals move-ins minus tiers 1 and 2, and its online sub-line never exceeds it
- no code path sums across tiers
- reconciliation guard and extraction-time guard
- no personal data in any output
- headless render of the panel and its definitions

### Acceptance

The panel reconciles to the Overview move-in total for every facility-month; every row has a definition;
the "Not recorded" row is visible at all times; and a reviewer cannot make it show a single combined number.

## 5. Measurement work the panel depends on (before it becomes useful)

| # | Work | Owner | Notes |
| --- | --- | --- | --- |
| A | **Record the source at move-in.** Staff pick the campaign in CCStorage for phone and walk-in rentals, including Instant-Form leads who call. Log Meta leads as `rental_requests` so follow-up is measurable. | FHS operations; owner decides process | Needs a one-page staff instruction and a short "how did you hear about us" list. Claude can draft both. |
| B | **Create campaigns with a naming standard, then tag every ad link.** `utm_campaign` equals the slug. Meta: URL parameters on each ad. Google: account-level URL suffix. | Owner (Meta); **Tyler (Google Ads)** | Slugs are **permanent** in CCStorage and cannot be renamed, so agree the standard first, e.g. `<channel>_<market>_<offer>`. |
| C | **Cross-domain tracking to `ccstorage.com`.** Configure the Google tag linker so the rental event joins the original visit in GA4. | Owner (web GTM); **tell Tyler**: the linker list is shared | Verify first how the portal captures the campaign: whether ads link straight to the portal or via the site. |
| D | **Scheduled dashboard refresh.** The data is manual and stale (through 17 Sept). | Owner approves schedule | Tracked separately. |

Known data limits to keep visible: Meta pre-fills lead forms from profiles, so identity matches stay a lower
bound; GA4 has no data from 29 Sept to 7 Oct; the 216 phone-only "Fayetteville GA" leads carry no campaign.

## 6. Phasing

1. **Approve the rule** (section 3) and the naming standard. No code.
2. **Fix collection** (section 5 A to C). Weeks of real data accrue; the panel is meaningless before this.
3. **Build the panel on the private host** (section 4), with the day-one "Not recorded" reading.
4. **Review after about 4 weeks** of credited data; decide on any public aggregate and on cost-per-rental.

## 7. Decisions needed from the owner

1. Approve the rule wording in section 3 (or amend it).
2. Approve the campaign naming standard and who creates campaigns in CCStorage.
3. Decide the staff process for crediting phone and walk-in rentals.
4. Approve the cross-domain change (C) and agree how Tyler is told.
5. Confirm the first build is private-only.
