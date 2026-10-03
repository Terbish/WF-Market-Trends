'use strict';
const $ = id => document.getElementById(id);
const A = Analytics;
const state = {items:[],byId:new Map(),selected:null,variant:null,orders:[],side:'sell',highlightTab:'rising',feed:[],paused:false,history:{},statistics:{},statisticsPending:new Map(),watch:[],pending:new Map(),cache:new Map(),contextVersion:0};
const starterSlugs=['ash_prime_set','volt_prime_set','saryn_prime_set','mesa_prime_set','wukong_prime_set','nekros_prime_set','rhino_prime_set','mag_prime_set','nova_prime_set','revenant_prime_set','wisp_prime_set','gauss_prime_set'];
let historyBusy=false;
let sequence=0, refreshBusy=false, watchBusy=false;
function showError(message) { $('error').textContent=message; $('error').hidden=!message; }
function persist() {
  try { localStorage.setItem('wfmt-v1', JSON.stringify({platform:$('platform').value,crossplay:$('crossplay').checked,watch:state.watch,history:state.history})); }
  catch { showError('Local storage is full or unavailable. Watchlist and history could not be saved.'); }
}
function context() { return {platform:$('platform').value,crossplay:$('platform').value !== 'switch' && $('crossplay').checked}; }
function keyFor(itemId, variant=state.variant) { const c=context();return A.historyKey(c.platform,c.crossplay,itemId,variant); }
function request(kind, extra={}) {
  return new Promise((resolve,reject) => {
    if (!window.chrome?.webview) { reject(new Error('Open this dashboard in the Windows app to connect to warframe.market.')); return; }
    const id=String(++sequence), timer=setTimeout(() => {state.pending.delete(id);reject(new Error('Market request timed out. Please retry.'));},45000);
    state.pending.set(id,{resolve,reject,timer});
    window.chrome.webview.postMessage({id,kind,...context(),...extra});
  });
}
function nameOf(item) { return item?.i18n?.en?.name || item?.slug?.replaceAll('_',' ') || 'Unknown item'; }
function num(value) { return value == null ? '—' : value.toLocaleString(undefined,{maximumFractionDigits:1}); }
function element(tag, className, text) { const node=document.createElement(tag); if(className)node.className=className;if(text!=null)node.textContent=text;return node; }
function restore() {
  try {
    const saved=JSON.parse(localStorage.getItem('wfmt-v1')||'null');
    if (saved) {
      if (['pc','ps4','xbox','switch','mobile'].includes(saved.platform)) $('platform').value=saved.platform;
      $('crossplay').checked=saved.crossplay !== false;
      state.watch=Array.isArray(saved.watch)?saved.watch.filter(x => x && typeof x.itemId==='string' && typeof x.variant==='string').slice(0,20):[];
      if (saved.history && typeof saved.history==='object' && !Array.isArray(saved.history)) {
        for (const [key,points] of Object.entries(saved.history))
          if (Array.isArray(points)) state.history[key]=points.filter(p => p && Number.isFinite(p.time) && p.time>Date.now()-30*86400000 && Number.isFinite(p.median)).slice(-43200);
      }
    }
  } catch { showError('Saved tracker data could not be read. Starting with an empty watchlist.'); }
  $('crossplay').disabled=$('platform').value==='switch';
  if ($('crossplay').disabled) $('crossplay').checked=false;
}
function search() {
  const query=$('search').value.trim().toLowerCase();$('results').replaceChildren();
  if(!query){$('results').hidden=true;return;}
  $('results').hidden=false;
  const found=state.items.filter(item => nameOf(item).toLowerCase().includes(query)).slice(0,12);
  if(!found.length){$('results').append(element('p','',state.items.length?'No matching items.':'Catalog is loading.'));return;}
  for(const item of found){const button=element('button','',nameOf(item));button.type='button';button.onclick=()=>selectItem(item);$('results').append(button);}
}
async function getOrders(item) {
  const c=context(), key=[c.platform,c.crossplay,item.slug].join('/');
  const cached=state.cache.get(key);
  if(cached && Date.now()-cached.time<30000)return cached.data;
  const data=await request('orders',{slug:item.slug,...c});
  if(!Array.isArray(data))throw new Error('Unexpected order response from market.');
  state.cache.set(key,{time:Date.now(),data});return data;
}
async function selectItem(item, variant=null) {
  state.selected=item;state.variant=variant;state.orders=[];
  $('search').value='';$('results').hidden=true;$('detail').hidden=false;
  $('item-name').textContent=nameOf(item);$('variant').replaceChildren();
  renderDetail();renderWatch();
  void loadHistorical(item).catch(error=>{if(state.selected===item)$('history-status').textContent='Historical prices unavailable: '+error.message;});
  await refreshSelected();
}
async function loadHistorical(item) {
  const platform=$('platform').value,key=platform+'/'+item.id;
  if(state.statistics[key] && Date.now()-state.statistics[key].fetchedAt<3600000)return state.statistics[key];
  if(state.statisticsPending.has(key))return state.statisticsPending.get(key);
  const task=(async()=>{
    const payload=await request('statistics',{slug:item.slug,platform,crossplay:false});
    if(!payload?.statistics_live)throw new Error('Market returned no historical listing statistics.');
    const entry={platform,itemId:item.id,fetchedAt:Date.now(),series:A.historicalSeries(payload,item)};
    state.statistics[key]=entry;
    if($('platform').value===platform){renderHighlights();if(state.selected?.id===item.id){populateVariants();renderDetail();}}
    return entry;
  })();
  state.statisticsPending.set(key,task);
  try{return await task;}finally{state.statisticsPending.delete(key);}
}
async function refreshHistorical() {
  if(historyBusy || !state.items.length)return;
  historyBusy=true;$('history-refresh').disabled=true;const version=state.contextVersion;
  const candidates=new Map();
  for(const slug of starterSlugs){const item=state.items.find(x=>x.slug===slug);if(item)candidates.set(item.id,item);}
  for(const watched of state.watch){const item=state.byId.get(watched.itemId);if(item)candidates.set(item.id,item);}
  if(state.selected)candidates.set(state.selected.id,state.selected);
  let loaded=0,failed=0;
  try {
    for(const item of candidates.values()) {
      if(version!==state.contextVersion)break;
      $('history-status').textContent='Loading history · '+loaded+' / '+candidates.size+' items';
      try{await loadHistorical(item);loaded++;}
      catch(error){failed++;$('history-status').title=error.message;break;}
    }
    if(version===state.contextVersion)$('history-status').textContent=failed
      ? 'History partially unavailable · '+loaded+' items loaded. Try updating again.'
      : 'Historical prices ready · '+loaded+' items · hourly updates';
  } finally {
    historyBusy=false;$('history-refresh').disabled=false;
    if(version!==state.contextVersion)void refreshHistorical();
  }
}
function selectedHistorical() {return state.selected?state.statistics[$('platform').value+'/'+state.selected.id]?.series[state.variant]:null;}
function populateVariants() {
  const variants=new Map();
  for(const order of state.orders) variants.set(A.variant(order),A.variantLabel(order));
  for(const [key,series] of Object.entries(state.statistics[$('platform').value+'/'+state.selected.id]?.series || {}))variants.set(key,series.label);
  if(state.variant && !variants.has(state.variant))variants.set(state.variant,'Saved variant (no listings)');
  if(!variants.size){const base=state.selected?.maxRank != null?{rank:0}:{};variants.set(A.variant(base),A.variantLabel(base));}
  const sorted=[...variants].sort((a,b)=>a[1].localeCompare(b[1],undefined,{numeric:true}));
  if(!state.variant)state.variant=sorted.find(([key])=>key===A.variant(state.selected?.maxRank != null?{rank:0}:{}))?.[0] || sorted[0][0];
  $('variant').replaceChildren(...sorted.map(([key,label])=>{const option=element('option','',label);option.value=key;return option;}));
  $('variant').value=state.variant;
}
function record(itemId,variant,orders) {
  const summary=A.summarize(orders,variant), key=keyFor(itemId,variant);
  state.history[key]=A.appendSnapshot(state.history[key]||[],summary,Date.now());
  // Bound retention across inactive items/markets as well as the active chart.
  for(const [historyKey,points] of Object.entries(state.history)) {
    state.history[historyKey]=A.appendSnapshot(points,{median:null},Date.now());
    if(!state.history[historyKey].length)delete state.history[historyKey];
  }
  let total=Object.values(state.history).reduce((sum,points)=>sum+points.length,0);
  for(const historyKey of Object.keys(state.history).sort((a,b)=>state.history[a].at(-1).time-state.history[b].at(-1).time)) {
    if(total<=25000)break;
    if(historyKey===key)continue;
    total-=state.history[historyKey].length;delete state.history[historyKey];
  }
  persist();
  renderHighlights();
}
async function refreshSelected() {
  if(!state.selected || refreshBusy)return;
  const item=state.selected, version=state.contextVersion;
  refreshBusy=true;$('refresh').disabled=true;
  try {
    const orders=await getOrders(item);
    if(state.selected!==item || version!==state.contextVersion)return;
    state.orders=orders;populateVariants();record(item.id,state.variant,orders);
    renderDetail();renderWatch();showError('');
  } catch(error){if(state.selected===item && version===state.contextVersion)showError(error.message);}
  finally {refreshBusy=false;$('refresh').disabled=false;if(state.selected!==item || version!==state.contextVersion)void refreshSelected();}
}
function renderDetail() {
  if(!state.selected)return;
  const summary=A.summarize(state.orders,state.variant);
  $('lowest').textContent=num(summary.lowest);$('highest').textContent=num(summary.highest);$('median').textContent=num(summary.median);
  const watched=state.watch.some(x=>x.itemId===state.selected.id && x.variant===state.variant);
  $('watch').textContent=watched?'− Unwatch':'+ Watch';$('watch').disabled=!state.variant;
  $('order-count').textContent=summary.sell.length+' sell / '+summary.buy.length+' buy';
  const orders=summary[state.side];$('orders').replaceChildren();
  if(!orders.length)$('orders').append(element('p','empty','No online '+state.side+' orders for this variant.'));
  for(const order of orders.slice(0,8)){
    const row=element('div','order-row'), user=element('div','user',order.user?.ingameName || 'Unknown trader');
    user.append(element('small','',order.user?.status==='ingame'?'In game':'Online'));
    const quantity=element('span','muted','×'+order.quantity), price=element('div','amount',num(A.unitPrice(order))+' p');
    if(order.perTrade>1)price.append(element('small','',order.platinum+' p / '+order.perTrade+' units'));
    row.append(user,quantity,price);$('orders').append(row);
  }
  renderChart();
}
function renderChart() {
  const series=selectedHistorical(),historical=!!(series?.hourly.length || series?.daily.length);
  const source=historical?[...series.daily.filter(p=>!series.hourly.length || p.time<series.hourly[0].time),...series.hourly]:(state.history[keyFor(state.selected.id)]||[]);
  const points=source.filter(p=>p.time>Date.now()-Number($('range').value)*86400000 && p.time<=Date.now());
  $('chart-source').textContent=historical?'Historical median sell asking prices for this platform; crossplay applies to live orders. Listings are not completed trades.':'Local median sell asking prices. Historical data is unavailable for this variant; listings are not completed trades.';
  $('chart').replaceChildren();
  $('updated').textContent=points.length?(historical?'Latest hour ':'Snapshot ')+new Date(points.at(-1).time).toLocaleString([],{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}):'No price history';
  const change=A.percentChange(points);
  $('change').textContent=change==null?'Not enough price history':(change>=0?'+':'')+change.toFixed(1)+'% over displayed history';
  if(points.length<2){$('chart').append(element('p','empty','No usable historical prices for this variant yet.'));return;}
  const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 440 145');svg.setAttribute('role','img');
  svg.setAttribute('aria-label','Median online sell asking price, '+num(points[0].median)+' to '+num(points.at(-1).median)+' platinum');
  function add(tag,attrs,text){const node=document.createElementNS(ns,tag);for(const [key,value]of Object.entries(attrs))node.setAttribute(key,value);if(text)node.textContent=text;svg.append(node);return node;}
  const values=points.map(p=>p.median),min=Math.min(...values),max=Math.max(...values),pad=Math.max(1,(max-min)*.15),low=min-pad,high=max+pad;
  for(let i=0;i<3;i++){const y=20+i*48;add('line',{x1:40,x2:426,y1:y,y2:y,stroke:'#29313a','stroke-dasharray':'3 4'});add('text',{x:8,y:y+3,fill:'#8e9ba9','font-size':9},num(high-i*(high-low)/2));}
  const path=points.map((p,i)=>[40+(p.time-points[0].time)/(points.at(-1).time-points[0].time||1)*386,20+(high-p.median)/(high-low)*96]);
  add('polygon',{points:[[40,116],...path,[426,116]].map(p=>p.join(',')).join(' '),fill:'#dfbe7c12'});
  add('polyline',{points:path.map(p=>p.join(',')).join(' '),fill:'none',stroke:'#dfbe7c','stroke-width':2,'stroke-linejoin':'round'});
  const last=path.at(-1);add('circle',{cx:last[0],cy:last[1],r:3,fill:'#dfbe7c'});
  const label=time=>new Date(time).toLocaleString([],{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
  add('text',{x:40,y:136,fill:'#8e9ba9','font-size':8},label(points[0].time));add('text',{x:426,y:136,fill:'#8e9ba9','font-size':8,'text-anchor':'end'},label(points.at(-1).time));$('chart').append(svg);
}
function renderWatch() {
  renderHighlights();
  $('watch-count').textContent=state.watch.length+' / 20';$('watchlist').replaceChildren();
  if(!state.watch.length)$('watchlist').append(element('p','empty','Search for an item and add it to your watchlist.'));
  for(const watched of state.watch){
    const item=state.byId.get(watched.itemId),points=state.history[keyFor(watched.itemId,watched.variant)]||[];
    const card=element('button','watch-card'+(state.selected?.id===watched.itemId && state.variant===watched.variant?' selected':''));
    card.append(element('span','name',item?nameOf(item):watched.name),element('span','price',points.length?num(points.at(-1).lowest)+' p':'— p'));
    const meta=element('span','watch-meta');meta.append(element('span','',watched.label || 'Standard'),element('span','',points.length?new Date(points.at(-1).time).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}):'Awaiting data'));card.append(meta);
    card.onclick=()=>{if(item)void selectItem(item,watched.variant);};$('watchlist').append(card);
  }
}
function renderHighlights() {
  const c=context(), groups=A.historicalHighlights(state.statistics,c.platform,Date.now());
  const rows=groups[state.highlightTab].filter(row=>state.byId.has(row.itemId));
  $('highlights-description').textContent=state.highlightTab==='rising'
    ? 'Items gaining at least 5% over the last 24 hours, ranked by price increase.'
    : 'Items staying within 3% of their price 24 hours ago, with no more than 6% movement across the day.';
  $('highlights').replaceChildren();
  if(!rows.length) {
    $('highlights').append(element('p','empty',state.highlightTab==='rising'
      ? 'No qualifying risers in the available historical prices. Loading more items may add results.'
      : 'No qualifying steady items in the available historical prices. Loading more items may add results.'));
    return;
  }
  for(const row of rows.slice(0,8)) {
    const item=state.byId.get(row.itemId), button=element('button','highlight-row');
    const label=element('span','highlight-item',nameOf(item));
    const watched=state.watch.find(x=>x.itemId===row.itemId && x.variant===row.variant);
    const variantOrder=Object.fromEntries(row.variant.split('|').map(field=>{const index=field.indexOf(':');return [field.slice(0,index),field.slice(index+1)];}).filter(([,value])=>value!=='' && value!=='0'));
    label.append(element('small','',row.label || watched?.label || A.variantLabel(variantOrder)));
    const price=element('span','highlight-price',num(row.price)+' p');
    price.append(element('small','',new Date(row.time).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})));
    const change=element('span','highlight-change '+state.highlightTab,(row.change>=0?'+':'')+row.change.toFixed(1)+'%');
    button.append(label,price,change);button.onclick=()=>void selectItem(item,row.variant);$('highlights').append(button);
  }
}
function chooseHighlightTab(tab, focus=false) {
  state.highlightTab=tab;
  for(const name of ['rising','holding']) {
    const button=$(name+'-tab'),active=name===tab;
    button.classList.toggle('active',active);button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;
  }
  $('highlights-panel').setAttribute('aria-labelledby',tab+'-tab');
  renderHighlights();if(focus)$(tab+'-tab').focus();
}
function toggleWatch() {
  if(!state.selected || !state.variant)return;
  const index=state.watch.findIndex(x=>x.itemId===state.selected.id && x.variant===state.variant);
  if(index>=0)state.watch.splice(index,1);
  else {
    if(state.watch.length>=20){showError('Your watchlist has 20 entries. Remove an item to add another.');return;}
    state.watch.push({itemId:state.selected.id,variant:state.variant,name:nameOf(state.selected),label:$('variant').selectedOptions[0]?.textContent});
  }
  persist();renderWatch();renderDetail();void refreshHistorical();
}
async function refreshWatchlist() {
  if(watchBusy)return;watchBusy=true;const version=state.contextVersion;
  try {
    for(const watched of [...state.watch]){
      if(version!==state.contextVersion)break;
      const item=state.byId.get(watched.itemId);if(!item)continue;
      try{const orders=await getOrders(item);if(version!==state.contextVersion)break;record(item.id,watched.variant,orders);renderWatch();}
      catch(error){if(version===state.contextVersion)showError('Watchlist refresh: '+error.message);break;}
    }
  } finally {watchBusy=false;if(version!==state.contextVersion)void refreshWatchlist();}
}
function renderFeed() {
  $('feed').replaceChildren();
  if(!state.feed.length)$('feed').append(element('p','empty',state.paused?'Feed display paused.':'Waiting for the next listing…'));
  for(const order of state.feed.slice(0,8)){
    const item=state.byId.get(order.itemId),row=element('div','feed-row');row.append(element('span','side '+order.type,order.type.toUpperCase()));
    const button=element('button','',item?nameOf(item):'Item '+(order.itemId || 'unknown'));button.append(element('small','',A.variantLabel(order)+' · '+(order.user?.ingameName || 'Trader')));
    button.onclick=()=>{if(item)void selectItem(item,A.variant(order));};
    row.append(button,element('span','feed-price',num(A.unitPrice(order))+' p'));$('feed').append(row);
  }
}
async function subscribe() {
  try{await request('subscribe');}catch(error){showError(error.message);}
}
function changeMarket() {
  state.contextVersion++;state.cache.clear();state.feed=[];state.orders=[];
  $('crossplay').disabled=$('platform').value==='switch';if($('crossplay').disabled)$('crossplay').checked=false;
  $('status').textContent='Switching market…';$('status-dot').className='';
  persist();renderWatch();renderFeed();if(state.selected)renderDetail();void subscribe();void refreshSelected();void refreshWatchlist();void refreshHistorical();
}
if(window.chrome?.webview)window.chrome.webview.addEventListener('message',event=>{
  const message=event.data;
  if(message.id && state.pending.has(message.id)){const task=state.pending.get(message.id);clearTimeout(task.timer);state.pending.delete(message.id);message.error?task.reject(new Error(message.error)):task.resolve(message.data);return;}
  const c=context();if(message.platform!==c.platform || message.crossplay!==c.crossplay)return;
  if(message.type==='feedStatus'){$('status').textContent=message.status==='live'?'Live listing feed connected':message.status==='connecting'?'Connecting to live feed…':'Feed interrupted · reconnecting';$('status').title=message.detail||'';$('status-dot').className=message.status==='live'?'live':'';}
  else if(message.type==='newOrder' && !state.paused){const order=message.data;if(!order || !['sell','buy'].includes(order.type) || !Number.isFinite(order.platinum))return;if(state.feed.some(x=>x.id===order.id))return;state.feed.unshift(order);state.feed=state.feed.slice(0,40);renderFeed();}
});
$('search').oninput=search;
$('search').onkeydown=event=>{if(event.key==='Escape')$('results').hidden=true;if(event.key==='ArrowDown'){$('results').querySelector('button')?.focus();event.preventDefault();}};
document.addEventListener('click',event=>{if(!event.target.closest('.search'))$('results').hidden=true;});
$('watch').onclick=toggleWatch;$('refresh').onclick=()=>void refreshSelected();
$('variant').onchange=()=>{state.variant=$('variant').value;record(state.selected.id,state.variant,state.orders);renderDetail();renderWatch();};
$('range').onchange=renderChart;
for(const side of ['sell','buy'])$(side+'-tab').onclick=()=>{state.side=side;for(const other of ['sell','buy']){$(other+'-tab').classList.toggle('active',other===side);$(other+'-tab').setAttribute('aria-pressed',other===side);}renderDetail();};
$('pause').onclick=()=>{state.paused=!state.paused;$('pause').textContent=state.paused?'Resume':'Pause';};
$('platform').onchange=changeMarket;$('crossplay').onchange=changeMarket;
$('history-refresh').onclick=()=>void refreshHistorical();
for(const tab of ['rising','holding']) {
  $(tab+'-tab').onclick=()=>chooseHighlightTab(tab);
  $(tab+'-tab').onkeydown=event=>{
    if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) {
      event.preventDefault();chooseHighlightTab(event.key==='Home'?'rising':event.key==='End'?'holding':tab==='rising'?'holding':'rising',true);
    }
  };
}
async function start() {
  restore();renderWatch();
  try {
    await request('ready');void subscribe();
    const items=await request('items');if(!Array.isArray(items))throw new Error('Unexpected catalog response.');
    state.items=items.filter(x=>x.id && x.slug);state.byId=new Map(state.items.map(x=>[x.id,x]));renderWatch();search();
    const first=state.watch[0],item=first && state.byId.get(first.itemId);
    if(item)void selectItem(item,first.variant);void refreshWatchlist();void refreshHistorical();
  } catch(error){showError(error.message);$('status').textContent='Market unavailable';const retry=element('button','subtle','Retry connection');retry.onclick=()=>{retry.remove();void start();};$('error').append(document.createElement('br'),retry);}
}
setInterval(()=>{renderHighlights();void refreshSelected();},60000);setInterval(()=>void refreshWatchlist(),300000);setInterval(()=>void refreshHistorical(),3600000);void start();
