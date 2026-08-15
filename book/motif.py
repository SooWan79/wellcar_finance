import re
from collections import defaultdict
lines=open('manuscript_raw.txt').read().split('\n')
def txt(l): return l.split('\t',1)[1] if '\t' in l else l
# build unit map: prologue / 1-1..5-7 / notes / epilogue / appendix
bounds=[]
for i,l in enumerate(lines):
    t=txt(l).strip()
    if t=='프롤로그': bounds.append((i,'프롤로그'))
    elif re.match(r'^(\d)-(\d)\.$',t): bounds.append((i,t[:-1]))
    elif t=='리더의 노트': bounds.append((i,f'{lines[i-1] and ""}노트'))
    elif re.match(r'^— 제(\d)장 끝 —$',t): bounds.append((i,'장끝'))
    elif t=='장을 열며': bounds.append((i,'장열며'))
    elif t=='에필로그': bounds.append((i,'에필로그'))
    elif t=='부  록': bounds.append((i,'부록'))
bounds.sort()
units=[]
for k,(i,name) in enumerate(bounds):
    end=bounds[k+1][0] if k+1<len(bounds) else len(lines)
    units.append((name,'\n'.join(txt(x) for x in lines[i:end])))

motifs=['김사부','미생','위플래시','오징어게임','슬램덩크','수국','벚꽃','블루베리','쇄빙선','과일 껍질','보글보글','무동력 요트','포수','오케스트라','정원사','답설야중거','호연지기','Bold Play','Storefront','One Step Ahead','Winning with X','Team-ship','Handsome','BLOOM','블루밍','독감','명함','동심원','Credit','역지사지','개와 늑대']
print(f"{'모티프':16} {'횟수':>4}  등장 위치")
for m in motifs:
    hits=[n for n,b in units if m in b]
    if len(hits)>=1:
        mark='  ⚠반복' if len(hits)>=5 else ''
        print(f"{m:16} {len(hits):4}  {', '.join(hits[:14])}{mark}")
