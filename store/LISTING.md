# Store listings

Copy-paste material for the Chrome Web Store and Firefox Add-ons (AMO).
Upload packages are built with `python3 tools/build.py`:
`dist/odex-<version>-chrome.zip` and `dist/odex-<version>-firefox.zip`.

---

## Shared text

**Name:** odeX - Odoo ORM Box

**Short description** (Chrome summary, max 132 chars; AMO summary, max 250):

> Run Odoo ORM calls (search_read, read, write, create, fields_get…) in Python syntax from any Odoo page and inspect the result.

**Full description:**

```
odeX is an Odoo ORM box for developers and functional consultants. Press Alt+Shift+X (or click the toolbar button) on any Odoo page, type an ORM call the way you would in an Odoo shell, press Enter and see the result right away. The box opens with your own user ready to run, so the first Enter shows who you are on this database.

    res.partner.search_read([('is_company', '=', True)], ['name', 'email'], limit=5)
    res.partner.browse([1, 2]).with_context(lang='fr_FR').read(['name'])
    env['sale.order'].search_count([('state', '=', 'sale')])

WRITE CALLS LIKE IN PYTHON
• model.method(...), env['model'], browse(ids), with_context(...), with_company(...)
• Keyword arguments, True/False/None, tuples, Command.create / Command.set / …
• uid, and _ / __ for the previous results: res.partner.browse(_).read(['name'])
• Tab completes model names and ORM methods, with their signatures

SEE THE RESULT
• Table view for record lists, a collapsible tree for anything else, plus JSON and Python views
• Many2one values shown as "name #id"
• Copy the result as Python or JSON
• Errors show Odoo's error type and message, with the server traceback folded underneath; syntax errors point at the column

SAFE BY DEFAULT
• Every call runs through your own Odoo session, as your user, with your access rights and record rules
• write, create, unlink, button methods and anything not known to be read-only ask for confirmation first, showing the database and the number of records
• odeX has no access to any site until you open it on that tab

COMFORT
• Draggable, resizable panel that doesn't touch Odoo's styles
• History of your last 200 calls with status and timing; Alt+↑ / Alt+↓ to recall
• Examples menu, light / dark / auto theme, your draft survives a reload

PRIVACY
odeX runs only when you open it, only on that tab, and talks only to the Odoo server you are on. Results are never stored or sent anywhere. No data is collected, no analytics, no third-party services.

odeX is an independent open-source project (MIT), not affiliated with Odoo S.A. "Odoo" is a trademark of Odoo S.A.
Source: https://github.com/odoomates/odex
```

**Homepage:** https://github.com/odoomates/odex
**Support:** https://github.com/odoomates/odex/issues
**Privacy policy:** https://github.com/odoomates/odex/blob/main/PRIVACY.md
**License:** MIT

---

## Chrome Web Store (https://chrome.google.com/webstore/devconsole)

**Package:** `dist/odex-<version>-chrome.zip`

**Store listing tab**
- Category: *Developer Tools*
- Language: English
- Icon: taken from the package (128×128)
- Screenshots (1280×800): `store/screenshots/1-table.png` … `6-python-dark.png`
- Small promo tile (440×280): `store/promo-small-440x280.png`
- Marquee promo tile (1400×560, optional): `store/promo-marquee-1400x560.png`
- Homepage and support: URLs above

**Privacy practices tab**

*Single purpose:*
> odeX lets users of the Odoo web application run Odoo ORM calls (search, read, write, fields_get…) from a panel on the Odoo page they are on, using their own session, and inspect the result.

*Permission justifications:*
- **activeTab**: The panel is injected only into the tab where the user clicks the toolbar button or presses the shortcut, so the extension needs no standing access to any website.
- **scripting**: Used to inject the panel into the active tab when the user asks for it.
- **storage**: Stores the user's settings, panel size and position, current draft and a local history of the calls they ran. Nothing is sent anywhere.

*Host permissions:* none requested.

*Remote code:* **No, I am not using remote code.** All JavaScript is packaged in the extension. The code users type is parsed into JSON (an Odoo call_kw request) and sent to their own Odoo server; it is never evaluated as JavaScript.

*Data usage:* collects none of the listed data types. Tick the three certifications.

*Privacy policy URL:* see above.

**Distribution:** Public, all regions (or Unlisted to share by link only).

---

## Firefox Add-ons (https://addons.mozilla.org/developers/)

**Submit a New Add-on → On this site** (listed) → upload `dist/odex-<version>-firefox.zip`.

- Compatibility: Firefox (desktop), minimum 128 (from the manifest)
- Source code: **not needed**. Nothing is minified, transpiled or bundled; the package is the source.
- Summary / description / homepage / support / license (MIT) / privacy policy: as above
- Categories: *Web Development*, *Other*
- Tags: odoo, odoo orm, odoo shell, erp, orm, developer tools, json-rpc
- Screenshots: the same PNGs

**Notes to reviewer:**
```
odeX needs an Odoo web client where you are logged in (https://www.odoo.com/trial gives a free instance, or runbot.odoo.com).
To test: log in to Odoo, click the odeX toolbar button (or Alt+Shift+X), then run for example
    res.partner.search_read([], ['name', 'email'], limit=5)

- The panel is injected on demand with scripting.executeScript (activeTab only); there are no host permissions and no persistent content scripts.
- The text the user types is parsed by src/shared/pyparse.js (a small tokenizer/parser) into a JSON-RPC request; nothing is evaluated as JavaScript (no eval / Function). The panel's fixed markup is one constant string parsed with DOMParser; all server data and user input is rendered with textContent / createElement.
- All network requests go to the Odoo origin of the current tab (/web/session/get_session_info and /web/dataset/call_kw), with the user's own session, via content.fetch in Firefox. No remote code, no analytics, no third-party services.
- Methods that may change data ask for confirmation before they are sent.
- The source is not minified; tests are in tests/ of https://github.com/odoomates/odex.
```
