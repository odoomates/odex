"""Capture the store screenshots (1280x800) into store/screenshots/ from a real Odoo.

    python3 tools/make_screenshots.py --url http://127.0.0.1:8020 --db mydb [--login admin --password admin]

Uses the same headless-Chrome harness as tests/e2e.py. Only read-only calls
are executed; the write screenshot stops at the confirmation bar.
"""
import argparse
import base64
import json
import shutil
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tests"))
from e2e import HELPERS, PRELUDE, SCRIPTS, Chrome  # noqa: E402

OUT = ROOT / "store" / "screenshots"
W, H = 1280, 800
# Panel geometry for the shots: big enough to read, leaving Odoo visible on the left.
GEOMETRY = {"left": 430, "top": 64, "width": 830, "height": 716}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://127.0.0.1:8069")
    ap.add_argument("--db", required=True)
    ap.add_argument("--login", default="admin")
    ap.add_argument("--password", default="admin")
    ap.add_argument("--binary", default=shutil.which("google-chrome") or shutil.which("chromium"))
    opts = ap.parse_args()

    OUT.mkdir(parents=True, exist_ok=True)
    profile = tempfile.mkdtemp(prefix="odex-shots-")
    chrome = Chrome(opts.binary, profile)
    try:
        chrome.page("Emulation.setDeviceMetricsOverride", {"width": W, "height": H, "deviceScaleFactor": 1, "mobile": False})
        chrome.navigate(f"{opts.url}/web/login?db={opts.db}")
        uid = chrome.evaluate(f"""fetch('/web/session/authenticate', {{method: 'POST',
            headers: {{'Content-Type': 'application/json'}},
            body: JSON.stringify({{jsonrpc: '2.0', method: 'call', params: {json.dumps(
                {"db": opts.db, "login": opts.login, "password": opts.password})}}})}})
            .then(r => r.json()).then(r => r.result && r.result.uid)""")
        assert isinstance(uid, int), "login failed"
        chrome.navigate(f"{opts.url}/odoo/action-base.action_partner_form")
        chrome.wait("!!document.querySelector('.o_main_navbar') && !!document.querySelector('.o_kanban_record, .o_data_row')", timeout=60)

        frame = chrome.page("Page.getFrameTree")["frameTree"]["frame"]["id"]
        ctx = chrome.page("Page.createIsolatedWorld", {"frameId": frame, "worldName": "odex-shots"})["executionContextId"]
        chrome.evaluate(PRELUDE, ctx)
        chrome.evaluate(f"__store['odex.geometry'] = {json.dumps(GEOMETRY)}; __store['odex.settings'] = {{theme: 'light'}}; true", ctx)
        for path in SCRIPTS:
            chrome.evaluate((ROOT / path).read_text(), ctx)
        chrome.evaluate(HELPERS, ctx)
        ev = lambda js: chrome.evaluate(js, ctx)  # noqa: E731
        wait = lambda js, timeout=30: chrome.wait(js, ctx, timeout)  # noqa: E731
        wait("T.q('.conn').classList.contains('ok')")
        time.sleep(1)  # let ir.model load for completion

        def shot(name):
            ev("T.q('textarea').blur(); true")
            time.sleep(0.4)
            png = chrome.page("Page.captureScreenshot", {"format": "png"})["data"]
            (OUT / f"{name}.png").write_bytes(base64.b64decode(png))
            print(f"store/screenshots/{name}.png")

        def run(code, done):
            ev(f"T.run({json.dumps(code)}); true")
            wait(done)

        run("res.partner.search_read([('is_company', '=', True)], ['name', 'email', 'phone', 'country_id'], limit=12, order='name')",
            "T.meta().includes('✓')")
        shot("1-table")

        run("res.partner.fields_get(['name', 'country_id', 'category_id'], ['string', 'type', 'relation', 'required'])",
            "T.meta().includes('fields_get') && T.meta().includes('✓')")
        ev("T.qa('.tree details').forEach(d => d.open = true); true")
        shot("2-tree")

        # Completion is shown while the editor is focused, so capture without blurring.
        ev("T.type('res.partner.se'); true")
        wait("!T.q('.complete').hidden")
        time.sleep(0.4)
        (OUT / "3-completion.png").write_bytes(base64.b64decode(chrome.page("Page.captureScreenshot", {"format": "png"})["data"]))
        print("store/screenshots/3-completion.png")
        ev("T.key('Escape'); true")

        ev("T.run(\"res.partner.browse([3]).write({'comment': 'Reviewed'})\"); true")
        wait("!T.q('.confirm').hidden")
        time.sleep(0.4)
        (OUT / "4-confirm.png").write_bytes(base64.b64decode(chrome.page("Page.captureScreenshot", {"format": "png"})["data"]))
        print("store/screenshots/4-confirm.png")
        ev("T.q('[data-act=confirm-cancel]').click(); true")

        run("res.partner.search_read([('no_such_field', '=', 1)], ['name'])", "T.meta().includes('✕')")
        # The traceback stays collapsed: it would show the server's file paths.
        shot("5-error")

        ev("__store['odex.settings'] = {theme: 'dark'}; true")
        ev("T.q('[data-setting=theme]') && (T.q('[data-setting=theme]').value = 'dark', T.q('[data-setting=theme]').dispatchEvent(new Event('change', {bubbles: true}))); true")
        run("res.users.browse(uid).with_context(lang='en_US').read(['name', 'login', 'lang', 'tz', 'company_id'])",
            "T.meta().includes('res.users') && T.meta().includes('✓')")
        ev("T.q('.tab[data-view=python]').click(); true")
        shot("6-python-dark")
    finally:
        chrome.close()
        shutil.rmtree(profile, ignore_errors=True)


if __name__ == "__main__":
    main()
