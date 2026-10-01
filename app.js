/* ============================================================
   Paroliamo — Wordle multiplayer
   Modello: l'host fa da regista (avvia i round, chiude i round,
   salva i punteggi nello storico); ogni giocatore scrive solo
   i propri tentativi/risposte. I punti si calcolano in modo
   deterministico dai dati della stanza, uguali per tutti.
   ============================================================ */
'use strict';

/* ---------------- utilità ---------------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const arr = (x) => Array.isArray(x) ? x.filter(v => v != null) : x && typeof x === 'object'
  ? Object.keys(x).sort((a, b) => a - b).map(k => x[k]).filter(v => v != null) : [];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const rand = (n) => Math.floor(Math.random() * n);

let toastTimer;
function toast(msg, ms = 1800) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}
function vibrate(p) { try { navigator.vibrate && navigator.vibrate(p); } catch {} }

const EMOJIS = ['🦊', '🐼', '🐸', '🦁', '🐙', '🦄', '🐧', '🐨', '🐯', '🐵', '🦉', '🐢', '🐳', '🦖', '🐝', '🍕', '🌵', '👽', '🤖', '👻', '🎃', '🐲', '🦩', '🍩', '🐌', '🦀', '🥑', '🐷', '🦝', '🐻', '🍄', '⚡'];
const REACTIONS = ['😂', '🔥', '👏', '😱', '💀', '🤯', '🐐', '🤡'];

/* ---------------- suoni ---------------- */
const Sfx = {
  ctx: null,
  on: localStorage.getItem('pq_sound') !== '0',
  play(kind) {
    if (!this.on) return;
    try {
      this.ctx = this.ctx || new (window.AudioContext || window.webkitAudioContext)();
      const seq = { win: [523, 659, 784, 1047], pop: [740], bad: [220, 160], tick: [1300], reveal: [392, 523, 659], lose: [330, 262, 196] }[kind] || [600];
      const t0 = this.ctx.currentTime;
      seq.forEach((f, i) => {
        const o = this.ctx.createOscillator(), g = this.ctx.createGain();
        o.type = kind === 'bad' ? 'square' : 'triangle';
        o.frequency.value = f;
        const st = t0 + i * 0.09;
        g.gain.setValueAtTime(0.0001, st);
        g.gain.exponentialRampToValueAtTime(kind === 'tick' ? 0.05 : 0.12, st + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, st + 0.18);
        o.connect(g).connect(this.ctx.destination);
        o.start(st); o.stop(st + 0.2);
      });
    } catch {}
  }
};

function confetti(n = 70) {
  const layer = $('#float-layer');
  const colors = ['#538d4e', '#c9b458', '#8b5cf6', '#ec4899', '#38bdf8', '#f97316'];
  for (let i = 0; i < n; i++) {
    const c = document.createElement('div');
    c.className = 'confetti';
    c.style.left = Math.random() * 100 + 'vw';
    c.style.background = colors[i % colors.length];
    c.style.animationDelay = Math.random() * 0.6 + 's';
    c.style.animationDuration = 1.8 + Math.random() * 1.4 + 's';
    layer.appendChild(c);
    setTimeout(() => c.remove(), 3800);
  }
}

/* ---------------- io ---------------- */
const me = {
  id: Net.deviceId(),
  name: localStorage.getItem('pq_name') || '',
  emoji: localStorage.getItem('pq_emoji') || EMOJIS[rand(EMOJIS.length)]
};

/* ---------------- parole ---------------- */
const WORDS = {};
async function loadWords(len, lang = 'it') {
  const id = lang + len;
  if (!WORDS[id]) {
    const d = await fetch(`words/${id}.json`).then(r => r.json());
    const set = new Set(d.v.split(' '));
    d.a.forEach(w => set.add(w));
    WORDS[id] = { a: d.a, set };
  }
  return WORDS[id];
}
// le parole da indovinare sono ordinate per frequenza: la difficoltà prende una fetta
function pool(len, diff, lang = 'it') {
  const a = WORDS[lang + len].a;
  const f = diff === 'facile' ? 0.35 : diff === 'difficile' ? 1 : 0.7;
  return a.slice(0, Math.max(60, Math.round(a.length * f)));
}

function dictUrl(w, lang) {
  return lang === 'en' ? `https://dictionary.cambridge.org/dictionary/english/${encodeURIComponent(w)}`
    : `https://www.treccani.it/vocabolario/ricerca/${encodeURIComponent(w)}/`;
}

function scoreGuess(guess, secret) {
  const res = Array(secret.length).fill('b');
  const left = {};
  for (let i = 0; i < secret.length; i++) {
    if (guess[i] === secret[i]) res[i] = 'g';
    else left[secret[i]] = (left[secret[i]] || 0) + 1;
  }
  for (let i = 0; i < secret.length; i++) {
    if (res[i] !== 'g' && left[guess[i]] > 0) { res[i] = 'y'; left[guess[i]]--; }
  }
  return res.join('');
}
const isWin = (p) => !!p && /^g+$/.test(p);

function hardViolation(guess, rows) {
  for (const r of rows) {
    const need = {};
    for (let i = 0; i < r.w.length; i++) {
      if (r.p[i] === 'g' && guess[i] !== r.w[i]) return `La ${i + 1}ª lettera dev'essere ${r.w[i].toUpperCase()}`;
      if (r.p[i] !== 'b') need[r.w[i]] = (need[r.w[i]] || 0) + 1;
    }
    for (const [ch, n] of Object.entries(need)) {
      if ([...guess].filter(c => c === ch).length < n) return `Devi usare la ${ch.toUpperCase()}`;
    }
  }
  return null;
}

// offuscamento leggero della parola segreta nel database (niente spoiler involontari)
function enc(w, k) { return btoa([...w].map((c, i) => String.fromCharCode(c.charCodeAt(0) ^ k.charCodeAt(i % k.length))).join('')); }
function dec(s, k) { try { return [...atob(s)].map((c, i) => String.fromCharCode(c.charCodeAt(0) ^ k.charCodeAt(i % k.length))).join(''); } catch { return ''; } }

function mulberry(seed) {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function seededShuffle(list, seed) {
  const a = list.slice(), r = mulberry(seed);
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/* ---------------- tabellone + tastiera ---------------- */
const KEY_ROWS = ['qwertyuiop', 'asdfghjkl', '⏎zxcvbnm⌫'];
const RANK = { b: 1, y: 2, g: 3 };

class Board {
  constructor(boardEl, kbdEl) {
    this.el = boardEl;
    this.kbd = kbdEl;
    this.onKey = null;
    kbdEl.innerHTML = KEY_ROWS.map(r => `<div class="krow">${[...r].map(k =>
      k === '⏎' ? `<button class="key wide" data-k="enter">Invio</button>`
        : k === '⌫' ? `<button class="key wide" data-k="back">⌫</button>`
          : `<button class="key" data-k="${k}">${k}</button>`).join('')}</div>`).join('');
    kbdEl.addEventListener('click', (e) => {
      const b = e.target.closest('.key');
      if (b && this.onKey) this.onKey(b.dataset.k);
    });
  }
  build(len, rows = 6) {
    this.len = len;
    this.el.dataset.len = len;
    this.el.classList.remove('spect');
    this.el.innerHTML = Array.from({ length: rows }, () =>
      `<div class="row">${'<div class="tile"></div>'.repeat(len)}</div>`).join('');
    this.rows = $$('.row', this.el);
    this.kbd.classList.remove('hidden');
    $$('.key', this.kbd).forEach(k => k.classList.remove('g', 'y', 'b'));
  }
  typing(i, str) {
    const row = this.rows[i];
    if (!row) return;
    [...row.children].forEach((t, j) => {
      t.textContent = str[j] || '';
      t.classList.toggle('filled', !!str[j]);
    });
  }
  paint(i, w, p, anim) {
    const row = this.rows[i];
    if (!row) return;
    [...row.children].forEach((t, j) => {
      t.textContent = w[j];
      if (!anim) { t.className = 'tile ' + p[j]; return; }
      setTimeout(() => { t.classList.add('flip'); }, j * 230);
      setTimeout(() => { t.className = 'tile flip ' + p[j]; }, j * 230 + 250);
    });
  }
  shake(i) {
    const row = this.rows[i];
    if (!row) return;
    row.classList.remove('shake'); void row.offsetWidth; row.classList.add('shake');
    vibrate(80);
  }
  win(i) { const row = this.rows[i]; row && setTimeout(() => row.classList.add('win'), this.len * 230 + 300); }
  keys(rows) {
    const best = {};
    rows.forEach(r => [...r.w].forEach((c, j) => { if (!best[c] || RANK[r.p[j]] > RANK[best[c]]) best[c] = r.p[j]; }));
    $$('.key', this.kbd).forEach(k => {
      k.classList.remove('g', 'y', 'b');
      if (best[k.dataset.k]) k.classList.add(best[k.dataset.k]);
    });
  }
}

/* una partita a Wordle su una parola (logica + tabellone) */
class WordleSession {
  constructor(o) {
    this.board = o.board;
    this.len = o.secret.length;
    this.secret = o.secret;
    this.valid = o.valid;
    this.hard = !!o.hard;
    this.maxRows = o.maxRows || 6;
    this.onRow = o.onRow || (() => {});
    this.onEnd = o.onEnd || (() => {});
    this.rows = (o.rows || []).slice();
    this.cur = '';
    this.busy = false;
    this.locked = false;
    this.board.build(this.len, this.maxRows);
    this.board.owner = this;
    this.rows.forEach((r, i) => this.board.paint(i, r.w, r.p, false));
    this.board.keys(this.rows);
    const last = this.rows[this.rows.length - 1];
    this.over = isWin(last && last.p) || this.rows.length >= this.maxRows;
    this.won = isWin(last && last.p);
  }
  key(k) {
    if (this.over || this.locked || this.busy) return;
    if (k === 'enter') return this.submit();
    if (k === 'back') this.cur = this.cur.slice(0, -1);
    else if (/^[a-z]$/.test(k) && this.cur.length < this.len) this.cur += k;
    else return;
    this.board.typing(this.rows.length, this.cur);
  }
  submit() {
    const i = this.rows.length;
    const g = this.cur;
    if (g.length < this.len) { this.board.shake(i); toast('Mancano delle lettere'); return; }
    if (!this.valid.has(g)) { this.board.shake(i); toast('Non è nel dizionario 🤨'); Sfx.play('bad'); return; }
    if (this.hard) {
      const v = hardViolation(g, this.rows);
      if (v) { this.board.shake(i); toast(v); return; }
    }
    const p = scoreGuess(g, this.secret);
    this.rows.push({ w: g, p });
    this.cur = '';
    this.busy = true;
    this.board.paint(i, g, p, true);
    const won = isWin(p);
    if (won || this.rows.length >= this.maxRows) { this.over = true; this.won = won; }
    this.onRow(this.rows, this);
    setTimeout(() => {
      this.busy = false;
      if (this.board.owner !== this) return;   // il tabellone è già passato a un'altra parola
      this.board.keys(this.rows);
      if (this.over) {
        if (won) { this.board.win(i); Sfx.play('win'); } else Sfx.play('lose');
        this.onEnd(won, this);
      }
    }, this.len * 230 + 280);
  }
}

let activeKey = null;    // a chi vanno i tasti fisici
document.addEventListener('keydown', (e) => {
  if (!activeKey || e.metaKey || e.ctrlKey || e.altKey) return;
  if (document.activeElement && /INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
  if (!$('#modal').classList.contains('hidden')) return;
  let k = e.key.toLowerCase();
  if (k === 'enter') k = 'enter';
  else if (k === 'backspace') k = 'back';
  else if (!/^[a-z]$/.test(k)) return;
  e.preventDefault();
  activeKey(k);
});

function shareGrid(rows, len, won, label) {
  const sq = { g: '🟩', y: '🟨', b: '⬛' };
  const txt = `Paroliamo ${label || len + ' lettere'} ${won ? rows.length : 'X'}/6\n` +
    rows.map(r => [...r.p].map(c => sq[c]).join('')).join('\n');
  copyText(txt, 'Risultato copiato 📋');
}
async function copyText(txt, msg) {
  try { await navigator.clipboard.writeText(txt); toast(msg || 'Copiato!'); }
  catch {
    const ta = document.createElement('textarea'); ta.value = txt; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast(msg || 'Copiato!'); } catch { toast('Copia non riuscita'); }
    ta.remove();
  }
}

/* ================================================================
   SCHERMATE
   ================================================================ */
function showScreen(id) {
  $$('.screen').forEach(s => s.classList.toggle('active', s.id === id));
  activeKey = null;
}

/* ---------------- HOME ---------------- */
function initHome() {
  $('#name-input').value = me.name;
  $('#emoji-btn').textContent = me.emoji;
  $('#emoji-picker').innerHTML = EMOJIS.map(e => `<button data-e="${e}" class="${e === me.emoji ? 'on' : ''}">${e}</button>`).join('');
  $('#emoji-btn').onclick = () => $('#emoji-picker').classList.toggle('hidden');
  $('#emoji-picker').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    me.emoji = b.dataset.e; localStorage.setItem('pq_emoji', me.emoji);
    $('#emoji-btn').textContent = me.emoji;
    $$('#emoji-picker button').forEach(x => x.classList.toggle('on', x === b));
    $('#emoji-picker').classList.add('hidden');
  };
  $('#name-input').oninput = () => { me.name = $('#name-input').value.trim(); localStorage.setItem('pq_name', me.name); };

  $('#create-btn').onclick = () => enterRoom(null);
  $('#join-btn').onclick = () => {
    const c = $('#code-input').value.trim().toUpperCase();
    if (c.length !== 4) return toast('Il codice ha 4 caratteri');
    enterRoom(c);
  };
  $('#code-input').onkeydown = (e) => { if (e.key === 'Enter') $('#join-btn').click(); };

  // allenamento
  let soloLen = +(localStorage.getItem('pq_solo_len') || 5);
  const paintSoloLen = () => $$('#solo-len button').forEach(b => b.classList.toggle('on', +b.dataset.v === soloLen));
  paintSoloLen();
  $('#solo-len').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; soloLen = +b.dataset.v; localStorage.setItem('pq_solo_len', soloLen); paintSoloLen(); };
  $('#solo-btn').onclick = () => startSolo(soloLen);
  let soloLang = localStorage.getItem('pq_solo_lang') || 'it';
  const paintSoloLang = () => $$('#solo-lang button').forEach(b => b.classList.toggle('on', b.dataset.v === soloLang));
  paintSoloLang();
  $('#solo-lang').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; soloLang = b.dataset.v; localStorage.setItem('pq_solo_lang', soloLang); paintSoloLang(); };

  // impostazioni
  const cb = localStorage.getItem('pq_cb') === '1';
  document.body.classList.toggle('cb', cb);
  $('#cb-toggle').checked = cb;
  $('#cb-toggle').onchange = (e) => { localStorage.setItem('pq_cb', e.target.checked ? '1' : '0'); document.body.classList.toggle('cb', e.target.checked); };
  $('#sound-toggle').checked = Sfx.on;
  $('#sound-toggle').onchange = (e) => { Sfx.on = e.target.checked; localStorage.setItem('pq_sound', Sfx.on ? '1' : '0'); };
  $('#db-input').value = Net.url();
  $('#db-save').onclick = async () => {
    if (!Net.configure($('#db-input').value)) return toast('Incolla l\'URL del database');
    $('#db-status').textContent = '⏳ Provo la connessione…';
    try { await Net.test(); $('#db-status').textContent = '✅ Database collegato!'; }
    catch (e) { $('#db-status').textContent = '❌ Non riesco a usarlo: ' + e.message; }
  };
  $('#db-status').textContent = Net.configured() ? '✅ Database configurato' : '⚠️ Nessun database: il multiplayer non funziona finché non lo imposti.';
}

function needName() {
  if (me.name) return false;
  toast('Prima scrivi il tuo nome 🙂');
  $('#name-input').focus();
  return true;
}

/* ---------------- ALLENAMENTO ---------------- */
let soloBoard;
async function startSolo(len) {
  showScreen('s-solo');
  soloBoard = soloBoard || new Board($('#solo-board'), $('#solo-kbd'));
  const lang = localStorage.getItem('pq_solo_lang') || 'it';
  const W = await loadWords(len, lang);
  const list = pool(len, 'normale', lang);
  const secret = list[rand(list.length)];
  $('#solo-info').textContent = `${len} lettere · ${lang === 'en' ? '🇬🇧' : '🇮🇹'}`;
  $('#solo-status').innerHTML = 'Indovina la parola in 6 tentativi';
  const s = new WordleSession({
    board: soloBoard, secret, valid: W.set,
    onEnd: (won, sess) => {
      $('#solo-status').innerHTML = (won ? `🎉 <b>Bravo!</b> In ${sess.rows.length} tentativi` : `😵 Era <b>${secret.toUpperCase()}</b>`) +
        ` · <a href="${dictUrl(secret, lang)}" target="_blank" rel="noopener">significato</a>` +
        ` · <a href="#" id="solo-share">copia</a>`;
      $('#solo-share').onclick = (e) => { e.preventDefault(); shareGrid(sess.rows, len, won); };
      if (won) confetti(40);
    }
  });
  soloBoard.onKey = (k) => s.key(k);
  activeKey = soloBoard.onKey;
  $('#solo-new').onclick = () => startSolo(len);
  $('#solo-back').onclick = () => showScreen('s-home');
}

/* ================================================================
   STANZA ONLINE
   ================================================================ */
const DEFAULT_CFG = { game: 'wordle', wmode: 'classic', lang: 'it', len: 5, diff: 'normale', timer: 0, hard: 0 };
const STALE_MS = 16000;

const R = {
  room: null, code: null, d: {}, isHost: false, hb: null, tick: null,
  board: null, sess: null, sessKey: null, setupToken: 0,
  reactSeen: null, viewRoundKey: null,
  mergeSel: null, lastTickSec: null, busy: false
};

function inviteLink() {
  let u = location.origin + location.pathname + '?room=' + R.code;
  const db = Net.url();
  if (db) u += '&db=' + encodeURIComponent(db.replace(/^https:\/\//, ''));
  return u;
}
async function shareInvite() {
  const link = inviteLink();
  if (navigator.share && matchMedia('(pointer: coarse)').matches) {
    try { await navigator.share({ title: 'Paroliamo', text: `Entra nella mia stanza di Paroliamo (${R.code})`, url: link }); return; } catch {}
  }
  copyText(link, 'Link copiato! Mandalo agli amici 📨');
}

async function enterRoom(code) {
  if (needName()) return;
  if (!Net.configured()) {
    $('#db-box').open = true;
    toast('Prima imposta il database (in fondo) ⚙️', 2600);
    $('#db-input').focus();
    return;
  }
  try {
    if (!code) {
      do { code = Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[rand(32)]).join(''); }
      while (await Net.exists(code));
      const room = Net.room(code);
      await room.set('', {
        meta: { host: me.id, createdAt: Net.TS },
        cfg: DEFAULT_CFG,
        players: { [me.id]: { name: me.name, emoji: me.emoji, joinedAt: Net.TS, seen: Net.TS } }
      });
      R.room = room;
    } else {
      if (!(await Net.exists(code))) return toast(`La stanza ${code} non esiste 🤔`);
      const room = Net.room(code);
      const prev = await room.get('players/' + me.id).catch(() => null);
      await room.update('players/' + me.id, {
        name: me.name, emoji: me.emoji, seen: Net.TS, left: null,
        joinedAt: (prev && prev.joinedAt) || Net.TS
      });
      R.room = room;
    }
  } catch (e) {
    console.error(e);
    return toast('Non riesco a collegarmi al database 😕', 2600);
  }
  R.code = code;
  sessionStorage.setItem('pq_in_room', code);
  history.replaceState(null, '', inviteLink().replace(location.origin, ''));
  $('#room-code').textContent = code;
  showScreen('s-room');
  R.room.onChange(() => onRoomData());
  R.room.onConnError = () => $('#conn-warn').classList.remove('hidden');
  R.room.onConnOk = () => $('#conn-warn').classList.add('hidden');
  R.room.start();
  R.room.beat(me.id).catch(() => {});
  R.hb = setInterval(() => R.room.beat(me.id).catch(() => {}), 5000);
  R.tick = setInterval(onTick, 250);
}

async function leaveRoom() {
  if (!confirm('Vuoi uscire dalla stanza?')) return;
  try { await R.room.update('players/' + me.id, { left: true }); } catch {}
  R.room.stop();
  clearInterval(R.hb); clearInterval(R.tick);
  Object.assign(R, { room: null, code: null, d: {}, sess: null, sessKey: null, reactSeen: null, viewRoundKey: null });
  sessionStorage.removeItem('pq_in_room');
  history.replaceState(null, '', location.pathname);
  showScreen('s-home');
  $('#join-banner').classList.add('hidden');
}

/* ---------- presenza e host ---------- */
function players() { return R.d.players || {}; }
function isPresent(id) {
  if (id === me.id) return true;
  const p = players()[id];
  return !!p && !p.left && typeof p.seen === 'number' && R.room.now() - p.seen < STALE_MS;
}
function presentIds() {
  const ps = players();
  return Object.keys(ps).filter(isPresent).sort((a, b) => (ps[a].joinedAt || 0) - (ps[b].joinedAt || 0));
}
function pname(id) { const p = players()[id]; return p ? p.name : '???'; }
function pemoji(id) { const p = players()[id]; return p ? p.emoji : '❔'; }
function who(id) { return `${pemoji(id)} ${esc(pname(id))}`; }

function computeHost() {
  const pres = presentIds();
  let h = R.d.meta && R.d.meta.host;
  if (!pres.includes(h)) {
    h = pres[0];
    if (h === me.id && R.d.meta) R.room.update('meta', { host: me.id }).catch(() => {});
  }
  R.isHost = h === me.id;
  return h;
}

/* ---------- punteggi ---------- */
function roundResults(r) {
  const pts = {}, d = {};
  if (!r) return { pts, d };
  if (r.game === 'wordle') {
    const parts = Object.keys(r.parts || {});
    const p = r.p || {};
    if (r.wmode === 'sprint') {
      parts.forEach(id => { pts[id] = (p[id] && p[id].pts) || 0; d[id] = { sol: (p[id] && p[id].sol) || 0 }; });
      return { pts, d };
    }
    const winners = [];
    parts.forEach(id => {
      const rows = arr(p[id] && p[id].rows);
      const won = isWin(rows.length && rows[rows.length - 1].p);
      d[id] = { t: won ? rows.length : 0 };
      pts[id] = won ? (7 - rows.length) * 100 : 0;
      if (won && p[id].at) winners.push([id, p[id].at]);
    });
    if (winners.length && parts.length > 1) {
      const first = Math.min(...winners.map(w => w[1]));
      winners.filter(w => w[1] === first).forEach(w => { pts[w[0]] += 50; d[w[0]].first = 1; });
    }
    if (r.wmode === 'friend' && r.chooser && parts.length) {
      const avg = parts.reduce((s, id) => s + (d[id].t || 8), 0) / parts.length;
      pts[r.chooser] = Math.round(avg * 50 / 10) * 10;
      d[r.chooser] = { chooser: 1 };
    }
    return { pts, d };
  }
  return { pts, d };
}

function totals() {
  const t = {};
  const add = (pts) => Object.entries(pts || {}).forEach(([id, v]) => { t[id] = (t[id] || 0) + (v || 0); });
  const hist = R.d.hist || {};
  Object.values(hist).forEach(h => h && add(h.pts));
  const r = R.d.round;
  let delta = {};
  if (r && r.status === 'reveal' && !hist['r' + r.id]) { delta = roundResults(r).pts; add(delta); }
  presentIds().forEach(id => { t[id] = t[id] || 0; });
  return { t, delta };
}

function scoreTable(limit) {
  const { t, delta } = totals();
  const ids = Object.keys(t).sort((a, b) => t[b] - t[a]);
  if (!ids.length) return '<div class="muted">Ancora nessun punto.</div>';
  let pos = 0, last = null;
  return `<table class="score-table">${ids.slice(0, limit || 99).map((id, i) => {
    if (t[id] !== last) { pos = i + 1; last = t[id]; }
    const medal = pos === 1 && t[id] > 0 ? '🥇' : pos === 2 && t[id] > 0 ? '🥈' : pos === 3 && t[id] > 0 ? '🥉' : pos;
    return `<tr class="${isPresent(id) ? '' : 'off'}"><td class="pos">${medal}</td><td>${who(id)}${id === me.id ? ' <span class="tag me">tu</span>' : ''}</td>
      <td class="pts">${t[id]}${delta[id] ? `<span class="delta">+${delta[id]}</span>` : ''}</td></tr>`;
  }).join('')}</table>`;
}

/* ---------- creazione dei round (solo host) ---------- */
async function makeRoundPatch() {
  const d = R.d;
  const cfg = Object.assign({}, DEFAULT_CFG, d.cfg || {});
  const id = (d.seq || 0) + 1;
  const pres = presentIds();
  const parts = Object.fromEntries(pres.map(x => [x, true]));
  const patch = { seq: id };
  if (cfg.game === 'wordle') {
    const len = +cfg.len;
    const lang = cfg.lang === 'en' ? 'en' : 'it';
    await loadWords(len, lang);
    const r = { id, game: 'wordle', wmode: cfg.wmode, lang, len, diff: cfg.diff, hard: +cfg.hard, status: 'play', startAt: Net.TS, dur: (+cfg.timer || 0) * 1000, parts };
    if (cfg.wmode === 'sprint') {
      r.dur = (+cfg.timer || 180) * 1000;
      r.seed = rand(2 ** 31);
    } else if (cfg.wmode === 'friend') {
      const order = pres;
      const lastIdx = order.indexOf(d.lastChooser);
      r.chooser = order[(lastIdx + 1) % order.length];
      delete r.parts[r.chooser];
      r.status = 'choose';
      patch.lastChooser = r.chooser;
    } else {
      const used = (d.usedW || {});
      let list = pool(len, cfg.diff, lang).filter(w => !used[w]);
      if (!list.length) list = pool(len, cfg.diff, lang);
      r.s = enc(list[rand(list.length)], R.code + id);
    }
    patch.round = r;
  }
  return patch;
}

function commitPatch() {
  const r = R.d.round;
  const patch = {};
  if (!r || r.status !== 'reveal' || (R.d.hist || {})['r' + r.id]) return patch;
  const res = roundResults(r);
  let title;
  if (r.game === 'wordle') {
    const w = r.s ? dec(r.s, R.code + r.id) : '';
    title = r.wmode === 'sprint' ? `Sprint ${r.len} lettere` : `Wordle · ${w.toUpperCase()}`;
    if (w) patch['usedW/' + w] = true;
  }
  patch['hist/r' + r.id] = { n: r.id, g: r.game, m: r.wmode || r.mode, t: title, pts: res.pts, d: res.d, at: Net.TS };
  return patch;
}

async function hostDo(fn) {
  if (R.busy) return;
  R.busy = true;
  try { await fn(); } catch (e) { console.error(e); toast('Errore di rete, riprova'); }
  R.busy = false;
}
const startGame = () => hostDo(async () => { await R.room.update('', await makeRoundPatch()); });
const nextRound = () => hostDo(async () => { await R.room.update('', Object.assign(commitPatch(), await makeRoundPatch())); });
const toLobby = () => hostDo(async () => { await R.room.update('', Object.assign(commitPatch(), { round: null })); });
const toFinal = () => hostDo(async () => { await R.room.update('', Object.assign(commitPatch(), { round: { status: 'final', id: (R.d.seq || 0) } })); });
const resetScores = () => {
  if (!confirm('Azzerare tutti i punteggi della serata?')) return;
  hostDo(async () => { await R.room.update('', { hist: null, round: null, seq: 0 }); });
};

/* ---------- regia automatica dell'host ---------- */
function hostTick() {
  const r = R.d.round;
  if (!R.isHost || !r || R.busy) return;
  const now = R.room.now();
  const pres = presentIds();
  if (r.status === 'choose' && r.chooser && !pres.includes(r.chooser)) {
    // chi doveva scegliere se n'è andato: si passa al prossimo
    const order = pres;
    const next = order[0];
    if (next) {
      const parts = Object.fromEntries(order.filter(x => x !== next).map(x => [x, true]));
      R.room.update('round', { chooser: next, parts }).catch(() => {});
      R.room.update('', { lastChooser: next }).catch(() => {});
    }
    return;
  }
  if (r.status !== 'play') return;
  const parts = Object.keys(r.parts || {}).filter(id => pres.includes(id));
  const expired = r.dur && typeof r.startAt === 'number' && now > r.startAt + r.dur + 1200;
  let allDone = false;
  if (parts.length) {
    if (r.game === 'wordle' && r.wmode !== 'sprint') allDone = parts.every(id => r.p && r.p[id] && r.p[id].done);
  }
  // quando tutti hanno finito aspetto un attimo, così l'ultimo vede l'animazione
  if (allDone && !expired) {
    if (R._allDoneRound !== r.id) { R._allDoneRound = r.id; R._allDoneAt = Date.now(); }
    if (Date.now() - R._allDoneAt < 2200) return;
  }
  if (allDone || expired) {
    R.busy = true;
    R.room.update('round', { status: 'reveal' }).catch(() => {}).finally(() => { R.busy = false; });
  }
}

/* ---------- timer ---------- */
function timeLeft(r) {
  if (!r || !r.dur || typeof r.startAt !== 'number') return null;
  return Math.max(0, r.startAt + r.dur - R.room.now());
}
function onTick() {
  if (!R.room) return;
  const r = R.d.round;
  const el = $('#timer');
  const left = r && r.status === 'play' ? timeLeft(r) : null;
  if (left == null) el.classList.add('hidden');
  else {
    el.classList.remove('hidden');
    const s = Math.ceil(left / 1000);
    el.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    el.classList.toggle('low', s <= 10);
    if (s <= 5 && s > 0 && s !== R.lastTickSec) { R.lastTickSec = s; Sfx.play('tick'); }
    if (left === 0 && R.sess && !R.sess.locked && !R.sess.over) {
      R.sess.locked = true;
      $('#wstatus').innerHTML = '⏰ <b>Tempo scaduto!</b>';
    }
  }
  // ogni secondo circa: regia e presenza
  const sec = Math.floor(Date.now() / 1000);
  if (sec !== R._lastSec) { R._lastSec = sec; computeHost(); hostTick(); }
}

/* ---------- reazioni ---------- */
function handleReactions() {
  const react = R.d.react || {};
  if (!R.reactSeen) { R.reactSeen = Object.fromEntries(Object.entries(react).map(([k, v]) => [k, v.at])); return; }
  for (const [id, v] of Object.entries(react)) {
    if (!v || typeof v.at !== 'number') continue;
    if (R.reactSeen[id] === v.at) continue;
    R.reactSeen[id] = v.at;
    floatEmoji(v.e, pname(id));
  }
}
function floatEmoji(e, name) {
  const f = document.createElement('div');
  f.className = 'floater';
  f.style.left = 10 + Math.random() * 75 + 'vw';
  f.innerHTML = `<span class="fe">${esc(e)}</span><span class="fn">${esc(name)}</span>`;
  $('#float-layer').appendChild(f);
  Sfx.play('pop');
  setTimeout(() => f.remove(), 3300);
}

/* ================================================================
   RENDER DELLA STANZA
   ================================================================ */
function onRoomData() {
  R.d = R.room.data || {};
  if (!R.d.meta) return;
  // se qualcuno mi ha "perso" (es. stanza ripulita) mi rimetto in lista
  if (!players()[me.id] && R.room.ready && !R._rejoining) {
    R._rejoining = true;
    R.room.update('players/' + me.id, { name: me.name, emoji: me.emoji, joinedAt: Net.TS, seen: Net.TS })
      .finally(() => { R._rejoining = false; });
  }
  computeHost();
  handleReactions();
  const r = R.d.round;
  let view = 'lobby';
  if (r && r.status === 'final') view = 'final';
  else if (r && r.status === 'reveal') view = 'reveal';
  else if (r && r.game === 'wordle') view = r.status === 'choose' ? 'choose' : 'wordle';
  $$('#room-main .view').forEach(v => v.classList.toggle('active', v.id === 'v-' + view));
  $('#s-room').classList.toggle('in-wordle', view === 'wordle');
  if (view !== 'wordle') activeKey = null;
  renderTop(r);
  if (view === 'lobby') renderLobby();
  if (view === 'wordle') renderWordle(r);
  if (view === 'choose') renderChoose(r);
  if (view === 'reveal') renderReveal(r);
  if (view === 'final') renderFinal();
  if (!$('#modal').classList.contains('hidden') && R.modalScore) openScores();
  hostTick();
}

function modeLabel(r) {
  const m = { classic: 'Wordle', friend: 'Parola dell\'amico', sprint: 'Sprint' }[r.wmode] || 'Wordle';
  return `${m} · ${r.lang === 'en' ? '🇬🇧 ' : ''}${r.len} lettere${r.hard ? ' · hard' : ''}`;
}
function renderTop(r) {
  const n = presentIds().length;
  $('#round-info').innerHTML = !r ? `<b>Lobby</b> · ${n} ${n === 1 ? 'giocatore' : 'giocatori'}`
    : r.status === 'final' ? '<b>Fine serata</b>'
      : `<b>Round ${r.id}</b> · ${esc(modeLabel(r))}`;
}

/* ---------- lobby ---------- */
const WMODE_HELP = {
  classic: 'Tutti hanno la stessa parola. Meno tentativi = più punti (1 tentativo: 600, 6 tentativi: 100) e +50 a chi la trova per primo.',
  friend: 'A turno uno di voi sceglie la parola e gli altri la indovinano. Chi sceglie prende punti in base a quanto fa penare gli altri.',
  sprint: 'Contro il tempo: indovina più parole possibile prima che scada il timer. Tutti hanno la stessa sequenza di parole.'
};
function renderLobby() {
  const ps = players();
  const ids = Object.keys(ps).filter(id => !ps[id].left).sort((a, b) => (ps[a].joinedAt || 0) - (ps[b].joinedAt || 0));
  const host = computeHost();
  $('#lobby-count').textContent = `(${presentIds().length})`;
  $('#lobby-players').innerHTML = ids.map(id => `<li class="${isPresent(id) ? '' : 'off'}">
      <span class="em">${pemoji(id)}</span><span class="nm">${esc(pname(id))}</span>
      ${id === host ? '<span class="tag host">host</span>' : ''}${id === me.id ? '<span class="tag me">tu</span>' : ''}
      ${isPresent(id) ? '' : '<span class="tag">offline</span>'}</li>`).join('');

  const cfg = Object.assign({}, DEFAULT_CFG, R.d.cfg || {});
  $$('#cfg-card .seg').forEach(seg => {
    const k = seg.dataset.k;
    let v = String(cfg[k]);
    if (k === 'timer' && cfg.wmode === 'sprint' && v === '0') v = '180';
    $$('button', seg).forEach(b => {
      b.classList.toggle('on', b.dataset.v === v);
      if (k === 'timer' && b.dataset.v === '0') b.disabled = cfg.wmode === 'sprint';
    });
    seg.classList.toggle('locked', !R.isHost);
  });
  $('#wmode-help').textContent = WMODE_HELP[cfg.wmode] || '';
  $('#cfg-hostnote').textContent = R.isHost ? '' : `(sceglie ${pname(host)})`;
  $('#start-btn').classList.toggle('hidden', !R.isHost);
  $('#wait-host').classList.toggle('hidden', R.isHost);
  const needTwo = cfg.wmode === 'friend' && presentIds().length < 2;
  $('#start-btn').disabled = needTwo;
  $('#start-btn').textContent = needTwo ? 'Servono almeno 2 giocatori' : '▶️ Inizia';
  $('#lobby-score').innerHTML = scoreTable();
}

function setCfg(k, v) {
  if (!R.isHost) return;
  const patch = { [k]: /^\d+$/.test(v) ? +v : v };
  if (k === 'wmode' && v === 'sprint' && !+(R.d.cfg || {}).timer) patch.timer = 180;
  R.room.update('cfg', patch).catch(() => toast('Errore di rete'));
}

/* ---------- wordle online ---------- */
function myPart(r) { return !!(r.parts && r.parts[me.id]); }

function maybeJoinLate(r) {
  // chi entra a round iniziato può giocare subito (tranne chi ha scelto la parola)
  if (r.status !== 'play' || myPart(r) || r.chooser === me.id) return;
  const left = timeLeft(r);
  if (left !== null && left < 5000) return;
  if (R._joiningRound === r.id) return;
  R._joiningRound = r.id;
  R.room.set(`round/parts/${me.id}`, true).catch(() => { R._joiningRound = null; });
}

async function renderWordle(r) {
  maybeJoinLate(r);
  R.board = R.board || new Board($('#board'), $('#kbd'));
  renderOpps(r);
  const spectator = !myPart(r);
  const sprint = r.wmode === 'sprint';
  const mine = (r.p || {})[me.id] || {};
  const wordIdx = sprint ? (mine.n || 0) : 0;
  const key = `${R.code}:${r.id}:${wordIdx}:${spectator ? 's' : 'p'}`;

  if (spectator) {
    if (R.sessKey !== key) { R.sess = null; R.sessKey = key; }
    renderSpectator(r);
    return;
  }
  if (R.sessKey !== key) {
    R.sessKey = key;
    R.sess = null;
    const token = ++R.setupToken;
    const W = await loadWords(r.len, r.lang);
    if (token !== R.setupToken) return;
    const secret = sprint ? sprintWord(r, wordIdx) : dec(r.s, R.code + r.id);
    R.sess = new WordleSession({
      board: R.board, secret, valid: W.set, hard: r.hard,
      rows: arr(mine.rows),
      onRow: (rows, s) => writeMyRows(r, rows, s),
      onEnd: (won, s) => onMyWordEnd(r, won, s)
    });
    R.board.onKey = (k) => R.sess && R.sess.key(k);
    if (timeLeft(r) === 0) R.sess.locked = true;
  }
  activeKey = R.board.onKey;
  renderWStatus(r);
}

function sprintWord(r, i) {
  const list = seededShuffle(pool(r.len, r.diff, r.lang), r.seed);
  return list[i % list.length];
}

function writeMyRows(r, rows, s) {
  const path = `round/p/${me.id}`;
  if (r.wmode === 'sprint') {
    const mine = (R.d.round && R.d.round.p && R.d.round.p[me.id]) || {};
    if (s.over) {
      const gain = s.won ? 100 + (6 - rows.length) * 20 : 0;
      const n = (mine.n || 0) + 1;
      // piccola pausa per far vedere l'esito prima di passare alla parola successiva
      setTimeout(() => {
        R.room.set(path, { n, rows: null, sol: (mine.sol || 0) + (s.won ? 1 : 0), pts: (mine.pts || 0) + gain, last: rows.map(x => x.p).join(',') }).catch(() => {});
      }, s.won ? 1900 : 2200);
      if (!s.won) toast(`Era ${s.secret.toUpperCase()} — avanti!`, 1700);
    }
    R.room.set(path, Object.assign({}, mine, { rows })).catch(() => toast('Errore di rete'));
    return;
  }
  const v = { rows, done: s.over, won: s.won || false };
  if (s.won) v.at = Net.TS;
  R.room.set(path, v).catch(() => toast('Errore di rete'));
}

function onMyWordEnd(r, won, s) {
  if (r.wmode === 'sprint') { if (won) confetti(25); return; }
  if (won) confetti(60);
  renderWStatus(R.d.round || r);
}

function renderWStatus(r) {
  const el = $('#wstatus');
  if (!R.sess) { el.textContent = ''; return; }
  const p = r.p || {};
  const parts = Object.keys(r.parts || {}).filter(isPresent);
  const doneN = parts.filter(id => p[id] && p[id].done).length;
  let html;
  if (r.wmode === 'sprint') {
    const mine = p[me.id] || {};
    html = `🔥 Parole indovinate: <b>${mine.sol || 0}</b> · punti <b>${mine.pts || 0}</b>`;
  } else if (R.sess.over) {
    html = (R.sess.won ? `🎉 <b>Presa in ${R.sess.rows.length}!</b>` : '😵 <b>Niente da fare</b>') + ` · aspettiamo gli altri (${doneN}/${parts.length})`;
  } else if (R.sess.locked) {
    html = '⏰ <b>Tempo scaduto!</b>';
  } else {
    html = r.wmode === 'friend' ? `Parola scelta da <b>${who(r.chooser)}</b>` : `Indovina la parola · <b>${r.len}</b> lettere`;
    if (r.hard) html += ' · <b>hard</b>';
  }
  el.innerHTML = html;
}

function miniGrid(rows, len, maxRows = 6, letters = false) {
  let h = '';
  for (let i = 0; i < maxRows; i++) {
    const r = rows[i];
    h += '<div class="mrow">';
    for (let j = 0; j < len; j++) h += r ? `<div class="mt ${r.p[j]}">${letters && r.w ? esc(r.w[j]) : ''}</div>` : '<div class="mt"></div>';
    h += '</div>';
  }
  return `<div class="mini">${h}</div>`;
}

function renderOpps(r) {
  const p = r.p || {};
  const ids = Object.keys(r.parts || {}).filter(id => id !== me.id && (isPresent(id) || p[id]));
  if (!ids.length) { $('#opps').innerHTML = '<div class="opps-title">Avversari</div><div class="opps-empty">Sei da solo… invita qualcuno! 📨</div>'; return; }
  const sprint = r.wmode === 'sprint';
  $('#opps').innerHTML = '<div class="opps-title">Avversari</div>' + ids.map(id => {
    const x = p[id] || {};
    const rows = arr(x.rows);
    const won = isWin(rows.length && rows[rows.length - 1].p);
    let st, cls = '';
    if (sprint) st = `🔥 ${x.sol || 0}`;
    else if (x.done) { st = won ? `✅ ${rows.length}/6` : '❌'; cls = won ? 'done-won' : 'done-lost'; }
    else st = rows.length ? `${rows.length}/6` : '…';
    return `<div class="opp ${cls}"><div class="opp-head"><span>${pemoji(id)}</span><span class="nm">${esc(pname(id))}</span><span class="st">${st}</span></div>${miniGrid(rows, r.len)}</div>`;
  }).join('');
}

function renderSpectator(r) {
  activeKey = null;
  R.board.el.classList.add('spect');
  R.board.kbd.classList.add('hidden');
  const p = r.p || {};
  const ids = Object.keys(r.parts || {});
  const isChooser = r.chooser === me.id;
  $('#wstatus').innerHTML = isChooser ? `Hai scelto <b>${esc(dec(r.s, R.code + r.id).toUpperCase())}</b> · guardali soffrire 😈`
    : 'Guardi questo round: giochi dal prossimo 👀';
  R.board.el.innerHTML = `<div class="spect">${ids.map(id => {
    const rows = arr((p[id] || {}).rows);
    return `<div class="opp"><div class="opp-head"><span>${pemoji(id)}</span><span class="nm">${esc(pname(id))}</span></div>${miniGrid(rows, r.len, 6, isChooser)}</div>`;
  }).join('')}</div>`;
}

/* ---------- parola dell'amico: scelta ---------- */
async function renderChoose(r) {
  const mine = r.chooser === me.id;
  $('#choose-me').classList.toggle('hidden', !mine);
  $('#choose-other').classList.toggle('hidden', mine);
  $('#chooser-name').innerHTML = who(r.chooser);
  if (mine) {
    const inp = $('#choose-input');
    inp.maxLength = r.len;
    inp.placeholder = `Una parola di ${r.len} lettere`;
    if (R._chooseRound !== r.id) { R._chooseRound = r.id; inp.value = ''; $('#choose-msg').textContent = ''; setTimeout(() => inp.focus(), 50); }
    await loadWords(r.len, r.lang);
  }
}
async function confirmChoice() {
  const r = R.d.round;
  if (!r || r.chooser !== me.id) return;
  const w = $('#choose-input').value.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const W = await loadWords(r.len, r.lang);
  if (w.length !== r.len) return ($('#choose-msg').textContent = `Deve avere ${r.len} lettere`);
  if (!W.set.has(w)) return ($('#choose-msg').textContent = 'Non la trovo nel dizionario 🤨');
  await R.room.update('round', { s: enc(w, R.code + r.id), status: 'play', startAt: Net.TS });
}

/* ---------- risultati del round ---------- */
function renderReveal(r) {
  activeKey = null;
  const res = roundResults(r);
  const head = $('#reveal-head'), body = $('#reveal-body');
  if (r.game === 'wordle' && r.wmode === 'sprint') {
    if (!WORDS[(r.lang || 'it') + r.len]) { loadWords(r.len, r.lang).then(() => { if (R.d.round === r) renderReveal(r); }); return; }
    const p = r.p || {};
    const maxN = Math.max(0, ...Object.values(p).map(x => (x && x.n) || 0));
    const words = seededShuffle(pool(r.len, r.diff, r.lang), r.seed).slice(0, maxN + 1);
    head.innerHTML = `<h2>⏱️ Sprint finito!</h2><div class="muted">Le parole erano:</div><div class="sprint-list">${words.map(w => `<span>${esc(w)}</span>`).join('')}</div>`;
    const ids = Object.keys(r.parts || {}).sort((a, b) => (res.pts[b] || 0) - (res.pts[a] || 0));
    body.innerHTML = `<div class="reveal-grids">${ids.map(id => `<div class="rgrid"><div class="opp-head"><span>${pemoji(id)}</span><span class="nm">${esc(pname(id))}</span></div>
      <div>🔥 ${(p[id] || {}).sol || 0} parole</div><div class="pts-badge ${res.pts[id] ? '' : 'zero'}">+${res.pts[id] || 0}</div></div>`).join('')}</div>`;
  } else if (r.game === 'wordle') {
    const w = dec(r.s || '', R.code + r.id);
    head.innerHTML = `<div class="muted">La parola era</div>
      <div class="secret">${[...w].map(c => `<div class="tile g">${esc(c)}</div>`).join('')}</div>
      <a class="muted small" href="${dictUrl(w, r.lang)}" target="_blank" rel="noopener">📖 Cosa vuol dire?</a>
      ${r.wmode === 'friend' ? `<div style="margin-top:6px">Scelta da ${who(r.chooser)} <span class="pts-badge">+${res.pts[r.chooser] || 0}</span></div>` : ''}`;
    const ids = Object.keys(r.parts || {}).sort((a, b) => (res.pts[b] || 0) - (res.pts[a] || 0));
    body.innerHTML = `<div class="reveal-grids">${ids.map(id => {
      const rows = arr(((r.p || {})[id] || {}).rows);
      const dd = res.d[id] || {};
      return `<div class="rgrid"><div class="opp-head"><span>${pemoji(id)}</span><span class="nm">${esc(pname(id))}</span>
        <span class="pts-badge ${res.pts[id] ? '' : 'zero'}">+${res.pts[id] || 0}</span></div>
        ${rows.map(x => `<div class="rw">${[...x.w].map((c, j) => `<div class="rt ${x.p[j]}">${esc(c)}</div>`).join('')}</div>`).join('') || '<div class="muted small">nessun tentativo</div>'}
        <div class="muted small">${dd.t ? `in ${dd.t}${dd.first ? ' · ⚡ primo!' : ''}` : '❌'}</div></div>`;
    }).join('')}</div>`;
    if (!R._celebrated || R._celebrated !== r.id) { R._celebrated = r.id; Sfx.play('reveal'); }
  }
  $('#reveal-score').innerHTML = '<div class="card-title">Classifica</div>' + scoreTable();
  renderHostActions(r);
}

function renderHostActions(r) {
  const el = $('#host-actions');
  if (!R.isHost) {
    el.innerHTML = `<div class="muted center" style="width:100%">Aspettiamo che ${who(computeHost())} faccia partire il prossimo round…</div>`;
    return;
  }
  el.innerHTML = `<button class="btn primary" data-a="next">▶️ Prossimo round</button>
    <button class="btn" data-a="lobby">⚙️ Impostazioni</button>
    <button class="btn" data-a="final">🏁 Fine serata</button>`;
}

/* ---------- finale ---------- */
function awards() {
  const hist = Object.values(R.d.hist || {}).filter(Boolean);
  const out = [];
  const tally = (fn) => { const t = {}; hist.forEach(h => Object.entries(h.d || {}).forEach(([id, d]) => { const v = fn(h, d); if (v) t[id] = (t[id] || 0) + v; })); return t; };
  const best = (t, label, ico, unit) => {
    const ids = Object.keys(t); if (!ids.length) return;
    const max = Math.max(...ids.map(i => t[i])); if (max <= 0) return;
    const win = ids.filter(i => t[i] === max);
    out.push(`<div class="award"><div class="ai">${ico}</div><b>${label}</b>${win.map(who).join(', ')} <span class="muted">(${max} ${unit})</span></div>`);
  };
  best(tally((h, d) => h.g === 'wordle' && d.t && d.t <= 2 ? 1 : 0), 'Colpo di fortuna', '🍀', 'parole in ≤2 tentativi');
  best(tally((h, d) => h.g === 'wordle' && d.first ? 1 : 0), 'Il più veloce', '⚡', 'volte primo');
  best(tally((h, d) => h.g === 'wordle' && h.m !== 'sprint' && !d.chooser && d.t === 0 ? 1 : 0), 'Sfiga cosmica', '💀', 'parole mancate');
  best(tally((h, d) => h.g === 'wordle' && d.sol ? d.sol : 0), 'Macchina da sprint', '🏎️', 'parole in sprint');
  return out.join('');
}
function renderFinal() {
  activeKey = null;
  const { t } = totals();
  const ids = Object.keys(t).sort((a, b) => t[b] - t[a]);
  const order = [ids[1], ids[0], ids[2]];
  $('#podium').innerHTML = order.map((id, i) => id == null ? '' :
    `<div class="pod p${[2, 1, 3][i]}"><div class="em">${pemoji(id)}</div><div class="nm">${esc(pname(id))}</div><div class="bar">${t[id]}</div></div>`).join('');
  $('#awards').innerHTML = awards();
  $('#final-list').innerHTML = scoreTable();
  $('#final-actions').innerHTML = R.isHost
    ? `<button class="btn primary" data-a="lobby">↩️ Torna alla lobby</button><button class="btn danger" data-a="reset">🔄 Azzera e ricomincia</button>`
    : '<div class="muted">Grande serata! 🎉</div>';
  if (R._finalShown !== R.d.round.id) { R._finalShown = R.d.round.id; confetti(120); Sfx.play('win'); }
}

/* ---------- classifica in sovrimpressione ---------- */
function openScores() {
  R.modalScore = true;
  const hist = Object.values(R.d.hist || {}).filter(Boolean).sort((a, b) => b.n - a.n).slice(0, 15);
  $('#modal-body').innerHTML = `<h2>🏆 Classifica</h2>${scoreTable()}
    ${hist.length ? `<h3 style="margin-top:18px">Ultimi round</h3>${hist.map((h) => {
      const top = Object.entries(h.pts || {}).sort((a, b) => b[1] - a[1])[0];
      return `<div class="small" style="padding:6px 0;border-bottom:1px solid var(--line)"><b>#${h.n}</b> ${esc(h.t)}${top && top[1] > 0 ? ` — ${who(top[0])} +${top[1]}` : ''}</div>`;
    }).join('')}` : ''}
    ${R.isHost ? '<div style="margin-top:16px"><button class="btn danger small" id="m-reset">Azzera punteggi</button></div>' : ''}`;
  $('#modal').classList.remove('hidden');
  const rb = $('#m-reset'); if (rb) rb.onclick = () => { closeModal(); resetScores(); };
}
function closeModal() { $('#modal').classList.add('hidden'); R.modalScore = false; }

/* ================================================================
   AVVIO
   ================================================================ */
function bindRoomUi() {
  $('#leave-btn').onclick = leaveRoom;
  $('#code-chip').onclick = shareInvite;
  $('#invite-btn').onclick = shareInvite;
  $('#score-btn').onclick = openScores;
  $('#modal-x').onclick = closeModal;
  $('#modal').onclick = (e) => { if (e.target.id === 'modal') closeModal(); };
  $('#cfg-card').addEventListener('click', (e) => {
    const b = e.target.closest('.seg button'); if (!b) return;
    setCfg(b.parentElement.dataset.k, b.dataset.v);
  });
  $('#start-btn').onclick = startGame;
  $('#choose-btn').onclick = confirmChoice;
  $('#choose-input').onkeydown = (e) => { if (e.key === 'Enter') confirmChoice(); };
  $('#choose-rand').onclick = async () => {
    const r = R.d.round; if (!r) return;
    await loadWords(r.len, r.lang);
    const list = pool(r.len, 'normale', r.lang);
    $('#choose-input').value = list[rand(list.length)];
  };
  const actions = (e) => {
    const b = e.target.closest('button[data-a]'); if (!b) return;
    ({ next: nextRound, lobby: toLobby, final: toFinal, reset: resetScores })[b.dataset.a]();
  };
  $('#host-actions').addEventListener('click', actions);
  $('#final-actions').addEventListener('click', actions);
  $('#react-bar').innerHTML = REACTIONS.map(e => `<button data-e="${e}">${e}</button>`).join('');
  $('#react-bar').onclick = (e) => {
    const b = e.target.closest('button'); if (!b || !R.room) return;
    R.room.set('react/' + me.id, { e: b.dataset.e, at: Net.TS }).catch(() => {});
  };
}

function boot() {
  const params = new URLSearchParams(location.search);
  const db = params.get('db');
  if (db) Net.configure(decodeURIComponent(db));
  else Net.restore();
  initHome();
  bindRoomUi();
  const code = (params.get('room') || '').toUpperCase();
  if (/^[A-Z0-9]{4}$/.test(code)) {
    if (me.name && sessionStorage.getItem('pq_in_room') === code) { enterRoom(code); return; }
    $('#join-banner').classList.remove('hidden');
    $('#join-banner-code').textContent = code;
    $('#join-banner-btn').onclick = () => enterRoom(code);
    $('#code-input').value = code;
    if (!me.name) setTimeout(() => $('#name-input').focus(), 100);
  }
}
boot();
