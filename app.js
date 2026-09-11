"use strict";
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=(v,kind='number')=>v==null?'n/a':new Intl.NumberFormat('en-US',kind==='money'?{style:'currency',currency:'USD',maximumFractionDigits:2}:kind==='percent'?{style:'percent',maximumFractionDigits:1}:{maximumFractionDigits:2}).format(v);
const state={period:'2026-08',brand:'all',facility:'all',compare:'previous',chart:'spend',coverage:'all',search:'',sort:'net',direction:-1,page:1};
let report;
const current=()=>report.periods.find(p=>p.id===state.period);
const selected=p=>p.facilities.filter(f=>(state.brand==='all'||f.brand===state.brand)&&(state.facility==='all'||f.id===state.facility));
function aggregate(rows){
 const sum=key=>{const values=rows.map(r=>r[key]).filter(v=>v!=null);return values.length?values.reduce((a,b)=>a+b,0):null;};
 const out=Object.fromEntries(['net','gross','refunds','payments','moveIns','moveOuts','leases','units','autopay'].map(k=>[k,sum(k)]));
 out.occupancy=out.units?out.leases/out.units:null;out.coverage=rows.filter(f=>f.net!=null).length;out.total=rows.length;return out;
}
const definitions=[
 ['Advertising','Spend, impressions and clicks are direct Google Ads and Meta Ads account totals in USD. Ad dates use America/New_York. Storage filters affect CCStorage only; advertising stays account-wide.'],
 ['Platform results','Google conversions may be fractional. Meta leads use only the action named lead, without adding overlapping subtypes. These are separate platform-reported results, not distinct renters.'],
 ['Net recorded payments','Original eligible payment amounts less current refunds, grouped by original payment effective month. Includes Complete, Manually Entered, Partially Refunded and Refunded; excludes Declined, Void and Pending Approval. Current refunds can revise historical months. This is the payment register, not audited revenue or bank deposits.'],
 ['Reporting-view volume','The separate CCStorage reporting view differs from the payment register. This dashboard consistently uses the register; the full-portfolio view total is disclosed in reporting notes for reconciliation.'],
 ['Moves','Counts from current non-void leases by move-in and move-out date. Lease events are not distinct customers. Zero means no matching event. Unavailable payment or occupancy history is n/a.'],
 ['Occupancy','Reported occupied leases divided by reported storage units at month end, or September 9 for MTD. Portfolio occupancy is weighted by units. Missing facilities are excluded. Counts exceeding capacity are flagged.'],
 ['Coverage and comparisons','The current roster contains 39 facilities. Historical coverage varies. CCStorage percentage comparisons are suppressed when the facilities with data differ. September 1–9 is not compared with a full prior month. These snapshots are manually refreshed and source systems may revise historical results.']
];
function openDefinitions(){ $('#modal-title').textContent='Reporting definitions';$('#modal-body').innerHTML=definitions.map(([title,body])=>`<div class="definition-card"><strong>${esc(title)}</strong><p>${esc(body)}</p></div>`).join('');$('#backdrop').classList.remove('hidden');$('#info-modal').classList.remove('hidden'); }
function closeOverlays(){ $('#drawer').classList.remove('open');$('#drawer').setAttribute('aria-hidden','true');$('#info-modal').classList.add('hidden');$('#backdrop').classList.add('hidden'); }
function comparison(key,source){
 if(state.compare==='none')return '';
 const p=current(),prev=report.periods[report.periods.indexOf(p)-1];
 if(p.partial)return 'MTD · no full-month comparison';if(!prev)return 'First reporting month';
 let a,b;
 if(source){a=p[source][key];b=prev[source][key];}else{
  const field=key==='occupancy'?'units':key;
  const ids=p=>selected(p).filter(f=>f[field]!=null).map(f=>f.id).sort().join(',');
  if(ids(p)!==ids(prev))return 'Coverage changed · see notes';
  a=aggregate(selected(p))[key];b=aggregate(selected(prev))[key];
 }
 if(a==null||b==null||b===0)return 'No comparable prior value';
 return key==='occupancy'?`${((a-b)*100).toFixed(1)} pp vs prior month`:`${a>=b?'+':''}${((a-b)/b*100).toFixed(1)}% vs prior month`;
}
function renderFilters(){
 const periods=typeof availablePeriods==='function'?availablePeriods():report.periods;
 if(!periods.some(p=>p.id===state.period))state.period=(periods.find(p=>p.id==='2026-08')||periods.findLast(p=>!p.partial)||periods[0]).id;
 $('#period-filter').innerHTML=periods.map(p=>`<option value="${esc(p.id)}">${esc(p.label)}</option>`).join('');$('#period-filter').value=state.period;
 const facilities=(current()||report.periods[0]).facilities;
 $('#brand-filter').innerHTML='<option value="all">All brands</option>'+[...new Set(facilities.map(f=>f.brand))].sort().map(b=>`<option>${esc(b)}</option>`).join('');$('#brand-filter').value=state.brand;
 $('#facility-filter').innerHTML='<option value="all">All facilities</option>'+facilities.filter(f=>state.brand==='all'||f.brand===state.brand).map(f=>`<option value="${f.id}">${esc(f.name)}</option>`).join('');$('#facility-filter').value=state.facility;
}
function render(){
 if(typeof detail!=='undefined'&&detail.view!=='overview'){renderDetailViews();return;}
 const p=current(),rows=selected(p),cc=aggregate(rows);
 $('#mode-ribbon').textContent=`Monthly reporting · ${p.label} · USD`;
 $('#snapshot-label').textContent=`Updated ${report.refreshed}`;$('#facility-count').textContent=`${p.facilities.length} facilities`;
 $('#freshness').innerHTML=`<span class="freshness-dot"></span><div><strong>${esc(p.label)}</strong><small>Sources refreshed ${report.refreshed}</small></div>`;
 $('#source-strip').innerHTML=[['google','G','Google Ads'],['meta','M','Meta Ads'],['cc','CC','CCStorage']].map(([cls,icon,name])=>`<div class="source-item"><i class="source-logo ${cls}">${icon}</i><strong>${name}</strong><span>${p.start} – ${p.end}</span><b class="state ok">Loaded</b></div>`).join('');
 const cards=[['Google Ads spend',p.google.spend,'money','spend','google','Account-wide'],['Meta Ads spend',p.meta.spend,'money','spend','meta','Account-wide'],['Net recorded payments',cc.net,'money','net',null,`${cc.coverage}/${cc.total} facilities with payments`],['Move-ins',cc.moveIns,'number','moveIns',null,'CCStorage lease events'],['Move-outs',cc.moveOuts,'number','moveOuts',null,'CCStorage lease events'],['Occupancy',cc.occupancy,'percent','occupancy',null,`${rows.filter(f=>f.units!=null).length}/${cc.total} facilities · ${p.end}`]];
 $('#kpi-grid').innerHTML=cards.map(([label,value,kind,key,source,note])=>`<article class="kpi-card"><div class="kpi-head">${label}</div><div class="kpi-value">${fmt(value,kind)}</div><div class="report-note">${esc(note)}</div><div class="report-comparison">${esc(comparison(key,source))}</div></article>`).join('');
 const ops=[['Gross recorded payments',cc.gross,'money','Before current refunds'],['Refund adjustments',cc.refunds,'money','Applied to original payment month'],['Eligible payments',cc.payments,'number','Payments included in register totals'],['Occupied leases / units',`${fmt(cc.leases)} / ${fmt(cc.units)}`,'text',`Snapshot: ${p.end}`],['Leases on autopay',cc.autopay,'number','At the occupancy snapshot']];
 $('#outcome-list').innerHTML=ops.map(([name,value,kind,note])=>`<div class="outcome-row"><div><strong>${name}</strong><small>${note}</small></div><div><b>${kind==='text'?value:fmt(value,kind)}</b></div></div>`).join('');
 $('#channel-mode').textContent=p.partial?'MTD':'Monthly';
 $('#channel-list').innerHTML='<div class="channel-head"><span>Platform</span><span>Spend</span><span>Impressions</span><span>Clicks</span><span>Platform results</span></div>'+[['Google Ads',p.google,p.google.conversions,'Conversions'],['Meta Ads',p.meta,p.meta.leads,'Leads']].map(([name,data,result,label])=>`<div class="channel-row"><div class="channel-name"><div><strong>${name}</strong><small>Entire ad account</small></div></div><span>${fmt(data.spend,'money')}</span><span>${fmt(data.impressions)}</span><span>${fmt(data.clicks)}</span><span class="channel-lead"><strong>${fmt(result)}</strong><small>${label}</small></span></div>`).join('')+`<p class="report-note">Meta reach: ${fmt(p.meta.reach)} · Link clicks: ${fmt(p.meta.linkClicks)}<br>Platform results use each platform's own definition.</p>`;
 const notes=[['Historical coverage',`${cc.coverage} of ${cc.total} selected facilities have payment data; ${rows.filter(f=>f.units!=null).length} have occupancy. Missing history is n/a.`],['Payment basis',`Net payments use the payment register. The separate CCStorage reporting-view volume is ${fmt(p.reportingViewVolume,'money')} for the full portfolio; the difference is unresolved.`],['Period and refresh',`${p.partial?'September covers days 1–9 only.':'Complete calendar month.'} Refreshed September 10. Updates are manual.`]];
 const anomalies=rows.filter(f=>f.occupancy>1);if(anomalies.length)notes.push(['Occupancy review',anomalies.map(f=>`${f.name}: ${f.leases} leases / ${f.units} units`).join('; ')]);
 $('#attention-count').textContent=`${notes.length} notes`;$('#attention-list').innerHTML=notes.map(([title,note])=>`<button type="button"><div><strong>${title}</strong><small>${esc(note)}</small></div><b>i</b></button>`).join('');$$('#attention-list button').forEach(b=>b.onclick=openDefinitions);
 $('#footer-note').textContent=`USD · Google Ads and Meta Ads: account-wide · CCStorage: selected facilities · Data through ${p.end}`;
 renderTrend();renderTable();if(typeof renderDetailViews==='function')renderDetailViews();
}
function renderTrend(){
 const metric=state.chart,kind=metric==='moveIns'?'number':'money',value=p=>metric==='spend'?p.google.spend+p.meta.spend:aggregate(selected(p))[metric];
 const label={spend:'Total advertising spend',net:'Net recorded payments',moveIns:'Move-ins'}[metric];
 $('#trend-label').textContent=label;$('#trend-total').textContent=fmt(value(current()),kind);$('#trend-delta').textContent=current().label;
 $('#trend-subtitle').textContent=`June–September · September is 1–9 only${metric==='spend'?' · account-wide':' · selected facilities'}`;$('#legend-primary').textContent='Monthly totals';
 const values=report.periods.map(value),max=Math.max(1,...values.filter(v=>v!=null));
 $('#trend-chart').setAttribute('aria-label',label+': '+report.periods.map((p,i)=>p.label+' '+fmt(values[i],kind)).join('; '));
 $('#trend-chart').innerHTML=`<svg viewBox="0 0 650 200" role="presentation">${report.periods.map((p,i)=>{const v=values[i],h=v==null?0:Math.max(0,v/max*125),x=40+i*160;return `<g><title>${esc(p.label)}: ${fmt(v,kind)}</title><rect x="${x}" y="${160-h}" width="85" height="${h}" rx="5" class="overview-bar${p.partial?' is-partial':''}${p.id===state.period?' is-selected':''}"/><text x="${x+42}" y="${151-h}" text-anchor="middle" fill="var(--ink)" font-size="11">${fmt(v,kind)}</text><text x="${x+42}" y="185" text-anchor="middle" fill="var(--muted)" font-size="12">${['June','July','August','Sept 1–9'][i]}</text></g>`;}).join('')}</svg>`;
 $$('.chart-toggle button').forEach(b=>b.classList.toggle('active',b.dataset.chart===state.chart));
}
function renderTable(){
 const rows=selected(current()).filter(f=>f.name.toLowerCase().includes(state.search)&&(state.coverage==='all'||(state.coverage==='available'?f.net!=null:f.net==null)));
 rows.sort((a,b)=>{const x=a[state.sort],y=b[state.sort];if(x==null)return y==null?0:1;if(y==null)return -1;return(typeof x==='string'?x.localeCompare(y):x-y)*state.direction;});
 const pages=Math.max(1,Math.ceil(rows.length/8));state.page=Math.min(state.page,pages);const start=(state.page-1)*8;
 $('#facility-tbody').innerHTML=rows.slice(start,start+8).map(f=>`<tr><td><button class="facility-open" data-id="${f.id}">${esc(f.name)}</button><small class="report-note">${esc(f.brand)}</small></td><td>${fmt(f.net,'money')}</td><td>${fmt(f.moveIns)}</td><td>${fmt(f.moveOuts)}</td><td>${fmt(f.occupancy,'percent')}${f.occupancy>1?' ⚠':''}</td><td><span class="state ${f.net!=null&&f.units!=null?'ok':'warn'}">${f.net!=null&&f.units!=null?'Available':'Missing history'}</span></td></tr>`).join('')||'<tr><td colspan="6">No facilities match these filters.</td></tr>';
 $('#table-result-count').textContent=rows.length?`${start+1}–${Math.min(start+8,rows.length)} of ${rows.length} facilities`:'No matching facilities';
 $('#pagination').innerHTML=Array.from({length:pages},(_,i)=>`<button class="page-button ${i+1===state.page?'active':''}" data-page="${i+1}" aria-label="Page ${i+1}">${i+1}</button>`).join('');
 $$('[data-page]').forEach(b=>b.onclick=()=>{state.page=Number(b.dataset.page);renderTable();});$$('.facility-open').forEach(b=>b.onclick=()=>openFacility(b.dataset.id));
}
function openFacility(id){
 const p=current(),f=p.facilities.find(f=>f.id===id);$('#drawer-title').textContent=f.name;$('#drawer-eyebrow').textContent=p.label;
 $('#drawer-body').innerHTML=`<p class="drawer-note">CCStorage · ${p.start} through ${p.end}</p><div class="drawer-kpis">${[['Net payments',f.net,'money'],['Gross payments',f.gross,'money'],['Refund adjustments',f.refunds,'money'],['Move-ins',f.moveIns],['Move-outs',f.moveOuts],['Occupancy',f.occupancy,'percent'],['Occupied leases',f.leases],['Storage units',f.units],['Autopay leases',f.autopay]].map(([label,value,kind])=>`<div class="drawer-kpi"><span>${label}</span><strong>${fmt(value,kind)}</strong></div>`).join('')}</div><p class="drawer-note">${f.net==null?'No payment history returned for this period. ':''}${f.units==null?'No occupancy snapshot returned. ':''}${f.occupancy>1?'Source leases exceed reported units; review this occupancy count. ':''}Advertising totals are account-wide.</p>`;
 $('#backdrop').classList.remove('hidden');$('#drawer').classList.add('open');$('#drawer').setAttribute('aria-hidden','false');
}
function bindEvents(){
 for(const[id,key]of[['period-filter','period'],['brand-filter','brand'],['facility-filter','facility'],['compare-filter','compare']])$('#'+id).onchange=e=>{state[key]=e.target.value;if(key==='brand')state.facility='all';if(key==='period'&&typeof detail!=='undefined')detail.periodNotice='';state.page=1;renderFilters();render();};
 $('#health-filter').onchange=e=>{state.coverage=e.target.value;state.page=1;renderTable();};$('#table-search').oninput=e=>{state.search=e.target.value.toLowerCase().trim();state.page=1;renderTable();};
 $('#reset-filters').onclick=()=>{Object.assign(state,{period:'2026-08',brand:'all',facility:'all',compare:'previous',coverage:'all',search:'',page:1,chart:'spend',sort:'net',direction:-1});$('#health-filter').value='all';$('#table-search').value='';$('#compare-filter').value='previous';renderFilters();render();};
 $$('.chart-toggle button').forEach(b=>b.onclick=()=>{state.chart=b.dataset.chart;renderTrend();});
 $$('[data-sort]').forEach(b=>{b.tabIndex=0;b.onclick=()=>{state.direction=state.sort===b.dataset.sort?-state.direction:-1;state.sort=b.dataset.sort;renderTable();};b.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();b.click();}};});
 ['definitions-button','outcome-info','help-button'].forEach(id=>$('#'+id).onclick=openDefinitions);['drawer-close','backdrop'].forEach(id=>$('#'+id).onclick=closeOverlays);$('[data-close-modal]').onclick=closeOverlays;
 document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeOverlays();$('#sidebar').classList.remove('open');}});$('#mobile-menu').onclick=()=>$('#sidebar').classList.toggle('open');
}
(async()=>{try{const response=await fetch('data/reporting.json',{cache:'no-store'});if(!response.ok)throw new Error('Report unavailable');report=await response.json();if(report.schema!=='storage-signal.reporting.v1'||!report.periods?.length)throw new Error('Invalid report');renderFilters();render();bindEvents();}catch(error){$('#mode-ribbon').textContent='Report could not be loaded';$('#content').innerHTML='<section class="panel load-failure"><h2>Reporting data is unavailable</h2><p>Please reload the page or check the published data file.</p></section>';console.error(error);}})();
