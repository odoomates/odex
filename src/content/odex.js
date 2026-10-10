/* odeX: the ORM box.
 *
 * Injected on demand (toolbar button / shortcut) into the active tab. Draws a
 * floating panel in a shadow root and runs ORM calls through the page's own
 * Odoo session (`/web/dataset/call_kw`), so every call runs as the logged-in
 * user with their access rights. Running it again toggles the panel.
 */
(() => {
  "use strict";

  if (globalThis.__odex) {
    globalThis.__odex.toggle();
    return;
  }

  const api = globalThis.browser || globalThis.chrome;
  const { parseCommand, pyRepr, formatCommand, ParseError } = globalThis.OdexParse;

  // Methods that don't change data. Anything else asks for confirmation (when enabled).
  const READONLY = new Set([
    "search", "search_read", "search_fetch", "search_count", "read", "read_group", "formatted_read_group",
    "web_search_read", "web_read", "web_read_group", "fields_get", "name_search", "name_get", "default_get",
    "exists", "get_views", "get_view", "fields_view_get", "load_views", "check_access_rights", "has_access",
    "check_access", "check_access_rule", "get_formview_id", "get_formview_action", "get_empty_list_help",
    "read_progress_bar", "search_panel_select_range", "search_panel_select_multi_range", "get_metadata",
    "web_name_search", "get_param", "fields_get_keys", "check_field_access_rights",
  ]);

  const METHODS = [
    ["search_read", "(domain, fields, offset=0, limit=None, order=None)"],
    ["search", "(domain, offset=0, limit=None, order=None)"],
    ["search_count", "(domain)"],
    ["read", "(fields)  · after browse(ids)"],
    ["fields_get", "(allfields=None, attributes=None)"],
    ["name_search", "(name='', domain=None, operator='ilike', limit=100)"],
    ["read_group", "(domain, fields, groupby, ...)"],
    ["formatted_read_group", "(domain, groupby, aggregates, ...)"],
    ["web_search_read", "(domain, specification, ...)"],
    ["web_read", "(specification)  · after browse(ids)"],
    ["default_get", "(fields)"],
    ["create", "(vals | [vals, ...])"],
    ["write", "(vals)  · after browse(ids)"],
    ["unlink", "()  · after browse(ids)"],
    ["copy", "(default=None)  · after browse(ids)"],
    ["exists", "()  · after browse(ids)"],
    ["has_access", "(operation)  · after browse(ids)"],
    ["check_access_rights", "(operation, raise_exception=True)"],
    ["get_views", "(views, options=None)"],
    ["browse", "(ids)  · target records"],
    ["with_context", "(**ctx)  · extra context"],
    ["with_company", "(company_id)"],
  ];

  const SNIPPETS = [
    ["Search & read", "res.partner.search_read([('is_company', '=', True)], ['name', 'email', 'country_id'], limit=10)"],
    ["Count", "res.partner.search_count([('customer_rank', '>', 0)])"],
    ["Read records", "res.partner.browse([1, 2, 3]).read(['name', 'email'])"],
    ["Fields of a model", "res.partner.fields_get(attributes=['string', 'type', 'relation', 'required'])"],
    ["Name search", "res.partner.name_search('admin', limit=5)"],
    ["Archived too", "res.partner.with_context(active_test=False).search_count([])"],
    ["Current user", "res.users.browse(uid).read(['name', 'login', 'company_id', 'group_ids'])"],
    ["Installed modules", "ir.module.module.search_read([('state', '=', 'installed')], ['name', 'shortdesc', 'installed_version'], order='name')"],
    ["System parameters", "ir.config_parameter.search_read([], ['key', 'value'])"],
    ["Model info", "ir.model.search_read([('model', '=', 'res.partner')], ['name', 'model', 'modules', 'transient'])"],
    ["Use last result", "res.partner.browse(_).read(['display_name'])"],
    ["Create", "res.partner.create({'name': 'odeX test partner'})"],
    ["Write", "res.partner.browse(_).write({'comment': 'Updated from odeX'})"],
    ["Delete", "res.partner.browse(_).unlink()"],
  ];

  const DEFAULTS = { confirmWrites: true, userContext: true, theme: "auto" };
  const HISTORY_MAX = 200;
  // What a fresh box starts with: run it to see who you are on this database.
  // Odoo 19 renamed res.users.groups_id to group_ids; connect() fixes the name on older versions.
  const prefillCode = (groups = "group_ids") => `res.users.browse(uid).read(['name', 'login', 'company_id', '${groups}'])`;
  const TREE_CHUNK = 100;
  const TABLE_MAX = 1000;
  const K = { settings: "odex.settings", history: "odex.history", geometry: "odex.geometry", draft: "odex.draft" };

  // Firefox content scripts must use content.fetch to send the page's cookies/origin.
  /* global content */
  const pageFetch =
    typeof content !== "undefined" && content && typeof content.fetch === "function"
      ? content.fetch.bind(content)
      : window.fetch.bind(window);

  // ---------------------------------------------------------------------------
  // storage helpers (never let a storage failure break the panel)
  const store = {
    async get(key, fallback) {
      try {
        const out = await api.storage.local.get(key);
        return out[key] === undefined ? fallback : out[key];
      } catch {
        return fallback;
      }
    },
    async set(key, value) {
      try {
        await api.storage.local.set({ [key]: value });
      } catch {
        /* ignore */
      }
    },
  };

  // ---------------------------------------------------------------------------
  // RPC
  class OdexError extends Error {
    constructor(title, message, extra = {}) {
      super(message || title);
      this.title = title;
      Object.assign(this, extra);
    }
  }

  let rpcSeq = 0;
  async function rpc(route, params) {
    let res;
    try {
      res = await pageFetch(new URL(route, location.origin).href, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "call", id: ++rpcSeq, params }),
      });
    } catch (e) {
      throw new OdexError("Network error", String(e && e.message ? e.message : e));
    }
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      const hint = res.status === 404 ? "This page doesn't look like an Odoo instance." : text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 300);
      throw new OdexError(`HTTP ${res.status}`, hint);
    }
    if (data.error) {
      const d = data.error.data || {};
      const name = d.name || "";
      const sessionExpired = data.error.code === 100 || /SessionExpired/.test(name);
      throw new OdexError(
        sessionExpired ? "Session expired" : shortName(name) || data.error.message || "Server error",
        sessionExpired ? "Log in to Odoo in this tab and try again." : d.message || data.error.message,
        { name, debug: d.debug, sessionExpired },
      );
    }
    return data.result;
  }

  function shortName(name) {
    return (name || "").split(".").pop();
  }

  // ---------------------------------------------------------------------------
  // state
  const state = {
    settings: { ...DEFAULTS },
    history: [],
    histPos: -1,
    histDraft: "",
    session: null,
    models: null, // [{model, name}]
    modelSet: new Set(),
    results: [], // previous results, newest first, exposed as _ / __
    current: null, // {kind: "ok"|"error", ...}
    view: "tree",
    pending: null, // command waiting for confirmation
    running: false,
  };

  // ---------------------------------------------------------------------------
  // DOM
  const host = document.createElement("odex-root");
  host.style.cssText = "all: initial; position: fixed; z-index: 2147483646; top: 0; left: 0; width: 0; height: 0;";
  const shadow = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = globalThis.ODEX_CSS || "";
  shadow.append(style);

  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
  const MOD = isMac ? "⌘" : "Ctrl";

  const SKELETON = `
<div class="panel" role="dialog" aria-label="odeX ORM box">
  <header>
    <span class="logo">ode<b>X</b></span>
    <span class="conn" title=""><span class="dot"></span><span class="conn-text">Connecting…</span></span>
    <button type="button" data-act="history" title="History (Alt+↑/↓ in the editor)" aria-label="History">⟲</button>
    <button type="button" data-act="settings" title="Settings" aria-label="Settings">⚙</button>
    <button type="button" data-act="minimize" title="Minimize" aria-label="Minimize">–</button>
    <button type="button" data-act="close" title="Close (toolbar button or Alt+Shift+X to reopen)" aria-label="Close">×</button>
  </header>
  <div class="editor-wrap">
    <textarea spellcheck="false" autocapitalize="off" autocomplete="off" aria-label="ORM expression"
      placeholder="res.partner.search_read([('is_company', '=', True)], ['name', 'email'], limit=10)"></textarea>
    <ul class="complete" role="listbox" hidden></ul>
  </div>
  <div class="toolbar">
    <button type="button" class="btn primary" data-act="run" title="Run (Enter or ${MOD}+Enter; Shift+Enter for a new line). Runs the selection if there is one.">▶ Run <kbd>↵</kbd></button>
    <select class="btn" data-act="snippet" aria-label="Insert example">
      <option value="">Examples…</option>
    </select>
    <span class="spacer"></span>
    <span class="hint">Tab completes models &amp; methods · <code>_</code> = last result · <code>uid</code></span>
  </div>
  <div class="confirm" hidden>
    <span class="msg"></span>
    <button type="button" class="btn danger" data-act="confirm-run">Run it</button>
    <button type="button" class="btn" data-act="confirm-cancel">Cancel</button>
  </div>
  <div class="result-bar">
    <div class="tabs" role="tablist">
      <button type="button" class="tab" data-view="tree" role="tab">Tree</button>
      <button type="button" class="tab" data-view="table" role="tab">Table</button>
      <button type="button" class="tab" data-view="json" role="tab">JSON</button>
      <button type="button" class="tab" data-view="python" role="tab">Python</button>
    </div>
    <span class="meta"></span>
    <button type="button" class="icon-btn" data-act="copy" title="Copy result">Copy</button>
  </div>
  <div class="output" tabindex="0"></div>
  <section class="sheet" data-sheet="history" hidden>
    <h3>History <button type="button" class="icon-btn" data-act="sheet-close" aria-label="Close history">×</button></h3>
    <input type="search" placeholder="Filter history…" aria-label="Filter history">
    <div class="body"></div>
    <div class="foot"><button type="button" class="btn" data-act="history-clear">Clear history</button></div>
  </section>
  <section class="sheet" data-sheet="settings" hidden>
    <h3>Settings <button type="button" class="icon-btn" data-act="sheet-close" aria-label="Close settings">×</button></h3>
    <div class="body">
      <label class="setting"><input type="checkbox" data-setting="confirmWrites">
        <span>Confirm before changing data<small>Ask before running any method that isn't known to be read-only (create, write, unlink, actions…).</small></span></label>
      <label class="setting"><input type="checkbox" data-setting="userContext">
        <span>Send the user's context<small>Adds the user's lang, tz and current companies to every call, like the web client does.</small></span></label>
      <div class="field"><label for="odex-theme">Theme</label>
        <select id="odex-theme" data-setting="theme">
          <option value="auto">Follow system</option><option value="light">Light</option><option value="dark">Dark</option>
        </select></div>
    </div>
  </section>
  <div class="toast" role="status" aria-live="polite"></div>
</div>`;

  const doc = new DOMParser().parseFromString(SKELETON, "text/html");
  shadow.append(...doc.body.childNodes);
  const $ = (sel) => shadow.querySelector(sel);
  const panel = $(".panel");
  const editor = $("textarea");
  const completeEl = $(".complete");
  const output = $(".output");
  const meta = $(".meta");
  const confirmBar = $(".confirm");
  const connEl = $(".conn");
  const snippetSel = $('[data-act="snippet"]');

  for (const [label, code] of SNIPPETS) {
    const opt = document.createElement("option");
    opt.value = code;
    opt.textContent = label;
    snippetSel.append(opt);
  }

  // Keep the host page (and Odoo's hotkeys) from reacting to keys typed in the panel.
  for (const type of ["keydown", "keyup", "keypress", "input"]) {
    host.addEventListener(type, (e) => e.stopPropagation());
  }

  // Tiny element builder.
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v === undefined || v === null || v === false) continue;
        if (k === "class") el.className = v;
        else if (k === "text") el.textContent = v;
        else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? "" : v);
      }
    }
    for (const c of children.flat()) {
      if (c === null || c === undefined || c === false) continue;
      el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
  }

  // ---------------------------------------------------------------------------
  // theme & geometry
  const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
  function applyTheme() {
    const t = state.settings.theme;
    host.setAttribute("data-theme", t === "auto" ? (darkQuery.matches ? "dark" : "light") : t);
  }
  darkQuery.addEventListener("change", applyTheme);

  function defaultGeometry() {
    const width = Math.min(680, window.innerWidth - 32);
    const height = Math.min(500, window.innerHeight - 32);
    return { left: window.innerWidth - width - 16, top: window.innerHeight - height - 16, width, height };
  }

  function setGeometry(g) {
    const width = Math.max(380, Math.min(g.width, window.innerWidth));
    const height = Math.max(260, Math.min(g.height, window.innerHeight));
    const left = Math.max(0, Math.min(g.left, window.innerWidth - Math.min(width, 120)));
    const top = Math.max(0, Math.min(g.top, window.innerHeight - 36));
    Object.assign(panel.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` });
  }

  function currentGeometry() {
    const r = panel.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: panel.classList.contains("min") ? parseFloat(panel.style.height) || r.height : r.height };
  }

  let geoTimer;
  function saveGeometry() {
    clearTimeout(geoTimer);
    geoTimer = setTimeout(() => store.set(K.geometry, currentGeometry()), 300);
  }

  // drag by header
  $("header").addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || e.target.closest("button")) return;
    const start = panel.getBoundingClientRect();
    const dx = e.clientX - start.left;
    const dy = e.clientY - start.top;
    const header = e.currentTarget;
    header.setPointerCapture(e.pointerId);
    const move = (ev) => {
      const left = Math.max(0, Math.min(ev.clientX - dx, window.innerWidth - 120));
      const top = Math.max(0, Math.min(ev.clientY - dy, window.innerHeight - 36));
      panel.style.left = `${left}px`;
      panel.style.top = `${top}px`;
    };
    const up = () => {
      header.removeEventListener("pointermove", move);
      header.removeEventListener("pointerup", up);
      header.removeEventListener("pointercancel", up);
      saveGeometry();
    };
    header.addEventListener("pointermove", move);
    header.addEventListener("pointerup", up);
    header.addEventListener("pointercancel", up);
  });
  $("header").addEventListener("dblclick", (e) => {
    if (!e.target.closest("button")) toggleMinimize();
  });
  new ResizeObserver(() => {
    if (!panel.classList.contains("min") && panel.isConnected) saveGeometry();
  }).observe(panel);
  window.addEventListener("resize", () => setGeometry(currentGeometry()));

  function toggleMinimize() {
    const min = panel.classList.toggle("min");
    if (min) {
      panel.dataset.height = panel.style.height;
      panel.style.height = "auto";
    } else {
      panel.style.height = panel.dataset.height || "460px";
      editor.focus();
    }
  }

  // ---------------------------------------------------------------------------
  // connection
  function cookie(name) {
    const m = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
    return m ? decodeURIComponent(m[1]) : null;
  }

  function userContext() {
    const ctx = { ...((state.session && state.session.user_context) || {}) };
    // The web client keeps the selected companies in the `cids` cookie ("1-3" or "1,3").
    const cids = cookie("cids");
    if (cids) {
      const ids = cids.split(/[-,]/).map(Number).filter(Number.isInteger);
      if (ids.length) ctx.allowed_company_ids = ids;
    }
    return ctx;
  }

  function setConn(kind, text, title) {
    connEl.className = `conn ${kind}`;
    connEl.querySelector(".conn-text").textContent = text;
    connEl.title = title || text;
  }

  async function connect() {
    setConn("", "Connecting…");
    try {
      const info = await rpc("/web/session/get_session_info", {});
      if (!info || !info.uid) throw new OdexError("Not logged in", "Log in to Odoo in this tab, then reopen odeX.");
      state.session = info;
      const version = info.server_version || (info.server_version_info || []).slice(0, 2).join(".");
      const who = info.username || info.name || `uid ${info.uid}`;
      setConn("ok", `${info.db || location.host} · ${who}${version ? ` · ${version}` : ""}`,
        `Database: ${info.db}\nUser: ${info.name} (${info.username}, uid ${info.uid})\nOdoo ${version}\n${location.origin}`);
      loadModels();
      fixPrefill();
    } catch (e) {
      state.session = null;
      setConn("err", e.title === "Network error" || /^HTTP/.test(e.title) ? "Not an Odoo page?" : e.title, `${e.title}: ${e.message}`);
    }
  }

  // Before Odoo 19 the field was groups_id: keep the untouched prefill runnable there too.
  async function fixPrefill() {
    if (editor.value !== prefillCode()) return;
    try {
      const fields = await rpc("/web/dataset/call_kw/res.users/fields_get", {
        model: "res.users",
        method: "fields_get",
        args: [["group_ids", "groups_id"]],
        kwargs: { attributes: ["type"], context: userContext() },
      });
      if (!fields.group_ids && fields.groups_id && editor.value === prefillCode()) editor.value = prefillCode("groups_id");
    } catch {
      // keep the prefill as is
    }
  }

  async function loadModels() {
    try {
      const rows = await rpc("/web/dataset/call_kw/ir.model/search_read", {
        model: "ir.model",
        method: "search_read",
        args: [[], ["model", "name"]],
        kwargs: { order: "model", context: userContext() },
      });
      state.models = rows.map((r) => ({ model: r.model, name: r.name }));
      state.modelSet = new Set(state.models.map((m) => m.model));
      // The user may have started typing a model name before the list arrived.
      if (shadow.activeElement === editor) updateComplete(false);
    } catch {
      state.models = []; // no access to ir.model: completion just won't offer models
    }
  }

  // ---------------------------------------------------------------------------
  // running
  function vars() {
    const v = {};
    if (state.session) v.uid = state.session.uid;
    if (state.results.length) v._ = state.results[0];
    if (state.results.length > 1) v.__ = state.results[1];
    return v;
  }

  function codeToRun() {
    const { selectionStart: s, selectionEnd: e, value } = editor;
    return s !== e ? value.slice(s, e) : value;
  }

  // True when the text has an unclosed ( [ { outside of string literals.
  function hasOpenBracket(text) {
    let depth = 0;
    let quote = null;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quote) {
        if (c === "\\") i++;
        else if (c === quote) quote = null;
      } else if (c === "'" || c === '"') quote = c;
      else if (c === "#") while (i < text.length && text[i] !== "\n") i++;
      else if ("([{".includes(c)) depth++;
      else if (")]}".includes(c)) depth--;
    }
    return depth > 0;
  }

  function run() {
    if (state.running) return;
    hideComplete();
    const src = codeToRun().trim();
    let cmd;
    try {
      cmd = parseCommand(src, vars());
    } catch (e) {
      if (!(e instanceof ParseError)) throw e;
      showError({ title: "Syntax error", message: e.message, caret: caretLine(src, e.pos) });
      return;
    }
    if (state.settings.confirmWrites && !READONLY.has(cmd.method)) {
      askConfirm(cmd, src);
      return;
    }
    execute(cmd, src);
  }

  function caretLine(src, pos) {
    const lineStart = src.lastIndexOf("\n", pos - 1) + 1;
    let lineEnd = src.indexOf("\n", pos);
    if (lineEnd < 0) lineEnd = src.length;
    const line = src.slice(lineStart, lineEnd);
    return `${line}\n${" ".repeat(Math.max(0, pos - lineStart))}^`;
  }

  function askConfirm(cmd, src) {
    state.pending = { cmd, src };
    const msg = confirmBar.querySelector(".msg");
    const target = cmd.ids ? `${cmd.ids.length} record${cmd.ids.length === 1 ? "" : "s"}` : "the model";
    const db = state.session ? state.session.db : location.host;
    msg.replaceChildren(
      h("strong", { text: `${cmd.method}()` }),
      ` may change data on ${target} in `,
      h("strong", { text: db }),
      ". ",
      h("code", { text: truncate(formatCommand(cmd), 240) }),
    );
    confirmBar.hidden = false;
    confirmBar.querySelector('[data-act="confirm-run"]').focus();
  }

  function cancelConfirm() {
    state.pending = null;
    confirmBar.hidden = true;
    editor.focus();
  }

  async function execute(cmd, src) {
    confirmBar.hidden = true;
    state.pending = null;
    state.running = true;
    const runBtn = $('[data-act="run"]');
    runBtn.disabled = true;
    meta.replaceChildren(h("span", { class: "spin" }), " running ", h("code", { text: `${cmd.model}.${cmd.method}` }));

    const kwContext = cmd.kwargs.context && typeof cmd.kwargs.context === "object" ? cmd.kwargs.context : {};
    const context = { ...(state.settings.userContext ? userContext() : {}), ...cmd.context, ...kwContext };
    const params = {
      model: cmd.model,
      method: cmd.method,
      args: cmd.ids ? [cmd.ids, ...cmd.args] : cmd.args,
      kwargs: { ...cmd.kwargs, context },
    };
    const t0 = performance.now();
    let entry;
    try {
      const result = await rpc(`/web/dataset/call_kw/${cmd.model}/${cmd.method}`, params);
      const ms = Math.round(performance.now() - t0);
      state.results.unshift(result === undefined ? null : result);
      state.results.length = Math.min(state.results.length, 2);
      showResult(result, ms, cmd);
      entry = { ok: true, ms, summary: summarize(result) };
    } catch (e) {
      const ms = Math.round(performance.now() - t0);
      showError({ title: e.title || "Error", name: e.name, message: e.message, debug: e.debug, ms });
      entry = { ok: false, ms, summary: e.title };
      if (e.sessionExpired) connect();
    } finally {
      state.running = false;
      runBtn.disabled = false;
    }
    pushHistory({ code: src, at: Date.now(), origin: location.origin, db: state.session && state.session.db, ...entry });
  }

  function summarize(v) {
    if (Array.isArray(v)) return `${v.length} item${v.length === 1 ? "" : "s"}`;
    if (v && typeof v === "object") return `${Object.keys(v).length} keys`;
    return truncate(JSON.stringify(v === undefined ? null : v), 40);
  }

  function truncate(s, n) {
    return s.length > n ? `${s.slice(0, n - 1)}…` : s;
  }

  // ---------------------------------------------------------------------------
  // results
  function isRecordList(v) {
    return Array.isArray(v) && v.length > 0 && v.every((r) => r && typeof r === "object" && !Array.isArray(r));
  }

  function tableable(v) {
    return Array.isArray(v) ? v.length > 0 : !!v && typeof v === "object" && Object.keys(v).length > 0;
  }

  function showResult(value, ms, cmd) {
    state.current = { kind: "ok", value, ms, cmd };
    // Keep JSON/Python if the user picked it; otherwise records go to a table, anything else to the tree.
    if (state.view !== "json" && state.view !== "python") state.view = isRecordList(value) ? "table" : "tree";
    const parts = [h("span", { class: "ok", text: "✓" }), ` ${cmd.model}.${cmd.method} · ${describeValue(value)} · ${ms} ms`];
    meta.replaceChildren(...parts);
    meta.title = formatCommand(cmd);
    renderOutput();
  }

  function describeValue(v) {
    if (v === null || v === undefined) return "None";
    if (Array.isArray(v)) return `list[${v.length}]`;
    if (typeof v === "object") return `dict{${Object.keys(v).length}}`;
    return typeof v === "boolean" ? "bool" : typeof v === "number" ? (Number.isInteger(v) ? "int" : "float") : "str";
  }

  function showError(err) {
    state.current = { kind: "error", ...err };
    meta.replaceChildren(h("span", { class: "err", text: "✕" }), ` ${err.title}${err.ms !== undefined ? ` · ${err.ms} ms` : ""}`);
    meta.title = "";
    renderOutput();
  }

  function renderOutput() {
    const cur = state.current;
    for (const tab of shadow.querySelectorAll(".tab")) {
      tab.classList.toggle("active", !!cur && cur.kind === "ok" && tab.dataset.view === state.view);
      tab.disabled = !cur || cur.kind !== "ok" || (tab.dataset.view === "table" && !tableable(cur.value));
      tab.setAttribute("aria-selected", tab.classList.contains("active"));
    }
    $('[data-act="copy"]').hidden = !cur;
    if (!cur) {
      output.replaceChildren(emptyState());
      return;
    }
    if (cur.kind === "error") {
      output.replaceChildren(renderError(cur));
      return;
    }
    const v = cur.value;
    let node;
    if (state.view === "table") node = renderTable(v);
    else if (state.view === "json") node = h("pre", { class: "raw", text: JSON.stringify(v === undefined ? null : v, null, 2) });
    else if (state.view === "python") node = h("pre", { class: "raw", text: pyRepr(v) });
    else node = h("ul", { class: "tree" }, treeNode(null, v, true));
    output.replaceChildren(node);
    output.scrollTop = 0;
  }

  function emptyState() {
    const ex = (code) => h("li", null, h("code", { text: code }));
    return h("div", { class: "empty" },
      "Write an ORM call and press ", h("strong", { text: "Enter" }), " (", h("strong", { text: "Shift+Enter" }), " for a new line). It runs as you, in this Odoo tab.",
      h("ul", null,
        ex("res.partner.search_read([('is_company', '=', True)], ['name'], limit=5)"),
        ex("res.partner.browse([1, 2]).read(['name', 'email'])"),
        ex("env['sale.order'].search_count([('state', '=', 'sale')])"),
        ex("res.partner.with_context(lang='fr_FR').fields_get(['name'])"),
      ),
    );
  }

  function renderError(err) {
    const box = h("div", { class: "error" },
      err.name ? h("div", { class: "kind", text: err.name }) : null,
      h("div", { class: "title", text: err.title }),
      err.message ? h("div", { class: "message", text: err.message }) : null,
      err.caret ? h("pre", { class: "caret", text: err.caret }) : null,
    );
    if (err.debug) box.append(h("details", null, h("summary", { text: "Traceback" }), h("pre", { text: err.debug })));
    return box;
  }

  // Tree view: children are rendered lazily when a node is opened.
  function treeNode(key, value, open) {
    const keyEl = key === null ? null : [h("span", { class: "k", text: key }), h("span", { class: "c", text: ": " })];
    if (value === null || typeof value !== "object") {
      return h("li", { class: "leaf" }, keyEl, scalar(value));
    }
    const isArr = Array.isArray(value);
    const keys = isArr ? null : Object.keys(value);
    const size = isArr ? value.length : keys.length;
    if (!size) return h("li", { class: "leaf" }, keyEl, h("span", { class: "c", text: isArr ? "[]" : "{}" }));
    const label = isArr ? `list[${size}]` : `{${size}}`;
    const preview = previewOf(value);
    const details = h("details", null,
      h("summary", null, keyEl, h("span", { class: "c", text: label }), preview ? h("span", { class: "c", text: `  ${preview}` }) : null));
    let filled = false;
    const fill = () => {
      if (filled) return;
      filled = true;
      const ul = h("ul");
      details.append(ul);
      let shown = 0;
      const more = () => {
        const end = Math.min(size, shown + TREE_CHUNK);
        for (; shown < end; shown++) {
          const k = isArr ? String(shown) : keys[shown];
          ul.append(treeNode(k, isArr ? value[shown] : value[k], false));
        }
        if (shown < size) {
          ul.append(h("li", null, h("button", {
            class: "more",
            type: "button",
            text: `show ${Math.min(TREE_CHUNK, size - shown)} more of ${size - shown}…`,
            onclick: (e) => { e.currentTarget.closest("li").remove(); more(); },
          })));
        }
      };
      more();
    };
    details.addEventListener("toggle", () => details.open && fill());
    if (open) {
      details.open = true;
      fill();
    }
    return h("li", null, details);
  }

  function previewOf(v) {
    if (Array.isArray(v)) {
      if (v.length === 2 && Number.isInteger(v[0]) && typeof v[1] === "string") return `${v[1]} (#${v[0]})`;
      return "";
    }
    const name = v.display_name || v.name;
    const bits = [];
    if (v.id !== undefined) bits.push(`#${v.id}`);
    if (typeof name === "string") bits.push(name);
    else if (typeof v.string === "string") bits.push(`${v.string}${v.type ? ` · ${v.type}` : ""}`);
    return truncate(bits.join(" "), 80);
  }

  function scalar(v) {
    if (v === null || v === undefined) return h("span", { class: "z", text: "None" });
    if (typeof v === "boolean") return h("span", { class: "b", text: v ? "True" : "False" });
    if (typeof v === "number") return h("span", { class: "n", text: String(v) });
    return h("span", { class: "s", text: pyRepr(v) });
  }

  function renderTable(v) {
    const frag = document.createDocumentFragment();
    let rows;
    let cols;
    if (Array.isArray(v)) {
      if (isRecordList(v)) {
        const set = new Set();
        for (const r of v.slice(0, TABLE_MAX)) for (const k of Object.keys(r)) set.add(k);
        cols = [...set];
        // id first, then the order Odoo returned.
        if (cols.includes("id")) cols = ["id", ...cols.filter((c) => c !== "id")];
        rows = v;
      } else {
        cols = ["#", "value"];
        rows = v.map((x, i) => ({ "#": i, value: x }));
      }
    } else {
      const entries = Object.entries(v);
      // fields_get / dict of dicts: one row per key with the inner keys as columns.
      if (entries.every(([, x]) => x && typeof x === "object" && !Array.isArray(x))) {
        const set = new Set();
        for (const [, x] of entries.slice(0, TABLE_MAX)) for (const k of Object.keys(x)) set.add(k);
        cols = ["key", ...set];
        rows = entries.map(([k, x]) => ({ key: k, ...x }));
      } else {
        cols = ["key", "value"];
        rows = entries.map(([k, x]) => ({ key: k, value: x }));
      }
    }
    const shown = rows.slice(0, TABLE_MAX);
    const table = h("table", null,
      h("thead", null, h("tr", null, cols.map((c) => h("th", { text: c })))),
      h("tbody", null, shown.map((r) => h("tr", null, cols.map((c) => cell(r[c]))))),
    );
    frag.append(table);
    if (rows.length > shown.length) frag.append(h("div", { class: "note", text: `Showing ${shown.length} of ${rows.length} rows. Use JSON or Python to see everything.` }));
    return frag;
  }

  function cell(v) {
    if (v === undefined) return h("td");
    if (typeof v === "number") return h("td", { class: "num", text: String(v) });
    if (v === null || v === false) return h("td", null, scalar(v));
    if (v === true) return h("td", null, scalar(v));
    if (Array.isArray(v)) {
      // many2one: [id, "name"]
      if (v.length === 2 && Number.isInteger(v[0]) && typeof v[1] === "string") {
        return h("td", null, v[1], " ", h("span", { class: "m2o", text: `#${v[0]}` }));
      }
      return h("td", { text: truncate(JSON.stringify(v), 300), title: v.length > 20 ? `${v.length} items` : null });
    }
    if (typeof v === "object") return h("td", { text: truncate(JSON.stringify(v), 300) });
    return h("td", { text: truncate(v, 1000) });
  }

  // ---------------------------------------------------------------------------
  // clipboard & toast
  let toastTimer;
  function toast(msg) {
    const t = $(".toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 1400);
  }

  async function copy() {
    const cur = state.current;
    if (!cur) return;
    let text;
    if (cur.kind === "error") text = [cur.name, cur.title, cur.message, cur.debug].filter(Boolean).join("\n");
    else if (state.view === "python") text = pyRepr(cur.value);
    else text = JSON.stringify(cur.value === undefined ? null : cur.value, null, 2);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = h("textarea", { style: "position:fixed;opacity:0" });
      ta.value = text;
      shadow.append(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    toast("Copied");
  }

  // ---------------------------------------------------------------------------
  // history
  function pushHistory(entry) {
    if (state.history[0] && state.history[0].code === entry.code) state.history.shift();
    state.history.unshift(entry);
    state.history.length = Math.min(state.history.length, HISTORY_MAX);
    state.histPos = -1;
    store.set(K.history, state.history);
    if (!$('[data-sheet="history"]').hidden) renderHistory();
  }

  function renderHistory() {
    const body = $('[data-sheet="history"] .body');
    const q = $('[data-sheet="history"] input').value.trim().toLowerCase();
    const items = state.history.filter((e) => !q || e.code.toLowerCase().includes(q));
    if (!items.length) {
      body.replaceChildren(h("div", { class: "empty", text: state.history.length ? "No match." : "Nothing run yet." }));
      return;
    }
    body.replaceChildren(...items.map((e) => h("button", {
      type: "button",
      class: "hist-item",
      title: e.code,
      onclick: () => {
        setEditor(e.code);
        closeSheets();
      },
    },
    h("span", { class: "code", text: e.code }),
    h("span", { class: "when" },
      e.ok ? "" : h("span", { class: "err", text: "✕ " }),
      `${timeAgo(e.at)} · ${e.db || hostOf(e.origin)} · ${e.summary || ""}${e.ms !== undefined ? ` · ${e.ms} ms` : ""}`))));
  }

  function hostOf(origin) {
    try {
      return new URL(origin).host;
    } catch {
      return "";
    }
  }

  function timeAgo(t) {
    const s = Math.round((Date.now() - t) / 1000);
    if (s < 60) return "just now";
    if (s < 3600) return `${Math.floor(s / 60)} min ago`;
    if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
    return new Date(t).toLocaleDateString();
  }

  function historyStep(dir) {
    if (!state.history.length) return;
    if (state.histPos === -1) state.histDraft = editor.value;
    const pos = Math.max(-1, Math.min(state.history.length - 1, state.histPos + dir));
    if (pos === state.histPos) return;
    state.histPos = pos;
    setEditor(pos === -1 ? state.histDraft : state.history[pos].code, true);
  }

  function setEditor(code, keepHist) {
    editor.value = code;
    editor.focus();
    editor.setSelectionRange(code.length, code.length);
    if (!keepHist) state.histPos = -1;
    saveDraft();
  }

  let draftTimer;
  function saveDraft() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => store.set(K.draft, editor.value), 400);
  }

  // ---------------------------------------------------------------------------
  // sheets & settings
  function openSheet(name) {
    const sheet = $(`[data-sheet="${name}"]`);
    const wasOpen = !sheet.hidden;
    closeSheets();
    if (wasOpen) return;
    sheet.hidden = false;
    if (name === "history") {
      renderHistory();
      sheet.querySelector("input").focus();
    } else {
      for (const input of sheet.querySelectorAll("[data-setting]")) {
        const v = state.settings[input.dataset.setting];
        if (input.type === "checkbox") input.checked = !!v;
        else input.value = v;
      }
      sheet.querySelector("[data-setting]").focus();
    }
  }

  function closeSheets() {
    for (const s of shadow.querySelectorAll(".sheet")) s.hidden = true;
  }

  $('[data-sheet="settings"]').addEventListener("change", (e) => {
    const input = e.target.closest("[data-setting]");
    if (!input) return;
    state.settings[input.dataset.setting] = input.type === "checkbox" ? input.checked : input.value;
    store.set(K.settings, state.settings);
    applyTheme();
  });
  $('[data-sheet="history"] input').addEventListener("input", renderHistory);

  // ---------------------------------------------------------------------------
  // completion
  const comp = { items: [], active: 0, from: 0, to: 0 };

  function suggestions() {
    const pos = editor.selectionStart;
    if (pos !== editor.selectionEnd) return null;
    const before = editor.value.slice(0, pos);
    const m = /[\w.]*$/.exec(before);
    const token = m[0];
    const head = before.slice(0, before.length - token.length);
    const startOfExpr = /^\s*((self\.)?env\[\s*['"])?$/.test(head);
    const quotedModel = /env\[\s*['"]$/.test(head);
    const items = [];
    const models = state.models || [];

    if (startOfExpr) {
      const dot = token.lastIndexOf(".");
      const prefix = token.slice(0, dot);
      const rest = token.slice(dot + 1);
      // "res.partner." / "res.partner.sea" -> methods
      if (!quotedModel && dot > 0 && state.modelSet.has(prefix)) {
        items.push(...methodItems(rest, pos - rest.length));
      }
      if (token.length >= 1) {
        const q = token.toLowerCase();
        const scored = [];
        for (const mdl of models) {
          const name = mdl.model;
          if (name === token) continue;
          const idx = name.indexOf(q);
          const nameIdx = mdl.name.toLowerCase().indexOf(q);
          if (idx < 0 && nameIdx < 0) continue;
          scored.push([idx === 0 ? 0 : idx > 0 ? 1 : 2, name.length, mdl]);
        }
        scored.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
        for (const [, , mdl] of scored.slice(0, 30)) {
          items.push({ label: mdl.model, detail: mdl.name, from: pos - token.length, insert: mdl.model + (quotedModel ? "" : ".") });
        }
      }
      return items.length ? items : null;
    }

    // After "browse(1)." or "env['res.partner'].": methods
    const chained = /[)\]]\s*\.(\w*)$/.exec(before);
    if (chained) {
      const list = methodItems(chained[1], pos - chained[1].length);
      return list.length ? list : null;
    }
    return null;
  }

  function methodItems(q, from) {
    const lq = q.toLowerCase();
    return METHODS.filter(([name]) => name.startsWith(lq) && name !== q)
      .concat(lq ? METHODS.filter(([name]) => !name.startsWith(lq) && name.includes(lq)) : [])
      .map(([name, sig]) => ({ label: name, detail: sig, from, insert: `${name}(` }));
  }

  function updateComplete(force) {
    const items = suggestions();
    const typed = /[\w.]*$/.exec(editor.value.slice(0, editor.selectionStart))[0];
    if (!items || (!force && !typed)) {
      hideComplete();
      return;
    }
    comp.items = items;
    comp.active = 0;
    comp.to = editor.selectionStart;
    completeEl.replaceChildren(...items.map((it, i) => h("li", {
      role: "option",
      class: i === 0 ? "active" : "",
      onmousedown: (e) => {
        e.preventDefault();
        comp.active = i;
        acceptComplete();
      },
    }, h("span", { text: it.label }), h("small", { text: it.detail || "" }))));
    positionComplete();
    completeEl.hidden = false;
  }

  function positionComplete() {
    // Approximate the caret position using a mirror element.
    const mirror = h("div");
    const cs = getComputedStyle(editor);
    for (const p of ["fontFamily", "fontSize", "lineHeight", "paddingTop", "paddingLeft", "paddingRight", "letterSpacing", "tabSize", "whiteSpace", "wordWrap"]) {
      mirror.style[p] = cs[p];
    }
    Object.assign(mirror.style, { position: "absolute", visibility: "hidden", width: `${editor.clientWidth}px`, whiteSpace: "pre-wrap", wordBreak: "break-word", top: "0", left: "0" });
    mirror.textContent = editor.value.slice(0, editor.selectionStart);
    const mark = h("span", { text: "​" });
    mirror.append(mark);
    $(".editor-wrap").append(mirror);
    const top = mark.offsetTop - editor.scrollTop + parseFloat(cs.lineHeight || "18");
    const left = Math.min(mark.offsetLeft, editor.clientWidth - 280);
    mirror.remove();
    completeEl.style.top = `${Math.min(top + 2, editor.offsetHeight)}px`;
    completeEl.style.left = `${Math.max(4, left)}px`;
  }

  function hideComplete() {
    completeEl.hidden = true;
    comp.items = [];
  }

  function moveComplete(dir) {
    const n = comp.items.length;
    comp.active = (comp.active + dir + n) % n;
    [...completeEl.children].forEach((li, i) => li.classList.toggle("active", i === comp.active));
    completeEl.children[comp.active].scrollIntoView({ block: "nearest" });
  }

  function acceptComplete() {
    const it = comp.items[comp.active];
    if (!it) return;
    const v = editor.value;
    let insert = it.insert;
    // don't double "(" if one already follows
    if (insert.endsWith("(") && v[comp.to] === "(") insert = insert.slice(0, -1);
    editor.setRangeText(insert, it.from, comp.to, "end");
    hideComplete();
    saveDraft();
    // Chain: after picking a model offer the methods right away.
    if (insert.endsWith(".")) updateComplete(true);
  }

  // ---------------------------------------------------------------------------
  // events
  editor.addEventListener("keydown", (e) => {
    const open = !completeEl.hidden && comp.items.length;
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      run();
      return;
    }
    if (open) {
      if (e.key === "ArrowDown") { e.preventDefault(); moveComplete(1); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); moveComplete(-1); return; }
      if (e.key === "Tab" || e.key === "Enter") { e.preventDefault(); acceptComplete(); return; }
      if (e.key === "Escape") { e.preventDefault(); hideComplete(); return; }
    }
    if (e.key === "Escape" && !confirmBar.hidden) { e.preventDefault(); cancelConfirm(); return; }
    // Enter runs a complete call; inside an open bracket it's a new line, as Shift+Enter always is.
    if (e.key === "Enter" && !e.shiftKey && !e.altKey && !e.isComposing && !hasOpenBracket(editor.value)) {
      e.preventDefault();
      run();
      return;
    }
    if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      historyStep(e.key === "ArrowUp" ? 1 : -1);
      return;
    }
    if ((e.ctrlKey && e.key === " ") || (e.key === "Tab" && !e.shiftKey && /[\w.]$/.test(editor.value.slice(0, editor.selectionStart)))) {
      e.preventDefault();
      updateComplete(true);
      if (!completeEl.hidden || e.key !== "Tab") return;
    }
    if (e.key === "Tab" && !e.shiftKey) {
      e.preventDefault();
      editor.setRangeText("    ", editor.selectionStart, editor.selectionEnd, "end");
    }
  });
  editor.addEventListener("input", () => {
    state.histPos = -1;
    saveDraft();
    if (state.pending) cancelConfirm();
    updateComplete(false);
  });
  editor.addEventListener("blur", () => setTimeout(() => {
    if (shadow.activeElement !== editor) hideComplete();
  }, 100));
  editor.addEventListener("click", hideComplete);

  panel.addEventListener("click", (e) => {
    const tab = e.target.closest(".tab");
    if (tab && !tab.disabled) {
      state.view = tab.dataset.view;
      renderOutput();
      return;
    }
    const btn = e.target.closest("[data-act]");
    if (!btn || btn.tagName === "SELECT") return;
    switch (btn.dataset.act) {
      case "run": run(); break;
      case "close": hide(); break;
      case "minimize": toggleMinimize(); break;
      case "history": openSheet("history"); break;
      case "settings": openSheet("settings"); break;
      case "sheet-close": closeSheets(); editor.focus(); break;
      case "history-clear":
        state.history = [];
        store.set(K.history, []);
        renderHistory();
        break;
      case "copy": copy(); break;
      case "confirm-run": if (state.pending) execute(state.pending.cmd, state.pending.src); break;
      case "confirm-cancel": cancelConfirm(); break;
    }
  });

  panel.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!confirmBar.hidden) cancelConfirm();
    else if ([...shadow.querySelectorAll(".sheet")].some((s) => !s.hidden)) { closeSheets(); editor.focus(); }
  });

  snippetSel.addEventListener("change", () => {
    if (snippetSel.value) setEditor(snippetSel.value);
    snippetSel.value = "";
  });

  // ---------------------------------------------------------------------------
  // show / hide
  function show() {
    if (!host.isConnected) document.documentElement.append(host);
    host.style.display = "";
    editor.focus();
  }

  function hide() {
    host.style.display = "none";
    hideComplete();
  }

  function toggle() {
    if (host.isConnected && host.style.display !== "none") hide();
    else show();
  }

  globalThis.__odex = { toggle, show, hide };

  (async () => {
    const [settings, history, geometry, draft] = await Promise.all([
      store.get(K.settings, {}),
      store.get(K.history, []),
      store.get(K.geometry, null),
      store.get(K.draft, ""),
    ]);
    state.settings = { ...DEFAULTS, ...settings };
    state.history = Array.isArray(history) ? history : [];
    applyTheme();
    setGeometry(geometry || defaultGeometry());
    editor.value = draft || prefillCode();
    renderOutput();
    show();
    editor.setSelectionRange(editor.value.length, editor.value.length);
    connect();
  })();
})();
