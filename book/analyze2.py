import re, statistics
from collections import defaultdict
lines=open('manuscript_raw.txt').read().split('\n')
def txt(l): 
    return l.split('\t',1)[1] if '\t' in l else l
marks=[]
for i,l in enumerate(lines):
    t=txt(l).strip()
    if re.match(r'^(\d)-(\d)\.$',t): marks.append((i,'SEC',t))
    elif t=='리더의 노트': marks.append((i,'NOTE',t))
    elif t=="Leader's Note": marks.append((i,'LNOTE',t))
    elif re.match(r'^— 제\d장 끝 —$',t): marks.append((i,'CHEND',t))
    elif t=='에필로그': marks.append((i,'EPI',t))
    elif t=='부  록': marks.append((i,'APPX',t))
    elif t=='장을 열며': marks.append((i,'OPEN',t))

secs=[]
for k,(i,kind,t) in enumerate(marks):
    if kind!='SEC': continue
    end=marks[k+1][0]
    title=txt(lines[i+1]).strip()
    raw='\n'.join(lines[i:end])
    body=re.sub(r'^\[[^\]]*\]\t','',raw,flags=re.M).replace('\n','')
    secs.append({'id':t[:-1],'ch':t[0],'title':title,'chars':len(body),
                 'tbl':raw.count('[[TABLE]]'),
                 'refl':'Reflection' in raw,
                 'classic':bool(re.search(r'논어|맹자|노자|탈무드|명심보감|시경|삼국지|장자|중용|한비자|채근담|공자|손자',raw)),
                 'sub':len([x for x in lines[i+2:end] if re.match(r'^\[\]\t\S',x) and 3<len(txt(x).strip())<40 and not txt(x).strip().startswith(('Reflection','—','💡'))])})
print(f"{'편':5} {'분량':>6} {'소제목':>4} {'표':>3} {'성찰':>4} {'고전':>4}  제목")
prev=None
for s in secs:
    if prev!=s['ch']: print('─'*70); prev=s['ch']
    flag='  ⚠' if s['chars']<3000 or s['chars']>5000 else ''
    print(f"{s['id']:5} {s['chars']:6} {s['sub']:4} {s['tbl']:3} {'O' if s['refl'] else '·':>4} {'O' if s['classic'] else '·':>4}  {s['title'][:30]}{flag}")
cs=[s['chars'] for s in secs]
print('─'*70)
print(f"평균 {int(statistics.mean(cs))}자 · 중앙값 {int(statistics.median(cs))} · 최소 {min(cs)} · 최대 {max(cs)} · 편차 {int(statistics.pstdev(cs))}")
d=defaultdict(int); n=defaultdict(int)
for s in secs: d[s['ch']]+=s['chars']; n[s['ch']]+=1
print("장별 본문 합계:", {k:f"{v:,}자" for k,v in sorted(d.items())})
print("35편 합계:", f"{sum(cs):,}자")
# non-section blocks
print("\n[구조 블록 위치]")
for i,kind,t in marks:
    if kind!='SEC': print(f"  line {i:5}  {kind:6} {t}")
