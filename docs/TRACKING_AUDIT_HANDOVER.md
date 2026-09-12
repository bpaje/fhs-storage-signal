# Tracking audit handover — GTM / GA4 / Meta (session of 2026-09-12)

This is a handover for a **separate workstream from the Phase 1 dashboard** (see
[CLAUDE_HANDOVER.md](CLAUDE_HANDOVER.md)). That document covers the reporting
dashboard product. This one covers a live audit and repair of the underlying
**source tracking infrastructure** — the GTM container, GA4 property, and Meta
pixel that feed it — triggered by the owner asking "tracking is one big issue,
setup needs accuracy." Read this before touching GTM, GA4, or Meta config for
Family Heirloom Storage again.

Any agent (Claude, Codex, or otherwise) picking this up should read this whole
file before making further changes. It is written to stand alone.

## Key identifiers

| Item | Value |
| --- | --- |
| GTM account | FHSG (account ID `6326877535`) |
| GTM web container | `GTM-MPM54W98` (container ID `236807841`) — installed on `familyheirloomstorage.com` **and** natively inside CCStorage's per-facility portal pages (`*.ccstorage.com`) |
| GTM server container | Stape-hosted, `https://gsogsqey.usu.stape.io` |
| GA4 property | `[FHS] familyheirloomstorage.com`, stream `[FHS] familyheirloomstorage.com - GA4`, measurement ID `G-TCSG6BY1KK` |
| GA4 account | `[FHS] Family Heirloom Storage Group` (account ID `376664360`), property ID `515113758` |
| Meta Pixel | `1037320278787532` |
| Google Ads account | `[FHS] Family Heirloom Storage`, CID `931-884-7859` — reachable via the owner's MCC, not directly by CID search |
| CCStorage `company_id` roster | 39 facilities; full list of IDs is in chat history of this session (also derivable by querying `companies` for name patterns matching the site's "Our Family of Brands" list) |

## What this session found and fixed — all verified live on production

All three fixes below were made in GTM workspace edits, verified in GTM's live
Preview/debug mode first, then published, then **re-verified with real network
requests on the live production site** (not preview) before being called done.

1. **Duplicate GA4 tracking tag.** A tag named "Google Ads Gtag" (`Google Tag`
   type) had a GA4 measurement ID (`G-J6PMFD5C5K`) in its Tag ID field instead
   of a Google Ads conversion ID, firing sitewide for at least 7 months and
   silently duplicating every pageview into an orphan GA4 property. That
   property is **not accessible from any Google login connected to this
   account** — not in GA4, not in GTM's cross-account Google-tags search — so
   its historical data is unrecoverable. This most likely explains the
   previously-unresolved "no GA4 activity before Feb 13" gap noted in
   [CLAUDE_HANDOVER.md](CLAUDE_HANDOVER.md). **Fix:** paused the tag (and a
   second, harmless redundant tag pointed at the correct property). Verified:
   site now sends exactly one `page_view` per load, to `G-TCSG6BY1KK` only.

2. **Duplicate Meta PageView.** A `Custom HTML` tag ("FB Pixel (Custom HTML)")
   contained a hand-installed base Meta pixel snippet with no `eventID`,
   firing alongside the properly configured server-side `[Stape] Meta -
   PageView` tag. Since it carried no event ID, Meta could never deduplicate
   the two, so every PageView was double-counted. Lead/conversion events were
   confirmed unaffected (each has only one tag, no independent client-side
   duplicate). **Fix:** paused the redundant tag. Verified: exactly one
   PageView fires per load now.

3. **Broken `contact` tracking.** The trigger `click - element tel` was
   hardcoded to one literal phone number (`tel:828-817-9226`) out of dozens
   across the 39-facility portfolio, **and** used the wrong trigger type
   (`Click - All Elements`), which failed to resolve `Click URL` at all on
   this Framer-rendered site (returned an empty string — the actual click
   target is a nested `<span>`, and the generic click listener doesn't walk
   up to the real `<a href>`). **Fix:** changed the match condition to `Click
   URL contains tel:` (matches any phone link) and changed the trigger type to
   `Click - Just Links` — mirroring the already-working `click -
   outbound_link` trigger in the same container. Verified live on production
   with two different facility phone numbers (the original hardcoded one and
   an unrelated one in a different area code); both fire GA4 `contact`, Meta
   `Contact`, and the data-layer tag correctly, with no regression.

## Investigated and found NOT to be a problem — no change made

**`generate_lead` tracking.** Initially suspected of the same "hardcoded
value" bug as `contact` (trigger matches only
`https://familyheirloomstorage.com/thank-you`). On investigation this
assumption was **wrong on two counts**, and the second, deeper investigation
fully cleared it:

- The `/thank-you` URL is correctly singular by design — it's the shared
  confirmation page for one sitewide "Contact Us" form (which has its own
  `Location` facility-picker field), not something that should vary per
  facility. Unlike a phone number, one shared thank-you page is the *correct*
  design, not a bug.
- A real submission of that form was tested end-to-end (with clearly
  fake/test-marked data — see "Test data left on site" below). The redirect
  to `/thank-you` works correctly via client-side routing. In GTM's debugger,
  **all three tags** (`[Stape] DT - generate_lead`, `[Stape] Meta - Lead`,
  `[Stape] GA4 - generate_lead`) fired successfully on the `gtm.historyChange`
  event. An earlier, incomplete check had only inspected the *second*,
  near-duplicate `gtm.historyChange-v2` event (which GTM also pushes for the
  same navigation, for backward-compatibility reasons) and saw it correctly
  **not** re-fire the same tags — that's GTM behaving as designed, not a bug.
  The first production network capture that seemed to show GA4's hit missing
  was almost certainly a timing artifact (network snapshot taken too soon
  after the click), not a real gap.

**Conclusion: `generate_lead` tracking already works correctly for GA4, Meta,
and the data layer. Do not "fix" this trigger — there is nothing broken.** If
low lead-form volume (79 events portfolio-wide over ~2 months, as observed
earlier in this session) is a concern, that's a genuine-usage question, not a
tracking-accuracy one — most real customer interest likely goes through the
CCStorage rental widget instead (see next section), which this form doesn't
capture and was never meant to.

**Test data left on the live site.** Three test submissions were made through
the real `/contact` form to verify tracking end-to-end, using obviously fake
names (`TEST-IGNORE`, `TRACKING-TEST`, etc.), phone `0000000000`, emails at
`example.com`, and messages explicitly saying "TEST SUBMISSION — please
ignore ... safe to delete." Whoever monitors that inbox/CRM should delete
these three entries; they are not real leads.

## Open item — waiting on CCStorage, not something to fix locally

The real rental/booking funnel for every facility lives inside a **cross-origin
CCStorage iframe** (`*.ccstorage.com`, one subdomain per facility). GTM is
loaded natively inside those portal pages too (CCStorage's own engineering
installs it per client), which is how any tracking from inside the widget is
possible at all — see the `ccstorage_rental_completed` custom event
(`GA4 Event - CCStorage Rental Completed` tag, `CE - CCStorage Rental
Completed` trigger), which another team (an agency, "thestorageagency.com",
contact Tyler Suchman) was actively building in the 24 hours before this
session, in direct email correspondence with CCStorage's Benjamin Garber.

**Status as of this session:** the GTM side is built and tested (manually
fired the snippet, confirmed it reaches GA4). CCStorage has not yet confirmed
it's actually deployed on the real rental-confirmation page — "we haven't
seen it fire from a real rental yet," per Tyler's last message in that thread.

**A drafted (not sent) follow-up email is sitting in the owner's Gmail**, in
the thread "Re: CCStorage / FHS - Conversion Tracking." It asks CCStorage to
(1) confirm production deployment specifically for Family Heirloom (not just
the other client, Rosehill, mentioned in the same thread), (2) extend the same
dataLayer-push approach to lead-stage events (not just rental completion),
since the mechanism is proven to work, and (3) restate the ask for transaction
value/currency/ID/unit-type in the push, to enable real revenue attribution
instead of just counting rentals. **Check whether the owner has sent this
before doing further work on lead-stage tracking inside the CCStorage
portal** — if extending `contact`/`generate_lead`-equivalent tracking into the
portal is wanted, the CCStorage-side dataLayer-push pattern (not a GTM
trigger fix) is the only mechanism that can reach that cross-origin iframe.

## Architecture notes and gotchas for whoever picks this up

- **This GTM container serves 39 facilities from one shared codebase**, all
  built on the same Framer template. A fix verified on one facility page
  (e.g. a trigger type change) should generalize to all of them, but was only
  spot-checked on 2 of 39 in this session (Chattanooga, Mill Spring).
- **Framer's rendered DOM breaks GTM's generic `Click - All Elements`
  listener** for resolving `Click URL` — the actual click event target is
  often a nested `<span>`/`<div>` inside the real `<a>`/button, and the
  generic listener doesn't walk up reliably. `Click - Just Links` (GTM's
  purpose-built link listener) does. If any other click-based trigger in this
  container is found to be under-firing, check its trigger type first before
  assuming the match condition is wrong.
- **GTM pushes both `gtm.historyChange` and `gtm.historyChange-v2`** for the
  same client-side route change, in that order, on this site. Triggers built
  against the older, un-suffixed event name still work — don't assume a
  trigger referencing `gtm.historyChange` is stale just because a newer `-v2`
  event also exists.
- **This is a shared, multi-client GTM login.** The same Google account that
  manages this container also manages dozens of unrelated clients' GTM
  containers, Google Ads accounts, and a large Gmail inbox. Be careful to
  scope any exploration (search, "Google tags" lookups, etc.) to FHSG/Family
  Heirloom Storage specifically, and never touch another client's container.
- **Two known access gaps, both dead ends, don't re-investigate them:**
  the orphan GA4 property `G-J6PMFD5C5K` (unrecoverable, see above), and this
  same login's Google Ads access to CID `931-884-7859` only works by
  navigating in through the MCC hierarchy (via **Goals → conversion actions**
  after landing in the account), not by searching for the CID or account name
  directly in the account picker.
- **`rental_requests` and `portal_requests` (CCStorage tables) are not usable
  as lead-volume ground truth.** They are near-empty, experimental features
  (12 rows and 2 rows respectively, platform-wide, across all of CCStorage's
  clients) — not a systematic lead-capture pipeline. Don't reach for them
  again as a workaround for tracking gaps.

## Current GTM container state (as of end of this session)

All changes below are **live and published** (workspace merged into the
container's live version, not sitting in a draft):

- `click - element tel` — trigger type `Click - Just Links`, condition `Click
  URL contains tel:`. Feeds `[Stape] DT - contact`, `[Stape] GA4 - contact`,
  `[Stape] Meta - Contact`.
- `Google Ads Gtag` — **paused**.
- `Google Tag-G-TCSG6BY1KK` — **paused** (redundant, not broken; consolidated
  onto `[Stape] GA4 - _Config` as the single source for that property).
- `FB Pixel (Custom HTML)` — **paused**.
- `dom - lead_event_page`, `historyChange - lead_event_page` — **unchanged**,
  confirmed working correctly, do not touch without re-reading the
  investigation above first.
- `GA4 Event - CCStorage Rental Completed` / `CE - CCStorage Rental
  Completed` — built by another team (thestorageagency.com), not touched or
  audited in depth by this session beyond confirming its existence and
  purpose.

## Recommended next steps, roughly in priority order

1. **Chase the CCStorage email thread** — either send the drafted follow-up
   sitting in Gmail, or check if it's already been sent and look for a reply.
   This is the actual bottleneck for lead-stage tracking inside the rental
   widget, which is where most real customer activity likely happens.
2. **Spot-check the `contact` fix on a handful more of the 39 facility
   pages** if a higher confidence bar than 2/39 is wanted before considering
   it fully closed.
3. **Delete the three test contact-form submissions** left on the live site
   during this session's verification (see "Test data left on site" above).
4. Nothing else is currently known-broken in this container. Do not go
   looking for more problems speculatively — audit further only if a new,
   concrete symptom shows up (e.g. a specific metric looking wrong in the
   dashboard) rather than continuing an open-ended sweep.
