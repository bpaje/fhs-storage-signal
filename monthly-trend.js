"use strict";

// Shared presentation only. Each source supplies its own correctly scoped
// monthly summaries and selected-period value; this renderer never adds them.
function renderMonthlyTrend(target, options) {
  const root = typeof target === 'string' ? document.querySelector(target) : target;
  if (!root) return;
  const metric = options.metrics.find(item => item.key === options.metric) || options.metrics[0];
  if (!metric) return;
  const numeric = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
  const periods = options.periods.filter(period => !/-ytd$/.test(period.id)).map(period => ({...period, value: numeric(period.value)}));
  const format = value => fmt(value, metric.kind || 'number');
  const monthLabel = period => new Date(period.start + 'T00:00:00Z').toLocaleDateString('en-US', {month: 'short', timeZone: 'UTC'});
  const isYtd = /-ytd$/.test(options.selectedPeriod || '');
  const currentPeriod = periods.find(period => period.id === options.selectedPeriod);
  const selectedValue = options.selectedValue === undefined ? currentPeriod?.value : numeric(options.selectedValue);
  const selectedLabel = options.selectedLabel || currentPeriod?.label || (isYtd ? options.selectedPeriod.slice(0, 4) + ' year to date' : 'Selected period');
  const anyPartial = periods.some(period => period.partial);
  const anyMissing = periods.some(period => period.value === null);
  const open = root.querySelector('.monthly-trend-values')?.open || false;
  const scrollLeft = root.querySelector('.monthly-trend-chart')?.scrollLeft || 0;
  const maxValue = Math.max(0, ...periods.map(period => period.value || 0));
  const minValue = Math.min(0, ...periods.map(period => period.value || 0));
  const ceiling = value => {
    if (!value) return 1;
    const step = 10 ** Math.floor(Math.log10(value)) / 2;
    return Math.ceil(value / step) * step;
  };
  const upper = ceiling(maxValue), lower = minValue < 0 ? -ceiling(-minValue) : 0;
  const width = Math.max(650, periods.length * 106 + 90);
  const left = 92, right = width - 22, top = 38, bottom = 220;
  const y = value => bottom - (value - lower) / (upper - lower) * (bottom - top);
  const zero = y(0), step = (right - left) / Math.max(1, periods.length), bar = Math.min(64, step * .63);
  const ticks = [...new Set([lower, (upper + lower) / 2, upper])];
  const guides = ticks.map(value => `<g class="monthly-trend-guide"><line x1="${left}" x2="${right}" y1="${y(value)}" y2="${y(value)}"/><text x="${left - 12}" y="${y(value) + 4}" text-anchor="end">${esc(format(value))}</text></g>`).join('');
  const columns = periods.map((period, index) => {
    const value = period.value, x = left + step * index + (step - bar) / 2;
    const selected = isYtd || period.id === options.selectedPeriod;
    const valueY = value === null ? zero : y(value);
    const height = value === null ? 0 : Math.abs(valueY - zero);
    const labelY = value === null || value >= 0 ? valueY - 10 : valueY + 18;
    const title = `${period.label}: ${value === null ? 'n/a' : format(value)}${period.partial ? ' (partial month)' : ''}${period.note ? '. ' + period.note : ''}`;
    const mark = value === null
      ? `<line class="monthly-trend-missing" x1="${x}" x2="${x + bar}" y1="${zero}" y2="${zero}"/>`
      : `<rect class="monthly-trend-bar${period.partial ? ' is-partial' : ''}${selected ? ' is-selected' : ''}" x="${x}" y="${Math.min(valueY, zero)}" width="${bar}" height="${height}" rx="4"/>`;
    return `<g data-monthly-month="${esc(period.id)}" data-value="${value === null ? '' : value}"><title>${esc(title)}</title>${mark}<text class="monthly-trend-value" x="${x + bar / 2}" y="${labelY}" text-anchor="middle">${esc(format(value))}</text><text class="monthly-trend-month${selected ? ' is-selected' : ''}" x="${x + bar / 2}" y="258" text-anchor="middle">${esc(monthLabel(period))}${period.partial ? '*' : ''}</text></g>`;
  }).join('');
  const accessible = `${metric.label} by month. ` + periods.map(period => `${period.label}: ${format(period.value)}${period.partial ? ', partial month' : ''}`).join('; ');
  const caption = [options.scope, anyPartial ? '* Partial month or partial recorded history; see the monthly values for dates.' : '', anyMissing ? 'n/a means no source value or an undefined rate; it is not zero.' : ''].filter(Boolean).join(' ');
  root.classList.add('monthly-trend');
  root.dataset.metric = metric.key;
  root.innerHTML = `
    <header class="monthly-trend-header">
      <div><h3>${esc(options.title || 'Monthly performance')}</h3><p>${esc(metric.label)} by month</p></div>
      <div class="monthly-trend-selected" aria-live="polite"><strong>${esc(format(selectedValue))}</strong><span>${esc(selectedLabel)}</span></div>
    </header>
    <div class="monthly-trend-controls" role="group" aria-label="${esc(options.title || 'Monthly chart')} metric">
      ${options.metrics.map(item => `<button type="button" data-monthly-metric="${esc(item.key)}" aria-pressed="${item.key === metric.key}">${esc(item.label)}</button>`).join('')}
    </div>
    <div class="monthly-trend-chart" tabindex="0" role="img" aria-label="${esc(accessible)}">
      <svg viewBox="0 0 ${width} 280" style="min-width:${width}px" role="presentation">${guides}<line class="monthly-trend-baseline" x1="${left}" x2="${right}" y1="${zero}" y2="${zero}"/>${columns}</svg>
    </div>
    <p class="monthly-trend-caption">${esc(caption)}</p>
    <details class="monthly-trend-values"${open ? ' open' : ''}>
      <summary>View monthly values</summary>
      <div class="table-scroll"><table><caption class="sr-only">${esc(metric.label)} by month</caption><thead><tr><th scope="col">Month</th><th scope="col">${esc(metric.label)}</th><th scope="col">Reporting dates</th></tr></thead><tbody>
        ${periods.map(period => `<tr data-month="${esc(period.id)}" data-value="${period.value === null ? '' : period.value}"><th scope="row">${esc(period.label)}${period.partial ? ' *' : ''}</th><td>${esc(format(period.value))}</td><td>${esc(period.start)} – ${esc(period.end)}${period.note ? `<small>${esc(period.note)}</small>` : ''}</td></tr>`).join('')}
      </tbody></table></div>
    </details>`;
  root.querySelector('.monthly-trend-chart').scrollLeft = scrollLeft;
  root.querySelectorAll('[data-monthly-metric]').forEach(button => {
    button.onclick = () => {
      const key = button.dataset.monthlyMetric;
      options.onMetricChange(key);
      [...root.querySelectorAll('[data-monthly-metric]')].find(item => item.dataset.monthlyMetric === key)?.focus({preventScroll: true});
    };
  });
}
