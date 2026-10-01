/* ============================================================
   Paroliamo — giochi a più round: Nomi Cose Città, Nominane 3,
   Carte Scorrette. Ogni gioco si registra in GAMES con:
   make, count, results, title, label, hostTick, render, reveal,
   (timeLeft, tick, lobby, bind, awards, minPlayers).
   Usa le utilità globali di app.js ($, esc, who, R, Net, me…).
   ============================================================ */
'use strict';

const GAMES = {};

/* ---------- testo libero: normalizzazione e somiglianza ---------- */
const ARTICLES = new Set(['il', 'lo', 'la', 'i', 'gli', 'le', 'un', 'uno', 'una', 'l', 'the', 'a']);
function fold(s) { return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
function normAnswer(s) {
  const ws = fold(s).replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
  while (ws.length > 1 && ARTICLES.has(ws[0])) ws.shift();
  return ws.join(' ');
}
function stem(s) { return s.split(' ').map(w => (w.length > 3 ? w.replace(/[aeiou]$/, '') : w)).join(' '); }
function lev(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 9;
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]; dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}
function similar(a, b) {
  if (!a || !b) return false;
  if (a === b || stem(a) === stem(b)) return true;
  const m = Math.min(a.length, b.length);
  const d = lev(a, b);
  return (m >= 5 && d <= 1) || (m >= 8 && d <= 2);
}
const majority = (n) => Math.floor((n - 1) / 2) + 1;   // maggioranza degli altri giocatori
const splitList = (s) => (s ? String(s).split(',').filter(x => x !== '') : []);
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

/* ================================================================
   NOMI COSE CITTÀ
   ================================================================ */
function nccBaseKeys(cfg) {
  return typeof cfg.nccCats === 'string' ? splitList(cfg.nccCats) : NCC_BASE.filter(b => b.on).map(b => b.k);
}
function nccEnd(r) {
  if (typeof r.startAt !== 'number') return null;
  let end = r.startAt + r.dur;
  if (typeof r.stopAt === 'number') end = Math.min(end, r.stopAt + 10000);
  return end;
}
function nccCats(r) { return arr(r.cats); }
function nccAnswer(r, id, i) { return ((r.a || {})[id] || {})['c' + i] || ''; }
// per ogni categoria: risposte valide raggruppate, punti per giocatore
function nccScore(r) {
  const cats = nccCats(r);
  const ids = [...new Set([...Object.keys(r.parts || {}), ...Object.keys(r.a || {})])];
  const L = fold(r.letter);
  const out = cats.map((_, i) => {
    const cells = {};
    ids.forEach(id => {
      const text = nccAnswer(r, id, i).trim();
      const norm = normAnswer(text);
      const votes = Object.keys(((r.f || {})[id] || {})['c' + i] || {}).filter(v => v !== id);
      let status = 'ok';
      if (!norm) status = 'empty';
      else if (norm[0] !== L && fold(text).replace(/[^a-z0-9]/g, '')[0] !== L) status = 'letter';
      else if (votes.length >= majority(ids.length)) status = 'voted';
      cells[id] = { text, norm, votes, status, pts: 0 };
    });
    const valid = ids.filter(id => cells[id].status === 'ok');
    valid.forEach(id => {
      const k = valid.filter(o => similar(cells[o].norm, cells[id].norm)).length;
      cells[id].k = k;
      cells[id].pts = k === 1 ? 100 : 50;
    });
    return cells;
  });
  return { cats, ids, out };
}

const nccSave = {};
GAMES.ncc = {
  minPlayers: 1,
  count: (cfg) => +cfg.nccN || 5,
  async make(cfg, { d, prev }) {
    const base = nccBaseKeys(cfg).map(k => (NCC_BASE.find(b => b.k === k) || {}).t).filter(Boolean);
    const custom = Object.values(d.cats || {}).filter(c => c && c.t).map(c => c.t);
    let cats = [...base, ...custom].slice(0, 14);
    if (!cats.length) cats = NCC_BASE.filter(b => b.on).map(b => b.t);
    const used = prev ? prev.used || '' : '';
    let letters = [...NCC_LETTERS].filter(l => !used.includes(l));
    if (!letters.length) letters = [...NCC_LETTERS];
    const letter = letters[rand(letters.length)];
    return { status: 'play', letter, used: used + letter, cats, startAt: Net.TS, dur: (+cfg.nccT || 90) * 1000 };
  },
  results(r) {
    const pts = {}, d = {};
    const { ids, out } = nccScore(r);
    ids.forEach(id => { pts[id] = 0; d[id] = { u: 0 }; });
    out.forEach(cells => ids.forEach(id => {
      pts[id] += cells[id].pts;
      if (cells[id].pts === 100) d[id].u++;
    }));
    return { pts, d };
  },
  title: (r) => `Nomi Cose Città · ${r.letter}`,
  label: (r) => `Nomi Cose Città · ${r.letter}`,
  timeLeft(r) {
    if (r.status !== 'play') return null;
    const end = nccEnd(r);
    return end == null ? null : Math.max(0, end - R.room.now());
  },
  hostTick(r, now) {
    if (r.status !== 'play') return;
    const end = nccEnd(r);
    if (end != null && now > end + 1500) {
      R.busy = true;
      R.room.update('round', { status: 'reveal' }).catch(() => {}).finally(() => { R.busy = false; });
    }
  },
  render(r) {
    const cats = nccCats(r);
    const key = R.code + ':' + r.id;
    if (R._nccKey !== key) {
      R._nccKey = key;
      $('#ncc-letter').textContent = r.letter;
      $('#ncc-list').innerHTML = cats.map((c, i) => `<label class="ncc-row"><span>${esc(c)}</span>
        <input data-i="${i}" maxlength="40" autocomplete="off" autocapitalize="sentences" spellcheck="false" placeholder="${esc(r.letter)}…" value="${esc(nccAnswer(r, me.id, i))}"></label>`).join('');
      setTimeout(() => { const f = $('#ncc-list input'); f && f.focus(); }, 80);
    }
    this.tick(r);
    const ids = Object.keys(r.parts || {}).filter(isPresent);
    $('#ncc-status').innerHTML = ids.map(id => {
      const n = cats.filter((_, i) => nccAnswer(r, id, i).trim()).length;
      return `<li class="${n === cats.length ? 'ok' : ''}">${who(id)} ${n}/${cats.length}</li>`;
    }).join('');
  },
  tick(r) {
    if (R._nccKey !== R.code + ':' + r.id) return;
    const left = this.timeLeft(r);
    const over = left === 0;
    $$('#ncc-list input').forEach(i => { i.disabled = over; });
    const mineFull = $$('#ncc-list input').every(i => i.value.trim());
    const stop = $('#ncc-stop');
    stop.disabled = over || typeof r.stopAt === 'number' || !mineFull;
    $('#ncc-banner').innerHTML = typeof r.stopAt === 'number'
      ? `🛑 <b>${who(r.stopBy)}</b> ha detto STOP! Ultimi secondi!`
      : over ? '⏰ Tempo scaduto!' : mineFull ? 'Hai finito? Premi <b>STOP!</b> e gli altri hanno 10 secondi' : '';
  },
  reveal(r, res, head, body) {
    const { cats, ids, out } = nccScore(r);
    head.innerHTML = `<div class="ncc-big small-letter">${esc(r.letter)}</div><h2>Nomi Cose Città</h2>
      <div class="muted small">Parola unica 100 · ripetuta 50. Una risposta non vale? Bocciatela con 👎 (servono ${majority(ids.length)} ${majority(ids.length) === 1 ? 'voto' : 'voti'}).</div>`;
    body.innerHTML = cats.map((c, i) => `<div class="card ncc-cat"><div class="card-title">${esc(c)}</div>${ids.map(id => {
      const cell = out[i][id];
      const iVoted = cell.votes.includes(me.id);
      const note = cell.status === 'empty' ? '—' : cell.status === 'letter' ? ' <span class="muted small">(lettera sbagliata)</span>' : '';
      return `<div class="ncc-ans ${cell.status !== 'ok' ? 'bad' : ''} ${cell.pts === 100 ? 'unique' : ''}">
        <span class="who">${pemoji(id)}</span><span class="txt">${cell.text ? esc(cell.text) : ''}${note}</span>
        <span class="pts-badge ${cell.pts ? '' : 'zero'}">+${cell.pts}</span>
        ${cell.text && id !== me.id ? `<button class="vote ${iVoted ? 'on' : ''}" data-act="nflag" data-t="${id}" data-c="${i}">👎${cell.votes.length ? ' ' + cell.votes.length : ''}</button>` : '<span class="vote-sp"></span>'}
      </div>`;
    }).join('')}</div>`).join('');
  },
  lobby(cfg) {
    const on = new Set(nccBaseKeys(cfg));
    $('#ncc-base').innerHTML = NCC_BASE.map(b => `<button data-k="${b.k}" class="${on.has(b.k) ? 'on' : ''}">${esc(b.t)}</button>`).join('');
    $('#ncc-base').classList.toggle('locked', !R.isHost);
    const cats = Object.entries(R.d.cats || {}).filter(([, c]) => c && c.t);
    $('#ncc-custom').innerHTML = cats.map(([k, c]) => `<span class="chip">${esc(c.t)}${R.isHost || c.by === me.id ? ` <button data-del="${k}" title="Togli">✕</button>` : ''}</span>`).join('')
      || '<span class="muted small">Nessuna ancora: aggiungetene di simpatiche! (es. "Scusa per non lavare i piatti")</span>';
  },
  bind() {
    $('#ncc-list').addEventListener('input', (e) => {
      const i = e.target.dataset.i;
      if (i == null) return;
      const r = R.d.round;
      if (!r || r.game !== 'ncc') return;
      nccSave[i] = nccSave[i] || debounce((v, rid) => {
        if (R.d.round && R.d.round.id === rid) R.room.set(`round/a/${me.id}/c${i}`, v).catch(() => {});
      }, 250);
      nccSave[i](e.target.value.slice(0, 40), r.id);
      this.tick(r);
    });
    $('#ncc-list').addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const ins = $$('#ncc-list input');
      const j = ins.indexOf(e.target);
      if (ins[j + 1]) ins[j + 1].focus(); else e.target.blur();
    });
    $('#ncc-stop').onclick = () => {
      const r = R.d.round;
      if (!r || typeof r.stopAt === 'number') return;
      R.room.update('round', { stopAt: Net.TS, stopBy: me.id }).catch(() => {});
      Sfx.play('bad');
    };
    $('#reveal-body').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-act="nflag"]');
      const r = R.d.round;
      if (!b || !r || r.game !== 'ncc' || r.status !== 'reveal') return;
      const path = `round/f/${b.dataset.t}/c${b.dataset.c}/${me.id}`;
      R.room.set(path, b.classList.contains('on') ? null : true).catch(() => {});
    });
    $('#ncc-base').onclick = (e) => {
      const b = e.target.closest('button[data-k]');
      if (!b || !R.isHost) return;
      const on = new Set(nccBaseKeys(Object.assign({}, DEFAULT_CFG, R.d.cfg || {})));
      on.has(b.dataset.k) ? on.delete(b.dataset.k) : on.add(b.dataset.k);
      R.room.update('cfg', { nccCats: NCC_BASE.filter(x => on.has(x.k)).map(x => x.k).join(',') }).catch(() => {});
    };
    const addCat = () => {
      const t = $('#ncc-add-input').value.trim().slice(0, 40);
      if (!t) return;
      R.room.set(`cats/${me.id}${Date.now().toString(36)}`, { t, by: me.id }).catch(() => toast('Errore di rete'));
      $('#ncc-add-input').value = '';
    };
    $('#ncc-add-btn').onclick = addCat;
    $('#ncc-add-input').onkeydown = (e) => { if (e.key === 'Enter') addCat(); };
    $('#ncc-custom').onclick = (e) => {
      const b = e.target.closest('button[data-del]');
      if (b) R.room.remove('cats/' + b.dataset.del).catch(() => {});
    };
  },
  awards: [{ fn: (h, d) => (h.g === 'ncc' && d.u ? d.u : 0), label: 'Fantasia al potere', ico: '🦄', unit: 'parole uniche' }]
};

/* ================================================================
   NOMINANE 3 (a voce, uno alla volta)
   ================================================================ */
function treCat(r) { return dec(r.c || '', R.code + r.id); }
GAMES.tre = {
  minPlayers: 2,
  count: (cfg, pres) => Math.max(1, pres.length) * (+cfg.treR || 1),
  async make(cfg, { pres, prev, id }) {
    const order = prev ? splitList(prev.order) : pres;
    const k = prev ? prev.k + 1 : 1;
    // chi tocca: in ordine, saltando chi non c'è più
    let player = order[(k - 1) % order.length];
    for (let t = 0; t < order.length && !pres.includes(player); t++) player = order[(k - 1 + t + 1) % order.length];
    const used = prev ? splitList(prev.usedc) : [];
    let cands = TRE_CATS.map((_, i) => i).filter(i => !used.includes(String(i)));
    if (!cands.length) cands = TRE_CATS.map((_, i) => i);
    const ci = cands[rand(cands.length)];
    return {
      status: 'play', phase: 'ready', player, order: order.join(','), usedc: [...used, ci].join(','),
      c: enc(TRE_CATS[ci], R.code + id), dur: (+cfg.treT || 10) * 1000
    };
  },
  results(r) {
    const pts = {}, d = {};
    if (r.player) { pts[r.player] = r.ok ? 100 : 0; d[r.player] = { ok: r.ok ? 1 : 0 }; }
    return { pts, d };
  },
  title: (r) => `Nominane 3 · ${pname(r.player)}: ${treCat(r)}`,
  label: () => 'Nominane 3',
  timeLeft(r) {
    if (r.status !== 'play' || r.phase !== 'go' || typeof r.startAt !== 'number') return null;
    return Math.max(0, r.startAt + r.dur - R.room.now());
  },
  hostTick(r, now, pres) {
    if (r.status === 'reveal') {
      // passaggio automatico al turno successivo
      if (r.k < r.N && typeof r.revealAt === 'number' && now > r.revealAt + 4500) nextRound();
      return;
    }
    if (r.status !== 'play') return;
    const set = (v) => { R.busy = true; R.room.update('round', v).catch(() => {}).finally(() => { R.busy = false; }); };
    if (!pres.includes(r.player)) return set({ status: 'reveal', ok: false, skipped: true, revealAt: Net.TS });
    if (r.phase === 'go' && typeof r.startAt === 'number' && now > r.startAt + r.dur + 600) return set({ phase: 'vote' });
    if (r.phase === 'vote') {
      const voters = pres.filter(id => id !== r.player);
      const v = r.v || {};
      if (voters.every(id => v[id] != null)) {
        const yes = voters.filter(id => v[id] === 1).length;
        const no = voters.filter(id => v[id] === 0).length;
        set({ status: 'reveal', ok: !voters.length || yes >= no, revealAt: Net.TS });
      }
    }
  },
  render(r) {
    const mine = r.player === me.id;
    const el = $('#tre-main');
    const cat = treCat(r);
    $('#tre-who').innerHTML = `${pemoji(r.player)} <b>${esc(pname(r.player))}</b>`;
    if (r.phase === 'ready') {
      el.innerHTML = mine
        ? `<h2>Tocca a te! 🎤</h2><p class="muted">Premi VIA: vedrai la categoria e avrai <b>${r.dur / 1000} secondi</b> per dirne 3 ad alta voce in chiamata.</p>
           <button class="btn primary big tre-go" data-act="go">VIA!</button>`
        : `<h2>Tocca a ${esc(pname(r.player))}…</h2><p class="muted">Sta per partire: ascolta bene e poi vota se ce l'ha fatta!</p>`;
    } else if (r.phase === 'go') {
      el.innerHTML = `<div class="tre-cat">Nomina 3<br><b>${esc(cat)}</b></div><div id="tre-count" class="tre-count"></div>
        ${mine ? '<button class="btn primary big" data-act="done">✅ Fatto!</button>' : '<p class="muted">Ascolta e conta! 👂</p>'}`;
      this.tick(r);
    } else if (r.phase === 'vote') {
      const v = (r.v || {})[me.id];
      const voters = presentIds().filter(id => id !== r.player);
      const nv = voters.filter(id => (r.v || {})[id] != null).length;
      el.innerHTML = `<div class="tre-cat">Nomina 3<br><b>${esc(cat)}</b></div>` + (mine
        ? `<p>Gli altri stanno votando… (${nv}/${voters.length}) 🤞</p>`
        : `<h2>Ce l'ha fatta?</h2><div class="tre-vote">
             <button class="btn ${v === 1 ? 'primary' : ''}" data-act="yes">✅ Sì</button>
             <button class="btn ${v === 0 ? 'danger' : ''}" data-act="no">❌ No</button></div>
           <p class="muted small">Voti: ${nv}/${voters.length}</p>`);
    }
  },
  tick(r) {
    const c = $('#tre-count');
    if (!c || r.phase !== 'go') return;
    const left = this.timeLeft(r);
    c.textContent = left == null ? '' : Math.ceil(left / 1000);
    c.classList.toggle('low', left != null && left <= 3000);
  },
  reveal(r, res, head, body) {
    const cat = treCat(r);
    const v = r.v || {};
    head.innerHTML = `<div class="tre-cat">${who(r.player)}<br>Nomina 3 <b>${esc(cat)}</b></div>
      <h2>${r.skipped ? '🚪 Saltato (non c\'è)' : r.ok ? '✅ Ce l\'ha fatta! <span class="pts-badge">+100</span>' : '❌ Niente da fare'}</h2>`;
    const votes = Object.keys(v);
    body.innerHTML = (votes.length ? `<div class="chips">${votes.map(id => `<li>${v[id] ? '✅' : '❌'} ${who(id)}</li>`).join('')}</div>` : '') +
      (r.k < r.N ? `<p class="muted center" style="margin-top:14px">Prossimo turno tra pochi secondi…</p>` : '');
    if (R._treSfx !== r.id) { R._treSfx = r.id; Sfx.play(r.ok ? 'win' : 'lose'); if (r.ok && r.player === me.id) confetti(40); }
  },
  bind() {
    $('#tre-main').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-act]');
      const r = R.d.round;
      if (!b || !r || r.game !== 'tre') return;
      const a = b.dataset.act;
      if (a === 'go' && r.player === me.id && r.phase === 'ready') R.room.update('round', { phase: 'go', startAt: Net.TS }).catch(() => {});
      if (a === 'done' && r.player === me.id && r.phase === 'go') R.room.update('round', { phase: 'vote' }).catch(() => {});
      if ((a === 'yes' || a === 'no') && r.player !== me.id) R.room.set(`round/v/${me.id}`, a === 'yes' ? 1 : 0).catch(() => {});
    });
  },
  awards: [{ fn: (h, d) => (h.g === 'tre' && d.ok ? 1 : 0), label: 'Sangue freddo', ico: '🧊', unit: 'sfide vinte' }]
};

/* ================================================================
   CARTE SCORRETTE (stile Cards Against Humanity)
   ================================================================ */
const HAND = 7;
function cahPick(b) { return Math.max(1, Math.min(2, (CAH_BLACK[b].match(/___/g) || []).length)); }
function cahAnswers(sub) {
  if (!sub) return [];
  if (sub.t) return [sub.t];
  return splitList(sub.c).map(i => CAH_WHITE[+i]).filter(Boolean);
}
// "di" + "il ritorno" → "del ritorno", ecc.
const CONTR = {
  di: { il: 'del', lo: 'dello', la: 'della', i: 'dei', gli: 'degli', le: 'delle', "l'": "dell'" },
  a: { il: 'al', lo: 'allo', la: 'alla', i: 'ai', gli: 'agli', le: 'alle', "l'": "all'" },
  da: { il: 'dal', lo: 'dallo', la: 'dalla', i: 'dai', gli: 'dagli', le: 'dalle', "l'": "dall'" },
  in: { il: 'nel', lo: 'nello', la: 'nella', i: 'nei', gli: 'negli', le: 'nelle', "l'": "nell'" },
  su: { il: 'sul', lo: 'sullo', la: 'sulla', i: 'sui', gli: 'sugli', le: 'sulle', "l'": "sull'" }
};
function cahFill(b, answers) {
  const parts = CAH_BLACK[b].split('___');
  const clean = (a) => String(a || '').replace(/[.!]+$/, '');
  if (parts.length === 1) return esc(parts[0]) + ' <b class="fill">' + esc(clean(answers[0])) + '</b>';
  let out = '', plain = '';
  parts.forEach((before, j) => {
    if (j === parts.length - 1) { out += esc(before); return; }
    let ans = clean(answers[j] != null ? answers[j] : answers[answers.length - 1]);
    if (!ans) { out += esc(before) + '<b class="fill">______</b>'; plain += before + '___'; return; }
    const startOfSentence = /(^|[.!?:«"]\s*)$/.test((plain + before).trim() ? plain + before : '');
    const pm = before.match(/(^|\s)(di|a|da|in|su) $/i);
    const am = ans.match(/^(il|lo|la|i|gli|le) (.+)$/i) || ans.match(/^(l')(.+)$/i);
    if (pm && am) {
      const c = CONTR[pm[2].toLowerCase()][am[1].toLowerCase()];
      before = before.slice(0, before.length - pm[2].length - 1);
      ans = c + (c.endsWith("'") ? '' : ' ') + am[2];
    } else if (!startOfSentence) {
      // a metà frase: minuscola (tranne sigle o nomi dopo l'articolo)
      ans = ans.charAt(0).toLowerCase() + ans.slice(1);
    }
    if (startOfSentence) ans = ans.charAt(0).toUpperCase() + ans.slice(1);
    out += esc(before) + `<b class="fill">${esc(ans)}</b>`;
    plain += before + ans;
  });
  return out;
}
function cahHand(id) { return splitList(((R.d.hands || {})[id]) || '').map(Number); }
const cahSel = { key: null, picks: [] };

GAMES.cah = {
  minPlayers: 3,
  count: (cfg) => +cfg.cahN || 10,
  async make(cfg, { d, pres, patch }) {
    const order = pres;
    const li = order.indexOf(d.lastCzar);
    const czar = order[(li + 1) % order.length];
    patch.lastCzar = czar;
    // carta nera mai uscita
    let usedB = splitList(d.cahB);
    let cands = CAH_BLACK.map((_, i) => i).filter(i => !usedB.includes(String(i)));
    if (!cands.length) { cands = CAH_BLACK.map((_, i) => i); usedB = []; }
    const b = cands[rand(cands.length)];
    patch.cahB = [...usedB, b].join(',');
    // distribuzione: tutti a 7 carte, senza ripetere carte in mano o già giocate
    const hands = {};
    order.forEach(id => { hands[id] = splitList((d.hands || {})[id]).map(Number); });
    let gone = new Set([...Object.values(hands).flat(), ...splitList(d.cahDis).map(Number)]);
    let free = CAH_WHITE.map((_, i) => i).filter(i => !gone.has(i));
    const need = order.reduce((s, id) => s + Math.max(0, HAND - hands[id].length), 0);
    if (free.length < need) { patch.cahDis = ''; gone = new Set(Object.values(hands).flat()); free = CAH_WHITE.map((_, i) => i).filter(i => !gone.has(i)); }
    free = seededShuffle(free, rand(1e9));
    order.forEach(id => {
      while (hands[id].length < HAND && free.length) hands[id].push(free.pop());
      patch['hands/' + id] = hands[id].join(',');
    });
    return { status: 'play', phase: 'pick', czar, b, pick: cahPick(b), seed: rand(1e9) };
  },
  results(r) {
    const pts = {}, d = {};
    if (r.win) { pts[r.win] = 100; d[r.win] = { w: 1 }; }
    return { pts, d };
  },
  title(r, patch) {
    const played = Object.values(r.sub || {}).flatMap(s => splitList(s && s.c));
    if (played.length) patch.cahDis = [...splitList(R.d.cahDis), ...played].join(',');
    return `Carte Scorrette · ${CAH_BLACK[r.b].slice(0, 40)}…`;
  },
  label: () => 'Carte Scorrette',
  hostTick(r, now, pres) {
    if (r.status !== 'play') return;
    const set = (v) => { R.busy = true; R.room.update('round', v).catch(() => {}).finally(() => { R.busy = false; }); };
    const sub = r.sub || {};
    if (!pres.includes(r.czar)) {
      // il giudice è sparito: ne serve un altro (meglio chi non ha ancora risposto)
      const nc = pres.find(id => !sub[id]) || pres[0];
      if (nc) set({ czar: nc, ['sub/' + nc]: null });
      return;
    }
    if (r.phase === 'pick') {
      const players = pres.filter(id => id !== r.czar);
      if (players.length && players.every(id => sub[id])) set({ phase: 'judge' });
    }
  },
  render(r) {
    const czar = r.czar === me.id;
    const sub = r.sub || {};
    $('#cah-black').innerHTML = cahFill(r.b, []);
    $('#cah-czar').innerHTML = `👑 Giudice: ${who(r.czar)}`;
    const others = presentIds().filter(id => id !== r.czar);
    $('#cah-status').innerHTML = r.phase === 'pick'
      ? others.map(id => `<li class="${sub[id] ? 'ok' : ''}">${sub[id] ? '✅' : '⏳'} ${who(id)}</li>`).join('') : '';
    const main = $('#cah-main');
    // il campo "scrivi la tua" non deve perdere il testo quando arrivano aggiornamenti
    const ci = $('#cah-custom');
    const keep = ci ? { v: ci.value, f: document.activeElement === ci } : null;
    if (r.phase === 'pick') {
      if (czar) {
        const n = others.filter(id => sub[id]).length;
        main.innerHTML = `<p class="center">Sei il giudice 👑 Aspetta le risposte (${n}/${others.length})…</p>` +
          (R.isHost && n >= 2 ? '<div class="center"><button class="btn small" data-act="force">⏩ Basta aspettare</button></div>' : '');
      } else if (sub[me.id]) {
        main.innerHTML = `<p class="center">✅ Risposta inviata! Aspettiamo gli altri…</p><div class="cah-card black small">${cahFill(r.b, cahAnswers(sub[me.id]))}</div>`;
      } else {
        const key = R.code + ':' + r.id;
        if (cahSel.key !== key) { cahSel.key = key; cahSel.picks = []; }
        const hand = cahHand(me.id);
        main.innerHTML = `<p class="center muted">Scegli ${r.pick === 2 ? '<b>2 carte</b> (in ordine)' : '<b>1 carta</b>'}</p>
          <div class="cah-hand">${hand.map(c => {
            const p = cahSel.picks.indexOf(c);
            return `<button class="cah-card white ${p >= 0 ? 'sel' : ''}" data-c="${c}">${p >= 0 && r.pick > 1 ? `<span class="num">${p + 1}</span>` : ''}${esc(CAH_WHITE[c])}</button>`;
          }).join('') || '<p class="muted">Riceverai le carte al prossimo round.</p>'}</div>
          ${cahSel.picks.length ? `<div class="cah-card black small">${cahFill(r.b, cahSel.picks.map(c => CAH_WHITE[c]))}</div>` : ''}
          <div class="center"><button class="btn primary" data-act="send" ${cahSel.picks.length === r.pick ? '' : 'disabled'}>Gioca ${r.pick === 2 ? 'le carte' : 'la carta'}</button></div>
          ${r.pick === 1 ? `<div class="join-row cah-custom"><input id="cah-custom" maxlength="80" placeholder="✏️ …oppure scrivi la tua"><button class="btn" data-act="custom">Gioca</button></div>` : ''}`;
        const ni = $('#cah-custom');
        if (ni && keep) { ni.value = keep.v; if (keep.f) ni.focus(); }
      }
    } else if (r.phase === 'judge') {
      const order = seededShuffle(Object.keys(sub), r.seed);
      main.innerHTML = `<p class="center">${czar ? '👑 <b>Scegli la più divertente!</b>' : `${who(r.czar)} sta scegliendo… leggetele ad alta voce 😂`}</p>
        <div class="cah-subs">${order.map(id => `<div class="cah-card black small ${czar ? 'pickable' : ''}" ${czar ? `data-win="${id}"` : ''}>${cahFill(r.b, cahAnswers(sub[id]))}</div>`).join('')}</div>`;
    }
  },
  reveal(r, res, head, body) {
    const sub = r.sub || {};
    head.innerHTML = r.win
      ? `<div class="muted">Vince il round</div><h2>${who(r.win)} <span class="pts-badge">+100</span></h2><div class="cah-card black win">${cahFill(r.b, cahAnswers(sub[r.win]))}</div>`
      : '<h2>Nessun vincitore</h2>';
    body.innerHTML = `<div class="cah-subs">${Object.keys(sub).filter(id => id !== r.win).map(id =>
      `<div class="cah-card black small">${cahFill(r.b, cahAnswers(sub[id]))}<div class="by">${who(id)}</div></div>`).join('')}</div>`;
    if (R._cahSfx !== r.id) { R._cahSfx = r.id; Sfx.play('win'); if (r.win === me.id) confetti(60); }
  },
  bind() {
    $('#cah-main').addEventListener('click', (e) => {
      const r = R.d.round;
      if (!r || r.game !== 'cah' || r.status !== 'play') return;
      const card = e.target.closest('button[data-c]');
      if (card && r.phase === 'pick') {
        const c = +card.dataset.c;
        const i = cahSel.picks.indexOf(c);
        if (i >= 0) cahSel.picks.splice(i, 1);
        else { if (cahSel.picks.length >= r.pick) cahSel.picks.shift(); cahSel.picks.push(c); }
        this.render(r);
        return;
      }
      const win = e.target.closest('[data-win]');
      if (win && r.phase === 'judge' && r.czar === me.id) {
        ask('Fai vincere questa carta?', '👑 Sì, vince lei').then(ok => {
          if (ok && R.d.round && R.d.round.id === r.id) R.room.update('round', { status: 'reveal', win: win.dataset.win }).catch(() => {});
        });
        return;
      }
      const b = e.target.closest('button[data-act]');
      if (!b) return;
      if (b.dataset.act === 'send' && cahSel.picks.length === r.pick) {
        const left = cahHand(me.id).filter(c => !cahSel.picks.includes(c));
        R.room.update('', { [`round/sub/${me.id}`]: { c: cahSel.picks.join(',') }, [`hands/${me.id}`]: left.join(',') }).catch(() => toast('Errore di rete'));
        cahSel.picks = [];
      }
      if (b.dataset.act === 'custom') {
        const t = $('#cah-custom').value.trim().slice(0, 80);
        if (!t) return toast('Scrivi qualcosa!');
        R.room.set(`round/sub/${me.id}`, { t }).catch(() => toast('Errore di rete'));
      }
      if (b.dataset.act === 'force' && R.isHost) R.room.update('round', { phase: 'judge' }).catch(() => {});
    });
  },
  awards: [{ fn: (h, d) => (h.g === 'cah' && d.w ? 1 : 0), label: 'Il più scorretto', ico: '😈', unit: 'round vinti' }]
};
