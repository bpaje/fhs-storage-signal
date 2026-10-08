"use strict";

// The restricted Tenants, Leads and Visitors tabs must not exist on the public GitHub Pages host; unknown hosts fail open.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { isPublicHost, resolveView, RESTRICTED_VIEWS } = require("../public-host.js");

const ROOT = path.join(__dirname, "..");

function run() {
  for (const host of ["bpaje.github.io", "BPAJE.GitHub.io", "bpaje.github.io.", "github.io", "other-user.github.io"]) assert.equal(isPublicHost(host), true, host);
  for (const host of ["localhost", "127.0.0.1", "[::1]", "reports.example.test", "storage-signal.private.example", "evilgithub.io", "github.io.example.com", "bpaje.github.io.example.com", "", null, undefined])
    assert.equal(isPublicHost(host), false, String(host));

  assert.deepEqual(RESTRICTED_VIEWS, ["tenants", "leads", "visitors"]);
  for (const view of RESTRICTED_VIEWS) {
    assert.equal(resolveView(view, "bpaje.github.io"), "overview", `${view} falls back to Overview on the public host`);
    assert.equal(resolveView(view, "localhost"), view, `${view} stays available on localhost`);
    assert.equal(resolveView(view, "reports.example.test"), view, `${view} stays available on a private host`);
  }
  for (const view of ["overview", "ads", "meta", "analytics"]) assert.equal(resolveView(view, "bpaje.github.io"), view);

  // Wiring: the guard loads before app.js, runs inside switchView (every view change, including a restricted one asked for by URL),
  // removes the nav buttons on a public host, and the Overview drawer offers no tenant link there.
  const index = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  assert.ok(index.indexOf('src="public-host.js"') > 0 && index.indexOf('src="public-host.js"') < index.indexOf('src="app.js"'), "public-host.js must load before app.js");
  const details = fs.readFileSync(path.join(ROOT, "details.js"), "utf8");
  const app = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
  assert.match(details, /function switchView\(view\)\{view=publicHost\.resolveView\(view,location\.hostname\);/);
  assert.match(details, /if\(onPublicHost\)\$\$\('\.tenant-nav-item'\)\.forEach\(b=>b\.remove\(\)\);/);
  assert.match(app, /const onPublicHost=publicHost\.isPublicHost\(location\.hostname\);/);
  assert.match(app, /\$\{onPublicHost\?'':'<button type="button" class="tenant-facility-link"/);
  assert.equal((index.match(/tenant-nav-item/g) || []).length, 3, "the three restricted nav buttons are the ones removed on a public host");
  console.log("public host guard: github.io hosts public, localhost/private hosts open, restricted views fall back to Overview");
}

run();
