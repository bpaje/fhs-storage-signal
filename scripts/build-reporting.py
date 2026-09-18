"""Build the cross-platform Overview reporting file (data/reporting.json) from local API extracts.

Usage: python scripts/build-reporting.py <ccstorage-source.json> <google-report.json> <meta-complete-source.json> [--google-ads-source PATH] [--refreshed YYYY-MM-DD]
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
import argparse, calendar, json
from datetime import date
from decimal import Decimal
from pathlib import Path


CONVERSION_TOLERANCE = 0.005
CONVERSION_GROUPS = {
    'SUBMIT_LEAD_FORM': 'leads_and_calls',
    'PHONE_CALL_LEAD': 'leads_and_calls',
    'CONTACT': 'phone_clicks',
    'BEGIN_CHECKOUT': 'button_clicks',
    'STORE_VISIT': 'store_visits',
    'PURCHASE': 'rentals',
}
CONVERSION_GROUP_ORDER = (
    'leads_and_calls', 'phone_clicks', 'button_clicks',
    'store_visits', 'rentals', 'other',
)


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


def conversion_groups_by_month(source):
    if not source or 'conversionsByAction' not in source.get('reports', {}):
        return None
    grouped = {}
    for row in source['reports']['conversionsByAction']['rows']:
        month = row['segments.month'][:7]
        if month not in grouped:
            grouped[month] = {group: 0 for group in CONVERSION_GROUP_ORDER}
        category = row['segments.conversion_action_category']
        grouped[month][CONVERSION_GROUPS.get(category, 'other')] += row['metrics.conversions']
    return grouped


def build(cc, google, meta, refreshed, google_ads_source=None):
    periods = []
    conversion_groups = conversion_groups_by_month(google_ads_source)
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
        google_summary = {
            'spend': money(sum(x['metrics.cost_micros'] for x in g) / 1000000),
            'impressions': sum(x['metrics.impressions'] for x in g),
            'clicks': sum(x['metrics.clicks'] for x in g),
            'conversions': round(sum(x['metrics.conversions'] for x in g), 6),
        }
        if conversion_groups is not None:
            groups = conversion_groups.get(key, {group: 0 for group in CONVERSION_GROUP_ORDER})
            split_total = sum(groups.values())
            assert abs(split_total - google_summary['conversions']) <= CONVERSION_TOLERANCE, (
                f'{key} Google conversion-action reconciliation', split_total, google_summary['conversions'],
            )
            google_summary['conversionsByGroup'] = groups
        periods.append({
            'id': key,
            'label': period_label(start, end),
            'start': start,
            'end': end,
            'partial': is_partial(start, end),
            'google': google_summary,
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
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('ccstorage_source', type=Path)
    parser.add_argument('google_report', type=Path)
    parser.add_argument('meta_source', type=Path)
    parser.add_argument('--google-ads-source', type=Path)
    parser.add_argument('--refreshed', default=date.today().isoformat())
    args = parser.parse_args()
    cc = json.loads(args.ccstorage_source.read_text(encoding='utf-8-sig'))
    google = json.loads(args.google_report.read_text(encoding='utf-8-sig'))
    meta = json.loads(args.meta_source.read_text(encoding='utf-8-sig'))
    google_ads_source_path = args.google_ads_source
    if google_ads_source_path is None:
        candidate = args.google_report.with_name('google-ads-source.json')
        if candidate.exists():
            google_ads_source_path = candidate
    google_ads_source = json.loads(google_ads_source_path.read_text(encoding='utf-8-sig')) if google_ads_source_path else None
    out = build(cc, google, meta, args.refreshed, google_ads_source)
    target = Path(__file__).resolve().parents[1] / 'data' / 'reporting.json'
    target.write_text(json.dumps(out, indent=2) + '\n', encoding='utf-8')
    for p in out['periods']:
        print(p['id'], p['google'], p['meta'], 'CC net', round(sum(x['net'] or 0 for x in p['facilities']), 2))
