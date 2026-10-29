"use strict";

// The restricted Tenants, Leads and Visitors tabs, and the Google Ads Watch list and Keywords tabs, exist only on the
// private host. Unknown hosts fail open on purpose: only the public GitHub Pages site (bpaje.github.io) is treated as
// public, so the owner is never locked out.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.publicHost = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const RESTRICTED_VIEWS = ["tenants", "leads", "visitors", "watch", "keywords"];

  function isPublicHost(hostname) {
    const host = String(hostname ?? "").trim().toLowerCase().replace(/\.$/, "");
    return host === "github.io" || host.endsWith(".github.io");
  }

  function resolveView(view, hostname) {
    return isPublicHost(hostname) && RESTRICTED_VIEWS.includes(view) ? "overview" : view;
  }

  return { RESTRICTED_VIEWS, isPublicHost, resolveView };
});
