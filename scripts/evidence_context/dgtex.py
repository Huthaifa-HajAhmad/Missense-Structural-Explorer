"""dGTEx V1 public artifacts only. No exact-age reconstruction or onset mapping."""
import gzip
import hashlib
import json
import math
import re
import sqlite3
import statistics
import xml.etree.ElementTree as ET
import zipfile
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

BASE = 'https://storage.googleapis.com/developmental-gtex/'
FILES = {
    'samples': 'annotations/v1/metadata-files/dGTEx_Analysis_2026-01-30_v1_Sample_Attributes_Dataset_DS_open.xlsx',
    'subjects': 'annotations/v1/metadata-files/dGTEx_Analysis_2026-01-30_v1_Subject_Phenotypes_Dataset_DS_open.xlsx',
    'dictionary': 'annotations/v1/metadata-files/dGTEx_Analysis_2026-01-30_v1_Subject_Phenotypes_Public_DD.xlsx',
    'tpm': 'bulk-gex/v1/rna-seq/dGTEx_Analysis_2025-07-21_v1_RNASeQCv2.4.3_gene_tpm.gct.gz',
}
COHORTS = {
    '1': 'Infant (0 to 2 years)', '2': 'Early Childhood (2 to 8 years)',
    '3': 'Pre-pubertal (8 to approximately 13)', '4': 'Post-pubertal (approximately 13 to 18)',
}
NS = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}

def workbook_rows(file):
    """Read values from the first sheet, resolving shared strings and sparse columns."""
    with zipfile.ZipFile(file) as archive:
        strings = []
        if 'xl/sharedStrings.xml' in archive.namelist():
            strings = [''.join(n.itertext()) for n in ET.fromstring(archive.read('xl/sharedStrings.xml')).findall('s:si', NS)]
        rows = []
        for row in ET.fromstring(archive.read('xl/worksheets/sheet1.xml')).findall('s:sheetData/s:row', NS):
            cells = {}
            for cell in row.findall('s:c', NS):
                if cell.find('s:f', NS) is not None:
                    raise ValueError('Unexpected formula in public metadata')
                value = cell.find('s:v', NS)
                text = value.text if value is not None else ''.join(cell.itertext())
                if cell.get('t') == 's':
                    text = strings[int(text)]
                cells[re.sub(r'\d+$', '', cell.get('r'))] = text or ''
            rows.append(cells)
        if not rows:
            raise ValueError('Empty metadata workbook')
        header = rows[0]
        if len(set(header.values())) != len(header):
            raise ValueError('Duplicate metadata column')
        for col in {col for row in rows[1:] for col in row} - set(header):
            header[col] = '__' + col
        return [{name: row.get(col, '') for col, name in header.items()} for row in rows[1:]]

def public_manifest(samples, subjects, dictionary, matrix_samples):
    cohort_definition = next((r for r in dictionary if r.get('VARNAME') == 'AGECOHORT'), None)
    if not cohort_definition or cohort_definition.get('ACCESS') != 'Open':
        raise ValueError('Missing open AGECOHORT definition')
    definitions = {f'{key}={label}' for key, label in COHORTS.items()}
    if not definitions.issubset(set(cohort_definition.values())):
        raise ValueError('AGECOHORT definitions changed')
    if any(r['SMAFRZE'] not in {'RNASEQ', 'WGS', 'EXCLUDE'} for r in samples):
        raise ValueError('Unknown analysis inclusion status')
    sample_map = {r['SAMPLE_ID']: r for r in samples}
    subject_map = {r['SUBJECT_ID']: r for r in subjects}
    if len(sample_map) != len(samples) or len(subject_map) != len(subjects):
        raise ValueError('Duplicate sample or subject ID')
    if len(set(matrix_samples)) != len(matrix_samples):
        raise ValueError('Duplicate matrix sample ID')
    eligible = {r['SAMPLE_ID'] for r in samples if r['SMAFRZE'] == 'RNASEQ'}
    if set(matrix_samples) != eligible:
        raise ValueError('TPM columns do not exactly reconcile with RNASEQ eligible metadata')
    groups = defaultdict(list)
    for index, sample_id in enumerate(matrix_samples):
        row = sample_map[sample_id]
        subject = subject_map.get(row['SUBJECT_ID'])
        if subject is None or subject['AGECOHORT'] not in COHORTS:
            raise ValueError('Missing subject or unrecognized age cohort')
        if not row['SMTSD'] or not re.fullmatch(r'UBERON:\d{7}', row['SMTSDUBRID']):
            raise ValueError('Missing detailed tissue identity')
        key = (row['SMTSDUBRID'], row['SMTSD'], subject['AGECOHORT'])
        groups[key].append((index, row['SUBJECT_ID']))
    ordered = sorted(groups, key=lambda k: (k[1], int(k[2]), k[0]))
    coverage = [{
        'tissueId': key[0], 'tissue': key[1], 'cohortId': key[2], 'cohort': COHORTS[key[2]],
        'sampleCount': len(groups[key]), 'donorCount': len({d for _, d in groups[key]}),
    } for key in ordered]
    return coverage, [groups[key] for key in ordered], {
        'metadataSamples': len(samples), 'includedSamples': len(matrix_samples),
        'excludedSamples': sum(r['SMAFRZE'] == 'EXCLUDE' for r in samples),
        'wgsSamples': sum(r['SMAFRZE'] == 'WGS' for r in samples),
        'includedDonors': len({sample_map[s]['SUBJECT_ID'] for s in matrix_samples}),
        'metadataDonors': len(subjects),
    }

def donor_medians(values, groups):
    result = []
    for members in groups:
        donors = defaultdict(list)
        for index, donor in members:
            donors[donor].append(values[index])
        result.append(statistics.median(statistics.median(v) for v in donors.values()))
    return result

def build_snapshot(paths, target, timestamp_basis='local-import'):
    samples, subjects, dictionary = [workbook_rows(paths[k]) for k in ('samples', 'subjects', 'dictionary')]
    required = {'SAMPLE_ID', 'SUBJECT_ID', 'SMAFRZE', 'SMTSD', 'SMTSDUBRID'}
    if not samples or not required.issubset(samples[0]) or not subjects or not {'SUBJECT_ID', 'AGECOHORT'}.issubset(subjects[0]):
        raise ValueError('Public workbook schema changed')
    source_files = []
    for key, file in paths.items():
        digest = hashlib.sha256()
        with open(file, 'rb') as stream:
            for block in iter(lambda: stream.read(1024 * 1024), b''):
                digest.update(block)
        source_files.append({'kind': key, 'url': BASE + FILES[key], 'sha256': digest.hexdigest()})
    source_files.sort(key=lambda f: f['kind'])
    target = Path(target)
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_name(target.name + '.tmp')
    if temporary.exists():
        raise ValueError('Temporary snapshot exists; remove the failed import artifact explicitly')
    db = sqlite3.connect(temporary)
    try:
        db.execute('CREATE TABLE genes (id TEXT PRIMARY KEY, symbol TEXT NOT NULL, medians TEXT NOT NULL)')
        db.execute('CREATE INDEX genes_symbol ON genes(symbol)')
        db.execute('CREATE TABLE metadata (id INTEGER PRIMARY KEY CHECK(id=1), json TEXT NOT NULL)')
        with gzip.open(paths['tpm'], 'rt', encoding='utf8') as matrix:
            if matrix.readline().strip() != '#1.2':
                raise ValueError('Expected GCT 1.2')
            dimensions = matrix.readline().strip().split('\t')
            if len(dimensions) != 2:
                raise ValueError('Invalid GCT dimensions')
            expected_genes, sample_count = map(int, dimensions)
            header = matrix.readline().rstrip('\n').split('\t')
            if header[:2] != ['Name', 'Description'] or len(header) != sample_count + 2:
                raise ValueError('Invalid GCT sample header')
            coverage, groups, counts = public_manifest(samples, subjects, dictionary, header[2:])
            seen = 0
            for line in matrix:
                row = line.rstrip('\n').split('\t')
                if len(row) != len(header) or not re.fullmatch(r'ENSG\d{11}\.\d+', row[0]) or not row[1]:
                    raise ValueError('Invalid or truncated gene row')
                values = [float(v) for v in row[2:]]
                if any(not math.isfinite(v) or v < 0 for v in values):
                    raise ValueError('Invalid TPM')
                db.execute('INSERT INTO genes VALUES (?, ?, ?)', (row[0], row[1], json.dumps(donor_medians(values, groups), separators=(',', ':'))))
                seen += 1
            if seen != expected_genes:
                raise ValueError('Gene row count does not reconcile')
        manifest = {
            'schemaVersion': 1, 'geneCount': seen, 'coverage': coverage, 'counts': counts,
            'reference': 'GENCODE v47 / GRCh38', 'statistic': 'median of within-donor median TPM',
            'files': source_files,
            'provenance': {'source': 'dGTEx', 'url': 'https://gtexportal.org/home/downloads/developmental-gtex',
                'licence': 'GTEx Portal data licence; attribution and pinned-data disclosure required',
                'release': 'dGTEx Analysis V1 / GENCODE v47', 'retrievedAt': datetime.now(timezone.utc).isoformat(),
                'timestampBasis': timestamp_basis,
                'sha256': hashlib.sha256(json.dumps(source_files, sort_keys=True).encode()).hexdigest()},
        }
        db.execute('INSERT INTO metadata VALUES (1, ?)', (json.dumps(manifest),))
        db.commit()
        db.close()
        temporary.replace(target)
        return manifest
    except Exception:
        db.close()
        temporary.unlink(missing_ok=True)
        raise
