import sys
import unittest
import tempfile
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import import_snapshot as imp


class ImportTests(unittest.TestCase):
    def test_memo_dates_are_read_from_source_not_hardcoded(self):
        text = ('По состоянию на 05.11.2026 задолженности числятся за 2 студентами, '
                'общее количество задолженностей — 3. Исключая переведенных студентов, '
                'на данный момент 1 студентов-должников, имеющих 2 академических задолженностей. '
                'По предыдущей сводке на 12.10.2026 число составляло 4 человек. '
                'Получена обратная связь от 1 студента; 0 студент с одной задолженностью; '
                '0 студентов-должников не вышли на связь. 1 студента частично исправили.')
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'memo.docx'
            with zipfile.ZipFile(path, 'w') as archive:
                archive.writestr('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>' + text + '</w:t></w:r></w:p></w:body></w:document>')
            memo = imp.read_memo(path)
        self.assertEqual(memo['date'], '2026-11-05')
        self.assertEqual(memo['previousDate'], '12.10.2026')

    def test_four_control_types_and_multidigit_semester(self):
        rows = imp.parse_debts('Э  Физика (2 сем); З История (1 сем); КР Проект (10 сем); КП Сети (4 сем)', 4)
        self.assertEqual([r['control'] for r in rows], ['Экзамен', 'Зачёт', 'Курсовая работа', 'Курсовой проект'])
        self.assertEqual(rows[2]['course'], 5)

    def test_bad_item_or_count_is_rejected(self):
        for text, count in [('Э Физика (2 сем)', 2), ('непонятная запись', 1), ('Э Физика (0 сем)', 1)]:
            with self.subTest(text=text), self.assertRaises(ValueError):
                imp.parse_debts(text, count)

    def test_student_key_normalizes_spacing_but_keeps_group(self):
        self.assertEqual(imp.student_key(' Ёлкин  Тест Тестович ', ' Г-1 '), imp.student_key('Елкин Тест Тестович', 'г-1'))
        self.assertNotEqual(imp.student_key('Тест Тестович', 'Г-1'), imp.student_key('Тест Тестович', 'Г-2'))

    def test_zero_contact_is_unknown_not_unreachable(self):
        for value in (0, '0', None, ''):
            self.assertEqual(imp.contact_status(value), 'неизвестно')
        self.assertEqual(imp.contact_status('да'), 'связь установлена')
        self.assertEqual(imp.contact_status('На связь не выходит, направлено письмо'), 'не выходит на связь')
        self.assertEqual(imp.contact_status('Оповещён через старосту'), 'информирован')

    def test_autumn_transfer_is_explicit_and_not_future_at_snapshot(self):
        self.assertTrue(imp.is_current_transfer('123/кс 30.10.2026', '2026-11-03'))
        self.assertFalse(imp.is_current_transfer('123/кс 30.10.2026', '2026-10-23'))
        self.assertFalse(imp.is_current_transfer('123/кс 03.03.2026', '2026-11-03'))
        self.assertFalse(imp.is_current_transfer(None, '2026-11-03'))

    def test_encryption_round_trip_and_wrong_key(self):
        payload = {'students': [{'student': 'Синтетический Тест'}]}
        envelope = imp.seal(payload, 'test-only-secret')
        self.assertEqual(imp.unseal(envelope, 'test-only-secret'), payload)
        self.assertNotIn('Синтетический', str(envelope))
        with self.assertRaises(Exception):
            imp.unseal(envelope, 'wrong-secret')
        self.assertNotEqual(envelope['iv'], imp.seal(payload, 'test-only-secret')['iv'])

    def test_official_counts_win_and_unknown_metadata_stays_unknown(self):
        roster = [{'name': 'Синтетический Студент', 'group': 'Г-1', 'count': 1,
                   'items': 'Э Физика (2 сем)', 'order': '', 'funding': 'б', 'row': 2}]
        registry = [{'name': 'Синтетический Студент', 'group': 'Г-1', 'count': 2,
                     'items': 'Э Физика (2 сем); З История (1 сем)', 'note': 'Не представлена',
                     'contact': 0, 'order': '', 'funding': 'к', 'row': 2}]
        data = imp.build_snapshot(roster, registry, {'students': [], 'debts': []}, {}, '2026-11-03')
        self.assertEqual(len(data['debts']), 1)
        self.assertEqual(data['students'][0]['bk'], 'Бюджет')
        self.assertEqual(data['students'][0]['contact_status'], 'неизвестно')
        self.assertEqual(data['students'][0]['expl'], 'нет')
        self.assertEqual(data['meta']['registryCountDifferences'], 1)

    def test_no_fuzzy_name_merge_and_no_guess_of_explanation(self):
        roster = [{'name': 'Условный Тест', 'group': 'Г-1', 'count': 1,
                   'items': 'З История (1 сем)', 'order': '', 'funding': 'б', 'row': 2}]
        registry = [{'name': 'Условный Тестов', 'group': 'Г-1', 'count': 1, 'items': '',
                     'note': 'Болел', 'contact': 'да', 'order': '', 'funding': 'б', 'row': 2}]
        data = imp.build_snapshot(roster, registry, {'students': [], 'debts': []}, {}, '2026-11-03')
        self.assertEqual(data['meta']['unmatchedRegistry'], 1)
        self.assertEqual(data['students'][0]['expl'], 'неизвестно')
        self.assertEqual(data['students'][0]['note'], '')


if __name__ == '__main__':
    unittest.main()
