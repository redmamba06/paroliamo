import re,collections,json
tags=collections.defaultdict(set)
for l in open('morphit.txt',encoding='utf-8'):
    p=l.rstrip('\n').split('\t')
    if len(p)==3: tags[p[0].lower()].add(p[2])
def load(f): return set(w.strip().lower() for w in open(f,encoding='utf-8') if w.strip())
big=load('660000_parole_italiane.txt')|load('280000_parole_italiane.txt')
ok=re.compile('^[a-z]+$')
foreign=re.compile('[kwxyj]|sh|ck|oo|ee|th|ph|ou|[^aeiou]$')
freq={}
for i,l in enumerate(open('it_50k.txt',encoding='utf-8')): freq.setdefault(l.split()[0],i)
BAD={'puttana','puttane','troia','troie','frocio','froci','negro','negri','negra','zoccola','zoccole','frocia','ricchione','finocchio','mignotta','cazzo','cazzi','merda','stronzo','stronza','stronzi','culo','culi','figa','fighe','pompino','sborra','tetta','tette','porno','signor','dottor','tizio','tizia','cosi','pero','perche','faro','sara','gia','piu','papa','citta','caffe','unita','dosso','ancor','elise','coglione','coglioni','scopare','fottuto','fottuta','fottere','frega','troione','checca','ebreo','ebrea','ebrei','zingaro','zingari','zingara','mongolo','handicappato','ritardato','ritardata','nazista','nazisti','stupro','stupri','stuprata','violentata','suicidio','cadavere','uccidere','ucciso','uccisa','uccisi','omicidio'}
def good(w):
    t=tags.get(w)
    if not t or w in BAD: return False
    if any(x.split(':')[0].split('-')[0] in ('ARTPRE','PRE','DET','PRO','CON','ART','NPR','ABL','SYM','INT','WH','CE','CI','NE','SI','AUX','MOD','CAU') for x in t): return False
    return any(x.startswith('NOUN') or x.startswith('ADJ') or x=='VER:infi' or x.startswith('ADV') for x in t)
caps={4:600,5:2200,6:2800,7:3000}
for n in (4,5,6,7):
    a=sorted([w for w in freq if len(w)==n and ok.match(w) and not foreign.search(w) and good(w)],key=freq.get)[:caps[n]]
    v=sorted(({w for w in big|set(tags) if len(w)==n and ok.match(w)})-set(a))
    json.dump({'a':a,'v':' '.join(v)},open(f'../words/it{n}.json','w'),separators=(',',':'))
    print(n,len(a),len(v),a[:25],a[-15:])
