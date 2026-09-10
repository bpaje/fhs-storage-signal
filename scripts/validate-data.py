"""Validate source reconciliation without credentials or network calls."""
import json
import calendar
import math
import re
from datetime import date
from pathlib import Path

root = Path(__file__).resolve().parents[1]
read = lambda name: json.loads((root / 'data' / name).read_text(encoding='utf-8'))
overview, ads, ga = map(read, ['reporting.json', 'google-ads.json', 'analytics.json'])
meta = read('meta.json') if (root / 'data' / 'meta.json').exists() else None
assert ads['through'] == ga['through'] == overview['periods'][-1]['end']
assert ga['measurementId'] == 'G-TCSG6BY1KK'
cutoff = date.fromisoformat(ads['through'])
month_ids = [f'{cutoff.year}-{month:02d}' for month in range(1, cutoff.month + 1)]
ytd_id = f'{cutoff.year}-ytd'
period_ids = month_ids + [ytd_id]
assert {p['id'] for p in ads['periods']} == set(period_ids)
assert set(ga['periods']) == set(period_ids)
account_totals = {row['month']: row for row in ads['accountTotals']}
assert set(account_totals) == set(period_ids)
additive = ['costMicros', 'impressions', 'clicks', 'conversions']

for period in ads['periods']:
    month = period['id']
    start = date(cutoff.year, 1 if month == ytd_id else int(month[-2:]), 1)
    end = cutoff if month == ytd_id or month == month_ids[-1] else date(start.year, start.month, calendar.monthrange(start.year, start.month)[1])
    assert period['start'] == start.isoformat() and period['end'] == end.isoformat()
    account = account_totals[month]
    for kind in ['campaigns', 'groups']:
        rows = [r for r in ads[kind] if r['month'] == month]
        assert all(math.isfinite(r[k]) and r[k] >= 0 for r in rows for k in additive)
        for key in additive:
            total = sum(r[key] for r in rows)
            if key == 'conversions':
                assert abs(total - account[key]) < .005, (month, kind, key, total, account[key])
            else:
                assert total == account[key], (month, kind, key, total, account[key])
    campaigns = [r for r in ads['campaigns'] if r['month'] == month]
    groups = [r for r in ads['groups'] if r['month'] == month]
    campaign_ids = {r['id'] for r in campaigns}
    assert len(campaign_ids) == len(campaigns), (month, 'duplicate campaign')
    assert len({(r['campaignId'], r['id']) for r in groups}) == len(groups), (month, 'duplicate ad group')
    assert all(r['campaignId'] in campaign_ids for r in groups)
    assert all(r['campaignId'] in campaign_ids for r in ads['geography'] if r['month'] == month)
    analytics = ga['periods'][month]
    assert analytics['start'] == start.isoformat() and analytics['end'] == end.isoformat()
    summary = analytics['summary']
    if summary is None:
        assert not any(analytics[k] for k in ['channels', 'pages', 'cities']), (month, 'data without summary')
        assert analytics.get('coverage'), (month, 'missing no-data explanation')
    else:
        assert all(math.isfinite(v) and v >= 0 for v in summary.values())
        assert summary['engagedSessions'] <= summary['sessions']
        assert 'notes' in analytics
        # Reconcile page views when the API reports no sampling, thresholding or grouped-away data.
        notes = analytics['notes']['pages']
        if not any(notes.get(flag, False) for flag in ['sampled', 'thresholding', 'otherRow']):
            assert sum(r['screenPageViews'] for r in analytics['pages']) == summary['screenPageViews'], (month, 'page views')
        assert all('?' not in r['pagePath'] for r in analytics['pages']), (month, 'query string in page path')
        assert all(not re.search(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', r['pagePath'], re.I) for r in analytics['pages']), (month, 'opaque identifier in page path')
        assert all(r['totalUsers'] is None for r in analytics['pages'] if r['pagePath'] == '[Private paths omitted]'), (month, 'summed users in private-path bucket')
    print(month + ': Google Ads account, campaigns, ad groups and GA4 coverage reconcile')

for metric in additive:
    total = sum(account_totals[m][metric] for m in month_ids)
    if metric == 'conversions':
        assert abs(total - account_totals[ytd_id][metric]) < .005
    else:
        assert total == account_totals[ytd_id][metric]

for period in overview['periods']:
    month = period['id']
    totals = []
    for kind in ['campaigns', 'groups']:
        rows = [r for r in ads[kind] if r['month'] == month]
        totals.append({k: sum(r[k] for r in rows) for k in ['costMicros', 'impressions', 'clicks', 'conversions']})
        assert abs(totals[-1]['costMicros'] / 1e6 - period['google']['spend']) <= .0051
        for metric in ['impressions', 'clicks']:
            assert totals[-1][metric] == period['google'][metric]
        # Fractional conversions can differ slightly by source report grain,
        # including crossing a display rounding boundary. Retain each source value.
        assert abs(totals[-1]['conversions'] - period['google']['conversions']) < .005
    assert totals[0]['costMicros'] == totals[1]['costMicros']
    campaign_ids = {r['id'] for r in ads['campaigns'] if r['month'] == month}
    assert all(r['campaignId'] in campaign_ids for r in ads['groups'] if r['month'] == month)
    analytics = ga['periods'][month]
    summary = analytics['summary']
    assert summary['engagedSessions'] <= summary['sessions']
    assert sum(r['screenPageViews'] for r in analytics['pages']) == summary['screenPageViews']
    for facility in period['facilities']:
        if facility['net'] is not None:
            assert abs(facility['gross'] - facility['refunds'] - facility['net']) < .001
    if meta:
        m = meta['periods'][month]
        assert meta['through'] == overview['periods'][-1]['end']
        for metric in ['spend','impressions','clicks','linkClicks','reach','leads']:
            assert m['account'][metric] == period['meta'][metric]
        for level in ['campaigns','adsets','ads']:
            assert abs(sum(r['spend'] for r in m[level]) - m['account']['spend']) < .011
            assert sum(r['leads'] for r in m[level]) == m['account']['leads']
        assert all(r['leads'] is None and r['messages'] is None and r['landingViews'] is None for r in m['regions']), 'Regional conversion support must be rechecked before changing this contract'
        assert abs(sum((r['formLeads'] or 0) for r in m['regions']) - m['account']['formLeads']) < .001
        prior, recent = m['weeklyEvidence']['priorWeek'], m['weeklyEvidence']['recentWeek']
        for window in [prior, recent]:
            assert (date.fromisoformat(window['end']) - date.fromisoformat(window['start'])).days == 6
        assert (date.fromisoformat(recent['start']) - date.fromisoformat(prior['end'])).days == 1
    print(month + ': overview, campaigns, ad groups, page views and payment arithmetic reconcile')
print('All reporting checks passed.')
