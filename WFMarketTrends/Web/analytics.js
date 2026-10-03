(function (root) {
  'use strict';
  const fields = ['rank', 'charges', 'amberStars', 'cyanStars', 'subtype'];
  function variant(order) {
    // Explicit zero and omitted zero mean the same variant for rank/star counts.
    return fields.map(field => field + ':' + (order[field] ?? (field === 'subtype' ? '' : 0))).join('|');
  }
  function variantLabel(order) {
    const labels = {rank:'Rank',charges:'Charges',amberStars:'Amber stars',cyanStars:'Cyan stars',subtype:'Subtype'};
    return fields.filter(field => order[field] != null).map(field => labels[field] + ' ' + order[field]).join(' · ') || 'Standard';
  }
  function unitPrice(order) { return order.platinum / Math.max(1, Number(order.perTrade) || 1); }
  function online(order) { return order.visible !== false && ['online', 'ingame'].includes(order.user?.status); }
  function summarize(orders, key) {
    const matching = orders.filter(order => online(order) && variant(order) === key && Number.isFinite(order.platinum) && order.platinum > 0);
    const sell = matching.filter(order => order.type === 'sell').sort((a,b) => unitPrice(a)-unitPrice(b));
    const buy = matching.filter(order => order.type === 'buy').sort((a,b) => unitPrice(b)-unitPrice(a));
    const middle = Math.floor(sell.length/2);
    const median = sell.length ? (sell.length%2 ? unitPrice(sell[middle]) : (unitPrice(sell[middle-1])+unitPrice(sell[middle]))/2) : null;
    return {sell,buy,lowest:sell.length ? unitPrice(sell[0]) : null,highest:buy.length ? unitPrice(buy[0]) : null,median};
  }
  function historyKey(platform, crossplay, itemId, variantKey) { return [platform,platform !== 'switch' && crossplay ? 'crossplay' : 'solo',itemId,variantKey].join('/'); }
  function appendSnapshot(points, summary, time) {
    const kept = points.filter(point => point.time > time-30*86400000 && Number.isFinite(point.median));
    if (summary.median != null && (!kept.length || time-kept[kept.length-1].time >= 60000))
      kept.push({time,median:summary.median,lowest:summary.lowest,highest:summary.highest});
    // Keep recent minute detail and aggregate older samples to bound local storage.
    const buckets = new Map();
    for (const point of kept) {
      const age = time-point.time;
      const interval = age > 86400000 ? 3600000 : age > 6*3600000 ? 300000 : 60000;
      buckets.set(interval + '/' + Math.floor(point.time/interval), point);
    }
    return [...buckets.values()].sort((a,b)=>a.time-b.time).slice(-1500);
  }
  function percentChange(points) { return points.length >= 2 && points[0].median > 0 ? (points[points.length-1].median/points[0].median-1)*100 : null; }
  function trend24h(points, now, historical=false) {
    const hour = 3600000;
    const valid = points.filter(p => Number.isFinite(p.time) && p.time <= now && Number.isFinite(p.median) && p.median > 0).sort((a,b)=>a.time-b.time);
    if (!valid.length) return null;
    const end = historical ? valid.at(-1).time : now;
    if (historical && now-end > 3*hour) return null;
    const target = end-24*hour;
    const baseline = valid.findLast(p => p.time <= target);
    if (!baseline || baseline.time < target-hour) return null;
    const window = valid.filter(p => p.time >= baseline.time);
    const latest = window.at(-1);
    if (window.length < (historical ? 12 : 4) || (!historical && now-latest.time > 15*60000)) return null;
    // A long recording gap cannot establish that an item held its value all day.
    if (window.some((p,i)=>i && p.time-window[i-1].time > 3*hour)) return null;
    const change = (latest.median/baseline.median-1)*100;
    const prices = window.map(p=>p.median);
    const spread = (Math.max(...prices)/Math.min(...prices)-1)*100;
    return {change,spread,price:latest.median,time:latest.time};
  }
  function historicalSeries(payload, item) {
    const result = {};
    // Historical bulk-price normalization is not documented; do not mix it with unit prices.
    if (item.bulkTradable) return result;
    const live = payload?.statistics_live;
    for (const [window,source] of [['hourly','48hours'],['daily','90days']]) {
      for (const row of live?.[source] || []) {
        if (row.order_type !== 'sell' || !Number.isFinite(row.median) || row.median <= 0 || !(row.volume > 0)) continue;
        const order = {};
        const mapping = {rank:'mod_rank',charges:'charges',amberStars:'amber_stars',cyanStars:'cyan_stars',subtype:'subtype'};
        const required = {rank:item.maxRank != null,charges:item.maxCharges != null,amberStars:item.maxAmberStars != null,cyanStars:item.maxCyanStars != null,subtype:item.subtypes?.length > 0};
        let ambiguous = false;
        for (const [field,legacy] of Object.entries(mapping)) {
          if (row[legacy] != null) order[field] = row[legacy];
          else if (required[field]) ambiguous = true;
        }
        const time = Date.parse(row.datetime);
        if (ambiguous || !Number.isFinite(time)) continue;
        const key = variant(order);
        result[key] ||= {hourly:[],daily:[],label:variantLabel(order)};
        result[key][window].push({time,median:row.median,lowest:row.min_price,volume:row.volume});
      }
    }
    for (const series of Object.values(result)) for (const window of ['hourly','daily'])
      series[window] = [...new Map(series[window].map(p=>[p.time,p])).values()].sort((a,b)=>a.time-b.time);
    return result;
  }
  function historicalHighlights(statistics, platform, now) {
    const history = {}, metadata = new Map();
    for (const entry of Object.values(statistics)) {
      if (entry.platform !== platform) continue;
      for (const [variant,series] of Object.entries(entry.series)) {
        const key = historyKey(platform,false,entry.itemId,variant);
        history[key] = series.hourly;
        metadata.set(key,series.label);
      }
    }
    const groups = marketHighlights(history,platform,false,now,true);
    for (const list of Object.values(groups)) for (const row of list) row.label=metadata.get(historyKey(platform,false,row.itemId,row.variant));
    return groups;
  }
  function marketHighlights(history, platform, crossplay, now, historical=false) {
    const prefix = historyKey(platform,crossplay,'','').slice(0,-1);
    const rising = [], holding = [];
    for (const [key,points] of Object.entries(history)) {
      if (!key.startsWith(prefix)) continue;
      const rest = key.slice(prefix.length), divider = rest.indexOf('/');
      if (divider < 1) continue;
      const trend = trend24h(points,now,historical);
      if (!trend) continue;
      const item = {...trend,itemId:rest.slice(0,divider),variant:rest.slice(divider+1)};
      if (trend.change >= 5-1e-9) rising.push(item);
      else if (Math.abs(trend.change) <= 3+1e-9 && trend.spread <= 6+1e-9) holding.push(item);
    }
    rising.sort((a,b)=>b.change-a.change || a.itemId.localeCompare(b.itemId));
    holding.sort((a,b)=>a.spread-b.spread || a.itemId.localeCompare(b.itemId));
    return {rising,holding};
  }
  const api = {variant,variantLabel,unitPrice,online,summarize,historyKey,appendSnapshot,percentChange,trend24h,marketHighlights,historicalSeries,historicalHighlights};
  if (typeof module !== 'undefined') module.exports = api;
  else root.Analytics = api;
})(globalThis);
