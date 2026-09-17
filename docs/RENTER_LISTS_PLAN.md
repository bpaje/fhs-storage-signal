# Tenants tab: plan (v2, approved 2026-09-17)

Supersedes the v1 "named lists behind Overview cards" build. The owner reviewed v1 and found it
too crunched. v2 moves the named data to its own tab.

Split of work: Claude plans, extracts CCStorage data and verifies independently. Codex writes
the code from [the brief below](#codex-brief).

## Owner decisions

- **Hosting:** Hostinger behind Basic Auth, owner login only. Wider access needs the owner's
  re-confirmation first. The public GitHub Pages site never receives restricted data.
- **Overview:** reverts to plain KPI cards. Clicking a facility name still opens the facility
  side panel, which gains one link: "View tenants at this facility".
- **New "Tenants" tab:**
  - A filter bar (facility, date range, search by name, customer #, lease # or unit) with a
    "Data through {cutoff}" badge.
  - Clickable scorecards: move-ins, move-outs, net change, collected, past due, occupancy.
  - A weekly move-ins vs move-outs trend and a unit-size mix pie.
  - An activity table with move-ins, move-outs, payments, past due and rate changes.
- **Scorecard click:** opens a large centered dialog listing the underlying records with IDs.
- **Name click:** swaps the dialog content to the renter profile, with a "Back to {list}"
  link. Dialogs never stack.
- **Profile contents:** everything except phone and email, including address, alternate
  contact name and account flags.
- **Also excluded, as Claude's security call (owner may override):**
  - gate access codes (`pac_codes`)
  - free-text notes (customer, unit, deposit)
  - email and SMS bodies, and document contents
  - alternate contact phone and email

## Status 2026-09-17: v2 built by Codex, verified and fixed by Claude, uncommitted, not deployed

**Bugs Claude found that Codex's tests missed, all fixed:**

1. `tenants.js` checked `globalThis.detail`, but `details.js` declares `const detail`, which
   never lands on `globalThis`. The tab stuck on "Loading…" forever. It now checks the
   visibility of `#tenants-view`.
2. Real CCStorage `unit_types.amenities` is a comma string, while the UI called `.join()` on it,
   so every profile failed with "Tenant data isn't available". The builder now splits it into
   a list.
3. A null `security_deposits.returned_amount`, which is common in real data, crashed the build.
   It is now optional.
4. An empty alternate contact rendered as "Name withheld". It is now null ("Not recorded").
5. The past-due lease lookup scanned every invoice link per invoice. It now uses a precomputed map.
6. Output JSON is compact, which shrank the synthetic index from 8.9 MB to 6.6 MB.

**Verified, using a full-scale synthetic source with fake names:**

- **Source size:** 2,880 customers, 13,722 payments, 5,603 invoices.
- **Reconciliation:** every facility and month matches `reporting.json`, and all 40 files
  build in about 2 seconds.
- **Profiles:** all 2,880 render without error.
- **HTML injection:** a name like `<img onerror>` is escaped and no element is created. Email-
  and phone-like names show "Name withheld".
- **Browser flows at 1440px:** facility panel to "View tenants" to the filtered tab. The Bartow
  August scorecards equal the published figures, All facilities August shows 135 move-ins,
  and presets and search work. The past-due dialog shows IDs, splits current from moved out,
  and its totals match. Name click opens the profile, and Back returns to the list.
- **Phone at 375px:** the dialog is full-screen, the page does not scroll sideways, and
  tables and the chart scroll inside their own containers.
- **Test suite:** the 5 Python tests, the headless render check and `validate-data.py` pass.

**Polish round, 2026-09-18: Codex implemented, Claude verified. All items below are done.**

- **Tests:** 9 Python tests plus 2 Node test files pass. Claude re-reverted the amenities fix
  and the `globalThis.detail` wiring fix independently, and the tests failed each time.
- **Browser, full-scale synthetic data:**
  - The profile header shows "Customer #…".
  - Move-out reads "Still renting" or "Scheduled …".
  - A deposit that was not returned reads "Not returned".
  - "Filtered by search" shows on all 6 scorecards and in the dialog, and clears with the search.
  - Focus returns to the originating scorecard after list, then profile, then back, then close,
    and after Escape.
  - All 2,880 profiles render. The HTML-injection name creates no elements. August move-ins
    still total 135.

**Original polish backlog, now done:**

- Add regression tests for bugs 1 to 3 above. The headless test only renders strings; it never
  opens the tab or a profile.
- Profile header shows the bare customer number; it should read "Customer #…".
- A current tenant's "Move-out / scheduled" should read "Still renting", not "Not recorded".
- A deposit that was not returned should read "Not returned", not "n/a returned".
- Search also narrows the scorecards, so show "Filtered by search" on the cards when a search
  is active.
- Focus return to the scorecard after closing the dialog could not be confirmed in the
  background preview; recheck in a focused browser.

## Design pass and second deploy, 2026-09-18

The owner's first look at the live Tenants tab: "this looks horrible". Codex ran a
Tenants-only visual pass; Claude verified it in a real browser and deployed.

**Root cause of the washed-out look:** the Tenants filter bar was sticky at `top: 34px`
under a ~93px ribbon plus header, `z-index: 18`, translucent white with backdrop blur and a
large shadow. Scrolling put it over the scorecards, which both greyed the content and clipped
the cards. It is now non-sticky and solid, and the dialog's backdrop blur is gone.

**Also fixed:**

- **Weekly chart:** fills the panel, one bar pair per week including zero weeks, y-axis with
  gridlines and values, labels like "Aug 17", centred single-week layout.
- **Unit-size mix:** normalized to the floor footprint for the chart only ("10x10x8" →
  "10x10", "10 x 20" → "10x20", "5x5x0" → "5x5"), top 5 plus Other. Tables keep the raw type.
- Tenant-name buttons aligned to the row baseline; numbers right-aligned; equal card heights;
  long-name truncation; focus rings; profile Back button moved into the dialog header.
- **Claude's own deploy bug:** `deploy-hostinger-fhs.ps1` read `index.html` with
  `Get-Content -Raw`, which uses the ANSI codepage on Windows PowerShell and double-encoded
  every glyph, so the live sidebar showed "âŒ‚" and "Â·". It now uses
  `[IO.File]::ReadAllText(..., UTF8)`, verified by a round-trip byte comparison.
- Mojibake in Codex's own `tests/fixtures/tenants-visual.html` was repaired.

**Verification:** 11 Python tests, both Node test files, `validate-data.py` and
`node --check` all pass. Claude viewed the synthetic fixture harness
(`tests/fixtures/tenants-visual.html`, plus `?mode=list` and `?mode=profile`) in a real
browser at ~1470px and at phone width. No real renter data was screenshotted.

**Second deploy (app only; the 40 tenant files were untouched):** all app files, assets, the 4
dashboard data files and `index.html` at `v=a178e069`. The server copy of `index.html` has 0
mojibake markers and its 21 real glyphs. `sizes`: 54 files, 0 mismatches. Cache cleared.
Post-deploy, `/`, `/index.html`, `/tenants.js` and `/data/restricted/tenants-index.json` all
return `401` with no auth and with a wrong login.

**Still owner-only to confirm:** the authenticated `200`, the look on their own screen and
phone, and whether JSON is served compressed (`Content-Encoding` in DevTools).

## First Hostinger deploy, 2026-09-18: DEPLOYED to https://fhs.attributionsignal.com

**What was done:**

1. **Login replaced.** The owner ran `set-fhs-password.ps1` in their own terminal; Claude
   checked only that the file holds a single apr1 entry, never its content. Uploaded
   `.htpasswd`, then the hardened `.htaccess`, which adds `Options -Indexes` from the live file
   (backup: `private-scripts/deploy-backups/htaccess-live-20260918-011056.txt`). No `500`.
2. **App uploaded.** All app files, assets and the 4 dashboard data files, then `index.html`
   cache-busted at `v=67c5100a`.
3. **Tenant files uploaded:** all 40 `data/restricted/tenants-*.json`, last.
4. **Sizes checked.** `sizes` shows 54 files and 0 mismatches between server and local.
5. **Cache cleared** with `hosting_clearWebsiteCacheV1` for `fhs.attributionsignal.com`.

**Verified with cookie-less `curl`:**

- **Refused without a valid login:** `/`, `/index.html`, `/tenants.js`, `/data/reporting.json`
  and `/data/restricted/tenants-index.json` / `tenants-1140.json` return `401` both with no
  auth and with a wrong login.
- **Blocked outright:** `/data/restricted/` and `/.htpasswd` return `403`.
- **Tenant file headers:** `Cache-Control: private, no-store, max-age=0`, `Pragma: no-cache`,
  `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex, nofollow`.
- **Public GitHub Pages:** `/data/restricted/tenants-index.json` returns `404`.

**Not yet verified (needs the owner's login):**

- the authenticated `200`
- the Tenants tab loading on desktop and phone
- whether `mod_deflate` actually compresses the 14.5 MB index; check `Content-Encoding` in
  browser DevTools

**The private site now shows** the 2026-09-17 CCStorage revisions (e.g. August net
$467,756.34). Public GitHub Pages is unchanged; `data/reporting.json` and all code are still
uncommitted.

## Hostinger deploy preparation, 2026-09-18 (historical)

**Current state:**

- **Site:** `https://fhs.attributionsignal.com` already exists and is gated. Unauthenticated
  requests to `/`, `/data/reporting.json` and `/data/restricted/tenants-index.json` all return
  `401 Basic realm="FHS Signal - Private"`. It was set up 2026-09-11.
- **Login:** the owner does not have the existing login, so it will be replaced.
- **Deploy approval:** the owner approved the deploy once the Hostinger connector is
  reconnected. In this session it was invalidated: "reconnect it from connector settings".

**Prepared (all git-ignored except the `.htaccess` template):**

- **`private-scripts/set-fhs-password.ps1`:** the owner runs it. It prompts for a username and
  password in their own terminal, hashes with OpenSSL apr1, and writes only the hash to
  `private-scripts/.htpasswd-fhs`. Claude never sees the plaintext.
- **`private-scripts/hostinger-fhs.htaccess` (kept out of this public repo: it holds the absolute server path):**
  - Basic Auth with the same `AuthUserFile` pattern as Foxbury
  - `X-Robots-Tag: noindex` site-wide
  - `Cache-Control: private, no-store`, `Pragma: no-cache` and `Referrer-Policy: no-referrer`
    on `tenants-*.json`
  - `mod_deflate` for JSON, HTML, CSS and JS, inside an `IfModule` guard
- **`private-scripts/deploy-hostinger-fhs.ps1`:** phases `inventory`, `backup-htaccess`,
  `htpasswd`, `htaccess`, `app` (content-hash cache-busted `index.html`), `restricted`
  (refuses to run if tracked in git) and `sizes`.

**Run order:**

1. `inventory`, then `backup-htaccess`.
2. `htpasswd`, then `htaccess`. Immediately `curl` the site without credentials: expect `401`
   plus the headers. On a `500`, re-upload the saved live `.htaccess` at once.
3. `app`.
4. `restricted`.
5. `sizes`. Then no-auth and wrong-password `401` checks on `/` and the tenant files.
6. The owner confirms their own login with a `200`.

## Real data pull, 2026-09-18: done locally, verified, uncommitted, not deployed

**How the data was pulled:**

- **Tags:** every CC-Storage MCP `run_sql` call starts with a tag comment (`/*fhs:clock*/`,
  `/*fhs:agg:<name>*/`, `/*fhs:t:<name>[:gN]*/`).
- **Large results:** results over the token limit are saved automatically by Claude Code to
  the session's `tool-results/` folder, so they never enter the conversation.
- **Assembly:** `private-scripts/assemble-ccstorage-from-transcript.py` reads each tagged
  result verbatim, either inline from the session `.jsonl` or from the saved file. Nothing is
  re-typed, and the latest call per tag wins.
- **Chunking:** payments, invoices and invoice-lease links were pulled in 4 facility groups to
  stay under CCStorage's 5 s query limit.

**The pass:**

- **Timestamps:** extractedAt `2026-09-17T16:50:55.562+00:00` for both source files; activity
  cutoff 2026-09-09, matching the published Google and Meta window.
- **Tables:** 5,280 customers, 6,085 leases, 46,906 non-void invoices (the same as the direct
  count), 33,598 payments, 37,041 invoice-lease links, 2,073 rate changes, 5,298 protection
  rows, 3,289 daily occupancy rows.
- **Monthly check:** for every month, net from `financial` equals independent status-level net.

**Local refresh was already broken.** `private-scripts/meta-complete-source.json` was
re-pulled through 2026-09-11, but `google-report.json` only goes through 2026-09-09. Both
`build-reporting.py` and `build-meta.py` have failed their assertions since the
2026-09-11 refresh attempts (see `refresh-logs`), so they cannot run. Instead,
`private-scripts/refresh-cc-fields.py` replaced **only** the CCStorage fields in
`data/reporting.json`, using `build-reporting.py`'s own `money()` and the same row logic.
The diff shows no Google, Meta or period-bound changes. `validate-data.py` passes.

**CCStorage revisions this puts into `reporting.json`** (not yet published):

| Month | Net before | Net now | Move-ins |
| --- | --- | --- | --- |
| June | $374,747.87 | $374,641.87 (a $106 ACH return) | 207 |
| July | $425,911.92 | $425,702.84 (a $209.08 ACH return) | 311 |
| August | $467,763.25 | $467,756.34 | 135 → 134 (one lease voided) |
| Sept 1–9 | $324,306.85 | $334,094.14 (late-posted payments) | 23 → 24 |

**Fixes made during the real build**, each with a mutation-checked test (11 Python tests pass):

1. **Contact details in address fields.** Staff had typed phone numbers into `address2` for 3
   customers. `address`, `address2` and `city` are now withheld when they are email- or
   phone-like.
2. **Balance date.** Past due, days late, tenant status and "upcoming" rate changes now use
   the extraction date (`balancesAsOf`), not the activity cutoff. The balances are
   CCStorage's current state, so labelling them "as of Sept 9" was wrong. Past due is now
   $204,054.36 across 743 tenants as of 2026-09-17, consistent with the live query.

**Verified on real output (counts only; no names shown or screenshotted):**

- **Reconciliation:** every facility and month matches, and all 40 files build in about 4.5 s.
- **August:** Tenants tab and Overview agree on 134 move-ins, 251 move-outs,
  $467,756.34 from 3,367 payments, and 72.2% occupancy (4,756 of 6,587 units).
- **Move-in invoices:** 126 of 134 August move-ins have one.
- **Profiles:** all 5,280 render with no failures and no injected elements. Every customer in
  the index has a profile.
- **Contact details:** zero email-like or phone-like strings remain in any restricted file.
- **Size:** the index is 14.5 MB and all files total 35 MB. **Hostinger must serve JSON with
  gzip or deflate.**

**Where data now sits locally:**

- **Real renter data:** `data/restricted/` and `private-scripts/ccstorage-tenants-source.json`,
  both git-ignored.
- **Raw query results:** `C:\Users\Basil\.claude\projects\...\tool-results\` also holds
  them. Treat that folder as sensitive and delete it once the data is no longer needed for
  a rebuild.

**Next:** Hostinger deploy behind Basic Auth (owner go-ahead needed). Separately, publishing
the revised public numbers needs a decision, plus a fix for the Google/Meta source mismatch
before `refresh-dashboard.ps1` can run again.

## Blocker 2026-09-18 (resolved same day, see above): the CC-Storage MCP can't carry a full tenant extract

**What was tried:**

- `run_sql` returns rows inline into the Claude conversation. A single-column query of 813
  payment IDs for one facility took about 30k tokens.
- The full extract is about 47k invoices, 34k payments, 6k leases and 5k customers, each with
  many columns. That means millions of tokens, and every row would then need re-typing into a
  file, which risks transcription errors in financial records. **Rejected.**
- `list_custom_reports` rejects `company_id` as "not an integer" (the MCP stringifies it), and
  `get_action_catalog` returns "Not authorized". No export-to-file path was found.
- The small aggregate extract (`ccstorage-source.json`) still works through the MCP.

**Paths forward (owner decision):**

1. **Headless read-only access from CCStorage (recommended).** Ask CCStorage (Benjamin Garber,
   already in contact) for API or read-only database credentials usable by a local script. A
   private fetcher then writes straight to `private-scripts/ccstorage-tenants-source.json`,
   with nothing passing through chat. This is also the prerequisite for scheduled refreshes.
2. **CCStorage built-in CSV exports.** The owner, or Claude with per-download permission,
   downloads rent roll, payments and invoices exports, and a converter maps them to the source
   contract. This depends on those exports carrying the needed IDs and fields. It's manual each
   refresh.
3. **Reduced scope through the MCP.** Only small lists (move-ins and move-outs, roughly 700 rows
   for June to September, plus a past-due summary), without full payment and invoice history in
   profiles. This keeps the existing reconciliation but drops what the owner asked for.

## Data facts (live checks, 2026-09-17, 39-facility roster)

- **Volume:**
  - 5,280 customers.
  - 6,085 leases, 4,436 of them active.
  - 33,593 payments, the first dated 2024-12-31.
  - 46,906 non-void invoices, of which 2,893 are past due: $204,703.64 across 747 customers.
    This likely includes vacated tenants, so past due is split into current tenants and
    moved out.
  - 2,073 rate changes.
- **History depth:** payments and invoices start only when each facility joined CCStorage,
  and most facilities joined around Oct 2025. Lease move-in dates go back further, because
  migrated leases carry their real dates. For migrated customers, `customers.created_at` is
  the migration date, so "Tenant since" is the earliest lease move-in, not `created_at`.
- **No fixed term:** leases are month-to-month. "Term" means billing interval plus length of stay.
- **Daily occupancy:** `occupancy_by_date_and_company` has daily leases and storage units per
  facility, so the occupancy scorecard uses the range end date.
- **August reconciliation (v1 test):** payment counts match the published figures exactly.
  Current data shows one fewer move-in (134, published 135) and net payments $6.91 below the
  published figure, both from changes made after the 2026-09-10 extraction. So restricted
  files and the public aggregates **must come from the same extraction**.
- **Net definition:** net payments are `effective_amount` summed over the statuses Complete,
  Manually Entered, Partially Refunded and Refunded.
- **Move events:** a move-in or move-out is a non-void lease whose `move_in_date` or
  `move_out_date` falls in the period. These count lease events, not people.

## Risks guarded in code

- `private-scripts/refresh-dashboard.ps1` stages `data/` and pushes to the public repo. All
  restricted output goes to `data/restricted/`, which is git-ignored as a directory. The
  refresh script and `validate-data.py` both fail if anything under `data/restricted/` is
  tracked.
- The build aborts if the source `extractedAt` differs from `reporting.json`'s `ccExtractedAt`.
- The build aborts if any facility-month reconciliation fails: move-ins, move-outs, payment
  count and net to the cent, and period-end occupancy leases and units.
- Name cleaning withholds any name or alternate contact name containing `@` or 7 or more digits.
- The UI offers no CSV or export of restricted data.

## Sequence

1. **Codex, local only:** remove v1, build v2 against a synthetic fixture, add tests. No commit, no deploy.
2. **Claude:** independent code review, a full-scale synthetic run and a browser check at 1440px and 375px.
3. **Claude:** a real extraction through the CC-Storage MCP. It covers both
   `ccstorage-source.json` and `ccstorage-tenants-source.json` in one pass, followed by the
   full dashboard rebuild. Needs the owner's go-ahead.
4. **Deploy:** Hostinger setup under Basic Auth, with no-store on `data/restricted/`, then the
   owner's logged-in check. Needs the owner's go-ahead.

<a id="codex-brief"></a>
## Codex brief

```text
Repository: D:\Documents\Clients\Family Heirloom Storage\FHS Storage Signal Reporting
Read first: CLAUDE.md, README.md, docs/DATA_AND_OPERATIONS.md, docs/VALIDATION_AND_RELEASE.md,
docs/RENTER_LISTS_PLAN.md (this plan; follow it exactly). UX reference only (read, never modify):
D:\Documents\Clients\Foxbury Dental\foxbury-signal.

Hard rules: no commit, push, deploy, or running private-scripts/refresh-dashboard.ps1. No network
or source APIs. Only synthetic names in fixtures (use obviously fake names). Keep plain HTML/CSS/JS,
no build step, no new runtime dependencies. Match the existing visual system in styles.css.

0. Remove v1 (uncommitted work you did earlier): the Overview card buttons and restricted list UI
   in app.js/index.html/styles.css, scripts/build-renter-lists.py, tests/test_renter_lists.py,
   tests/renter-lists-render.test.js and its fixtures. Overview KPI cards return to plain display.
   Keep and adapt scripts/restricted_data_guard.py.

1. Guards: .gitignore `data/restricted/` and `private-scripts/ccstorage-tenants-source.json`
   (drop the v1 renter-lists entries). restricted_data_guard.py fails if
   `git ls-files -- data/restricted` returns anything; validate-data.py calls it; in
   refresh-dashboard.ps1 fail before staging if anything under data/restricted is tracked and
   stage with `git add -- data/ ':(exclude)data/restricted'`.

2. Source contract (Claude will produce the real file; build a synthetic one matching it):
   private-scripts/ccstorage-tenants-source.json =
   { extractedAt, cutoff,
     customers:[{id,company_id,customer_number,name,address,address2,city,state,postal_code,
       alternate_contact_name,active_military,do_not_rent,tax_exempt,pricing_type}],
     leases:[{id,company_id,lease_number,customer_id,storage_unit_id,unit_name,unit_type,
       storage_unit_type_id,move_in_date,move_out_date,scheduled_move_out,next_bill_date,
       cash_price,billing_interval,void,auction_date}],
     unitTypes:[{id,company_id,name,amenities,length,width}],
     leaseSigned:[{lease_id,accepted_at}],
     rateChanges:[{lease_id,old_rate,new_rate,effective_date,applied_at}],
     leaseDiscounts:[{lease_id,discount_name,active_start,active_end}],
     leaseProtection:[{lease_id,plan_name,monthly_amount,coverage_amount,active_start,active_end}],
     securityDeposits:[{lease_id,collected_amount,returned_amount,collected_at,returned_at}],
     autopay:[{customer_id,active}],
     invoices:[{id,company_id,invoice_number,customer_id,total_billed,total_paid,balance_due,
       due_date,created_at}],            (non-void only)
     invoiceLeases:[{invoice_id,lease_id}],
     payments:[{id,company_id,payment_number,customer_id,payment_method,status,original_amount,
       refund_amount,effective_amount,effective_date,source}],
     occupancyDaily:[{company_id,date,leases,auto_pay_leases,storage_units}] }
   Money arrives as decimal strings; use Decimal, never float math, when summing.

3. Builder: scripts/build-tenants.py <tenants-source.json> <data/reporting.json>
   Writes atomically, only after all checks pass, to data/restricted/:
   - tenants-index.json: { schema, cutoff, extractedAt, facilities:[{id,name}],
       moveIns:[...], moveOuts:[...], payments:[...], pastDue:[...], rateChanges:[...],
       occupancyDaily:[...] }  -- light rows with company_id, date, customer_id, customer_number,
       display name, lease_number/unit/unit type/rate where relevant, amounts, status.
       Move-in rows include move-in invoice (earliest non-void invoice linked to the lease:
       total_billed, total_paid) or null.
       pastDue rows = non-void invoices with balance_due > 0 and due_date <= cutoff; include
       days_late = cutoff - due_date and tenantStatus "Current" or "Moved out" (customer has
       no active non-void lease as of cutoff).
       rateChanges rows = all, flag upcoming when effective_date > cutoff.
   - tenants-<company_id>.json per facility: full profiles keyed by customer_id: identity
       (customer_number, name, address fields, alternate_contact_name, flags, pricing_type),
       autopay active, tenantSince = earliest lease move_in_date, balance due (sum of open
       non-void balances), past-due total, lifetime paid in CCStorage + first payment date,
       leases (with signed date, rate history, discounts, protection, deposits, unit type
       dimensions/amenities), invoices, payments.
   Checks (exit 1, print diffs, write nothing on any failure):
   - source.extractedAt == reporting.ccExtractedAt.
   - For every reporting period and facility: moveIns, moveOuts, payments count, net (to the
     cent) derived from the source equal reporting.json; period-end occupancy leases and
     storage units from occupancyDaily equal reporting.json where reporting has values.
   - Definitions exactly as the plan's "Data facts" section and scripts/build-reporting.py.
   - Name cleaning withholds names/alternate contact names containing '@' or 7+ digits.
   - Output must not contain any key named email, phone, phone_number, notes, code, pac.

4. UI:
   - Sidebar: add "Tenants" tab with a small "Restricted" marker. Fetch
     data/restricted/tenants-index.json lazily on first open (cache: "no-store"); facility files
     lazily when a profile is opened. On 404/401/network failure show "Tenant data isn't
     available on this site." and leave every other tab working.
   - Facility side panel (openFacility) gets a "View tenants at this facility" link that opens
     the Tenants tab filtered to that facility and the current Overview period.
   - Tenants tab layout, top to bottom:
     a) Sticky filter bar: facility select (All + roster), date range with presets (This month,
        Last month, Last 7 days, Last 30 days, Custom from/to bounded to data coverage), search
        (name, customer #, lease #, unit), "Data through {cutoff}" badge.
     b) Scorecards (buttons): Move-ins, Move-outs, Net change (ins - outs), Collected (net
        payments, with count), Past due (amount, tenants; as of cutoff, ignores date range and
        says so), Occupancy (at range end, from occupancyDaily; "No data" when missing).
     c) Charts row: weekly move-ins vs move-outs columns for the range; unit-size mix pie of
        move-ins (group beyond 5 sizes into "Other"). No chart library; inline SVG ok.
     d) Activity table with sub-tabs: Move-ins, Move-outs, Payments, Past due (current tenants
        and moved out separated), Rate changes (recent in range and upcoming). Sortable,
        paginated (50/page), names are buttons.
   - Scorecard click opens a large centered <dialog> (max ~1100px wide, full-screen on phones)
     listing the underlying rows with IDs (customer #, lease #, payment # / invoice #), a
     search box, count and totals that equal the scorecard.
   - Name click swaps dialog content to the profile with "Back to {list title}" (keep filters
     and scroll). Profile: header (name, customer #, facility, Current/Moved out, flags),
     stat tiles (balance due, past due, autopay, lifetime paid since {first payment date},
     tenant since), address and alternate contact name, leases table (lease #, unit, size and
     amenities, signed, move-in, move-out/scheduled, current rate, rate history, discounts,
     protection plan, deposit), payments table, invoices table (open balances first).
     State plainly: "Payment history starts when this facility joined CCStorage."
   - Escape/close returns focus to the triggering element. Keyboard reachable throughout.
     No export/CSV/print controls for restricted data. Empty results: "No matching records."
   - Must work at 1440px and 375px without horizontal page scroll (tables scroll in their own
     container).

5. Tests (synthetic fixtures only): reconciliation mismatch aborts without writing (mutation
   check), extractedAt mismatch aborts, name cleaning, forbidden keys absent, past-due and
   tenantStatus logic, move-in invoice null case, git guard for data/restricted, and a headless
   render check that the Tenants tab, scorecard dialog, and profile render against the fixture
   and that no names appear outside the Tenants tab and its dialog.

6. Run `py -3.14 scripts/validate-data.py`, `node --check` on changed JS, and all new tests.
   Report changed/removed files, test output, and anything unverified. Leave everything
   uncommitted.
```
