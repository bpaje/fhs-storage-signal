"""Build public Google Ads aggregates from a private, bounded MCP source extract.

Usage: python scripts/build-google-ads.py /private/path/google-ads-2026-source.json
The source records exact MCP query arguments and full returned rows. No credentials
are accepted or written. This script performs no network calls or ad mutations.
"""
import argparse
import calendar
import json
from collections import defaultdict
from datetime import date
from pathlib import Path


METRICS = {
    'costMicros': 'metrics.cost_micros',
    'impressions': 'metrics.impressions',
    'clicks': 'metrics.clicks',
    'conversions': 'metrics.conversions',
}
CONVERSION_TOLERANCE = 0.005


def source_metrics(row):
    return {public: row[source] for public, source in METRICS.items()}


def totals(rows):
    return {metric: sum(row[metric] for row in rows) for metric in METRICS}


def with_rates(row):
    cost = row['costMicros'] / 1e6
    return {
        **row,
        'ctr': row['clicks'] / row['impressions'] if row['impressions'] else None,
        'cpc': cost / row['clicks'] if row['clicks'] else None,
        'cpa': cost / row['conversions'] if row['conversions'] else None,
    }


def add_ytd(rows, identity_fields):
    buckets = {}
    for row in rows:
        key = tuple(row[field] for field in identity_fields)
        if key not in buckets:
            buckets[key] = {
                'month': '2026-ytd',
                **{field: row[field] for field in identity_fields},
                **{metric: 0 for metric in METRICS},
            }
        for metric in METRICS:
            buckets[key][metric] += row[metric]
    return [with_rates(row) for row in rows] + [with_rates(row) for row in buckets.values()]


def assert_reconciles(actual, expected, label):
    for metric in METRICS:
        delta = abs(actual[metric] - expected[metric])
        limit = CONVERSION_TOLERANCE if metric == 'conversions' else 0
        assert delta <= limit, (label, metric, actual[metric], expected[metric])


def build(source):
    assert source['schema'] == 'storage-signal.google-ads-source.v1'
    start, through = date.fromisoformat(source['start']), date.fromisoformat(source['through'])
    assert start == date(2026, 1, 1) and through.year == 2026
    reports = source['reports']
    required = ['account', 'accountYtd', 'campaigns', 'groups', 'geography', 'geonames']
    counts = {}
    for name in required:
        report = reports[name]
        limit = report['query']['limit']
        counts[name] = len(report['rows'])
        assert counts[name] < limit, f'{name} reached the query cap; retrieve bounded partitions before building'
        if name != 'geonames':
            assert report['query']['conditions'] == [f"segments.date BETWEEN '{start}' AND '{through}'"]
        assert str(report['query']['customer_id']) == str(source['account']['customer_client.id'])
    assert len(reports['accountYtd']['rows']) <= 1
    names = {
        row['geo_target_constant.resource_name']: row['geo_target_constant.canonical_name'].replace(',', ', ')
        for row in reports['geonames']['rows']
    }
    periods = []
    account_by_month = {row['segments.month'][:7]: source_metrics(row) for row in reports['account']['rows']}
    assert len(account_by_month) == len(reports['account']['rows'])
    account_totals, coverage = [], {}
    for month in range(1, through.month + 1):
        month_start = date(2026, month, 1)
        month_end = min(date(2026, month, calendar.monthrange(2026, month)[1]), through)
        period_id = month_start.strftime('%Y-%m')
        partial = month_end.day < calendar.monthrange(2026, month)[1]
        label = month_start.strftime('%B %Y') + (f' · 1–{month_end.day} MTD' if partial else '')
        periods.append({'id': period_id, 'label': label, 'start': str(month_start), 'end': str(month_end), 'partial': partial})
        # Successful exhaustive date-segmented metric reports omit zero-delivery rows.
        account = account_by_month.get(period_id, {metric: 0 for metric in METRICS})
        account_totals.append(with_rates({'month': period_id, **account}))
        has_delivery = any(account.values())
        coverage[period_id] = {
            'status': 'available' if has_delivery else 'no_delivery',
            'note': 'Successful account and detail reads cover this full reporting period.' if has_delivery else 'The successful account report returned no delivery for this period.',
        }
    assert set(account_by_month) <= {period['id'] for period in periods}
    campaigns, groups, geography = [], [], []
    for row in reports['campaigns']['rows']:
        name = row['campaign.name']
        campaigns.append({
            'month': row['segments.month'][:7], 'id': str(row['campaign.id']),
            'name': name, 'location': name.removeprefix('[FHS] ').removesuffix(' Search'),
            'type': row['campaign.advertising_channel_type'], **source_metrics(row),
        })
    for row in reports['groups']['rows']:
        groups.append({
            'month': row['segments.month'][:7], 'campaignId': str(row['campaign.id']),
            'id': str(row['ad_group.id']), 'name': row['ad_group.name'], **source_metrics(row),
        })
    for row in reports['geography']['rows']:
        geo_id = row.get('segments.geo_target_city')
        assert not geo_id or geo_id == 'geoTargetConstants/0' or geo_id in names, f'Missing city label: {geo_id}'
        geography.append({
            'month': row['segments.month'][:7], 'campaignId': str(row['campaign.id']),
            'city': names.get(geo_id, 'Unknown city'), 'locationType': row['geographic_view.location_type'],
            **source_metrics(row),
        })
    campaigns = add_ytd(campaigns, ['id', 'name', 'location', 'type'])
    groups = add_ytd(groups, ['campaignId', 'id', 'name'])
    geography = add_ytd(geography, ['campaignId', 'city', 'locationType'])
    periods.append({
        'id': '2026-ytd', 'label': '2026 year to date', 'start': str(start), 'end': str(through),
        'partial': through != date(2026, 12, 31),
    })
    account_ytd = source_metrics(reports['accountYtd']['rows'][0]) if reports['accountYtd']['rows'] else {metric: 0 for metric in METRICS}
    assert_reconciles(totals(account_totals), account_ytd, 'Monthly account sum versus independent YTD')
    account_totals.append(with_rates({'month': '2026-ytd', **account_ytd}))
    coverage['2026-ytd'] = {
        'status': 'available' if any(account_ytd.values()) else 'no_delivery',
        'note': f'January 1–{through.strftime("%B")} {through.day}, 2026. Future dates are not included.',
    }
    reconciliation = {}
    for account in account_totals:
        month = account['month']
        checks = {}
        for label, rows in [('campaigns', campaigns), ('groups', groups)]:
            actual = totals([row for row in rows if row['month'] == month])
            assert_reconciles(actual, account, f'{month} {label}')
            checks[label] = {'exactDeliveryTotals': True, 'conversionDifference': actual['conversions'] - account['conversions']}
        campaign_ids = {row['id'] for row in campaigns if row['month'] == month}
        assert all(row['campaignId'] in campaign_ids for row in groups + geography if row['month'] == month)
        geo_total = totals([row for row in geography if row['month'] == month])
        checks['geography'] = {**geo_total, 'spendCoverage': geo_total['costMicros'] / account['costMicros'] if account['costMicros'] else None}
        reconciliation[month] = checks
    return {
        'schema': 'storage-signal.ads-details.v1', 'refreshed': source['extractedAt'][:10],
        'extractedAt': source['extractedAt'], 'from': str(start), 'through': str(through),
        'currency': source['account']['customer_client.currency_code'],
        'timeZone': source['account']['customer_client.time_zone'],
        'periods': periods, 'coverage': coverage, 'accountTotals': account_totals,
        'campaigns': campaigns, 'groups': groups, 'geography': geography,
        'validation': {
            'sourceRowCounts': counts, 'queryRowLimit': source['pagination']['limit'],
            'allResultsBelowLimit': True, 'allCityLabelsResolved': True,
            'accountYtdDirectRead': True, 'conversionTolerance': CONVERSION_TOLERANCE,
            'reconciliation': reconciliation,
        },
        'notes': [
            'Year-to-date account totals are independently queried; additive monthly delivery sums reconcile. Detail YTD rows sum monthly source rows and recompute rates.',
            'Google Ads fractional conversions can differ slightly by reporting grain. Source values are retained; delivery totals reconcile exactly and conversion differences are below 0.005.',
            'City delivery does not cover all account activity. City rows describe audience geography, not facility attribution.',
            'Conversions are Google Ads reported conversions, not verified storage rentals. Historical source metrics can be revised.',
            'This is a manual reporting snapshot through the last included date, not a complete future calendar year.',
        ],
    }


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('--output', type=Path, default=Path(__file__).resolve().parents[1] / 'data' / 'google-ads.json')
    args = parser.parse_args()
    result = build(json.loads(args.source.read_text(encoding='utf-8-sig')))
    args.output.write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
    print(json.dumps({'periods': len(result['periods']), 'through': result['through'], 'accountTotals': result['accountTotals'], 'rows': result['validation']['sourceRowCounts']}, indent=2))
