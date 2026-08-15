import re
lines=open('manuscript_raw.txt').read().split('\n')
def txt(l): return l.split('\t',1)[1] if '\t' in l else l
titles={}
for i,l in enumerate(lines):
    t=txt(l).strip()
    m=re.match(r'^(\d-\d)\.$',t)
    if m: titles[m.group(1)]=txt(lines[i+1]).strip()
full='\n'.join(txt(x) for x in lines)
print("=== 실제 제목 ===")
for k,v in titles.items(): print(' ',k,v)
print("\n=== 본문 내 상호참조 검증 ===")
bad=0
for m in re.finditer(r'(\d-\d)\s*「([^」]+)」', full):
    sec,ref=m.group(1),m.group(2)
    actual=titles.get(sec,'(없음)')
    ok = ref in actual or actual.startswith(ref) or ref.split('—')[0].strip() in actual
    if not ok:
        bad+=1
        print(f"  ✗ {sec} 「{ref}」  → 실제: 「{actual}」")
print(f"\n불일치 {bad}건")
print("\n=== 장 번호만 참조된 것 (숫자장) ===")
for m in re.finditer(r'제(\d)장\s*[「"]?([^」"\n]{0,20})', full):
    pass
