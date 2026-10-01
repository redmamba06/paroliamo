/* ============================================================
   Paroliamo — rete: Firebase Realtime Database via REST + SSE
   Nessun SDK. Ogni stanza vive sotto /rooms/pq-{CODICE}.
   Il client tiene in memoria una copia dell'intera stanza,
   aggiornata dagli eventi SSE (put/patch), e scrive con fetch.
   ============================================================ */
'use strict';

const Net = (() => {
  const LS_URL = 'gs_fb_url';          // condiviso con HitQuiz (stessa origine)
  const LS_ID = 'pq_device_id';
  let base = null;

  function deviceId() {
    let id = localStorage.getItem(LS_ID);
    if (!id) { id = 'p' + Math.random().toString(36).slice(2, 10); localStorage.setItem(LS_ID, id); }
    return id;
  }

  function configure(url) {
    url = (url || '').trim().replace(/\/+$/, '');
    if (!url) return false;
    if (!/^https?:\/\//.test(url)) url = (/^(localhost|127\.)/.test(url) ? 'http://' : 'https://') + url;
    base = url;
    localStorage.setItem(LS_URL, url);
    return true;
  }
  function restore() { const u = localStorage.getItem(LS_URL); return u ? configure(u) : false; }

  const url = (p) => `${base}/${p}.json`;

  async function write(path, value, method) {
    const res = await fetch(url(path), {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: value === undefined ? undefined : JSON.stringify(value)
    });
    if (!res.ok) throw new Error('database ' + res.status);
    return res.json().catch(() => null);
  }

  const api = {
    get: (p) => fetch(url(p)).then(r => (r.ok ? r.json() : null)),
    set: (p, v) => write(p, v, 'PUT'),
    update: (p, v) => write(p, v, 'PATCH'),
    remove: (p) => write(p, undefined, 'DELETE'),
    TS: { '.sv': 'timestamp' }
  };

  /* ---------- albero locale ---------- */
  const split = (p) => (p || '').split('/').filter(Boolean);
  function setIn(root, path, value) {
    const ps = split(path);
    if (!ps.length) return value == null ? {} : value;
    if (root == null || typeof root !== 'object') root = {};
    let n = root;
    for (let i = 0; i < ps.length - 1; i++) {
      if (n[ps[i]] == null || typeof n[ps[i]] !== 'object') n[ps[i]] = {};
      n = n[ps[i]];
    }
    const last = ps[ps.length - 1];
    if (value == null) { if (Array.isArray(n)) n[last] = undefined; else delete n[last]; }
    else n[last] = value;
    return root;
  }

  class LiveRoom {
    constructor(code) {
      this.code = code;
      this.key = 'rooms/pq-' + code;
      this.data = null;
      this.ready = false;
      this.es = null;
      this.listeners = [];
      this.offset = 0;   // ora del server - ora locale
    }
    p(sub) { return this.key + (sub ? '/' + sub : ''); }
    get(sub) { return api.get(this.p(sub)); }
    set(sub, v) { return api.set(this.p(sub), v); }
    update(sub, v) { return api.update(this.p(sub), v); }
    remove(sub) { return api.remove(this.p(sub)); }
    now() { return Date.now() + this.offset; }
    onChange(fn) { this.listeners.push(fn); }
    emit() { this.listeners.forEach(fn => { try { fn(this.data); } catch (e) { console.error(e); } }); }
    start() {
      this.stop();
      this.es = new EventSource(url(this.key));
      const apply = (kind) => (e) => {
        let d; try { d = JSON.parse(e.data); } catch { return; }
        if (!d) return;
        if (kind === 'put') this.data = setIn(this.data, d.path, d.data);
        else for (const k of Object.keys(d.data || {})) this.data = setIn(this.data, (d.path === '/' ? '' : d.path) + '/' + k, d.data[k]);
        this.ready = true;
        this.emit();
      };
      this.es.addEventListener('put', apply('put'));
      this.es.addEventListener('patch', apply('patch'));
      this.es.onerror = () => { this.onConnError && this.onConnError(); };
      this.es.onopen = () => { this.onConnOk && this.onConnOk(); };
    }
    stop() { if (this.es) { try { this.es.close(); } catch {} this.es = null; } }
    // battito di presenza: scrive il timestamp del server e stima lo scarto orario
    async beat(me) {
      const t0 = Date.now();
      const v = await this.set('players/' + me + '/seen', api.TS);
      const t1 = Date.now();
      if (typeof v === 'number') this.offset = v - (t0 + t1) / 2;
    }
  }

  return {
    deviceId, configure, restore,
    configured: () => !!base,
    url: () => base || '',
    TS: api.TS,
    room: (code) => new LiveRoom(code.toUpperCase()),
    async exists(code) { return !!(await api.get('rooms/pq-' + code.toUpperCase() + '/meta').catch(() => null)); },
    async test() {
      const p = 'health/' + deviceId();
      const v = Date.now();
      await api.set(p, v);
      const back = await api.get(p);
      await api.remove(p);
      if (back !== v) throw new Error('valore non corrisponde');
      return true;
    }
  };
})();
