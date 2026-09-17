"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
const source = fs.readFileSync(path.join(ROOT, "tenants.js"), "utf8");
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "tenants-ui.json"), "utf8"));
const visualFixture = require(path.join(__dirname, "fixtures", "tenants-visual-fixture.js"));

function tick() {
  return new Promise(resolve => setImmediate(resolve));
}

async function classicScriptLoadProbe(scriptSource) {
  let resolveFetch;
  const response = new Promise(resolve => { resolveFetch = resolve; });
  const root = {
    innerHTML: "",
    querySelector() { return {}; },
    querySelectorAll() { return []; },
  };
  const elements = {
    "tenants-root": root,
    "tenants-view": { classList: { contains: () => false } },
    "mode-ribbon": { textContent: "" },
    "snapshot-label": { textContent: "" },
    "footer-note": { textContent: "" },
  };
  const context = vm.createContext({
    console: { warn() {} },
    document: {
      activeElement: null,
      getElementById(id) { return elements[id] || null; },
    },
    fetch() { return response; },
    clearTimeout,
    setTimeout,
    requestAnimationFrame(callback) { callback(); },
  });

  vm.runInContext('"use strict"; const detail = { view: "tenants" };', context);
  vm.runInContext(scriptSource, context, { filename: "tenants.js" });
  assert.equal(context.detail, undefined, "top-level const must not become globalThis.detail");

  context.tenantDashboard.render();
  assert.match(root.innerHTML, /Loading restricted tenant data/);
  resolveFetch({ ok: true, json: async () => fixture.index });
  await tick();
  await tick();
  return root.innerHTML;
}

function testFocusRefind() {
  const tenants = require(path.join(ROOT, "tenants.js"));
  const oldScorecard = { isConnected: false, dataset: { tenantScorecard: "payments" }, focus() {} };
  const newScorecard = { dataset: { tenantScorecard: "payments" }, focus() {} };
  const otherScorecard = { dataset: { tenantScorecard: "moveIns" }, focus() {} };
  const heading = { focus() {} };
  const documentObject = {
    querySelectorAll(selector) {
      if (selector === "[data-tenant-scorecard]") return [otherScorecard, newScorecard];
      return [];
    },
    querySelector() { return heading; },
  };
  assert.equal(tenants.findDialogReturnTarget({ element: oldScorecard, key: { kind: "scorecard", scorecard: "payments" } }, documentObject), newScorecard);

  const oldProfile = { isConnected: false, focus() {} };
  const wrongCompany = { dataset: { tenantProfile: "customer-1", tenantCompany: "200" }, focus() {} };
  const newProfile = { dataset: { tenantProfile: "customer-1", tenantCompany: "100" }, focus() {} };
  documentObject.querySelectorAll = selector => selector.includes("tenant-profile") ? [wrongCompany, newProfile] : [];
  assert.equal(tenants.findDialogReturnTarget({ element: oldProfile, key: { kind: "profile", profile: "customer-1", company: "100" } }, documentObject), newProfile);
  assert.equal(tenants.findDialogReturnTarget({ element: oldProfile, key: null }, documentObject), heading);
  console.log("dialog focus return re-find checks passed");
}

async function run() {
  const rendered = await classicScriptLoadProbe(source);
  assert.match(rendered, /tenant-filter-bar/);

  const tenants = require(path.join(ROOT, "tenants.js"));
  const visualView = tenants.createInitialView(visualFixture.index);
  const visualViewMarkup = tenants.renderTenantView(visualFixture.index, visualView);
  const visualDialogMarkup = tenants.renderScorecardDialog("Collected", "payments", visualFixture.index.payments);
  const visualProfileMarkup = tenants.renderProfile(Object.values(visualFixture.facility.profiles)[0], visualFixture.facility.facility.name);
  assert.match(visualViewMarkup, /tenant-weekly-chart/);
  assert.match(visualViewMarkup, /Synthetic Tenant/);
  assert.match(visualDialogMarkup, /SYN-PAY-0050/);
  assert.match(visualDialogMarkup, /1 \/ 2/);
  assert.match(visualProfileMarkup, /Demonstration|Fixture Storage North/);
  assert.match(visualProfileMarkup, /Synthetic Tenant 1 With an Intentionally Long Display Name/);
  console.log("large synthetic Tenants view, dialog, and profile render checks passed");

  const fixed = 'if(!document.getElementById("tenants-view")?.classList.contains("hidden"))render();';
  assert.equal(source.split(fixed).length - 1, 1, "expected visibility fix exactly once for mutation check");
  const mutant = source.replace(fixed, 'if(globalThis.detail?.view==="tenants")render();');
  const mutantMarkup = await classicScriptLoadProbe(mutant);
  assert.match(mutantMarkup, /Loading restricted tenant data/);
  assert.doesNotMatch(mutantMarkup, /tenant-filter-bar/);
  console.log("mutation check killed: globalThis.detail tenant-view wiring");

  testFocusRefind();
  console.log("classic-script tenant loading check passed with lexical const detail");
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
