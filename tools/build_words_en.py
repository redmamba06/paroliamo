import re,json
alpha=set(w.strip() for w in open('en_alpha.txt'))
common=set(w.strip() for w in open('en_common.txt'))
names=set(w.strip().lower() for w in open('names.txt'))|set(w.strip().lower() for w in open('last_names.txt'))
swears=set(w.strip().lower() for w in open('en_swears.txt'))
EXTRA={'paris','texas','london','italy','china','japan','india','vegas','miami','tokyo','dubai','egypt','spain','korea','berlin','boston','dallas','denver','sydney','mexico','canada','russia','france','german','jesus','christ','moses','satan','nixon','obama','trump','yahoo','apple','amazon','google','sony','honda','toyota','disney','gonna','wanna','gotta','gimme','dunno','lemme','kinda','sorta','outta','doesn','didn','couldn','wouldn','shouldn','wasn','weren','isn','aren','hasn','haven','hadn','ain','okay','yeah','hmm','uh','huh','mrs','hey','fucking','fucker','bitch','bitches','whore','slut','nigga','nigger','faggot','retard','penis','vagina','boobs','dick','dicks','cock','pussy','tits','asshole','bastard','damn','crap','shit','sex','sexy','porn','rape','raped','kill','killed','killing','murder','dead','suicide','tellin','talkin','nothin','somethin','goin','doin','comin','lookin','gettin','feelin','fuckin','motherfucker'}
freq={}
for i,l in enumerate(open('en_50k.txt')):
    freq.setdefault(l.split()[0],i)
ok=re.compile('^[a-z]+$')
caps={4:700,5:2300,6:2600,7:2600}
for n in (4,5,6,7):
    a=sorted([w for w in freq if len(w)==n and ok.match(w) and w in alpha and w not in EXTRA and w not in swears
              and (w in common or (w not in names and freq[w]<20000))
              and not (w in names and w not in common)],key=freq.get)[:caps[n]]
    v=sorted({w for w in alpha if len(w)==n}-set(a))
    json.dump({'a':a,'v':' '.join(v)},open(f'../words/en{n}.json','w'),separators=(',',':'))
    print(n,len(a),len(v),a[:20],a[-15:])
