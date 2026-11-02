(function () {
  'use strict';
  const M=window.RetakesModel, $=s=>document.querySelector(s);
  const nf=new Intl.NumberFormat('ru-RU');
  const labels={absent:'Нет во втором срезе',decreased:'Долгов стало меньше',appeared:'Новая запись',
    increased:'Долгов стало больше',changed:'Изменился состав',unchanged:'Без изменений'};
  let filters={}, query='', status='changed-only', expanded=new Set();
  const el=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e;};
  const sign=n=>n>0?'+'+nf.format(n):n<0?'−'+nf.format(-n):'0';
  const showChanges=()=>$('#tab-changes').click();

  function metric(label,before,after,primary=false) {
    const box=el('div','comparison-metric'+(primary?' is-primary':''));
    const delta=after-before;
    box.append(el('div','comparison-metric__label',label),el('strong','comparison-metric__delta',sign(delta)));
    const flow=el('div','comparison-metric__flow');
    flow.append(el('span',null,nf.format(before)),el('span','flow-arrow','→'),el('b',null,nf.format(after)));
    box.append(flow);return box;
  }

  function sourceContent(first,next) {
    const box=$('#source-content'), meta=next.meta, memo=meta.memo;
    box.replaceChildren();
    const notes=[
      `Первый срез — ${first.meta.date}; второй — ${meta.date}, дата из служебной записки. Дата подготовки — ${meta.preparedOn.split('-').reverse().join('.')}.`,
      `Новая ведомость: ${next.students.length} студентов, ${next.debts.length} задолженностей. Реестр причин: ${meta.registryStudents} студентов, ${meta.registryDebts} долгов; его старые количества не используются вместо новой ведомости.`,
      'Приказы о переводе любого года и переводы осени 2026 — разные признаки. Осенний критерий: дата приказа от 01.09.2026 до даты выбранного среза.',
      `Без осенних переводов в записке: ${memo.withoutTransfersStudents} студентов и ${memo.withoutTransfersDebts} долгов. Результат воспроизведён по датам приказов: ${meta.memoWithoutMatches?'да':'нет; требуется сверка'}.`,
      `Сведения записки об обратной связи: ${memo.feedback} — получена обратная связь; ${memo.informed} — информированы; ${memo.unreachable} — не вышли на связь. Это сводка автора, а не пересчёт статусов отдельных строк реестра.`,
      `В записке ${memo.partiallyCorrected} студента частично исправили задолженности; предыдущая сводка там датирована ${memo.previousDate} (${memo.previousStudents} человек). Эти числа не относятся к сравнению с 23.10.`,
      `У ${meta.unmatchedRegistry} записи новой ведомости нет точного совпадения ФИО и группы в реестре причин. Автоматическая замена похожим ФИО не выполнялась. У ${meta.registryCountDifferences} совпавших записей число долгов в ведомости отличается от старого реестра.`,
      'Нули и пустые ячейки связи означают «неизвестно». Свободный текст причины не доказывает наличие письменной объяснительной. Для неё явно отмечен источник последнего известного статуса.',
      'Сопоставление выполняется по нормализованным ФИО и группе; долг — по дисциплине, форме контроля и семестру. Изменение ФИО или группы может дать пару «нет записи / новая запись» и требует ручной сверки.'
    ];
    notes.forEach(text=>box.append(el('p','v2-note',text)));
    box.append(el('h3','source-title','Предоставленные документы'));
    for(const source of meta.sources){const p=el('p','source-file',source.name);p.title='SHA-256: '+source.sha256;box.append(p);}
  }

  function detailsFor(row) {
    const wrap=el('div','change-detail');
    for(const [title,items] of [['Нет в новой ведомости',row.removedItems],['Появились в новой ведомости',row.addedItems]]) {
      const column=el('div');column.append(el('h3',null,`${title} · ${items.length}`));
      if(!items.length)column.append(el('p','v2-note','Нет изменений этого типа.'));
      else {const list=el('ul');for(const item of items)list.append(el('li',null,`${item.control} · ${item.subject} · ${item.sem} сем.`));column.append(list);}
      wrap.append(column);
    }
    return wrap;
  }

  function renderRows(result) {
    const q=M.norm(query);
    const rows=result.rows.filter(r=>(status==='all'||(status==='changed-only'?r.status!=='unchanged':r.status===status))&&
      (!q||M.norm(r.student+' '+r.group).includes(q)));
    $('#change-count').textContent=`Показано ${rows.length} из ${result.rows.length}`;
    const body=$('#change-rows');body.replaceChildren();
    if(!rows.length){const r=el('tr'),cell=el('td','v2-empty','Ничего не найдено');cell.colSpan=5;r.append(cell);body.append(r);return;}
    for(const row of rows) {
      const tr=el('tr','is-link'),who=el('td');tr.tabIndex=0;
      who.append(el('div','change-name',row.student),el('div','v2-row__meta',row.group),
        el('span','change-mobile-status change-badge change-badge--'+row.status,labels[row.status]));
      const state=el('td'),badge=el('span','change-badge change-badge--'+row.status,labels[row.status]);state.append(badge);
      tr.append(who,el('td','num',row.before),el('td','num',row.after),el('td','num',sign(row.after-row.before)),state);
      const extra=el('tr'),cell=el('td','det');cell.colSpan=5;
      extra.hidden=!expanded.has(row.key);cell.append(detailsFor(row));extra.append(cell);
      tr.setAttribute('aria-expanded',String(!extra.hidden));
      tr.setAttribute('aria-label',`${row.student}, ${row.group}: ${labels[row.status]}, было ${row.before}, стало ${row.after}. Раскрыть состав изменений.`);
      const toggle=()=>{extra.hidden=!extra.hidden;tr.setAttribute('aria-expanded',String(!extra.hidden));if(extra.hidden)expanded.delete(row.key);else expanded.add(row.key);};
      tr.addEventListener('click',toggle);tr.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();toggle();}});
      body.append(tr,extra);
    }
  }

  function paint() {
    const snapshots=dash.snapshots();if(snapshots.length!==2)return;
    const [first,next]=snapshots,current=dash.current();
    const switcher=$('#snapshot-switch');switcher.replaceChildren();
    for(const snap of snapshots){const b=el('button','snapshot-button',snap.meta.date);b.type='button';
      b.setAttribute('aria-pressed',String(snap===current));b.addEventListener('click',()=>{expanded.clear();dash.selectSnapshot(snap.meta.id);$('#snapshot-switch button[aria-pressed="true"]').focus();});switcher.append(b);}
    $('#snapshot-note').textContent=current===next?
      `Дата по записке: ${next.meta.date}. Подготовлено ${next.meta.preparedOn.split('-').reverse().join('.')}.${next.meta.futureDate?' Дата среза позже даты подготовки; проверьте её.':''}`:
      'Исторический срез. Причины и статусы сохранены из первой версии дашборда.';
    $('#comparison-title').textContent=`${first.meta.date} → ${next.meta.date}`;
    const result=M.compareSnapshots(first,next,filters);
    $('#comparison-numbers').replaceChildren(metric('Студентов в ведомости',result.before.students,result.after.students,true),metric('Задолженностей',result.before.debts,result.after.debts));
    $('#comparison-foot').textContent=`Состав долгов: ${result.removedDebts} записей больше не значатся, ${result.addedDebts} появились. ${result.before.debts} − ${result.removedDebts} + ${result.addedDebts} = ${result.after.debts}. Это изменение ведомостей, а не подтверждённое закрытие.`;
    $('#cnt-changes').textContent=result.rows.length-result.unchanged;
    const stats=$('#change-stats');stats.replaceChildren();
    for(const type of ['absent','decreased','appeared','changed','increased','unchanged']){const b=el('button','change-stat');b.type='button';b.append(el('strong',null,result[type]),el('span',null,labels[type]));b.addEventListener('click',()=>{status=type;$('#change-status').value=status;renderRows(result);});stats.append(b);}
    renderRows(result);sourceContent(first,next);
    $('#card-closed').hidden=current===next;
  }

  $('#open-changes').addEventListener('click',showChanges);
  $('#change-search').addEventListener('input',e=>{query=e.target.value;paint();});
  $('#change-status').addEventListener('change',e=>{status=e.target.value;paint();});
  window.addEventListener('retakes:filters',e=>{filters=e.detail;paint();});
  window.addEventListener('retakes:lock',()=>{filters={};query='';status='changed-only';expanded.clear();$('#change-status').value=status;
    $('#change-rows').replaceChildren();$('#source-content').replaceChildren();});
  dash.onData(paint);
})();
