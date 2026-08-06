#!/usr/bin/env python3
# =============================================================================
# okf_to_excel.py — Knowledge Plane bundle (kp/) -> Excel workbook for business.
#
#   Bootstraps or refreshes the workbook FROM the bundle. Pair with
#   excel_to_okf.py (workbook -> bundle). Rule: once business authoring runs
#   through Excel, Excel is the SOLE write path for the columns it owns —
#   refresh the sheet from the bundle only after developer-side changes, then
#   hand it back to stewards.
#
#   Usage: python3 okf_to_excel.py [kp_dir] [out.xlsx]
# =============================================================================
import sys, os, re
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.utils import get_column_letter

KP  = sys.argv[1] if len(sys.argv) > 1 else 'kp'
OUT = sys.argv[2] if len(sys.argv) > 2 else 'knowledge_plane_workbook.xlsx'

# OKF v0.2 lifecycle (SPEC.md §5.4): draft | stable | deprecated.
STATUS_OUT = {'stable': 'Approved', 'draft': 'Draft', 'deprecated': 'Deprecated'}
DOMAIN_TO_STEWARD = {'sales': 'Sales', 'finance': 'Finance',
                     'merchandising': 'Merchandising', 'operations': 'Retail Operations'}
KINDS = {'entity', 'defined_class', 'measure', 'attribute'}

# ---- read the bundle (frontmatter only; no external deps) -------------------
def frontmatter(path):
    t = open(path, encoding='utf-8').read()
    if not t.startswith('---'): return None
    end = t.index('\n---', 3)
    fm, out, key = t[3:end].strip().split('\n'), {}, None
    for line in fm:
        m = re.match(r'^(\w+):\s*(.*)$', line)
        if m:
            key, val = m.group(1), m.group(2).strip()
            out[key] = val
        elif key and line.startswith('  '):
            out.setdefault(key + '__nested', []).append(line)
    return out

def unq(v):
    v = (v or '').strip()
    if v.startswith('"') and v.endswith('"'): v = v[1:-1].replace('\\"', '"')
    return v

def unlist(v):
    v = unq(v)
    if v.startswith('[') and v.endswith(']'):
        return ', '.join(x.strip().strip('"') for x in v[1:-1].split(',') if x.strip())
    return v

def flow_field(v, key):
    """Pull `key` out of an inline flow mapping like '{ by: human:sales, at: 2026-07-15T00:00:00Z }'."""
    m = re.search(key + r':\s*([^,}]+)', v or '')
    return m.group(1).strip() if m else ''

concepts, relationships = [], []
namespace = 'https://yourorg.example/kp#'
cfg = os.path.join(KP, 'bundle.yaml')
if os.path.exists(cfg):
    m = re.search(r'namespace:\s*"?([^"\n]+)"?', open(cfg).read())
    if m: namespace = m.group(1).strip()

for root, dirs, files in os.walk(KP):
    dirs[:] = [d for d in dirs if not d.startswith('_') and d != 'agent']
    for fn in sorted(files):
        if not fn.endswith('.md') or fn in ('index.md', 'README.md'): continue
        d = frontmatter(os.path.join(root, fn))
        if not d or d.get('type') not in KINDS: continue
        domain = os.path.relpath(root, KP).split(os.sep)[0]
        steward = unq(d.get('steward', '')) or DOMAIN_TO_STEWARD.get(domain, '')
        status = STATUS_OUT.get(unq(d.get('status', 'draft')), 'Draft')
        # governance now lives in `verified` (a human: actor), not `status` alone —
        # only a verified concept gets an 'Approved by' / 'Approved on' back in the sheet.
        verified_at = flow_field(d.get('verified', ''), 'at')
        generated_at = flow_field(d.get('generated', ''), 'at')
        c = {
            'URI': unq(d.get('uri')), 'Label': unq(d.get('title')), 'Kind': d.get('type'),
            'Definition': unq(d.get('description')), 'Synonyms': unlist(d.get('synonyms', '')),
            'Steward': steward,
            'Subtype of': unq(d.get('subtype_of', '')), 'Of (entity)': unq(d.get('of', '')),
            'Membership rule': unq(d.get('membership_rule', '')),
            'Preferred source': unq(d.get('preferred_source', '')),
            'Allowed roles': unlist(d.get('allowed_roles', '')),
            'Approval status': status,
            'Approved by': steward if verified_at else '',
            'Approved on': (verified_at or generated_at)[:10],
            'Validation status': unq(d.get('validation_status', '')).capitalize() or 'Not started',
            'Checked against': unq(d.get('checked_against', '')),
            'Validation notes': unq(d.get('validation_notes', '')),
        }
        concepts.append(c)
        for i, line in enumerate(d.get('relationships__nested', [])):
            m = re.match(r'\s*-\s*uri:\s*(\S+)', line)
            if m:
                verb = rng = ''
                for l2 in d['relationships__nested'][i+1:i+3]:
                    mv = re.match(r'\s*verb:\s*(.*)', l2); mr = re.match(r'\s*range:\s*(\S+)', l2)
                    if mv: verb = unq(mv.group(1))
                    if mr: rng = mr.group(1)
                relationships.append({'URI': m.group(1), 'Verb phrase': verb,
                                      'From (domain)': unq(d.get('uri')), 'To (range)': rng,
                                      'Approval status': STATUS_OUT.get(unq(d.get('status','draft')),'Draft')})

kind_order = {'entity': 0, 'defined_class': 1, 'measure': 2, 'attribute': 3}
concepts.sort(key=lambda c: (kind_order[c['Kind']], c['URI']))
relationships.sort(key=lambda r: r['URI'])

# ---- write the workbook -----------------------------------------------------
HDR_FILL = PatternFill('solid', fgColor='2F5B7C')
HDR_FONT = Font(name='Arial', size=10, bold=True, color='FFFFFF')
BODY_FONT = Font(name='Arial', size=10)
wb = openpyxl.Workbook()

def style_headers(ws, headers, widths):
    for i, (h, w) in enumerate(zip(headers, widths), 1):
        c = ws.cell(row=1, column=i, value=h)
        c.font, c.fill = HDR_FONT, HDR_FILL
        c.alignment = Alignment(vertical='center')
        ws.column_dimensions[get_column_letter(i)].width = w
    ws.freeze_panes = 'A2'

def dv(ws, formula, ref):
    d = DataValidation(type='list', formula1=formula, allow_blank=True, showDropDown=False)
    ws.add_data_validation(d); d.add(ref)

# Read me
rm = wb.active; rm.title = 'Read me'
rm.column_dimensions['B'].width = 110
lines = [
    ('Knowledge Plane workbook', True),
    ('', False),
    ('This sheet is the friendly front door to the company Knowledge Plane: the single agreed list of business concepts,', False),
    ('their definitions, and who owns them. What you approve here becomes the definitions the AI analyst and all reports use.', False),
    ('', False),
    ('How to work with it', True),
    ('1. One row per concept on the Concepts sheet. Edit the definition columns; BI fills the validation columns.', False),
    ('2. New concept: add a row, set Approval status = Draft. Only Approved concepts go live.', False),
    ('3. Retiring a concept: set status = Deprecated (kept for history, no longer used).', False),
    ('4. When you approve, fill Approved by and Approved on.', False),
    ('', False),
    ('What the columns mean', True),
    ('Kind            — entity (a business thing), attribute (a property of a thing), measure (a number we track),', False),
    ('                  defined_class (a named group with a precise membership rule, e.g. Active Customer).', False),
    ('Steward         — the team that owns this definition. Blank = Global (the whole company shares it).', False),
    ('Of (entity)     — for attributes: WHICH entity this is a property of (Customer Age is of kp:Customer).', False),
    ('Membership rule — for defined_class only: the exact rule, applied verbatim everywhere.', False),
    ('Preferred source— which data model is the official source when several carry this concept (BI advises).', False),
    ('Allowed roles   — leave blank if everyone may see it; else comma-separated roles.', False),
    ('Approval status — Draft -> Approved. Deprecated retires a concept.', False),
    ('Approved on     — date of approval; becomes the audit timestamp.', False),
    ('Validation cols — BI fills: whether the implemented number was checked against a trusted source.', False),
    ('', False),
    ('Global vs domain concepts', True),
    ('Blank Steward = Global: one company-wide definition. A stewarded concept used by many domains is a candidate', False),
    ('for promotion to Global — BI will flag these; promotion is a review decision, never automatic.', False),
    ('', False),
    (f'Namespace: {namespace} · Concepts: {len(concepts)} · Relationships: {len(relationships)}', False),
]
for i, (txt, bold) in enumerate(lines, 1):
    c = rm.cell(row=i, column=2, value=txt)
    c.font = Font(name='Arial', size=11 if bold else 10, bold=bold)

# Concepts
ws = wb.create_sheet('Concepts')
headers = ['URI','Label','Kind','Definition','Synonyms','Steward','Subtype of','Of (entity)',
           'Membership rule','Preferred source','Allowed roles','Approval status','Approved by',
           'Approved on','—  Validation (BI fills below)  —','Validation status','Checked against','Validation notes']
widths  = [26,22,13,60,22,16,18,16,34,26,16,14,14,12,4,14,22,30]
style_headers(ws, headers, widths)
for r, c in enumerate(concepts, 2):
    for i, h in enumerate(headers, 1):
        cell = ws.cell(row=r, column=i, value=c.get(h, ''))
        cell.font = BODY_FONT
    ws.cell(row=r, column=14).number_format = 'yyyy-mm-dd'
n = len(concepts) + 1
dv(ws, '"entity,attribute,measure,defined_class"', f'C2:C{n}')
dv(ws, '"Draft,Approved,Deprecated"',    f'L2:L{n}')
dv(ws, '"Not started,Passed,Failed"',              f'P2:P{n}')

# Relationships
wr = wb.create_sheet('Relationships')
rh = ['URI','Verb phrase','From (domain)','To (range)','Approval status']
style_headers(wr, rh, [24,20,22,22,16])
for r, rel in enumerate(relationships, 2):
    for i, h in enumerate(rh, 1):
        wr.cell(row=r, column=i, value=rel.get(h, '')).font = BODY_FONT
dv(wr, '"Draft,Approved,Deprecated"', f'E2:E{len(relationships)+1}')

# Lists
wl = wb.create_sheet('Lists')
style_headers(wl, ['Kinds','Approval statuses','Validation statuses','Stewards'], [16,18,18,20])
cols = [['entity','attribute','measure','defined_class'],
        ['Draft','Approved','Deprecated'],
        ['Not started','Passed','Failed'],
        sorted({c['Steward'] for c in concepts if c['Steward']})]
for j, col in enumerate(cols, 1):
    for i, v in enumerate(col, 2):
        wl.cell(row=i, column=j, value=v).font = BODY_FONT

wb.save(OUT)
print(f'-> {OUT}: {len(concepts)} concepts, {len(relationships)} relationships')
