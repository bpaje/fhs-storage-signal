"use strict";

(function (root, factory) {
  const fixture = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = fixture;
  if (root) root.journeysVisualFixture = fixture;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const leads = [
    {
      id: "lead-a1b2-c3d4",
      created_time: "2026-08-04T13:00:00Z",
      created_date: "2026-08-04",
      form: "Synthetic Storage Interest",
      campaign: { key: "campaign-one", name: "Synthetic Campaign", source: "formAds" },
      adset: "Synthetic Prospecting",
      ad: "Synthetic Creative A",
      platform: "facebook",
      organic: false,
      display_name: "Synthetic Tenant 1 With an Intentionally Long Display Name",
      answers: { preferred_location: "Fixture Storage North", storage_size: "Medium" },
      match: {
        status: "confirmed",
        label: "Confirmed via email",
        multiple: false,
        matches: [{ customer_id: "synthetic-customer-1", customer_number: "SYN-0001", company_id: "100", via: "email", timing: "moved in after lead", days_to_move_in: 8, lease_signed: "2026-08-10T09:00:00Z", move_in_date: "2026-08-12", payments: { count: 4, net: "500.00" } }],
      },
    },
    {
      id: "lead-b2c3-d4e5",
      created_time: "2026-08-10T09:30:00Z",
      created_date: "2026-08-10",
      form: "Demonstration Rental Request",
      campaign: { key: "campaign-two", name: "Demonstration Campaign", source: "lead" },
      adset: "Demonstration Ad Set",
      ad: "Demonstration Ad",
      platform: "instagram",
      organic: false,
      display_name: "Possible Renter Example",
      answers: { rental_timing: "Within a month" },
      match: { status: "possible", label: "Possible match - unconfirmed", multiple: false, matches: [{ customer_id: "synthetic-customer-2", customer_number: "SYN-0002", company_id: "100", via: "name and timing", timing: "moved in after lead", days_to_move_in: 18, lease_signed: null, move_in_date: "2026-08-28", payments: { count: 1, net: "125.00" } }] },
    },
    {
      id: "lead-c3d4-e5f6",
      created_time: "2026-08-16T11:00:00Z",
      created_date: "2026-08-16",
      form: "Synthetic Storage Interest",
      campaign: { key: "campaign-one", name: "Synthetic Campaign", source: "formAds" },
      adset: "Synthetic Prospecting",
      ad: "Synthetic Creative B",
      platform: "facebook",
      organic: false,
      display_name: "Existing Renter Example",
      answers: {},
      match: { status: "confirmed", label: "Confirmed via phone", multiple: false, matches: [{ customer_id: "synthetic-customer-3", customer_number: "SYN-0003", company_id: "200", via: "phone", timing: "already a tenant", days_to_move_in: null, lease_signed: "2025-10-01T10:00:00Z", move_in_date: "2025-10-01", payments: { count: 12, net: "1875.00" } }] },
    },
    {
      id: "lead-d4e5-f6a7",
      created_time: "2026-08-22T15:00:00Z",
      created_date: "2026-08-22",
      form: "Demonstration Rental Request",
      campaign: { key: "campaign-two", name: "Demonstration Campaign", source: "lead" },
      adset: "Demonstration Ad Set",
      ad: "Demonstration Ad",
      platform: "facebook",
      organic: true,
      display_name: "Unmatched Lead Example",
      answers: { storage_use: "Synthetic household items" },
      match: { status: "none", label: "No renter match", multiple: false, matches: [] },
    },
  ];
  const visitors = [
    { vid: "a1b2c3d4e5f6", first_seen: "2026-08-13T12:00:00Z", last_seen: "2026-08-20T12:00:00Z", sessions: 2, pageviews: 4, first_touch: { source: "google", medium: "cpc", campaign: "synthetic-fall" }, landing_path: "/storage", has_gclid: true, has_fbclid: false, device: "desktop", city: "Sampleville", region: "Georgia", key_events: { generate_lead: 0, contact: 1, form_submit: 0, begin_checkout: 0, outbound_click: 1, ccstorage_rental_completed: 0 }, portal_hosts: [], week_file: "visitors-2026-W33.json" },
    { vid: "b2c3d4e5f6a7", first_seen: "2026-08-15T14:00:00Z", last_seen: "2026-08-15T14:05:00Z", sessions: 1, pageviews: 2, first_touch: { source: "facebook", medium: "paid-social", campaign: "fixture-leads" }, landing_path: "/units", has_gclid: false, has_fbclid: true, device: "mobile", city: "Demotown", region: "Tennessee", key_events: { generate_lead: 1, contact: 0, form_submit: 1, begin_checkout: 0, outbound_click: 0, ccstorage_rental_completed: 0 }, portal_hosts: [], week_file: "visitors-2026-W33.json" },
    { vid: "c3d4e5f6a7b8", first_seen: "2026-08-17T08:00:00Z", last_seen: "2026-08-17T08:04:00Z", sessions: 1, pageviews: 0, first_touch: { source: "(direct)", medium: "(none)", campaign: "(not set)" }, landing_path: "/rent", has_gclid: false, has_fbclid: false, device: "mobile", city: "Example City", region: "Florida", key_events: { generate_lead: 0, contact: 0, form_submit: 0, begin_checkout: 1, outbound_click: 0, ccstorage_rental_completed: 1 }, portal_hosts: ["fixture.ccstorage.com"], week_file: "visitors-2026-W34.json" },
  ];
  const timelines = {
    "a1b2c3d4e5f6": [
      { ts: "2026-08-13T12:00:00Z", name: "page_view", session: "s1", host: "familyheirloomstorage.com", path: "/storage", source: "google", medium: "cpc", campaign: "synthetic-fall" },
      { ts: "2026-08-13T12:02:00Z", name: "contact", session: "s1", host: "familyheirloomstorage.com", path: "/contact" },
      { ts: "2026-08-20T12:00:00Z", name: "page_view", session: "s2", host: "familyheirloomstorage.com", path: "/locations/north" },
    ],
    "b2c3d4e5f6a7": [{ ts: "2026-08-15T14:05:00Z", name: "form_submit", session: "s1", host: "familyheirloomstorage.com", path: "/units", source: "facebook", medium: "paid-social", campaign: "fixture-leads" }],
    "c3d4e5f6a7b8": [{ ts: "2026-08-17T08:04:00Z", name: "ccstorage_rental_completed", session: "s1", host: "fixture.ccstorage.com", path: "/complete" }],
  };
  return {
    leads: {
      schema: "storage-signal.leads.v1", cutoff: "2026-08-31", balancesAsOf: "2026-09-17", extractedAt: "2026-09-17T12:00:00Z", generatedAt: "2026-09-18T10:00:00Z",
      summary: { leads: 4, confirmed: 2, possible: 1, none: 1, confirmed_new_renters: 1, already_tenants: 1, median_days_to_move_in: 8, later_leads_excluded: 0, reconciliation_note: "2026-08: 4 lead records vs 5 Meta account leads", reconciliation: [] },
      byCampaign: [{ key: "campaign-one", name: "Synthetic Campaign", leads: 2, confirmed_new_renters: 1, possible: 0, meta_spend: 250, spend_by_month: { "2026-08": 250 }, spend_per_confirmed_renter: 250, cost_label: "At least - leads may use other contact details" }, { key: "campaign-two", name: "Demonstration Campaign", leads: 2, confirmed_new_renters: 0, possible: 1, meta_spend: 180, spend_by_month: { "2026-08": 180 }, spend_per_confirmed_renter: null, cost_label: "At least - leads may use other contact details" }],
      leads,
      byCustomer: { "synthetic-customer-1": ["lead-a1b2-c3d4"], "synthetic-customer-2": ["lead-b2c3-d4e5"], "synthetic-customer-3": ["lead-c3d4-e5f6"] },
    },
    visitors: { schema: "storage-signal.visitors.v1", start: "2026-08-13", through: "2026-08-31", summary: { visitors: 3, sessions: 4, new_visitors: 2, returning_visitors: 1, key_events: {}, note: "Website visitors cannot be linked to named renters yet." }, channels: [], visitors },
    timelines,
  };
});
