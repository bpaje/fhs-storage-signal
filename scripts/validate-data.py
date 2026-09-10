"""Validate source reconciliation without credentials or network calls."""
import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
read = lambda name: json.loads((root / 'data' / name).read_text(encoding='utf-8'))
overview, ads, ga = map(read, ['reporting.json', 'google-ads.json', 'analytics.json'])
assert ads['through'] == ga['through'] == overview['periods'][-1]['end']
assert ga['measurementId'] == 'G-TCSG6BY1KK'
for period in overview['periods']:
    month = period['id']
    totals = []
    for kind in ['campaigns', 'groups']:
        rows = [r for r in ads[kind] if r['month'] == month]
        totals.append({k: sum(r[k] for r in rows) for k in ['costMicros', 'impressions', 'clicks', 'conversions']})
        assert abs(totals[-1]['costMicros'] / 1e6 - period['google']['spend']) <= .0051
        for metric in ['impressions', 'clicks']:
            assert totals[-1][metric] == period['google'][metric]
        # Platform fractional conversions vary slightly across report grains.
        # Preserve source values; require agreement at the displayed precision.
        assert round(totals[-1]['conversions'], 2) == round(period['google']['conversions'], 2)
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
    print(month + ': overview, campaigns, ad groups, page views and payment arithmetic reconcile')
print('All reporting checks passed.')
