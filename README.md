# odeX: Odoo ORM Box

A browser extension (Chrome, Edge, Firefox, Manifest V3) that opens a box on any Odoo page where you
type ORM calls in Python syntax, run them with your own session and inspect the result.
Click the toolbar button or press **Alt+Shift+X**; press it again to hide the box.
The box opens with `res.users.browse(uid).read(['name', 'login', 'company_id', 'group_ids'])` ready:
press **Enter** to see who you are on this database. **Shift+Enter** adds a new line (so does Enter
inside an open bracket).

```python
res.partner.search_read([('is_company', '=', True)], ['name', 'email'], limit=5)
res.partner.browse([1, 2]).with_context(lang='fr_FR').read(['name'])
env['sale.order'].search_count([('state', '=', 'sale')])
res.users.browse(uid).read(['login'])
res.partner.browse(_).read(['display_name'])     # _ = previous result, __ = the one before
```

## Features

- **Python syntax**: `model.method(...)`, `env['model']`, `browse(ids)`, `with_context(...)`,
  `with_company(...)`, keyword arguments, `True/False/None`, tuples, `Command.create(...)` and
  friends, `uid`, and `_` / `__` for the previous results. Each call becomes one
  `/web/dataset/call_kw` request.
- **Runs as you**: calls go through the tab's own Odoo session, so access rights and record rules
  apply (`sudo()` / `with_user()` are refused with an explanation). odeX never sees your password.
- **Results**: Tree, Table (for record lists), JSON and Python views; many2one values shown as
  `name #id`; copy the result as Python or JSON.
- **Errors**: Odoo's error type and message, with the server traceback folded underneath; syntax
  errors point at the column.
- **Safety**: any method that isn't known to be read-only (`write`, `create`, `unlink`, button
  methods…) asks for confirmation first, showing the database and the number of records. You can
  turn this off in settings.
- **Completion**: Tab completes model names (from `ir.model`) and ORM methods with their signatures.
- **History**: the last 200 calls with status and timing, searchable; `Alt+↑ / Alt+↓` recall them.
- **Comfort**: draggable, resizable panel, examples menu, light/dark/auto theme, the draft survives a
  reload.

Tested on Odoo 19.5. It only uses `/web/session/get_session_info` and `/web/dataset/call_kw`,
which recent Odoo versions all provide. The panel lives in a closed shadow root, so it
doesn't affect Odoo's styles and Odoo doesn't affect it.

## Install (development)

```bash
python3 tools/build.py          # -> dist/chrome, dist/firefox and store zips
```

- **Chrome/Edge:** go to `chrome://extensions`, turn on Developer mode, click *Load unpacked* and pick `dist/chrome`.
- **Firefox:** go to `about:debugging#/runtime/this-firefox`, click *Load Temporary Add-on* and pick `dist/firefox/manifest.json`.

## Tests

```bash
python3 tools/run_tests.py      # parser unit tests in headless Chrome
python3 tests/e2e.py --url http://127.0.0.1:8069 --db mydb [--login admin --password admin]
```

`e2e.py` logs in to a real Odoo, injects odeX the way the background does and drives the panel.
It runs read-only calls only; the write check stops at the confirmation bar and cancels.

## Store material

```bash
python3 tools/make_icons.py         # src/icons
python3 tools/make_store_images.py  # store/promo-*.png
python3 tools/make_screenshots.py --url http://127.0.0.1:8069 --db mydb   # store/screenshots (1280x800)
```

Listing text, permission justifications and reviewer notes: [store/LISTING.md](store/LISTING.md).

## Layout

```
manifest.json               MV3 manifest (the build strips the keys each browser doesn't use)
src/background.js           toolbar button / shortcut: injects or toggles the box (activeTab only)
src/shared/pyparse.js       Python-call parser -> call_kw params; Python repr of results
src/content/odex.js         the panel: editor, completion, runner, result views, history, settings
src/content/panel-css.js    panel styles (injected into the shadow root)
```

## Permissions

`activeTab` + `scripting` to inject the box into the tab you open it on, `storage` for settings and
history. No host permissions: odeX has no access to any site until you click it there.

## License

MIT, see [LICENSE](LICENSE). Privacy: [PRIVACY.md](PRIVACY.md).
odeX is an independent project, not affiliated with Odoo S.A. "Odoo" is a trademark of Odoo S.A.
