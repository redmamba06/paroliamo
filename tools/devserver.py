"""Server di sviluppo: file statici + finto Firebase Realtime Database (REST + SSE)
sotto /fb/... — serve solo per provare il multiplayer in locale con più schede.
Uso: python3 tools/devserver.py [porta]"""
import json, os, sys, threading, time, queue
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = {}
LOCK = threading.Lock()
LISTENERS = []  # (path_parts, queue)

def parts(p): return [x for x in p.strip('/').split('/') if x]

def resolve(v):
    if isinstance(v, dict):
        if v.get('.sv') == 'timestamp': return int(time.time() * 1000)
        out = {k: resolve(x) for k, x in v.items()}
        out = {k: x for k, x in out.items() if x is not None and x != {} and x != []}
        return out or None
    if isinstance(v, list):
        out = {str(i): resolve(x) for i, x in enumerate(v)}
        out = {k: x for k, x in out.items() if x is not None}
        return out or None
    return v

def get(ps):
    n = DATA
    for p in ps:
        if not isinstance(n, dict) or p not in n: return None
        n = n[p]
    return n

def setp(ps, v):
    global DATA
    if not ps:
        DATA = v if isinstance(v, dict) else {}
        return
    n = DATA
    chain = []
    for p in ps[:-1]:
        if not isinstance(n.get(p), dict): n[p] = {}
        chain.append((n, p)); n = n[p]
    if v is None: n.pop(ps[-1], None)
    else: n[ps[-1]] = v
    # pulizia nodi vuoti
    for parent, key in reversed(chain):
        if parent[key] == {}: parent.pop(key)

def to_out(v):
    # Firebase restituisce array per chiavi numeriche consecutive
    if isinstance(v, dict):
        conv = {k: to_out(x) for k, x in v.items()}
        if conv and all(k.isdigit() for k in conv):
            idx = sorted(int(k) for k in conv)
            if idx[0] == 0 or len(idx) * 2 > idx[-1]:
                arr = [None] * (idx[-1] + 1)
                for k in conv: arr[int(k)] = conv[k]
                return arr
        return conv
    return v

def notify(ps, kind, payload_at_path):
    for lp, q in list(LISTENERS):
        if ps[:len(lp)] == lp:  # scrittura sotto il listener
            rel = '/' + '/'.join(ps[len(lp):])
            q.put((kind, rel, to_out(payload_at_path)))
        elif lp[:len(ps)] == ps:  # scrittura sopra il listener
            q.put(('put', '/', to_out(get(lp))))

class H(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=ROOT, **k)
    def log_message(self, *a): pass
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET,PUT,PATCH,POST,DELETE,OPTIONS')
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()
    def fbpath(self):
        p = self.path.split('?')[0]
        if not p.startswith('/fb') or not p.endswith('.json'): return None
        return parts(p[3:-5])
    def body(self):
        n = int(self.headers.get('Content-Length') or 0)
        return json.loads(self.rfile.read(n) or b'null')
    def reply(self, v, code=200):
        b = json.dumps(v).encode()
        self.send_response(code); self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b)
    def do_OPTIONS(self): self.send_response(204); self.end_headers()
    def do_GET(self):
        ps = self.fbpath()
        if ps is None: return super().do_GET()
        if 'text/event-stream' in (self.headers.get('Accept') or ''):
            return self.stream(ps)
        with LOCK: v = to_out(get(ps))
        self.reply(v)
    def stream(self, ps):
        q = queue.Queue()
        with LOCK:
            LISTENERS.append((ps, q)); q.put(('put', '/', to_out(get(ps))))
        self.send_response(200); self.send_header('Content-Type', 'text/event-stream'); self.end_headers()
        try:
            while True:
                try: kind, rel, data = q.get(timeout=15)
                except queue.Empty:
                    self.wfile.write(b'event: keep-alive\ndata: null\n\n'); self.wfile.flush(); continue
                msg = 'event: %s\ndata: %s\n\n' % (kind, json.dumps({'path': rel, 'data': data}))
                self.wfile.write(msg.encode()); self.wfile.flush()
        except Exception: pass
        finally:
            with LOCK:
                LISTENERS[:] = [l for l in LISTENERS if l[1] is not q]
    def do_PUT(self):
        ps = self.fbpath(); v = resolve(self.body())
        with LOCK: setp(ps, v); notify(ps, 'put', v)
        self.reply(to_out(v))
    def do_PATCH(self):
        ps = self.fbpath(); v = self.body() or {}
        out = {}
        with LOCK:
            for k, x in v.items():
                sub = ps + parts(k); rx = resolve(x); setp(sub, rx); out[k] = rx
            for k in out: notify(ps + parts(k), 'put', out[k])
        self.reply(to_out(out))
    def do_POST(self):
        ps = self.fbpath(); v = resolve(self.body())
        name = '-k%x%04d' % (int(time.time() * 1000), int.from_bytes(os.urandom(2), 'big') % 10000)
        with LOCK: setp(ps + [name], v); notify(ps + [name], 'put', v)
        self.reply({'name': name})
    def do_DELETE(self):
        ps = self.fbpath()
        with LOCK: setp(ps, None); notify(ps, 'put', None)
        self.reply(None)

if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8480
    print('http://localhost:%d  (finto db: http://localhost:%d/fb)' % (port, port))
    ThreadingHTTPServer(('', port), H).serve_forever()
