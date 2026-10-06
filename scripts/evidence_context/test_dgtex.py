import gzip
import json
import sqlite3
import tempfile
import unittest
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape
from dgtex import COHORTS, build_snapshot, donor_medians, public_manifest

def workbook(file, rows):
    xml = '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'
    for i, row in enumerate(rows, 1):
        xml += f'<row r="{i}">' + ''.join(f'<c r="{chr(65+j)}{i}" t="inlineStr"><is><t>{escape(str(v))}</t></is></c>' for j, v in enumerate(row)) + '</row>'
    xml += '</sheetData></worksheet>'
    with zipfile.ZipFile(file, 'w') as archive:
        archive.writestr('xl/worksheets/sheet1.xml', xml)

def dictionary():
    return [{'VARNAME': 'AGECOHORT', 'ACCESS': 'Open', **{f'v{k}': f'{k}={v}' for k, v in COHORTS.items()}}]

class DevelopmentalImportTests(unittest.TestCase):
    def setUp(self):
        self.samples = [dict(SAMPLE_ID=s, SUBJECT_ID=d, SMAFRZE=status, SMTSD='Liver', SMTSDUBRID='UBERON:0002107')
                        for s, d, status in [('S1','D1','RNASEQ'), ('S2','D1','RNASEQ'), ('S3','D2','RNASEQ'), ('S4','D2','EXCLUDE'), ('S5','D2','WGS')]]
        self.subjects = [{'SUBJECT_ID':'D1','AGECOHORT':'1'}, {'SUBJECT_ID':'D2','AGECOHORT':'1'}]

    def test_donor_repeats_do_not_weight_the_median_and_zero_is_measured(self):
        coverage, groups, counts = public_manifest(self.samples, self.subjects, dictionary(), ['S1','S2','S3'])
        self.assertEqual(coverage[0]['donorCount'], 2)
        self.assertEqual(coverage[0]['sampleCount'], 3)
        self.assertEqual(donor_medians([0, 0, 10], groups), [5])
        self.assertEqual(donor_medians([0, 0, 0], groups), [0])
        self.assertEqual(counts['excludedSamples'], 1)
        self.assertEqual(counts['wgsSamples'], 1)

    def test_rejects_missing_extra_duplicate_and_excluded_matrix_samples(self):
        for columns in [['S1','S2'], ['S1','S2','S3','S4'], ['S1','S1','S3'], ['S1','S2','UNKNOWN']]:
            with self.assertRaises(ValueError):
                public_manifest(self.samples, self.subjects, dictionary(), columns)

    def test_never_guesses_age_cohorts_or_anatomy(self):
        for field, value in [('AGECOHORT','neonatal'), ('AGECOHORT','')]:
            subjects = [dict(self.subjects[0], **{field:value}), self.subjects[1]]
            with self.assertRaises(ValueError):
                public_manifest(self.samples, subjects, dictionary(), ['S1','S2','S3'])
        altered = dictionary(); altered[0]['v1'] = '1=Neonatal'
        with self.assertRaises(ValueError):
            public_manifest(self.samples, self.subjects, altered, ['S1','S2','S3'])

    def test_installs_complete_snapshot_and_preserves_it_on_truncated_matrix(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            paths = {k:root/(k+'.xlsx' if k != 'tpm' else k+'.gz') for k in ['samples','subjects','dictionary','tpm']}
            header = ['SAMPLE_ID','SUBJECT_ID','SMAFRZE','SMTSD','SMTSDUBRID']
            workbook(paths['samples'], [header] + [[r[k] for k in header] for r in self.samples])
            workbook(paths['subjects'], [['SUBJECT_ID','AGECOHORT']] + [[r['SUBJECT_ID'],r['AGECOHORT']] for r in self.subjects])
            workbook(paths['dictionary'], [['VARNAME','ACCESS','VALUES','C2','C3','C4'], ['AGECOHORT','Open']+[f'{k}={v}' for k,v in COHORTS.items()]])
            matrix = '#1.2\n1\t3\nName\tDescription\tS1\tS2\tS3\nENSG00000000001.1\tTEST\t0\t0\t10\n'
            with gzip.open(paths['tpm'], 'wt') as out: out.write(matrix)
            target = root/'context.sqlite'
            manifest = build_snapshot(paths, target)
            self.assertEqual(manifest['geneCount'], 1)
            with sqlite3.connect(target) as db:
                self.assertEqual(json.loads(db.execute('SELECT medians FROM genes').fetchone()[0]), [5])
            db.close()
            original = target.read_bytes()
            with gzip.open(paths['tpm'], 'wt') as out: out.write(matrix.replace('1\t3', '2\t3'))
            with self.assertRaises(ValueError): build_snapshot(paths, target)
            self.assertEqual(target.read_bytes(), original)
            self.assertFalse(Path(str(target)+'.tmp').exists())

if __name__ == '__main__': unittest.main()
