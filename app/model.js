(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RetakesModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const norm = value => String(value ?? '').normalize('NFKC').toLocaleLowerCase('ru').replace(/ё/g,'е').replace(/\s+/g,' ').trim();
  const studentKey = row => `${norm(row.student)}|${norm(row.group)}`;
  const debtKey = row => JSON.stringify([norm(row.subject), norm(row.control), Number(row.sem)]);
  function filterDebts(debts, filters = {}) {
    return debts.filter(d => {
      const any = d.transfer === 'да';
      const current = d.transfer_current === true;
      const tr = filters.tr || 'all';
      return (!filters.course || filters.course === 'all' || String(d.course) === String(filters.course)) &&
        (!filters.group || filters.group === 'all' || d.group === filters.group) &&
        (!filters.bk || filters.bk === 'all' || d.bk === filters.bk) &&
        (tr === 'all' || (tr === 'да' && any) || (tr === 'нет' && !any) ||
          (tr === 'autumn-yes' && current) || (tr === 'autumn-no' && !current));
    });
  }
  function people(debts) {
    const result = new Map();
    for (const d of debts) {
      const key = studentKey(d);
      if (!result.has(key)) result.set(key, []);
      result.get(key).push(d);
    }
    return result;
  }
  function summarize(debts) {
    const groups = Array.from(people(debts).values());
    const counts = groups.map(ds => ds.length).sort((a,b) => a-b);
    const heavy = groups.filter(ds => ds.length >= 5);
    const base = groups.filter(ds => ds[0].transfer !== 'да');
    const noexpl = base.filter(ds => ds[0].expl === 'нет').length;
    const transfer = groups.filter(ds => ds[0].transfer === 'да');
    const transferDebts = transfer.reduce((n, ds) => n + ds.length, 0);
    const n = counts.length;
    return {students:n, debts:debts.length, median:n ? (counts[Math.floor((n-1)/2)]+counts[Math.floor(n/2)])/2 : 0,
      heavy:heavy.length, heavy_share:debts.length ? Math.round(100*heavy.reduce((n,ds)=>n+ds.length,0)/debts.length) : 0,
      noexpl, noexpl_base:base.length, noexpl_pct:base.length ? Math.round(100*noexpl/base.length) : 0,
      expl_unknown:groups.filter(ds=>!['есть','нет'].includes(ds[0].expl)).length,
      transfer:transfer.length, transfer_debts:transferDebts, transfer_share:debts.length ? Math.round(100*transferDebts/debts.length) : 0};
  }
  // A multiset difference: repeated rows cannot silently disappear through Set().
  function difference(left, right) {
    const remaining = new Map();
    for (const row of right) remaining.set(debtKey(row), (remaining.get(debtKey(row)) || 0)+1);
    return left.filter(row => {
      const key=debtKey(row), count=remaining.get(key)||0;
      if (count) { remaining.set(key,count-1); return false; }
      return true;
    });
  }
  function compareSnapshots(before, after, filters = {}) {
    const a=filterDebts(before.debts,filters), b=filterDebts(after.debts,filters);
    const ap=people(a), bp=people(b);
    const result={before:summarize(a), after:summarize(b), rows:[], absent:0, appeared:0,
      decreased:0, increased:0, unchanged:0, changed:0, removedDebts:0, addedDebts:0};
    for (const key of new Set([...ap.keys(),...bp.keys()])) {
      const old=ap.get(key)||[], next=bp.get(key)||[];
      const removedItems=difference(old,next), addedItems=difference(next,old);
      const status=!old.length ? 'appeared' : !next.length ? 'absent' : next.length<old.length ? 'decreased' :
        next.length>old.length ? 'increased' : removedItems.length || addedItems.length ? 'changed' : 'unchanged';
      const person=next[0]||old[0];
      result.rows.push({key, student:person.student, group:person.group, before:old.length, after:next.length,
        removed:removedItems.length, added:addedItems.length, removedItems, addedItems, status});
      result[status]++; result.removedDebts+=removedItems.length; result.addedDebts+=addedItems.length;
    }
    result.rows.sort((a,b)=>Math.abs(b.after-b.before)-Math.abs(a.after-a.before)||a.student.localeCompare(b.student,'ru'));
    return result;
  }
  return {norm, studentKey, debtKey, filterDebts, summarize, compareSnapshots};
});
