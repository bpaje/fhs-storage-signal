# Leads and visitor journeys: plan (approved 2026-09-18)

Restricted, owner-only features on the private host, alongside the [Tenants tab](RENTER_LISTS_PLAN.md).
Nothing here is ever published to GitHub Pages.

## Decisions (2026-09-18)

- **Attribution exception.** Phase 1 said "no attribution". The owner has now approved linking a
  renter to a Meta lead, for identity matches only. This is not modeled allocation: no spend is
  split across facilities, and no renter is credited to a channel by estimation.
  - **Confirmed match:** the email or phone on the Meta lead equals the CCStorage customer's
    email or phone after normalization.
  - **Possible match:** same normalized full name, a move-in 0 to 60 days after the lead, and
    no confirmed match. Always labeled "Possible match - unconfirmed" and counted separately.
    Never added to confirmed totals.
- **Lead source.** The existing Meta system user gets lead access for the FHS Page, and leads
  are pulled on each refresh. Its current token has `ads_read` only (checked 2026-09-18).
- **Scope of the first build.** Both of these:
  1. Meta-lead journeys in renter profiles, plus a Leads view.
  2. A restricted Visitors tab of anonymous website journeys from the GA4 BigQuery export.

## Evidence (read-only checks, 2026-09-18, aggregates only)

- **GA4 export:** daily BigQuery export linked 2026-08-13 (dataset `analytics_515113758`). Data
  runs 2026-08-17 to 2026-09-16: 22,247 events, 3,689 visitors, 4,503 sessions. `user_id` is
  never set. 1,805 events carry a gclid and 174 page URLs carry an fbclid.
- **Event counts:** `page_view` 8,616; `begin_checkout` 945; `form_submit` 156; `generate_lead` 47;
  `contact` 27; `ccstorage_rental_completed` 4.
- **The rental event cannot be tied to a website visitor.** All 4 rental events come from one
  visitor seen only on a single `*.ccstorage.com` portal, with no main-site events. The event
  carries no lease, transaction or value parameters. CCStorage portal pages log visitor IDs
  separate from the main site's. So website journeys stay anonymous until CCStorage passes an
  identifier across (see [tracking handover](TRACKING_AUDIT_HANDOVER.md)).
- **CCStorage contact data:** 5,282 roster customers, 4,459 with an email and 4,694 with a phone
  (10 or more digits).

## Privacy rules

- CCStorage emails and phones are hashed inside CCStorage's SQL (SHA-256 of `lower(trim(email))`
  and of the last 10 phone digits). Plaintext never leaves CCStorage.
  - The hashes live only in `private-scripts/ccstorage-contact-hashes.json`, which is git-ignored.
  - A 10-digit phone hash can be reversed by brute force, so treat the hashes as personal data.
- **Meta leads:** the fetcher hashes email and phone the same way at fetch time and stores no
  plaintext contact values.
  - It keeps name, created time, campaign, ad set, ad and form IDs and names, and non-contact
    form answers such as facility, unit size and move date.
  - Contact-like answers and free text are withheld.
- **Output** goes to `data/restricted/`, which is never committed.
  - Output never contains email, phone, IP address, raw query strings or free text.
  - Visitor IDs are shown only as a short one-way hash.
  - Page URLs are stripped to the path. The only query-string values kept are UTM parameters,
    plus flags recording whether a gclid or fbclid was present.
- **Meta lead history:** Meta's API returns leads for a limited window (about 90 days). The
  fetcher merges each pull into the private source so older leads are kept. Leads older than the
  window need a one-off Leads Center CSV export.
- **Privacy policy:** the owner should confirm FHS's privacy policy covers combining ad-lead
  details with rental records.

## Build outline

1. **`private-scripts/fetch-meta-leads.ps1`** writes `meta-leads-source.json`, git-ignored.
   - **Reads:** `/{page}/leadgen_forms` and `/{form}/leads` with `created_time`, the ad, ad set
     and campaign IDs and names, `form_id`, `is_organic`, `platform` and `field_data`.
   - **Stores:** hashes in place of email and phone, as described above.
   - **Merges:** by lead ID, keeping older leads.
2. **`private-scripts/fetch-ga4-events.py`** reads the BigQuery export and writes
   `ga4-events-source.json`, git-ignored.
   - **Auth:** gcloud ADC (the cloud-platform scope, already present).
   - **Sources:** the daily `events_*` tables.
   - **Fields:** `user_pseudo_id`, `event_timestamp`, `event_name`, the session ID and number,
     path-only page location, UTM source/medium/campaign, gclid and fbclid presence, device
     category, and city.
3. **`scripts/build-journeys.py`** reads the tenants source, the contact hashes, the leads
   source, the GA4 events and `reporting.json`. It writes:
   - `data/restricted/leads-index.json`: one row per lead with match status (confirmed,
     possible, none), matched customer ID, days from lead to move-in, and whether the person
     was already a tenant when the lead arrived.
   - `data/restricted/visitors-index.json`: one row per visitor with first seen, first-touch
     source, medium and campaign, landing path, sessions, pages, key events and last seen.
   - `data/restricted/visitors-<week>.json`: event timelines, loaded on demand.
   - **Rules:** it refuses to write if the tenants source and `reporting.json` came from
     different extractions. Meta spend per campaign comes from `data/meta.json`, so cost per
     matched renter reconciles with the Meta tab.
4. **UI**, matching the Tenants tab conventions:
   - **Renter profile:** a Journey section. It shows the Meta lead (date, campaign, ad, form and
     answers), then lease signed, move-in and payments, with a confirmed or possible badge.
   - **Leads tab:**
     - Scorecards: leads, confirmed renters, possible renters, confirmed lead-to-renter rate,
       median days to move-in, and Meta spend per confirmed renter by campaign. Label that last
       one "at least", because unmatched leads may have used other contact details.
     - A leads table.
     - Clicking a lead opens a journey dialog, which links to the renter profile when matched.
   - **Visitors tab:**
     - Scorecards: visitors, sessions, new vs returning, and key events.
     - A first-touch channel mix.
     - A visitor table with filters for date, channel, landing page and "had key event".
     - Clicking a visitor opens a timeline dialog.
     - A plain note: a website visitor cannot yet be linked to a named renter.
5. **Tests** use synthetic fixtures only:
   - hash normalization parity between SQL and Python
   - confirmed vs possible match rules, including "already a tenant"
   - no plaintext contact values in any output
   - query strings stripped
   - reconciliation guard
   - headless render of the dialogs

## Owner action needed before step 1 can run

Grant the existing Meta system user lead access and save the new token locally, following the
steps given in the 2026-09-18 session. Claude never sees the token. Claude then verifies with a
read-only check that prints only permission names and form counts.
