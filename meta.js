"use strict";

// Meta reports use exact source summaries. Reach and frequency are never added.
const metaPanel = (() => {
  const modes = { campaigns: 'Campaigns', adsets: 'Ad sets', ads: 'Ads', placements: 'Placements', demographics: 'Age / gender', regions: 'Regions', devices: 'Devices' };
  const hierarchy = new Set(['campaigns', 'adsets', 'ads']);
  const metricFields = ['spend', 'impressions', 'reach', 'frequency', 'clicks', 'linkClicks', 'leads', 'formLeads', 'websiteLeads', 'messages', 'landingViews', 'postEngagement', 'reactions', 'comments', 'saves', 'videoPlays'];
  const ui = { campaign: 'all', adset: 'all', ad: 'all', mode: 'campaigns', search: '', sort: 'spend', direction: -1, page: 1, period: null };
  let data = null, loading = false, failed = false;
  const rowsFor = (period, kind) => Array.isArray(period?.[kind]) ? period[kind] : [];
  const same = (a, b) => String(a) === String(b);
  const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
  const ratio = (a, b, scale = 1) => number(a) !== null && number(b) !== null && b > 0 ? a / b * scale : null;
  const rates = row => ({ ...row, cpl: ratio(row.spend, row.leads), linkCTR: ratio(row.linkClicks, row.impressions), linkCPC: ratio(row.spend, row.linkClicks), cpm: ratio(row.spend, row.impressions, 1000) });
  const periodLabel = () => (typeof report !== 'undefined' && report ? current()?.label : null) || state.period;

  function validate(value) {
    if (value?.schema !== 'storage-signal.meta.v1' || !value.periods || typeof value.periods !== 'object') throw Error('Invalid Meta report');
    for (const period of Object.values(value.periods)) {
      if (!period || typeof period !== 'object') throw Error('Invalid Meta period');
      for (const kind of Object.keys(modes)) if (period[kind] != null && !Array.isArray(period[kind])) throw Error('Invalid Meta breakdown');
      const rows = [period.account, ...Object.keys(modes).flatMap(kind => rowsFor(period, kind))].filter(Boolean);
      for (const row of rows) for (const field of metricFields) {
        if (row[field] != null && number(row[field]) === null) throw Error('Invalid Meta metric');
      }
    }
    return value;
  }

  async function load() {
    if (loading) return;
    loading = true;
    failed = false;
    try {
      const response = await fetch('data/meta.json', { cache: 'no-store' });
      if (!response.ok) throw Error('Meta report unavailable');
      data = validate(await response.json());
    } catch (_) {
      failed = true;
    } finally {
      loading = false;
      render();
    }
  }

  function ensureShell(root) {
    if ($('#meta-campaign')) return;
    root.innerHTML = `
      <div class="detail-filters meta-filters">
        <label>Campaign<select id="meta-campaign"></select></label>
        <label>Ad set / location group<select id="meta-adset"></select></label>
        <label id="meta-ad-label">Individual ad<select id="meta-ad"></select></label>
        <button class="export-button" id="meta-reset">Reset Meta filters</button>
      </div>
      <p class="detail-scope" id="meta-scope"></p>
      <div class="kpi-grid" id="meta-kpis"></div>
      <section class="panel meta-support-panel" aria-label="Additional Meta metrics">
        <div class="meta-support-grid" id="meta-support"></div>
        <details class="meta-more"><summary>More delivery and engagement metrics</summary><div class="meta-support-grid" id="meta-more-metrics"></div></details>
        <p class="meta-explanation">Meta leads and messaging conversations can overlap. Grouped Meta leads and website pixel leads are source action buckets; use Meta leads as the total. These results do not establish qualified enquiries, rentals or revenue. n/a means the source did not provide a value.</p>
      </section>
      <section class="panel meta-insights-panel" aria-labelledby="meta-insights-title">
        <header class="panel-header"><div><h3 id="meta-insights-title">What to review next</h3><p id="meta-insights-scope"></p></div><span class="meta-scope-badge">Account-wide insights</span></header>
        <div class="meta-insight-grid" id="meta-insights"></div>
      </section>
      <section class="panel detail-panel meta-table-panel" aria-labelledby="meta-table-title">
        <header class="panel-header"><div><h3 id="meta-table-title">Performance detail</h3><p>Explore results and the evidence behind each decision.</p></div><button class="export-button" id="meta-export">Download CSV</button></header>
        <div class="detail-toolbar"><div class="detail-toggle" aria-label="Meta breakdown">${Object.entries(modes).map(([key, label]) => `<button data-meta-mode="${key}" aria-pressed="false">${label}</button>`).join('')}</div><label class="meta-search-label"><span class="sr-only">Search Meta table</span><input id="meta-search" type="search" placeholder="Search this breakdown" autocomplete="off"></label></div>
        <p class="detail-scope" id="meta-table-note"></p>
        <div class="table-scroll" tabindex="0" role="region" aria-label="Meta performance table, scroll horizontally for more metrics"><table><thead id="meta-head"></thead><tbody id="meta-body"></tbody></table></div>
        <div class="table-footer"><span id="meta-count" aria-live="polite"></span><div class="pagination" id="meta-pages"></div></div>
      </section>`;

    $('#meta-campaign').onchange = e => {
      Object.assign(ui, { campaign: e.target.value, adset: 'all', ad: 'all', page: 1 });
      render();
    };
    $('#meta-adset').onchange = e => {
      ui.adset = e.target.value;
      ui.ad = 'all';
      ui.page = 1;
      if (ui.adset !== 'all') {
        const row = rowsFor(data.periods[state.period], 'adsets').find(row => same(row.id, ui.adset));
        if (row?.campaignId != null) ui.campaign = String(row.campaignId);
        if (hierarchy.has(ui.mode)) ui.mode = 'adsets';
      }
      render();
    };
    $('#meta-ad').onchange = e => {
      ui.ad = e.target.value;
      ui.page = 1;
      if (ui.ad !== 'all') {
        const row = rowsFor(data.periods[state.period], 'ads').find(row => same(row.id, ui.ad));
        if (row?.campaignId != null) ui.campaign = String(row.campaignId);
        if (row?.adsetId != null) ui.adset = String(row.adsetId);
        ui.mode = 'ads';
      }
      render();
    };
    $('#meta-reset').onclick = reset;
    $$('#meta-view [data-meta-mode]').forEach(button => button.onclick = () => {
      ui.mode = button.dataset.metaMode;
      ui.page = 1;
      ui.search = '';
      ui.ad = 'all';
      if (ui.mode === 'campaigns') ui.adset = 'all';
      $('#meta-search').value = '';
      render();
    });
    $('#meta-search').oninput = e => {
      ui.search = e.target.value.trim().toLowerCase();
      ui.page = 1;
      renderTable(data.periods[state.period]);
    };
    $('#meta-search').value = ui.search;
    $('#meta-body').onclick = e => {
      const row = e.target.closest('tr[data-meta-drill]');
      if (row) drill(row.dataset.metaDrill, row.dataset.id);
    };
    $('#meta-body').onkeydown = e => {
      if (e.target.tagName === 'BUTTON') return;
      const row = e.target.closest('tr[data-meta-drill]');
      if (row && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        drill(row.dataset.metaDrill, row.dataset.id);
      }
    };
  }

  function reset() {
    Object.assign(ui, { campaign: 'all', adset: 'all', ad: 'all', mode: 'campaigns', search: '', sort: 'spend', direction: -1, page: 1 });
    if ($('#meta-search')) $('#meta-search').value = '';
    render();
  }

  function drill(kind, id) {
    if (kind === 'campaigns') Object.assign(ui, { campaign: id, adset: 'all', ad: 'all', mode: 'adsets' });
    else {
      const row = rowsFor(data.periods[state.period], 'adsets').find(row => same(row.id, id));
      Object.assign(ui, { campaign: row?.campaignId == null ? ui.campaign : String(row.campaignId), adset: id, ad: 'all', mode: 'ads' });
    }
    ui.page = 1;
    ui.search = '';
    $('#meta-search').value = '';
    render();
  }

  function setOptions(id, rows, selected, allLabel, context) {
    const element = $('#' + id);
    element.innerHTML = `<option value="all">${esc(allLabel)}</option>` + rows.map(row => `<option value="${esc(row.id)}">${esc(row.name)}${context && row[context] ? ' · ' + esc(row[context]) : ''}</option>`).join('');
    element.value = selected;
  }

  function normaliseSelection(period) {
    const campaigns = rowsFor(period, 'campaigns');
    if (ui.campaign !== 'all' && !campaigns.some(row => same(row.id, ui.campaign))) Object.assign(ui, { campaign: 'all', adset: 'all', ad: 'all' });
    const adsets = rowsFor(period, 'adsets').filter(row => ui.campaign === 'all' || same(row.campaignId, ui.campaign));
    if (ui.adset !== 'all' && !adsets.some(row => same(row.id, ui.adset))) Object.assign(ui, { adset: 'all', ad: 'all' });
    const ads = rowsFor(period, 'ads').filter(row => (ui.campaign === 'all' || same(row.campaignId, ui.campaign)) && (ui.adset === 'all' || same(row.adsetId, ui.adset)));
    if (!hierarchy.has(ui.mode) || (ui.ad !== 'all' && !ads.some(row => same(row.id, ui.ad)))) ui.ad = 'all';
    setOptions('meta-campaign', campaigns, ui.campaign, 'All campaigns');
    setOptions('meta-adset', adsets, ui.adset, 'All ad sets', ui.campaign === 'all' ? 'campaignName' : null);
    setOptions('meta-ad', ads, ui.ad, 'All ads', 'adsetName');
    $('#meta-ad').disabled = !hierarchy.has(ui.mode);
    $('#meta-ad-label').classList.toggle('hidden', !hierarchy.has(ui.mode));
  }

  function exactSummary(period) {
    if (ui.ad !== 'all') return { row: rowsFor(period, 'ads').find(row => same(row.id, ui.ad)), level: 'Ad' };
    if (ui.adset !== 'all') return { row: rowsFor(period, 'adsets').find(row => same(row.id, ui.adset)), level: 'Ad set' };
    if (ui.campaign !== 'all') return { row: rowsFor(period, 'campaigns').find(row => same(row.id, ui.campaign)), level: 'Campaign' };
    return { row: period.account, level: 'Entire Meta account' };
  }

  function smallMetrics(items) {
    return items.map(([label, value, kind]) => `<div><span>${esc(label)}</span><strong>${fmt(value, kind)}</strong></div>`).join('');
  }

  function renderMetrics(period) {
    const selection = exactSummary(period), summary = rates(selection.row || {});
    const scope = selection.row?.name ? selection.level + ': ' + selection.row.name : selection.level;
    $('#meta-scope').textContent = `${periodLabel()} · ${scope} · USD. Headline totals follow these dropdowns; table search and breakdown do not change them. Reach and frequency come from this exact source summary.`;
    $('#meta-kpis').innerHTML = cardsHtml([
      ['Spend', summary.spend, 'money'], ['Meta leads', summary.leads, 'number', 'Platform-reported lead actions'],
      ['Cost per lead', summary.cpl, 'money', 'Spend ÷ Meta leads'], ['Link clicks', summary.linkClicks],
      ['Link click-through rate', summary.linkCTR, 'percent', 'Link clicks ÷ impressions'], ['Frequency', summary.frequency, 'number', 'Source-reported average']
    ]);
    $('#meta-support').innerHTML = smallMetrics([
      ['Reach', summary.reach], ['Impressions', summary.impressions], ['Messaging conversations', summary.messages],
      ['Landing-page views', summary.landingViews], ['Grouped Meta leads', summary.formLeads], ['Website pixel leads', summary.websiteLeads]
    ]);
    $('#meta-more-metrics').innerHTML = smallMetrics([
      ['All clicks', summary.clicks], ['Cost per link click', summary.linkCPC, 'money'], ['CPM', summary.cpm, 'money'],
      ['Post engagement', summary.postEngagement], ['Reactions', summary.reactions], ['Comments', summary.comments],
      ['Saves', summary.saves], ['Video plays', summary.videoPlays]
    ]);
  }

  function renderInsights(period) {
    $('#meta-insights-scope').textContent = `${periodLabel()} · Entire Meta account, independent of campaign, ad-set, ad and table filters.`;
    const insights = Array.isArray(period.insights) ? period.insights : [];
    $('#meta-insights').innerHTML = insights.length ? insights.map(item => {
      const basis = Array.isArray(item.basis) ? item.basis.join(' · ') : item.basis;
      return `<article class="meta-insight-card"><div class="meta-insight-heading"><h4>${esc(item.title)}</h4><span class="meta-confidence">${esc(item.confidence || 'Evidence to review')}</span></div><p><strong>Observation</strong>${esc(item.observation)}</p><p><strong>Suggested action</strong>${esc(item.action)}</p><p class="meta-insight-basis"><strong>Basis and limits</strong>${esc(basis || 'Source-reported Meta results; no confirmed rental or revenue link.')}</p></article>`;
    }).join('') : '<p class="detail-scope">No decision notes are available for this month yet. The source metrics remain available below.</p>';
  }

  function tableRows(period) {
    return rowsFor(period, ui.mode).filter(row => {
      const campaignId = ui.mode === 'campaigns' ? row.id : row.campaignId;
      const adsetId = ui.mode === 'adsets' ? row.id : row.adsetId;
      return (ui.campaign === 'all' || same(campaignId, ui.campaign)) &&
        (ui.adset === 'all' || same(adsetId, ui.adset)) &&
        (ui.ad === 'all' || ui.mode !== 'ads' || same(row.id, ui.ad));
    }).map(row => rates({ ...row, label: row.name || row.label || 'Unlabelled', secondary: [row.campaignName, row.adsetName].filter(Boolean).join(' · ') }));
  }

  function sorted(rows) {
    return rows.filter(row => [row.label, row.secondary, row.id].filter(value => value != null).join(' ').toLowerCase().includes(ui.search)).sort((a, b) => {
      const x = a[ui.sort], y = b[ui.sort];
      if (x == null) return y == null ? 0 : 1;
      if (y == null) return -1;
      return (typeof x === 'string' ? x.localeCompare(String(y)) : x - y) * ui.direction;
    });
  }

  function renderTable(period) {
    const columns = [['label', modes[ui.mode], 'text'], ['spend', 'Spend', 'money'], ['leads', 'Meta leads'], ['cpl', 'Cost / lead', 'money'], ['linkClicks', 'Link clicks'], ['linkCTR', 'Link CTR', 'percent'], ['linkCPC', 'Link CPC', 'money'], ['impressions', 'Impressions'], ['reach', 'Reach'], ['frequency', 'Frequency'], ['messages', 'Conversations'], ['landingViews', 'Landing views']];
    const filtered = sorted(tableRows(period)), pages = Math.max(1, Math.ceil(filtered.length / 12));
    ui.page = Math.min(Math.max(1, ui.page), pages);
    const start = (ui.page - 1) * 12;
    const dimension = !hierarchy.has(ui.mode);
    $('#meta-table-title').textContent = 'Performance by ' + modes[ui.mode].toLowerCase();
    $('#meta-table-note').textContent = `${dimension ? 'Rows retain their campaign and ad-set context. Individual-ad filtering is unavailable for this breakdown. ' : 'Select a campaign or ad-set row to drill down. '}${ui.mode === 'regions' ? 'Meta did not return total leads, website leads, conversations or landing-page views for regions; their values and cost per lead are n/a. ' : ''}Search filters the table and CSV only. Reach is not additive across rows. Location labels describe audience or ad-set groups, not verified individual facilities.`;
    $$('#meta-view [data-meta-mode]').forEach(button => {
      const active = button.dataset.metaMode === ui.mode;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    $('#meta-head').innerHTML = '<tr>' + columns.map(([key, label]) => `<th scope="col" aria-sort="${ui.sort === key ? ui.direction === 1 ? 'ascending' : 'descending' : 'none'}"><button class="detail-sort" data-meta-sort="${key}">${esc(label)} ${ui.sort === key ? ui.direction === 1 ? '↑' : '↓' : '↕'}</button></th>`).join('') + '</tr>';
    $('#meta-body').innerHTML = filtered.slice(start, start + 12).map(row => {
      const clickable = (ui.mode === 'campaigns' || ui.mode === 'adsets') && row.id != null;
      const attrs = clickable ? ` data-meta-drill="${ui.mode}" data-id="${esc(row.id)}" tabindex="0" aria-label="Explore ${esc(row.label)}"` : '';
      return `<tr${attrs}>` + columns.map(([key, , kind]) => `<td>${kind === 'text' ? `${clickable ? `<button class="campaign-drill">${esc(row.label)} →</button>` : esc(row.label)}${row.secondary ? `<small class="report-note">${esc(row.secondary)}</small>` : ''}` : fmt(row[key], kind)}</td>`).join('') + '</tr>';
    }).join('') || `<tr><td colspan="${columns.length}" class="empty-row">${rowsFor(period, ui.mode).length ? 'No rows match these filters.' : 'No source rows are available for this breakdown and month.'}</td></tr>`;
    $('#meta-count').textContent = filtered.length ? `${start + 1}–${Math.min(start + 12, filtered.length)} of ${filtered.length} rows` : 'No matching rows';
    $('#meta-pages').innerHTML = `<button class="page-button" data-meta-step="-1" ${ui.page === 1 ? 'disabled' : ''} aria-label="Previous Meta page">‹</button><span>${ui.page} / ${pages}</span><button class="page-button" data-meta-step="1" ${ui.page === pages ? 'disabled' : ''} aria-label="Next Meta page">›</button>`;
    $$('#meta-head [data-meta-sort]').forEach(button => button.onclick = () => {
      ui.direction = ui.sort === button.dataset.metaSort ? -ui.direction : button.dataset.metaSort === 'label' ? 1 : -1;
      ui.sort = button.dataset.metaSort;
      renderTable(period);
    });
    $$('#meta-pages [data-meta-step]').forEach(button => button.onclick = () => {
      ui.page += Number(button.dataset.metaStep);
      renderTable(period);
    });
    $('#meta-export').disabled = !filtered.length;
    $('#meta-export').onclick = () => exportCsv(filtered);
  }

  function csvCell(value) {
    let text = String(value ?? '');
    // Protect spreadsheet formula interpretation, including leading whitespace.
    if (typeof value === 'string' && (/^[\s\uFEFF]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text))) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  }

  function exportCsv(rows) {
    const columns = [['label', 'Name / breakdown'], ['id', 'Entity ID'], ['campaignName', 'Campaign'], ['adsetName', 'Ad set'], ['spend', 'Spend USD'], ['leads', 'Meta leads'], ['cpl', 'Cost per lead USD'], ['formLeads', 'Grouped Meta leads'], ['websiteLeads', 'Website pixel leads'], ['messages', 'Messaging conversations'], ['linkClicks', 'Link clicks'], ['linkCTR', 'Link CTR fraction'], ['linkCPC', 'Link CPC USD'], ['impressions', 'Impressions'], ['reach', 'Reach - not additive'], ['frequency', 'Frequency - not additive'], ['cpm', 'CPM USD'], ['clicks', 'All clicks'], ['landingViews', 'Landing-page views'], ['postEngagement', 'Post engagement'], ['reactions', 'Reactions'], ['comments', 'Comments'], ['saves', 'Saves'], ['videoPlays', 'Video plays']];
    const header = ['Month', 'Breakdown', ...columns.map(column => column[1])];
    const csv = [header.map(csvCell).join(','), ...rows.map(row => [state.period, modes[ui.mode], ...columns.map(([key]) => row[key])].map(csvCell).join(','))].join('\r\n');
    const url = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `FHS-meta-${state.period}-${ui.mode}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function render() {
    const root = $('#meta-view');
    if (!root) return;
    if (!data) {
      root.innerHTML = failed ? '<section class="panel meta-message" role="status"><h3>Meta detail could not be loaded</h3><p>The current report is unavailable. Reload the source report to try again.</p><button class="export-button" id="meta-retry">Try again</button></section>' : '<section class="panel meta-message" role="status"><h3>Loading Meta reporting</h3><p>Loading the saved monthly report…</p></section>';
      if (failed) $('#meta-retry').onclick = () => { failed = false; load(); render(); };
      else if (!loading) load();
      return;
    }
    const period = data.periods[state.period];
    if (!period) {
      root.innerHTML = `<section class="panel meta-message" role="status"><h3>Meta report unavailable for ${esc(periodLabel())}</h3><p>Select another month. No figures from a different period are substituted.</p></section>`;
      return;
    }
    ensureShell(root);
    if (ui.period !== state.period) { ui.period = state.period; ui.page = 1; }
    normaliseSelection(period);
    renderMetrics(period);
    renderInsights(period);
    renderTable(period);
    const refreshed = data.refreshed ? ` · Refreshed ${data.refreshed}` : '';
    const footer = $('#footer-note');
    if (footer && !root.classList.contains('hidden')) footer.textContent = `Meta Ads · ${periodLabel()} · USD · America/New_York${refreshed}. Manual snapshots; platform results can be revised.`;
  }

  return { render, reset };
})();

function renderMeta() { metaPanel.render(); }
$('#reset-filters').addEventListener('click', () => { if (typeof detail !== 'undefined' && detail.view === 'meta') metaPanel.reset(); });
definitions.push(['Meta reporting and insights', 'Meta lead actions are the primary lead total. Messaging and other action buckets can overlap. Reach and frequency come from exact source summaries. Regional total leads and related conversion fields were not returned and display n/a. Decision notes use observed source results and comparable periods; suggested actions do not change campaign settings.'], ['Meta fatigue screening', 'A possible fatigue signal requires frequency up 20%, link CTR down 15% and CPL up 20%, with at least 5 leads, 30 link clicks and 1,000 impressions in both adjacent seven-day windows. These are screening rules, not proof of fatigue or statistical significance.']);
