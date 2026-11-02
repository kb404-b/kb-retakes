#!/usr/bin/env python3
"""Import two source workbooks; write encrypted data only. Never log student data."""
import argparse
import base64
from collections import Counter
from datetime import date, datetime
import getpass
import hashlib
import json
import os
from pathlib import Path
import re
import unicodedata
import xml.etree.ElementTree as ET
import zipfile

import openpyxl
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

CONTROLS = {'Э': 'Экзамен', 'З': 'Зачёт', 'КП': 'Курсовой проект', 'КР': 'Курсовая работа'}


def norm(value):
    return ' '.join(unicodedata.normalize('NFKC', str(value or '')).lower().replace('ё', 'е').split())


def student_key(name, group):
    return norm(name) + '|' + norm(group)


def parse_debts(text, expected):
    result = []
    for item in str(text or '').strip().rstrip(';').split(';'):
        match = re.fullmatch(r'\s*(КП|КР|Э|З)\s+(.+?)\s*\((\d+)\s*сем\)\s*', item)
        if not match or not 1 <= int(match[3]) <= 20:
            raise ValueError('Нераспознанная запись дисциплины или семестра')
        sem = int(match[3])
        result.append({'subject': ' '.join(match[2].split()), 'control': CONTROLS[match[1]],
                       'sem': sem, 'course': (sem + 1) // 2})
    if len(result) != expected:
        raise ValueError(f'Число дисциплин {len(result)} не равно указанному числу {expected}')
    return result


def order_date(value):
    match = re.search(r'\b(\d{2}\.\d{2}\.\d{4})\b', str(value or ''))
    return datetime.strptime(match[1], '%d.%m.%Y').date() if match else None


def is_current_transfer(order, snapshot_date):
    dt = order_date(order)
    return bool(dt and date(2026, 9, 1) <= dt <= date.fromisoformat(snapshot_date))


def contact_status(value):
    text = norm(value)
    if text in ('', '0'):
        return 'неизвестно'
    if re.search(r'не выходит.{0,12}на связь|на связь не выходит|не ответил|не удалось связаться', text):
        return 'не выходит на связь'
    if text == 'да' or re.search(r'выш[её]л на связь|связь установлена|состоялась беседа', text):
        return 'связь установлена'
    if re.search(r'оповещ|информирован|старост|направлено письмо|отправлено.{0,20}письмо', text):
        return 'информирован'
    return 'есть заметка'


def reason_category(note, fallback='Не уточнено'):
    text = norm(note)
    if not text or text.startswith('не представлена'):
        return 'Не уточнено'
    for pattern, label in [(r'боле|болел|больнич|заболев|госпитал', 'Здоровье'),
                           (r'работ', 'Работа'), (r'семейн', 'Семейные обстоятельства'),
                           (r'перев[её]?[дл]|перевод|академ|армия', 'Перевод / восстановление')]:
        if re.search(pattern, text):
            return label
    return fallback if fallback and fallback != 'Не уточнено' else 'Другие обстоятельства'


def read_workbook(path, registry=False):
    sheet = openpyxl.load_workbook(path, data_only=True, read_only=True).active
    headers = list(next(sheet.values))
    expected = ('Группа', 'ФИО', 'Количество задолженностей') if registry else ('группа', 'ФИО', 'кол-во задолж.')
    if tuple(map(norm, headers[:3])) != tuple(map(norm, expected)):
        raise ValueError('Неожиданные заголовки входной таблицы')
    rows = []
    seen = set()
    for i, values in enumerate(sheet.iter_rows(min_row=2, values_only=True), 2):
        if not any(v is not None for v in values):
            continue
        if not values[0] or not values[1] or not isinstance(values[2], (int, float)):
            raise ValueError(f'Неполная запись в строке {i}')
        if values[2] != int(values[2]) or values[2] <= 0:
            raise ValueError(f'Некорректное число задолженностей в строке {i}')
        key = student_key(values[1], values[0])
        if key in seen:
            raise ValueError(f'Повтор идентификатора ФИО+группа в строке {i}')
        seen.add(key)
        row = dict(group=str(values[0]).strip(), name=' '.join(str(values[1]).split()),
                   count=int(values[2]), items=values[3], order=values[5 if registry else 4] or '',
                   funding=values[9 if registry else 8], row=i)
        if registry:
            row.update(note=str(values[4] or '').strip(), contact=values[6])
        try:
            parse_debts(row['items'], row['count'])
        except ValueError as exc:
            raise ValueError(f'Строка {i}: {exc}') from None
        rows.append(row)
    return rows


def build_snapshot(roster, registry, baseline, memo, snapshot_date):
    registry_index = {student_key(r['name'], r['group']): r for r in registry}
    old_index = {student_key(r['student'], r['group']): r for r in baseline['students']}
    debts, students = [], []
    unmatched = differences = 0
    for row in roster:
        key = student_key(row['name'], row['group'])
        reg, old = registry_index.get(key), old_index.get(key, {})
        unmatched += reg is None
        differences += bool(reg and reg['count'] != row['count'])
        note = reg['note'] if reg else ''
        # A free-text reason does not prove the existence of a written explanation.
        explicit_missing = norm(note).startswith('не представлена')
        expl = 'нет' if explicit_missing else old.get('expl', 'неизвестно')
        funding = {'б': 'Бюджет', 'к': 'Контракт'}.get(norm(row['funding']))
        if not funding:
            raise ValueError(f"Неизвестная основа обучения в строке {row['row']}")
        items = parse_debts(row['items'], row['count'])
        common = dict(student=row['name'], group=row['group'], bk=funding,
                      transfer='да' if row['order'] else 'нет',
                      transfer_current=is_current_transfer(row['order'], snapshot_date),
                      expl=expl, reason=reason_category(note, old.get('reason', 'Не уточнено')))
        for j, item in enumerate(items, 1):
            debts.append({**common, **item, 'id': f"nov-{row['row']}-{j}"})
        counts = Counter(d['control'] for d in items)
        n = len(items)
        students.append({**common, 'debts': n, 'exams': counts['Экзамен'], 'credits': counts['Зачёт'],
                         'projects': counts['Курсовая работа'] + counts['Курсовой проект'],
                         'sem_from': min(d['sem'] for d in items), 'sem_to': max(d['sem'] for d in items),
                         'bucket': '1' if n == 1 else '2' if n == 2 else '3–4' if n <= 4 else '5–9' if n <= 9 else '10+',
                         'form': old.get('form', 'неизвестно'), 'note': note,
                         'contact_raw': str(reg['contact']) if reg and reg['contact'] is not None else '',
                         'contact_status': contact_status(reg['contact'] if reg else None),
                         'transfer_order': str(row['order']), 'metadata_missing': reg is None,
                         'expl_source': 'Реестр: явно не представлена' if explicit_missing else
                             'Статус из среза 23.10.2026' if old else 'Нет подтверждённого статуса',
                         'source_row': row['row'], 'registry_row': reg['row'] if reg else None})
    baseline_transfers = {student_key(r['name'], r['group']): {
        'transfer_current': is_current_transfer(r['order'], '2026-10-23'),
        'order_date': order_date(r['order']).isoformat() if order_date(r['order']) else None
    } for r in registry}
    return {'meta': {'id': snapshot_date, 'date': date.fromisoformat(snapshot_date).strftime('%d.%m.%Y'),
                     'transferCutoff': '2026-09-01', 'registryStudents': len(registry),
                     'registryDebts': sum(r['count'] for r in registry), 'unmatchedRegistry': unmatched,
                     'registryCountDifferences': differences, 'memo': memo},
            'students': students, 'debts': debts, 'closed': [], 'baselineTransfers': baseline_transfers}


def seal(payload, token):
    salt, iv = os.urandom(16), os.urandom(12)
    key = hashlib.pbkdf2_hmac('sha256', token.encode(), salt, 600000, 32)
    ct = AESGCM(key).encrypt(iv, json.dumps(payload, ensure_ascii=False, separators=(',', ':')).encode(), None)
    b64 = lambda value: base64.b64encode(value).decode('ascii')
    return dict(v=1, kdf='PBKDF2-SHA256', it=600000, salt=b64(salt), iv=b64(iv), ct=b64(ct))


def unseal(envelope, token):
    b64 = base64.b64decode
    key = hashlib.pbkdf2_hmac('sha256', token.encode(), b64(envelope['salt']), envelope['it'], 32)
    return json.loads(AESGCM(key).decrypt(b64(envelope['iv']), b64(envelope['ct']), None))


def read_memo(path):
    with zipfile.ZipFile(path) as archive:
        root = ET.fromstring(archive.read('word/document.xml'))
    ns = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
    text = '\n'.join(''.join(t.text or '' for t in p.findall('.//w:t', ns)) for p in root.findall('.//w:p', ns))
    def number(pattern):
        match = re.search(pattern, text, re.IGNORECASE | re.DOTALL)
        if not match:
            raise ValueError('В записке не найден обязательный показатель')
        return int(match[1])
    dt = re.search(r'по состоянию на\s+(\d{2}\.\d{2}\.\d{4})', text, re.IGNORECASE)
    previous = re.search(r'по предыдущей сводке на\s+(\d{2}\.\d{2}\.\d{4})', text, re.IGNORECASE)
    if not dt:
        raise ValueError('Не найдена дата записки')
    if not previous:
        raise ValueError('Не найдена дата предыдущей сводки в записке')
    return {'date': datetime.strptime(dt[1], '%d.%m.%Y').date().isoformat(),
            'students': number(r'задолженности числятся за\s+(\d+)'),
            'debts': number(r'общее количество задолженностей\s*[—–-]\s*(\d+)'),
            'withoutTransfersStudents': number(r'Исключая переведенных студентов.{0,50}?(\d+)\s+студентов'),
            'withoutTransfersDebts': number(r'имеющих\s+(\d+)\s+академических задолженностей'),
            'feedback': number(r'обратная связь от\s+(\d+)'),
            'informed': number(r'(\d+)\s+студент с одной задолженностью'),
            'unreachable': number(r'(\d+)\s+студентов-должников не вышли на связь'),
            'partiallyCorrected': number(r'(\d+)\s+студента частично исправили'),
            'previousDate': previous[1], 'previousStudents': number(r'составляло\s+(\d+)\s+человек')}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for argument in ('roster', 'registry', 'memo'):
        parser.add_argument('--' + argument, required=True, type=Path)
    parser.add_argument('--html', type=Path, default=Path('index.html'))
    parser.add_argument('--out', type=Path, default=Path('data/snapshot-next.js'))
    parser.add_argument('--prepared-on', default=date.today().isoformat())
    args = parser.parse_args()
    memo = read_memo(args.memo)
    token = getpass.getpass('Ключ страницы (не сохраняется): ').strip().upper()
    token = re.sub(r'[\s_]+', '', token)
    if re.fullmatch(r'\w{16}', token):
        token = '-'.join(token[i:i+4] for i in range(0,16,4))
    html = args.html.read_text()
    original = json.loads(re.search(r'window\.__ENC\s*=\s*(\{.*?\});', html)[1])
    baseline = unseal(original, token)
    data = build_snapshot(read_workbook(args.roster), read_workbook(args.registry, registry=True), baseline, memo, memo['date'])
    current = [s for s in data['students'] if s['transfer_current']]
    # Source figures are acceptance checks, never substitutions for computed rows.
    actual = (len(data['students']), len(data['debts']))
    if actual != (memo['students'], memo['debts']):
        raise ValueError('Ведомость и записка расходятся по общим итогам')
    without = (actual[0]-len(current), actual[1]-sum(s['debts'] for s in current))
    data['meta'].update(preparedOn=args.prepared_on, futureDate=memo['date'] > args.prepared_on,
                        memoWithoutMatches=without == (memo['withoutTransfersStudents'], memo['withoutTransfersDebts']),
                        sources=[{'name': unicodedata.normalize('NFC', p.name), 'sha256': hashlib.sha256(p.read_bytes()).hexdigest()}
                                 for p in (args.roster, args.registry, args.memo)])
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text('// Encrypted source snapshot. No access key or plaintext records.\nwindow.__ENC_NEXT = ' +
                        json.dumps(seal(data, token), separators=(',', ':')) + ';\n')
    print(json.dumps({'students': actual[0], 'debts': actual[1], 'currentTransfers': len(current),
                      'currentTransferDebts': sum(s['debts'] for s in current), 'withoutCurrentTransfers': without,
                      'unmatchedRegistry': data['meta']['unmatchedRegistry'], 'output': str(args.out)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
