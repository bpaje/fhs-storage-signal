"use strict";

// Static guards for keyboard access, sortable headers and minimum legible type. Browser behaviour is checked separately.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = name => fs.readFileSync(path.join(ROOT, name), "utf8");

function run() {
  const css = read("styles.css"), index = read("index.html"), app = read("app.js");

  // Closed drawer is removed from the tab order and the accessibility tree, not just moved off screen.
  assert.match(css, /\.drawer \{[^}]*visibility: hidden;/);
  assert.match(css, /\.drawer\.open \{[^}]*visibility: visible;/);
  assert.match(index, /<aside class="drawer" id="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title"/);
  assert.match(index, /id="info-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" tabindex="-1"/);

  // Focus moves in on open, is trapped while open, and returns to the opener on close; Escape closes.
  assert.match(app, /\$\('#info-modal \.close-button'\)\.focus\(\)/);
  assert.match(app, /\$\('#drawer-close'\)\.focus\(\)/);
  assert.match(app, /if\(opener\?\.isConnected\)opener\.focus\(\);opener=null;/);
  assert.match(app, /function trapTab\(e\)/);
  assert.match(app, /if\(e\.key==='Escape'\)\{closeOverlays\(\);[^}]*\}else trapTab\(e\);/);

  // Sortable headers are real buttons inside a th that carries aria-sort.
  const headers = index.match(/<th class="sortable"[^>]*>.*?<\/th>/g) || [];
  assert.equal(headers.length, 5);
  for (const header of headers) assert.match(header, /^<th class="sortable" aria-sort="none"><button type="button" class="sort-button" data-sort="\w+">[^<]+<span aria-hidden="true">↕<\/span><\/button><\/th>$/);
  assert.doesNotMatch(index, /<th[^>]*data-sort=/);
  assert.match(app, /th\.setAttribute\('aria-sort'/);
  assert.doesNotMatch(app, /b\.tabIndex=0/);

  // No text rule under 10px; the tiny 6-9px sizes are gone.
  const small = [...css.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].filter(match => Number(match[1]) < 10);
  assert.deepEqual(small.map(match => match[0]), []);
  console.log("accessibility guards: drawer visibility, dialog roles, focus handling, sort buttons and minimum font size passed");
}

run();
