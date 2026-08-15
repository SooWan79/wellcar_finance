import re
lines=open('manuscript_raw.txt').read().split('\n')
def txt(l): return l.split('\t',1)[1] if '\t' in l else l
marks=[]
for i,l in enumerate(lines):
    t=txt(l).strip()
    if re.match(r'^\d-\d\.$',t): marks.append((i,'SEC',t[:-1]))
    elif t in ('리더의 노트',"Leader's Note",'장을 열며','에필로그','부  록'): marks.append((i,'X',t))
    elif re.match(r'^— 제\d장 끝 —$',t): marks.append((i,'X',t))
secs=[(i,t) for i,k,t in marks if k=='SEC']
res=[]
for k,(i,sid) in enumerate(secs):
    end=[m[0] for m in marks if m[0]>i][0]
    blk=[txt(x) for x in lines[i:end]]
    raw='\n'.join(blk)
    # classical quote = table line with 3+ CJK ideographs and a — attribution
    quote = bool(re.search(r'[一-鿿]{4,}.{0,400}—\s*\S', raw, re.S))
    src=re.findall(r'—\s*([^\n,]{2,25}?)\s*[「\n]', raw)
    refl=[x for x in blk if x.startswith('Reflection')]
    qn=len(re.findall(r'\d\.\s', refl[0])) if refl else 0
    # epigraph: table immediately after title
    epi = blk[2].startswith('[[TABLE]]') if len(blk)>2 else False
    res.append((sid,quote,qn,epi,src[0] if src else ''))
print(f"{'편':5} {'고전인용':>6} {'성찰질문':>6} {'제사(격언)':>8}  출처")
for sid,q,qn,epi,src in res:
    flag=''
    if not q: flag+=' ⚠고전없음'
    if qn!=3: flag+=f' ⚠질문{qn}개'
    if not epi: flag+=' ⚠제사없음'
    print(f"{sid:5} {'O' if q else '·':>6} {qn:6} {'O' if epi else '·':>8}  {src[:24]}{flag}")
