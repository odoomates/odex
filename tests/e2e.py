"""End-to-end test against a real Odoo server.

Opens Odoo in headless Chrome, logs in, injects the odeX scripts into an
isolated world exactly like the background's scripting.executeScript does,
then drives the panel and checks results that come back from the server.
Only read-only ORM calls are executed; the write test stops at the
confirmation bar.

    python3 tests/e2e.py --url http://127.0.0.1:8020 --db mydb [--login admin --password admin]
"""
import argparse
import base64
import json
import os
import re
import shutil
import socket
import struct
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = ["src/shared/pyparse.js", "src/content/panel-css.js", "src/content/odex.js"]


class WebSocket:
    """Minimal client WebSocket (text frames only), enough for CDP."""

    def __init__(self, url):
        m = re.match(r"ws://([^:/]+):(\d+)(/.*)?", url)
        host, port, path = m.group(1), int(m.group(2)), m.group(3) or "/"
        self.sock = socket.create_connection((host, port))
        key = base64.b64encode(os.urandom(16)).decode()
        self.sock.sendall(
            f"GET {path} HTTP/1.1\r\nHost: {host}:{port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n".encode())
        response = b""
        while b"\r\n\r\n" not in response:
            response += self.sock.recv(1)
        assert b" 101 " in response.split(b"\r\n")[0], response

    def send(self, text):
        payload = text.encode()
        mask = os.urandom(4)
        n = len(payload)
        if n < 126:
            header = bytes([0x81, 0x80 | n])
        elif n < 65536:
            header = bytes([0x81, 0x80 | 126]) + struct.pack(">H", n)
        else:
            header = bytes([0x81, 0x80 | 127]) + struct.pack(">Q", n)
        self.sock.sendall(header + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(payload)))

    def _exact(self, n):
        buf = b""
        while len(buf) < n:
            chunk = self.sock.recv(n - len(buf))
            if not chunk:
                raise ConnectionError("browser connection closed")
            buf += chunk
        return buf

    def recv(self):
        message = b""
        while True:
            b1, b2 = self._exact(2)
            n = b2 & 0x7F
            if n == 126:
                n = struct.unpack(">H", self._exact(2))[0]
            elif n == 127:
                n = struct.unpack(">Q", self._exact(8))[0]
            message += self._exact(n)
            if b1 & 0x80:
                return message.decode()


class Chrome:
    def __init__(self, binary, profile):
        self.proc = subprocess.Popen(
            [binary, "--headless=new", "--remote-debugging-port=0", f"--user-data-dir={profile}", "--no-first-run",
             "--no-default-browser-check", "--disable-gpu", "--window-size=1400,900", "about:blank"],
            stderr=subprocess.PIPE, stdout=subprocess.DEVNULL, text=True)
        for line in self.proc.stderr:
            if m := re.search(r"DevTools listening on (ws://\S+)", line):
                break
        else:
            raise SystemExit("Chrome failed to start")
        self.ws = WebSocket(m.group(1))
        self.next_id = 0
        target = self.send("Target.createTarget", {"url": "about:blank"})["targetId"]
        self.session = self.send("Target.attachToTarget", {"targetId": target, "flatten": True})["sessionId"]
        self.send("Page.enable", session=self.session)

    def send(self, method, params=None, session=None):
        self.next_id += 1
        msg = {"id": self.next_id, "method": method, "params": params or {}}
        if session:
            msg["sessionId"] = session
        self.ws.send(json.dumps(msg))
        while True:
            reply = json.loads(self.ws.recv())
            if reply.get("id") == self.next_id:
                if "error" in reply:
                    raise RuntimeError(f"{method}: {reply['error']}")
                return reply["result"]

    def page(self, method, params=None):
        return self.send(method, params, self.session)

    def navigate(self, url):
        self.page("Page.navigate", {"url": url})
        origin = "/".join(url.split("/")[:3])
        self.wait(f"document.readyState === 'complete' && location.origin === {json.dumps(origin)}")

    def evaluate(self, expression, context=None):
        params = {"expression": expression, "awaitPromise": True, "returnByValue": True}
        if context:
            params["contextId"] = context
        res = self.page("Runtime.evaluate", params)
        if "exceptionDetails" in res:
            raise RuntimeError(res["exceptionDetails"].get("exception", {}).get("description") or res["exceptionDetails"])
        return res["result"].get("value")

    def wait(self, expression, context=None, timeout=30):
        deadline = time.time() + timeout
        error = None
        while time.time() < deadline:
            try:
                value = self.evaluate(expression, context)
                if value:
                    return value
            except RuntimeError as e:
                error = e
            time.sleep(0.2)
        raise TimeoutError(f"Timed out waiting for: {expression} ({error})")

    def close(self):
        self.proc.terminate()
        self.proc.wait(10)


# Runs in the isolated world before the odeX scripts: a storage stub standing in
# for browser.storage, and a hook that keeps a handle on the (closed) shadow root.
PRELUDE = """
(() => {
  const data = {};
  globalThis.browser = { storage: { local: {
    async get(k) { return k in data ? { [k]: JSON.parse(JSON.stringify(data[k])) } : {}; },
    async set(o) { Object.assign(data, JSON.parse(JSON.stringify(o))); },
  } } };
  globalThis.__store = data;
  const attach = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function (o) { return (globalThis.__root = attach.call(this, o)); };
})();
"""

HELPERS = """
globalThis.T = {
  q: (s) => __root.querySelector(s),
  qa: (s) => [...__root.querySelectorAll(s)],
  type(code) {
    const ed = T.q('textarea');
    ed.focus();
    ed.value = code;
    ed.setSelectionRange(code.length, code.length);
    ed.dispatchEvent(new Event('input', { bubbles: true }));
  },
  key(key, opts = {}) {
    T.q('textarea').dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...opts }));
  },
  run(code) { T.type(code); T.key('Enter', { ctrlKey: true }); },
  meta: () => T.q('.meta').textContent,
};
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://127.0.0.1:8069")
    ap.add_argument("--db", required=True)
    ap.add_argument("--login", default="admin")
    ap.add_argument("--password", default="admin")
    ap.add_argument("--binary", default=shutil.which("google-chrome") or shutil.which("chromium"))
    ap.add_argument("--screenshot", help="save a PNG of the panel here")
    opts = ap.parse_args()

    profile = tempfile.mkdtemp(prefix="odex-e2e-")
    chrome = Chrome(opts.binary, profile)
    results = []

    def check(name, fn):
        try:
            fn()
            results.append((name, None))
        except Exception as e:  # noqa: BLE001 - report every failure
            results.append((name, f"{type(e).__name__}: {e}"))

    try:
        chrome.navigate(f"{opts.url}/web/login?db={opts.db}")
        auth = chrome.evaluate(f"""fetch('/web/session/authenticate', {{method: 'POST',
            headers: {{'Content-Type': 'application/json'}},
            body: JSON.stringify({{jsonrpc: '2.0', method: 'call', params: {json.dumps(
                {"db": opts.db, "login": opts.login, "password": opts.password})}}})}})
            .then(r => r.json()).then(r => r.result ? r.result.uid : JSON.stringify(r.error))""")
        assert isinstance(auth, int), f"login failed: {auth}"
        chrome.navigate(f"{opts.url}/odoo")
        chrome.wait("!!document.querySelector('.o_main_navbar')", timeout=60)

        frame = chrome.page("Page.getFrameTree")["frameTree"]["frame"]["id"]
        ctx = chrome.page("Page.createIsolatedWorld", {"frameId": frame, "worldName": "odex-e2e"})["executionContextId"]

        def inject():
            for path in SCRIPTS:
                chrome.evaluate((ROOT / path).read_text(), ctx)

        chrome.evaluate(PRELUDE, ctx)
        inject()
        chrome.evaluate(HELPERS, ctx)
        ev = lambda js: chrome.evaluate(js, ctx)  # noqa: E731
        wait = lambda js, timeout=30: chrome.wait(js, ctx, timeout)  # noqa: E731

        check("panel opens with empty state", lambda: wait("T.q('.panel') && T.q('.empty') && document.querySelector('odex-root').style.display !== 'none'"))
        check("connects to the session", lambda: wait(f"T.q('.conn').classList.contains('ok') && T.q('.conn').textContent.includes({json.dumps(opts.db)})"))
        def prefill_enter():
            code = ev("T.q('textarea').value")
            assert code == "res.users.browse(uid).read(['name', 'login', 'company_id', 'group_ids'])", code
            ev("T.q('textarea').focus(); T.key('Enter'); true")
            wait("T.meta().includes('✓') && T.meta().includes('res.users.read')")
            heads = ev("T.qa('th').map(th => th.textContent)")
            assert heads[:3] == ["id", "name", "login"] and "group_ids" in heads, heads
            assert ev("T.q('tbody td:nth-child(3)').textContent") == opts.login, ev("T.q('tbody tr').textContent")
        check("prefilled with the current user; Enter runs it", prefill_enter)

        def enter_in_open_bracket():
            ev("T.type(\"res.partner.search_count([\"); T.key('Enter'); true")
            time.sleep(0.5)
            assert "search_count" not in ev("T.meta()"), "Enter inside an open bracket must not run"
            ev("T.key('Enter', {shiftKey: true}); true")
            time.sleep(0.3)
            assert "search_count" not in ev("T.meta()")
        check("Enter inside an open bracket / Shift+Enter doesn't run", enter_in_open_bracket)

        # Typed before ir.model has loaded on purpose: the list must show up once it arrives.
        check("loads models for completion", lambda: ev("T.type('res.partne'); true") and wait("!T.q('.complete').hidden && T.qa('.complete li').some(li => li.textContent.startsWith('res.partner'))"))

        def completion_accept():
            ev("T.type('res.partne'); true")
            wait("!T.q('.complete').hidden")
            # pick res.partner exactly
            ev("""(() => { const lis = T.qa('.complete li'); const i = lis.findIndex(li => li.firstChild.textContent === 'res.partner');
                   for (let n = 0; n < i; n++) T.key('ArrowDown'); T.key('Tab'); })()""")
            assert ev("T.q('textarea').value") == "res.partner.", ev("T.q('textarea').value")
            wait("!T.q('.complete').hidden && T.qa('.complete li').some(li => li.firstChild.textContent === 'search_read')")
        check("completion: model then methods", completion_accept)

        def search_read():
            ev("T.run(\"res.partner.search_read([], ['name', 'email', 'country_id'], limit=3, order='id')\"); true")
            wait("T.meta().includes('✓')")
            assert "res.partner.search_read" in ev("T.meta()") and "list[" in ev("T.meta()"), ev("T.meta()")
            assert ev("T.q('.tab.active').dataset.view") == "table"
            heads = ev("T.qa('th').map(th => th.textContent)")
            assert heads[0] == "id" and "name" in heads and "country_id" in heads, heads
            rows = ev("T.qa('tbody tr').length")
            assert 1 <= rows <= 3, rows
        check("search_read renders a table", search_read)

        def views():
            for view in ("json", "python", "tree"):
                ev(f"T.q('.tab[data-view={view}]').click(); true")
                assert ev("T.q('.tab.active').dataset.view") == view
            assert ev("T.q('.output pre') === null && !!T.q('.tree details[open]')")
            ev("T.q('.tab[data-view=python]').click(); true")
            text = ev("T.q('.output pre').textContent")
            assert text.startswith("[") and "'name':" in text, text[:200]
            ev("T.q('.tab[data-view=table]').click(); true")
        check("tree / json / python views", views)

        def last_result():
            ev("T.run(\"res.partner.browse(_).read(['display_name'])\"); true")
            wait("T.meta().includes('✓') && T.meta().includes('.read')")
            assert ev("T.qa('th').map(th => th.textContent).join()") == "id,display_name"
        check("_ feeds the previous result into browse()", last_result)

        def uid_ctx():
            ev("T.run(\"res.users.browse(uid).with_context(lang='en_US').read(['login'])\"); true")
            wait("T.meta().includes('✓') && T.meta().includes('res.users')")
            assert ev("T.q('tbody td:nth-child(2)').textContent") == opts.login
        check("uid + with_context", uid_ctx)

        def scalar():
            ev("T.run(\"res.partner.with_context(active_test=False).search_count([])\"); true")
            wait("T.meta().includes('search_count') && T.meta().includes('int')")
            assert ev("T.q('.tab[data-view=table]').disabled")
            assert ev("T.q('.tab.active').dataset.view") == "tree"
        check("scalar result goes to the tree, table disabled", scalar)

        def server_error():
            ev("T.run(\"res.partner.search_read([('no_such_field', '=', 1)], limit=1)\"); true")
            wait("T.meta().includes('✕')")
            assert ev("T.q('.error .message').textContent.includes('no_such_field')"), ev("T.q('.error').textContent")
            assert ev("!!T.q('.error details pre').textContent")
        check("server errors show the message and traceback", server_error)

        def missing_model():
            ev("T.run(\"no.such.model.search([])\"); true")
            wait("T.meta().includes('✕') && !!T.q('.error')")
        check("unknown model is reported", missing_model)

        def syntax():
            ev("T.run(\"res.partner.search([('a', '=', )\"); true")
            wait("T.meta().includes('Syntax error')")
            assert "^" in ev("T.q('.error .caret').textContent")
        check("syntax errors point at the column", syntax)

        def confirm_write():
            before = ev("__store['odex.history'].length")
            ev("T.run(\"res.partner.browse([1]).write({'comment': 'x'})\"); true")
            assert ev("!T.q('.confirm').hidden"), "confirm bar not shown"
            assert "write()" in ev("T.q('.confirm .msg').textContent")
            ev("T.q('[data-act=confirm-cancel]').click(); true")
            assert ev("T.q('.confirm').hidden")
            time.sleep(0.5)
            assert ev("__store['odex.history'].length") == before, "write must not run after cancel"
        check("write asks for confirmation; cancel doesn't run it", confirm_write)

        def history():
            hist = ev("__store['odex.history']")
            # Syntax errors never reach the server and aren't recorded; the cancelled write isn't either.
            assert hist[0]["code"] == "no.such.model.search([])", hist[0]
            assert any(h["ok"] for h in hist) and any(not h["ok"] for h in hist)
            ev("T.q('[data-act=history]').click(); true")
            wait("T.qa('.hist-item').length >= 5")
            ev("T.qa('.hist-item')[2].click(); true")
            assert ev("T.q('textarea').value") == hist[2]["code"]
            ev("T.q('textarea').value = ''; true")
            ev("T.key('ArrowUp', {altKey: true}); true")
            assert ev("T.q('textarea').value") == hist[0]["code"]
        check("history is stored, listed and recallable", history)

        if opts.screenshot:
            ev("T.run(\"res.partner.search_read([], ['name', 'email', 'country_id', 'is_company'], limit=8, order='id')\"); true")
            wait("T.meta().includes('✓') && T.meta().includes('search_read')")
            png = chrome.page("Page.captureScreenshot", {"format": "png"})["data"]
            Path(opts.screenshot).write_bytes(base64.b64decode(png))

        def toggle():
            inject()
            assert ev("document.querySelector('odex-root').style.display") == "none", ev("document.querySelector('odex-root').style.display")
            inject()
            # The host carries `all: initial`, so a cleared display reads back as "initial".
            assert ev("document.querySelector('odex-root').style.display") != "none"
            assert ev("document.querySelectorAll('odex-root').length") == 1
        check("re-injecting toggles the same panel", toggle)
    finally:
        chrome.close()
        shutil.rmtree(profile, ignore_errors=True)

    for name, error in results:
        print(("PASS " if not error else "FAIL ") + name + (f"\n     {error}" if error else ""))
    failed = sum(1 for _, e in results if e)
    print(f"\n{len(results) - failed}/{len(results)} passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
