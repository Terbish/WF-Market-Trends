const {test}=require('node:test');
const assert=require('node:assert/strict');
const A=require('../WFMarketTrends/Web/analytics.js');
const order=(type,platinum,extra={})=>({type,platinum,quantity:1,user:{status:'online'},...extra});
test('online order book excludes offline and hidden orders, sorts both sides and computes an unweighted median',()=>{
  const orders=[order('sell',30),order('sell',10),order('sell',20),order('buy',9),order('buy',12),order('sell',1,{user:{status:'offline'}}),order('sell',2,{visible:false})];
  const stats=A.summarize(orders,A.variant({}));
  assert.equal(stats.lowest,10);assert.equal(stats.highest,12);assert.equal(stats.median,20);assert.equal(stats.sell.length,3);
});
test('bulk prices are normalized per unit and even-count medians average the middle prices',()=>{
  const stats=A.summarize([order('sell',60,{perTrade:6}),order('sell',24,{perTrade:2})],A.variant({}));
  assert.equal(stats.lowest,10);assert.equal(stats.median,11);
});
test('all documented variant fields separate prices; missing rank and zero rank agree',()=>{
  assert.equal(A.variant({}),A.variant({rank:0}));
  for(const field of ['rank','charges','amberStars','cyanStars','subtype'])assert.notEqual(A.variant({}),A.variant({[field]:1}));
  const stats=A.summarize([order('sell',10,{rank:0}),order('sell',200,{rank:10})],A.variant({rank:0}));assert.equal(stats.median,10);
});
test('history is isolated by platform, crossplay and variant, with switch crossplay always disabled',()=>{
  assert.notEqual(A.historyKey('pc',true,'item','a'),A.historyKey('pc',false,'item','a'));
  assert.notEqual(A.historyKey('pc',true,'item','a'),A.historyKey('xbox',true,'item','a'));
  assert.notEqual(A.historyKey('pc',true,'item','a'),A.historyKey('pc',true,'item','b'));
  assert.equal(A.historyKey('switch',true,'item','a'),A.historyKey('switch',false,'item','a'));
});
test('snapshots prune old data, avoid duplicate minute points and never invent missing prices',()=>{
  const now=Date.now(),summary={median:10,lowest:9,highest:8};
  let points=A.appendSnapshot([{time:now-31*86400000,median:2}],summary,now);assert.equal(points.length,1);
  points=A.appendSnapshot(points,{...summary,median:20},now+1000);assert.equal(points.length,1);
  points=A.appendSnapshot(points,{...summary,median:20},now+60000);assert.equal(points.length,2);assert.equal(A.percentChange(points),100);
  assert.equal(A.appendSnapshot(points,{median:null},now+120000).length,2);
  assert.equal(A.percentChange([]),null);
});
test('older snapshots collapse into hourly buckets while recent samples retain minute detail',()=>{
  const now=Date.UTC(2026,9,3,12),hour=3600000;
  const points=[{time:now-48*hour+1000,median:10},{time:now-48*hour+2000,median:12},{time:now-60000,median:14}];
  const kept=A.appendSnapshot(points,{median:15},now);
  assert.equal(kept.length,3);assert.equal(kept[0].median,12);assert.equal(kept.at(-1).median,15);
});
const trendNow=Date.UTC(2026,9,3,12),trendHour=3600000;
const daySeries=(start,end)=>Array.from({length:25},(_,i)=>({time:trendNow-(24-i)*trendHour,median:start+(end-start)*i/24}));
test('24-hour trends reject partial days, stale data and long recording gaps',()=>{
  assert.equal(A.trend24h(daySeries(100,110).slice(1),trendNow),null);
  assert.equal(A.trend24h(daySeries(100,110).slice(0,-1),trendNow),null);
  assert.equal(A.trend24h(daySeries(100,110).filter((p,i)=>i<4||i>10),trendNow),null);
  assert.equal(A.trend24h(daySeries(100,110).map(p=>({...p,time:p.time-2*trendHour})),trendNow),null);
  assert.ok(Math.abs(A.trend24h(daySeries(100,110),trendNow).change-10)<1e-9);
});
test('highlights rank risers and steady variants without mixing markets',()=>{
  const history={};
  const add=(item,series,platform='pc',crossplay=true,variant='standard')=>history[A.historyKey(platform,crossplay,item,variant)]=series;
  add('rising10',daySeries(100,110));add('rising20',daySeries(100,120));add('steady',daySeries(100,102));
  add('flat',daySeries(100,100));add('falling',daySeries(100,80));add('other',daySeries(100,150),'xbox');
  add('solo',daySeries(100,150),'pc',false);add('steady',daySeries(100,108),'pc',true,'rank10');
  const result=A.marketHighlights(history,'pc',true,trendNow);
  assert.deepEqual(result.rising.map(x=>x.itemId),['rising20','rising10','steady']);
  assert.deepEqual(result.holding.map(x=>x.itemId),['flat','steady']);
  assert.equal(result.rising.at(-1).variant,'rank10');
});
test('holding value excludes a volatile round trip and includes exact threshold boundaries',()=>{
  const volatile=daySeries(100,100);volatile[12].median=120;
  const history={
    [A.historyKey('pc',true,'volatile','standard')]:volatile,
    [A.historyKey('pc',true,'boundaryUp','standard')]:daySeries(100,105),
    [A.historyKey('pc',true,'boundaryHold','standard')]:daySeries(100,97)
  };
  const result=A.marketHighlights(history,'pc',true,trendNow);
  assert.deepEqual(result.rising.map(x=>x.itemId),['boundaryUp']);
  assert.deepEqual(result.holding.map(x=>x.itemId),['boundaryHold']);
});
test('historical statistics import only sell listings and keep actual mod ranks separate',()=>{
  const fs=require('node:fs'),path=require('node:path');
  const standard=JSON.parse(fs.readFileSync(path.join(__dirname,'statistics-sample.json'),'utf8'));
  const ranked=JSON.parse(fs.readFileSync(path.join(__dirname,'statistics-ranked-sample.json'),'utf8'));
  const sets=A.historicalSeries(standard.payload,{});
  assert.ok(sets[A.variant({})].hourly.length>=24);
  const mods=A.historicalSeries(ranked.payload,{maxRank:10});
  assert.ok(mods[A.variant({rank:0})].hourly.length>0);assert.ok(mods[A.variant({rank:10})].hourly.length>0);
  const row=ranked.payload.statistics_live['48hours'].find(x=>x.order_type==='sell'&&x.mod_rank===10);
  assert.equal(mods[A.variant({rank:10})].hourly.find(p=>p.time===Date.parse(row.datetime)).median,row.median);
});
test('historical trends compare completed hours without requiring locally recorded snapshots',()=>{
  const points=daySeries(100,110).map(p=>({...p,time:p.time-trendHour}));
  assert.ok(Math.abs(A.trend24h(points,trendNow,true).change-10)<1e-9);
  assert.equal(A.trend24h(points,trendNow),null);
  assert.equal(A.trend24h(points,trendNow+3*trendHour,true),null);
  const stats={sample:{platform:'pc',itemId:'ash',series:{standard:{hourly:points,label:'Standard'}}}};
  assert.equal(A.historicalHighlights(stats,'pc',trendNow).rising[0].itemId,'ash');
  assert.equal(A.historicalHighlights(stats,'xbox',trendNow).rising.length,0);
});
test('ambiguous variants, invalid prices and unverified bulk normalization are excluded',()=>{
  const payload={statistics_live:{'48hours':[{order_type:'sell',median:10,volume:2,datetime:new Date(trendNow).toISOString()}]}};
  assert.deepEqual(A.historicalSeries(payload,{maxRank:10}),{});
  assert.deepEqual(A.historicalSeries(payload,{bulkTradable:true}),{});
  assert.deepEqual(A.historicalSeries(payload,{subtypes:['blueprint']}),{});
  payload.statistics_live['48hours'][0].median=0;assert.deepEqual(A.historicalSeries(payload,{}),{});
});
