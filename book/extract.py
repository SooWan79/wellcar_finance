"""원고 .docx에서 문단별 텍스트를 스타일명과 함께 추출한다.

사용법:  python extract.py <원고.docx> [출력.txt]
출력 형식:  [스타일명]\t문단 텍스트   (표는 [[TABLE]] 블록)
이후 analyze2.py / chk.py / motif.py / xref.py가 이 출력을 입력으로 쓴다.
"""
import sys
import zipfile
from xml.etree import ElementTree as ET

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'


def para_text(p):
    return ''.join(t.text or '' for t in p.iter(W + 't'))


def extract(path, out_path):
    z = zipfile.ZipFile(path)

    styles = {}
    sroot = ET.fromstring(z.read('word/styles.xml'))
    for s in sroot.iter(W + 'style'):
        name = s.find(W + 'name')
        if name is not None:
            styles[s.get(W + 'styleId')] = name.get(W + 'val')

    body = ET.fromstring(z.read('word/document.xml')).find(W + 'body')
    out = []
    for el in body:
        tag = el.tag.replace(W, '')
        if tag == 'p':
            pPr = el.find(W + 'pPr')
            sid = None
            if pPr is not None:
                ps = pPr.find(W + 'pStyle')
                if ps is not None:
                    sid = ps.get(W + 'val')
            out.append(('P', styles.get(sid, sid) if sid else '', para_text(el)))
        elif tag == 'tbl':
            rows = []
            for tr in el.findall(W + 'tr'):
                cells = [' '.join(para_text(p) for p in tc.iter(W + 'p'))
                         for tc in tr.findall(W + 'tc')]
                rows.append(' | '.join(cells))
            out.append(('TBL', '', '\n'.join(rows)))

    with open(out_path, 'w') as f:
        for kind, style, txt in out:
            if kind == 'TBL':
                f.write('[[TABLE]]\n' + txt + '\n')
            else:
                f.write(f'[{style}]\t{txt}\n')
    print(f'{len(out)}개 블록 추출 → {out_path}')


if __name__ == '__main__':
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    extract(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else 'manuscript_raw.txt')
