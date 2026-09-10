"""Build aggregate Meta reporting and evidence-backed observations from a local API extract.

Usage: python scripts/build-meta.py /private/path/meta-complete-source.json
No credentials, source writes, budget changes or network calls.
"""
import json, sys
from pathlib import Path

MONTHS = {'2026-06':'June','2026-07':'July','2026-08':'August','2026-09':'September 1–9'}
ACTION_FIELDS = [('leads','lead'),('formLeads','onsite_conversion.lead_grouped'),('websiteLeads','offsite_conversion.fb_pixel_lead'),('messages','onsite_conversion.messaging_conversation_started_7d'),('landingViews','landing_page_view'),('postEngagement','post_engagement'),('reactions','post_reaction'),('comments','comment'),('saves','onsite_conversion.post_save')]
def number(value):
    return float(value) if value is not None else None
def action(row, key, field='actions'):
    matches = [x for x in row.get(field, []) if x['action_type'] == key]
    assert len(matches) <= 1, 'Duplicate action name'
    return number(matches[0]['value']) if matches else 0
def metrics(row):
    result = {k:number(row.get(v)) for k,v in [('spend','spend'),('impressions','impressions'),('reach','reach'),('frequency','frequency'),('clicks','clicks'),('linkClicks','inline_link_clicks')]}
    for key, source in ACTION_FIELDS:
        result[key] = action(row, source)
    result['videoPlays'] = action(row, 'video_view', 'video_play_actions') if 'video_play_actions' in row else None
    return result
def cpl(row):
    return row['spend']/row['leads'] if row['leads'] else None
def link_ctr(row):
    return (row['linkClicks'] or 0)/row['impressions'] if row['impressions'] else None
def usd(value):
    return '${:,.2f}'.format(value) if value is not None else 'n/a'
def count(value):
    return '{:,.0f}'.format(value)
def summarize(rows):
    # Additive measures only. Never sum reach or frequency.
    return {k:sum((r.get(k) or 0) for r in rows) for k in ['spend','leads','impressions','linkClicks']}
def insight(title, observation, action_text, confidence, basis):
    return dict(title=title, observation=observation, action=action_text, confidence=confidence, basis=basis)
def make_insights(month, period, previous, weeks):
    account = period['account']; average = cpl(account); name=MONTHS[month]; insights=[]
    if previous and month != '2026-09':
        old = previous['account']; old_cpl=cpl(old)
        if old_cpl and average:
            change=100*(average/old_cpl-1)
            old_sets={r['id']:r for r in previous['adsets']};new_sets={r['id']:r for r in period['adsets']}
            changes=[]
            for group_id in old_sets.keys() | new_sets.keys():
                before=old_sets.get(group_id,{'leads':0,'spend':0});after=new_sets.get(group_id,{'leads':0,'spend':0})
                changes.append({'name':new_sets.get(group_id,old_sets.get(group_id))['name'],'leads':after['leads']-before['leads'],'spend':after['spend']-before['spend']})
            assert sum(r['leads'] for r in changes)==account['leads']-old['leads']
            biggest_gain=max(changes,key=lambda r:r['leads']);biggest_drop=min(changes,key=lambda r:r['leads'])
            drivers=''
            for label,row in [('Largest lead gain',biggest_gain),('Largest lead decline',biggest_drop)]:
                if (label.endswith('gain') and row['leads']>0) or (label.endswith('decline') and row['leads']<0):
                    drivers+=f" {label}: {row['name']} ({row['leads']:+.0f} leads, {row['spend']:+.2f} USD spend change)."
            insights.append(insight(
                f'Cost per lead {abs(change):.1f}% '+('lower' if change<0 else 'higher')+' than last month',
                f"{name}: {usd(account['spend'])}, {count(account['leads'])} leads and {usd(average)} CPL. Prior month: {usd(old['spend'])}, {count(old['leads'])} leads and {usd(old_cpl)} CPL."+drivers,
                'Review the largest declining ad set first and compare its offer, audience and ads with the prior month. Change one factor at a time.',
                'Observed monthly change', 'Complete calendar months; Meta lead action only. Different month lengths and lead quality can affect interpretation.'))
    if month == '2026-09':
        recent, prior=weeks['recentWeek'],weeks['priorWeek'];new=summarize(recent['rows']);old=summarize(prior['rows'])
        recent_cpl=cpl(new);prior_cpl=cpl(old)
        title='Compare September using equal seven-day windows'
        if recent_cpl and prior_cpl:
            change=100*(recent_cpl/prior_cpl-1)
            title=f'Latest seven-day CPL {abs(change):.1f}% '+('higher' if change>0 else 'lower')
        insights.append(insight(title,
            f"{recent['start']}–{recent['end']}: {usd(new['spend'])}, {count(new['leads'])} leads, {usd(cpl(new))} CPL. {prior['start']}–{prior['end']}: {usd(old['spend'])}, {count(old['leads'])} leads, {usd(cpl(old))} CPL.",
            'Keep the full September month-to-date total separate; use these equal windows to assess the latest movement.',
            'Limited recent volume' if min(new['leads'],old['leads'])<10 else 'Observed weekly change',
            'Each window is seven days. Platform results can be revised after reporting.'))
    qualified=[r for r in period['adsets'] if r['leads']>=10 and r['spend']>0]
    if qualified and average:
        best=min(qualified,key=cpl); share=100*best['leads']/account['leads'];spend_share=100*best['spend']/account['spend']
        insights.append(insight('Lead efficiency to investigate: '+best['name'],
            f"{usd(best['spend'])} generated {count(best['leads'])} leads at {usd(cpl(best))} CPL. This is {share:.1f}% of leads on {spend_share:.1f}% of spend; the account CPL is {usd(average)}.",
            'Review this ad set’s audience, offer and relevant storage capacity before a small budget test. Check lead quality separately; past CPL does not establish how extra spend will perform.',
            f"Observed · {count(best['leads'])} leads",'Lowest CPL among ad sets with at least 10 reported leads; descriptive, not a controlled experiment.'))
    else:
        insights.append(insight('More volume needed before choosing a winner',
            f"No ad set reached 10 Meta-reported leads in {name}. The account has {count(account['leads'])} leads.",
            'Keep comparisons provisional and review the longer completed month before making a large reallocation.',
            'Limited sample','Ten leads is a screening rule, not a statistical significance threshold.'))
    underperformers=[r for r in period['adsets'] if r['leads']>=5 and average and cpl(r)>average*1.25]
    if underperformers:
        weak=max(underperformers,key=cpl)
        insights.append(insight('Review higher-cost enquiries: '+weak['name'],
            f"{usd(weak['spend'])} generated {count(weak['leads'])} leads at {usd(cpl(weak))} CPL, {100*(cpl(weak)/average-1):.1f}% above the account average.",
            'Inspect the audience, offer and individual ads. Use a controlled change and monitor the next comparable period rather than assuming the audience should be paused.',
            'Limited sample' if weak['leads']<10 else 'Observed cost gap','Comparison mixes different audiences and locations; it does not measure lead quality.'))
    creative_candidates=[r for r in period['ads'] if r['leads']>=10]
    if creative_candidates and account['leads']:
        dominant=max(creative_candidates,key=lambda r:r['leads']);share=100*dominant['leads']/account['leads']
        if share>=35:
            insights.append(insight('Lead volume is concentrated in one ad',
                f"{dominant['name']} ({dominant['adsetName']}) generated {count(dominant['leads'])} leads at {usd(cpl(dominant))} CPL — {share:.1f}% of account leads.",
                'Keep a tested alternative creative available and monitor this ad weekly. Unequal delivery means this is not proof that its creative is intrinsically better.',
                'Observed concentration','Lead-share calculation uses ad-level results reconciled to the account; no causal creative ranking.'))
    recent,prior=weeks['recentWeek'],weeks['priorWeek'];old_by_id={r['id']:r for r in prior['rows']};eligible=[];flags=[]
    for row in recent['rows']:
        old=old_by_id.get(row['id'])
        if not old or min(row['leads'],old['leads'])<5 or min(row['impressions'] or 0,old['impressions'] or 0)<1000 or min(row['linkClicks'] or 0,old['linkClicks'] or 0)<30:
            continue
        eligible.append(row)
        if row['frequency'] and old['frequency'] and row['frequency']>=old['frequency']*1.2 and link_ctr(row)<=link_ctr(old)*.85 and cpl(row)>=cpl(old)*1.2:
            flags.append((row,old))
    if flags:
        row,old=flags[0]
        insights.append(insight('Possible fatigue signal: '+row['name'],
            f"Frequency rose from {old['frequency']:.2f} to {row['frequency']:.2f}; link CTR fell from {link_ctr(old)*100:.2f}% to {link_ctr(row)*100:.2f}%; CPL rose from {usd(cpl(old))} to {usd(cpl(row))}.",
            'Review the recent ad creative and audience saturation. Test one change at a time; auction competition and audience mix could also explain this pattern.',
            'Possible signal',f"{prior['start']}–{prior['end']} vs {recent['start']}–{recent['end']}. Rule: frequency +20%, link CTR −15%, CPL +20%, at least 5 leads, 30 link clicks and 1,000 impressions in both windows."))
    else:
        insights.append(insight('Creative fatigue is not established',
            f"{len(eligible)} ad set(s) had enough activity for the seven-day fatigue check; none met all three warning conditions.",
            'Keep monitoring frequency, link CTR and CPL together. Review individual ads when all three deteriorate; low-volume groups remain inconclusive.',
            'Inconclusive' if not eligible else 'No rule-based flag',f"{prior['start']}–{prior['end']} vs {recent['start']}–{recent['end']}. Screening rule requires frequency +20%, link CTR −15% and CPL +20%, with 5 leads, 30 link clicks and 1,000 impressions in each window. No flag does not prove the absence of fatigue."))
    return insights
def build(raw):
    output={'schema':'storage-signal.meta.v1','refreshed':raw['refreshed'][:10],'through':raw['through'],'timezone':raw['timezone'],'periods':{}}
    weekly={}
    available_actions={}
    for report in raw['reports']:
        available_actions.setdefault(report['kind'],set()).update(a['action_type'] for row in report['rows'] for a in row.get('actions',[]))
    for report in raw['reports']:
        month,kind=report['month'],report['kind'];rows=[]
        for source in report['rows']:
            row=metrics(source)
            if kind in ['placements','demographics','regions','devices']:
                # A whole breakdown can omit unsupported outcome categories.
                # Preserve these as unavailable, even when the account has leads.
                for key, action_name in ACTION_FIELDS:
                    if action_name not in available_actions[kind]:row[key]=None
            for key,field in [('campaignId','campaign_id'),('campaignName','campaign_name'),('adsetId','adset_id'),('adsetName','adset_name')]:
                if field in source:row[key]=source[field]
            if kind=='campaigns':row.update(id=source['campaign_id'],name=source['campaign_name'])
            elif kind in ['adsets','recentWeek','priorWeek']:row.update(id=source['adset_id'],name=source['adset_name'])
            elif kind=='ads':row.update(id=source['ad_id'],name=source['ad_name'])
            elif kind=='placements':row['label']=source['publisher_platform']+' / '+source['platform_position']
            elif kind=='demographics':row['label']=source['age']+' / '+source['gender']
            elif kind=='regions':row['label']=source['region']
            elif kind=='devices':row['label']=source['impression_device']
            rows.append(row)
        if kind in ['recentWeek','priorWeek']:
            weekly.setdefault(month,{})[kind]={'start':report['start'],'end':report['end'],'rows':rows}
        else:
            period=output['periods'].setdefault(month,{})
            if kind=='account':assert len(rows)==1;period[kind]=rows[0]
            else:period[kind]=rows
    previous=None
    for month in sorted(output['periods']):
        p=output['periods'][month]
        for kind in ['campaigns','adsets','ads']:
            assert abs(sum(r['spend'] for r in p[kind])-p['account']['spend'])<.011,(month,kind,'spend')
            assert sum(r['leads'] for r in p[kind])==p['account']['leads'],(month,kind,'leads')
        p['insights']=make_insights(month,p,previous,weekly[month]);p['weeklyEvidence']=weekly[month]
        previous=p
    return output

if __name__=='__main__':
    raw=json.loads(Path(sys.argv[1]).read_text(encoding='utf-8-sig'))
    out=build(raw)
    target=Path(__file__).resolve().parents[1]/'data'/'meta.json'
    target.write_text(json.dumps(out,separators=(',',':'),ensure_ascii=False)+'\n',encoding='utf-8')
    overview_path=target.parent/'reporting.json'
    overview=json.loads(overview_path.read_text(encoding='utf-8'))
    for period in overview['periods']:
        account=out['periods'][period['id']]['account']
        period['meta'].update({k:account[k] for k in ['spend','impressions','clicks','linkClicks','reach','leads']})
    overview['metaExtractedAt']=raw['refreshed']
    overview_path.write_text(json.dumps(overview,indent=2)+'\n',encoding='utf-8')
    for month,p in out['periods'].items():print(month,usd(p['account']['spend']),count(p['account']['leads'])+' leads',len(p['insights']),'insights')
