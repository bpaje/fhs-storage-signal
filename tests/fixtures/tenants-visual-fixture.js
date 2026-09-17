"use strict";

(function (root, factory) {
  const fixture = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = fixture;
  if (root) root.tenantsVisualFixture = fixture;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const facilities = [
    { id: "100", name: "Fixture Storage North" },
    { id: "200", name: "Demonstration Storage Facility With an Intentionally Long Name" },
  ];
  const unitTypes = ["10x10", "10x10x8", "10x10x10", "10 x 20", "5x5x0", "Parking", "5 X 10", "10x20x9", "15x20"];
  const days = Array.from({ length: 36 }, (_, index) => String(1 + (index * 7) % 31).padStart(2, "0"));
  const moveIns = days.map((day, index) => {
    const facility = facilities[index % facilities.length];
    return {
      company_id: facility.id,
      facility: facility.name,
      date: `2026-08-${day}`,
      customer_id: `synthetic-customer-${index + 1}`,
      customer_number: `SYN-${String(index + 1).padStart(4, "0")}`,
      name: index % 8 === 0 ? `Synthetic Tenant ${index + 1} With an Intentionally Long Display Name` : `Synthetic Tenant ${index + 1}`,
      lease_number: `SYN-LEASE-${String(index + 1).padStart(4, "0")}`,
      unit: `S-${String(index + 1).padStart(3, "0")}`,
      unitType: unitTypes[index % unitTypes.length],
      rate: String(75 + index * 3) + ".00",
      tenantStatus: "Current",
      moveInInvoice: index % 4 ? { invoice_number: `SYN-INV-${index + 1}`, total_billed: "125.00", total_paid: "125.00" } : null,
    };
  });
  const moveOuts = moveIns.filter((_, index) => index % 2 === 0).map((row, index) => ({
    ...row,
    date: `2026-08-${String(2 + (index * 9) % 29).padStart(2, "0")}`,
    move_in_date: "2026-01-15",
    tenantStatus: "Moved out",
  }));
  const payments = Array.from({ length: 68 }, (_, index) => {
    const tenant = moveIns[index % moveIns.length];
    return {
      company_id: tenant.company_id,
      facility: tenant.facility,
      date: `2026-08-${String(1 + (index * 5) % 31).padStart(2, "0")}`,
      customer_id: tenant.customer_id,
      customer_number: tenant.customer_number,
      name: tenant.name,
      payment_number: `SYN-PAY-${String(index + 1).padStart(4, "0")}`,
      payment_method: index % 2 ? "Card" : "ACH",
      status: "Complete",
      original_amount: "125.00",
      refund_amount: "0.00",
      effective_amount: "125.00",
      source: "Synthetic fixture",
    };
  });
  const pastDue = moveIns.slice(0, 12).map((row, index) => ({
    ...row,
    date: `2026-07-${String(1 + index).padStart(2, "0")}`,
    invoice_number: `SYN-DUE-${String(index + 1).padStart(3, "0")}`,
    balance_due: String(40 + index * 9) + ".00",
    days_late: 61 - index,
    tenantStatus: index % 3 ? "Current" : "Moved out",
  }));
  const rateChanges = moveIns.slice(0, 14).map((row, index) => ({
    ...row,
    date: index < 8 ? `2026-08-${String(5 + index * 3).padStart(2, "0")}` : `2026-09-${String(index + 1).padStart(2, "0")}`,
    old_rate: "110.00",
    new_rate: "125.00",
    upcoming: index >= 8,
  }));
  const profileTenant = moveIns[0];
  const profile = {
    customer_id: profileTenant.customer_id,
    company_id: profileTenant.company_id,
    customer_number: profileTenant.customer_number,
    name: profileTenant.name,
    address: "101 Synthetic Fixture Lane",
    address2: "Suite Example",
    city: "Sampleville",
    state: "GA",
    postal_code: "30001",
    alternate_contact_name: "Alternate Example",
    flags: { active_military: true, do_not_rent: false, tax_exempt: true },
    pricing_type: "Synthetic standard pricing",
    autopay: true,
    tenantStatus: "Current",
    tenantSince: "2025-10-01",
    balanceDue: "165.00",
    pastDue: "85.00",
    lifetimePaid: "1875.00",
    firstPaymentDate: "2025-10-01",
    leases: Array.from({ length: 4 }, (_, index) => ({
      lease_number: `SYN-PROFILE-LEASE-${index + 1}`,
      unit: `PROFILE-${index + 1}`,
      unitType: { name: unitTypes[index], width: "10", length: "10", amenities: ["Climate controlled", "Drive up"] },
      signedDate: "2025-10-01T10:00:00Z",
      move_in_date: "2025-10-01",
      move_out_date: null,
      scheduled_move_out: index === 3 ? "2026-09-30" : null,
      currentRate: String(125 + index * 10) + ".00",
      rateHistory: [{ effective_date: "2026-06-01", old_rate: "115.00", new_rate: "125.00" }],
      discounts: [{ discount_name: "Synthetic loyalty discount", active_start: "2026-01-01", active_end: "2026-12-31" }],
      protection: [{ plan_name: "Fixture Protection", monthly_amount: "14.00", coverage_amount: "2500.00" }],
      deposits: [{ collected_amount: "30.00", returned_amount: null }],
    })),
    payments: payments.slice(0, 18).map(row => ({ ...row, effective_date: row.date })),
    invoices: pastDue.slice(0, 10).map(row => ({
      invoice_number: row.invoice_number,
      created_at: `${row.date}T09:00:00Z`,
      due_date: row.date,
      total_billed: "125.00",
      total_paid: "40.00",
      balance_due: "85.00",
    })),
  };

  return {
    index: {
      schema: "storage-signal.tenants.v2",
      cutoff: "2026-08-31",
      balancesAsOf: "2026-09-17",
      extractedAt: "2026-09-17T12:00:00+00:00",
      facilities,
      moveIns,
      moveOuts,
      payments,
      pastDue,
      rateChanges,
      occupancyDaily: facilities.map((facility, index) => ({
        company_id: facility.id,
        facility: facility.name,
        date: "2026-08-31",
        leases: 84 + index * 17,
        auto_pay_leases: 63 + index * 12,
        storage_units: 112 + index * 21,
      })),
    },
    facility: {
      schema: "storage-signal.tenants.v2",
      cutoff: "2026-08-31",
      facility: facilities[0],
      profiles: { [profile.customer_id]: profile },
    },
  };
});
