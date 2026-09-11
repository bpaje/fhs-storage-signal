"""Build the cross-platform Overview reporting file (data/reporting.json) from local API extracts.

Usage: python scripts/build-reporting.py <ccstorage-source.json> <google-report.json> <meta-complete-source.json> [--refreshed YYYY-MM-DD]
No credentials, source writes, budget changes or network calls.

Period boundaries come entirely from the 'account'-kind entries in the
Meta extract's own reports array (each with an explicit start/end), so
this script covers whatever months the raw extracts contain rather than
a fixed list. Using the same meta-complete-source.json that build-meta.py
also reads (instead of a separate Meta extract) avoids two different
Meta snapshots, taken at different times, disagreeing for the
still-moving current month.

Run order matters: this script must run BEFORE scripts/build-meta.py.
The Meta figures written here (period.meta.*, metaExtractedAt) are a
rough first pass from meta-report.json; build-meta.py's own run
overwrites them afterward from data/meta.json, which is the
authoritative Meta source once it exists. Running build-meta.py first
(or not at all) leaves reporting.json's Meta numbers stale/inconsistent
with meta.json for the current in-progress month.
"""
import calendar, json, sys
from datetime import date
from decimal import Decimal
from pathlib import Path


def money(v):
    return float(Decimal(str(v)).quantize(Decimal('.01')))


def month_name(month_key):
    year, mon = map(int, month_key.split('-'))
    return calendar.month_name[mon]


def is_partial(start, end):
    year, mon, _ = map(int, start.split('-'))
    return int(end.split('-')[2]) < calendar.monthrange(year, mon)[1]


def period_label(start, end):
    year = int(start.split('-')[0])
    name = month_name(start[:7])
    if is_partial(start, end):
        return f"{name} 1–{int(end.split('-')[2])}, {year} (MTD)"
    return f"{name} {year}"


def build(cc, google, meta, refreshed):
    periods = []
    account_reports = sorted((r for r in meta['reports'] if r['kind'] == 'account'), key=lambda r: r['start'])
    for period in account_reports:
        start, end = period['start'], period['end']
        key = start[:7]
        g = [x for x in google if x['segments.date'].startswith(key) and x['segments.date'] <= end]
        assert len(g) == int(end.split('-')[2]), f'Incomplete Google daily response for {key}'
        assert len(period['rows']) == 1, f'Expected exactly one Meta account row for {key}'
        m = period['rows'][0]
        assert m['date_start'] == start and m['date_stop'] == end, f'Meta period bounds mismatch for {key}'
        rows = []
        for c in cc['companies']:
            cid = c['company_id']
            name = c['company_name']
            p = next((x for x in cc['financial'] if x['company_id'] == cid and x['month'] == key + '-01'), None)
            o = next((x for x in cc['endOccupancy'] if x['company_id'] == cid and x['date'] == end), None)
            v = next((x for x in cc['moves'] if x['company_id'] == cid and x['month'] == key + '-01'), None)
            row = {
                'id': str(cid),
                'name': name,
                'brand': 'Family Heirloom' if name.startswith('Family Heirloom') else 'Southeastern' if name.startswith('Southeastern') else 'Eagles Landing' if name.startswith('Eagles Landing') else 'Other brands',
            }
            row.update({k: money(p[src]) if p else None for k, src in [('net', 'net_recorded'), ('gross', 'gross_recorded'), ('refunds', 'refunds_against_payments')]})
            row.update({
                'payments': int(p['eligible_count']) if p else None,
                'moveIns': int(v['move_ins']) if v else None,
                'moveOuts': int(v['move_outs']) if v else None,
                'leases': int(o['leases']) if o else None,
                'units': int(o['storage_units']) if o else None,
                'autopay': int(o['auto_pay_leases']) if o else None,
            })
            row['occupancy'] = row['leases'] / row['units'] if o and row['units'] else None
            rows.append(row)
        leads = [a for a in m.get('actions', []) if a['action_type'] == 'lead']
        assert len(leads) <= 1, f'Duplicate lead action for {key}'
        periods.append({
            'id': key,
            'label': period_label(start, end),
            'start': start,
            'end': end,
            'partial': is_partial(start, end),
            'google': {
                'spend': money(sum(x['metrics.cost_micros'] for x in g) / 1000000),
                'impressions': sum(x['metrics.impressions'] for x in g),
                'clicks': sum(x['metrics.clicks'] for x in g),
                'conversions': round(sum(x['metrics.conversions'] for x in g), 6),
            },
            'meta': {
                'spend': money(m['spend']),
                'impressions': int(m['impressions']),
                'clicks': int(m['clicks']),
                'linkClicks': int(m['inline_link_clicks']),
                'reach': int(m['reach']),
                'leads': int(leads[0]['value']) if leads else None,
            },
            'facilities': rows,
            'reportingViewVolume': money(sum(Decimal(x['volume']) for x in cc['daily'] if x['month'] == key + '-01')),
        })
    return {
        'schema': 'storage-signal.reporting.v1',
        'refreshed': refreshed,
        'currency': 'USD',
        'adTimezone': meta['timezone'],
        'ccExtractedAt': cc['extractedAt'],
        'metaExtractedAt': meta['refreshed'],
        'periods': periods,
    }


if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    refreshed = date.today().isoformat()
    if '--refreshed' in sys.argv:
        refreshed = sys.argv[sys.argv.index('--refreshed') + 1]
    cc_path, google_path, meta_path = (Path(p) for p in args[:3])
    cc = json.loads(cc_path.read_text(encoding='utf-8-sig'))
    google = json.loads(google_path.read_text(encoding='utf-8-sig'))
    meta = json.loads(meta_path.read_text(encoding='utf-8-sig'))
    out = build(cc, google, meta, refreshed)
    target = Path(__file__).resolve().parents[1] / 'data' / 'reporting.json'
    target.write_text(json.dumps(out, indent=2) + '\n', encoding='utf-8')
    for p in out['periods']:
        print(p['id'], p['google'], p['meta'], 'CC net', round(sum(x['net'] or 0 for x in p['facilities']), 2))
