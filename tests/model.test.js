const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../app/model.js');

const debt = (student, subject, extra = {}) => ({student, subject, group:'Г-1', sem:2, course:1,
  control:'Экзамен', bk:'Бюджет', transfer:'нет', transfer_current:false, expl:'нет', ...extra});
const snapshot = debts => ({debts, students:[], meta:{}});

test('compare distinguishes missing, partial reduction, added and unchanged students', () => {
  const before = snapshot([debt('А','Физика'),debt('Б','Физика'),debt('Б','История'),debt('В','Физика')]);
  const after = snapshot([debt('Б','Физика'),debt('В','Физика'),debt('Г','История')]);
  const result = M.compareSnapshots(before, after);
  assert.equal(result.before.students,3);
  assert.equal(result.after.students,3);
  assert.equal(result.absent,1);
  assert.equal(result.decreased,1);
  assert.equal(result.appeared,1);
  assert.equal(result.unchanged,1);
  assert.equal(result.removedDebts,2);
  assert.equal(result.addedDebts,1);
  assert.equal(result.before.debts-result.removedDebts+result.addedDebts,result.after.debts);
});
test('same debt count can hide a change of subjects', () => {
  const r=M.compareSnapshots(snapshot([debt('А','Физика')]),snapshot([debt('А','История')]));
  assert.equal(r.changed,1);
  assert.equal(r.unchanged,0);
  assert.equal(r.rows[0].removedItems[0].subject,'Физика');
  assert.equal(r.rows[0].addedItems[0].subject,'История');
});
test('homonyms in different groups remain separate', () => {
  const r=M.summarize([debt('Тест','Физика'),debt('Тест','Физика',{group:'Г-2'})]);
  assert.equal(r.students,2);
});
test('subject, semester and control are all part of debt identity', () => {
  const r=M.compareSnapshots(snapshot([debt('А','Физика')]),snapshot([debt('А','Физика',{sem:4,control:'Зачёт'})]));
  assert.equal(r.removedDebts,1);
  assert.equal(r.addedDebts,1);
});
test('comparison preserves multiplicity of repeated debts', () => {
  const r=M.compareSnapshots(snapshot([debt('А','Физика'),debt('А','Физика')]),snapshot([debt('А','Физика')]));
  assert.equal(r.removedDebts,1);
  assert.equal(r.decreased,1);
});
test('same filters are applied to both dates and empty scope is valid', () => {
  const b=snapshot([debt('А','Физика'),debt('Б','История',{course:2})]);
  const r=M.compareSnapshots(b,snapshot([debt('Б','История',{course:2})]),{course:'1'});
  assert.equal(r.before.students,1); assert.equal(r.after.students,0); assert.equal(r.absent,1);
  const z=M.compareSnapshots(b,b,{group:'нет группы'});
  assert.equal(z.rows.length,0); assert.equal(z.after.median,0);
});
test('any-year transfer and autumn-2026 transfer are distinct filters', () => {
  const ds=[debt('А','Физика',{transfer:'да'}),debt('Б','Физика',{transfer:'да',transfer_current:true}),debt('В','Физика')];
  assert.equal(M.filterDebts(ds,{tr:'да'}).length,2);
  assert.equal(M.filterDebts(ds,{tr:'autumn-yes'}).length,1);
  assert.equal(M.filterDebts(ds,{tr:'autumn-no'}).length,2);
});
test('unknown explanation is excluded from confirmed missing count', () => {
  const r=M.summarize([debt('А','Физика',{expl:'неизвестно'}),debt('Б','Физика')]);
  assert.equal(r.noexpl,1); assert.equal(r.expl_unknown,1); assert.equal(r.noexpl_base,2);
});
