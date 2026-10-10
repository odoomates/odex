/* odeX panel styles, injected into the panel's shadow root so the host page can't touch them. */
globalThis.ODEX_CSS = `
:host {
  all: initial;
  --accent: #714b67;
  --accent-2: #8f6a86;
  --accent-fg: #fff;
  --bg: #ffffff;
  --bg-2: #f6f5f8;
  --bg-3: #ecebf0;
  --fg: #1f1d24;
  --fg-2: #5d5a66;
  --fg-3: #8b8894;
  --border: #dcdae2;
  --danger: #c0392b;
  --danger-bg: #fdecea;
  --warn: #9a6700;
  --warn-bg: #fff4d6;
  --ok: #1a7f37;
  --str: #0a7a50;
  --num: #1f5fbf;
  --kw: #a1308a;
  --key: #5b3a8c;
  --shadow: 0 12px 40px rgba(20, 10, 30, .22), 0 2px 8px rgba(20, 10, 30, .12);
  /* The editor is inverted: dark in the light theme, light in the dark theme. */
  --ed-scheme: dark;
  --ed-bg: #221d26;
  --ed-fg: #f1ecf4;
  --ed-dim: #8d8496;
  --ed-caret: #3fd0cb;
  --ed-sel: rgba(176, 127, 165, .45);
  --ed-edge: #3a3240;
  --mono: ui-monospace, "SFMono-Regular", "JetBrains Mono", Menlo, Consolas, "Liberation Mono", monospace;
  --sans: system-ui, -apple-system, "Segoe UI", Roboto, Ubuntu, sans-serif;
}
:host([data-theme="dark"]) {
  --accent: #b07fa5;
  --accent-2: #c79bbd;
  --accent-fg: #1b1420;
  --bg: #1c1b21;
  --bg-2: #24232a;
  --bg-3: #2e2d35;
  --fg: #ebe9f0;
  --fg-2: #b4b1bd;
  --fg-3: #85828e;
  --border: #3a3842;
  --danger: #ff7b72;
  --danger-bg: #3a1d1d;
  --warn: #e3b341;
  --warn-bg: #3a2f12;
  --ok: #56d364;
  --str: #7ee0a8;
  --num: #79b8ff;
  --kw: #f08fd6;
  --key: #c4a7ff;
  --shadow: 0 12px 40px rgba(0, 0, 0, .55), 0 2px 8px rgba(0, 0, 0, .4);
  --ed-scheme: light;
  --ed-bg: #f7f4f8;
  --ed-fg: #1f1d24;
  --ed-dim: #8b8894;
  --ed-caret: #714b67;
  --ed-sel: rgba(113, 75, 103, .22);
  --ed-edge: #d9d3dc;
}
* { box-sizing: border-box; }
.panel {
  position: fixed;
  z-index: 2147483646;
  display: flex;
  flex-direction: column;
  min-width: 380px;
  min-height: 260px;
  max-width: 100vw;
  max-height: 100vh;
  background: var(--bg);
  color: var(--fg);
  font: 13px/1.45 var(--sans);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: var(--shadow);
  overflow: hidden;
  resize: both;
}
.panel.min { height: auto !important; min-height: 0; resize: none; }
.panel.min > :not(header) { display: none !important; }
header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px 6px 12px;
  background: var(--accent);
  color: var(--accent-fg);
  cursor: move;
  user-select: none;
  flex: none;
}
.logo { font-weight: 700; font-size: 14px; letter-spacing: .2px; }
.logo b { font-weight: 800; opacity: .75; }
.conn {
  flex: 1;
  min-width: 0;
  font-size: 11.5px;
  opacity: .9;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.conn .dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-right: 5px; background: #bbb; vertical-align: 1px; }
.conn.ok .dot { background: #4ade80; }
.conn.err .dot { background: #f87171; }
header button {
  all: unset;
  cursor: pointer;
  width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
  border-radius: 5px;
  font-size: 15px;
  line-height: 1;
}
header button:hover { background: rgba(255, 255, 255, .18); }
header button:focus-visible { outline: 2px solid currentColor; }
.editor-wrap { position: relative; flex: none; border-bottom: 1px solid var(--ed-edge); background: var(--ed-bg); }
textarea {
  display: block;
  width: 100%;
  min-height: 74px;
  height: 96px;
  max-height: 50vh;
  padding: 10px 12px;
  margin: 0;
  border: 0;
  outline: 0;
  resize: vertical;
  background: var(--ed-bg);
  color: var(--ed-fg);
  caret-color: var(--ed-caret);
  color-scheme: var(--ed-scheme);
  font: 13px/1.5 var(--mono);
  tab-size: 4;
  white-space: pre-wrap;
}
textarea::placeholder { color: var(--ed-dim); }
textarea::selection { background: var(--ed-sel); }
.complete {
  position: absolute;
  z-index: 3;
  min-width: 260px;
  max-width: 420px;
  max-height: 220px;
  overflow: auto;
  margin: 0;
  padding: 4px 0;
  list-style: none;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  box-shadow: var(--shadow);
  font: 12.5px/1.4 var(--mono);
}
.complete[hidden] { display: none; }
.complete li { display: flex; gap: 10px; justify-content: space-between; padding: 3px 10px; cursor: pointer; white-space: nowrap; }
.complete li small { color: var(--fg-3); font-family: var(--sans); overflow: hidden; text-overflow: ellipsis; }
.complete li.active { background: var(--accent); color: var(--accent-fg); }
.complete li.active small { color: inherit; opacity: .8; }
.toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--border);
  flex: none;
  flex-wrap: wrap;
}
.btn {
  all: unset;
  box-sizing: border-box;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 26px;
  padding: 0 10px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--fg);
  font: 500 12px var(--sans);
  white-space: nowrap;
}
.btn:hover { background: var(--bg-3); }
.btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.btn.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-fg); }
.btn.primary:hover { filter: brightness(1.08); }
.btn.danger { background: var(--danger); border-color: var(--danger); color: #fff; }
.btn[disabled] { opacity: .5; pointer-events: none; }
.btn kbd { font: 10.5px var(--sans); opacity: .75; }
select.btn { appearance: auto; padding-right: 4px; }
.spacer { flex: 1; }
.hint { color: var(--fg-3); font-size: 11.5px; }
.confirm {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  background: var(--warn-bg);
  color: var(--warn);
  border-bottom: 1px solid var(--border);
  font-size: 12.5px;
  flex: none;
}
.confirm[hidden] { display: none; }
.confirm code { font: 12px var(--mono); color: var(--fg); word-break: break-all; }
.confirm .msg { flex: 1; min-width: 0; }
.result-bar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-2);
  flex: none;
}
.tabs { display: flex; gap: 2px; }
.tab {
  all: unset;
  cursor: pointer;
  padding: 3px 9px;
  border-radius: 5px;
  font: 500 12px var(--sans);
  color: var(--fg-2);
}
.tab:hover { background: var(--bg-3); }
.tab.active { background: var(--bg); color: var(--fg); box-shadow: 0 0 0 1px var(--border); }
.tab[disabled] { opacity: .4; pointer-events: none; }
.meta { flex: 1; text-align: right; color: var(--fg-3); font-size: 11.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.meta .ok { color: var(--ok); }
.meta .err { color: var(--danger); }
.icon-btn {
  all: unset;
  cursor: pointer;
  padding: 2px 7px;
  border-radius: 5px;
  font: 12px var(--sans);
  color: var(--fg-2);
}
.icon-btn:hover { background: var(--bg-3); color: var(--fg); }
.output {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 8px 12px;
  font: 12.5px/1.5 var(--mono);
}
.empty { color: var(--fg-3); font-family: var(--sans); padding: 18px 4px; }
.empty code { font-family: var(--mono); background: var(--bg-2); padding: 1px 5px; border-radius: 4px; color: var(--fg-2); }
.empty ul { margin: 6px 0 0; padding-left: 18px; }
.empty li { margin: 3px 0; }
pre.raw { margin: 0; white-space: pre-wrap; word-break: break-word; }
.error {
  border: 1px solid var(--danger);
  background: var(--danger-bg);
  color: var(--danger);
  border-radius: 6px;
  padding: 8px 10px;
  font-family: var(--sans);
}
.error .title { font-weight: 600; }
.error .kind { font: 11px var(--mono); opacity: .8; margin-bottom: 2px; }
.error .message { white-space: pre-wrap; color: var(--fg); margin-top: 4px; font-size: 12.5px; }
.error details { margin-top: 6px; }
.error summary { cursor: pointer; font-size: 12px; }
.error pre { margin: 6px 0 0; max-height: 300px; overflow: auto; font: 11.5px/1.45 var(--mono); color: var(--fg-2); white-space: pre; }
.caret { display: inline-block; margin-top: 4px; font: 12.5px var(--mono); color: var(--fg); white-space: pre; }
/* tree */
.tree, .tree ul { list-style: none; margin: 0; padding: 0; }
.tree ul { padding-left: 16px; border-left: 1px dashed var(--border); margin-left: 4px; }
.tree li { white-space: nowrap; }
.tree summary { cursor: pointer; list-style: none; }
.tree summary::-webkit-details-marker { display: none; }
.tree summary::before { content: "▸"; display: inline-block; width: 12px; color: var(--fg-3); }
.tree details[open] > summary::before { content: "▾"; }
.tree .leaf { padding-left: 12px; }
.k { color: var(--key); }
.s { color: var(--str); white-space: pre-wrap; word-break: break-word; }
.n { color: var(--num); }
.b, .z { color: var(--kw); }
.c { color: var(--fg-3); }
.more { all: unset; cursor: pointer; color: var(--accent); font: 12px var(--sans); padding: 2px 0 2px 12px; }
/* table */
table { border-collapse: collapse; font: 12px/1.4 var(--sans); min-width: 100%; }
th, td { border: 1px solid var(--border); padding: 4px 8px; text-align: left; vertical-align: top; max-width: 380px; overflow: hidden; text-overflow: ellipsis; }
th { position: sticky; top: -8px; background: var(--bg-2); font-weight: 600; white-space: nowrap; z-index: 1; }
td { white-space: pre-wrap; word-break: break-word; }
td.num { text-align: right; font-family: var(--mono); color: var(--num); }
td .m2o { color: var(--fg-3); font-size: 11px; }
tr:hover td { background: var(--bg-2); }
.note { color: var(--fg-3); font: 11.5px var(--sans); margin-top: 6px; }
/* side sheets */
.sheet {
  position: absolute;
  inset: 37px 0 0 auto;
  width: min(360px, 90%);
  background: var(--bg);
  border-left: 1px solid var(--border);
  box-shadow: var(--shadow);
  display: flex;
  flex-direction: column;
  z-index: 4;
}
.sheet[hidden] { display: none; }
.sheet h3 { display: flex; align-items: center; justify-content: space-between; margin: 0; padding: 8px 10px; font: 600 13px var(--sans); border-bottom: 1px solid var(--border); }
.sheet .body { flex: 1; overflow: auto; padding: 4px 0; }
.sheet input[type="search"] {
  margin: 8px 10px 4px;
  padding: 5px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-2);
  color: var(--fg);
  font: 12.5px var(--sans);
  outline: none;
}
.sheet input[type="search"]:focus { border-color: var(--accent); }
.hist-item { display: block; width: 100%; padding: 6px 10px; border: 0; border-bottom: 1px solid var(--bg-3); background: none; color: var(--fg); text-align: left; cursor: pointer; font: 12px/1.4 var(--mono); }
.hist-item:hover, .hist-item:focus-visible { background: var(--bg-2); outline: none; }
.hist-item .code { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; word-break: break-all; }
.hist-item .when { display: block; color: var(--fg-3); font: 11px var(--sans); margin-top: 2px; }
.hist-item .when .err { color: var(--danger); }
.setting { display: flex; gap: 10px; align-items: flex-start; padding: 8px 12px; cursor: pointer; }
.setting input { margin-top: 3px; accent-color: var(--accent); }
.setting span { display: block; }
.setting small { display: block; color: var(--fg-3); font-size: 11.5px; }
.sheet .field { padding: 8px 12px; }
.sheet .field label { display: block; font-weight: 500; margin-bottom: 4px; }
.sheet .field select { width: 100%; padding: 4px; background: var(--bg-2); color: var(--fg); border: 1px solid var(--border); border-radius: 6px; font: 12.5px var(--sans); }
.sheet .foot { padding: 8px 12px; border-top: 1px solid var(--border); display: flex; gap: 6px; }
.toast {
  position: absolute;
  left: 50%;
  bottom: 14px;
  transform: translateX(-50%);
  background: var(--fg);
  color: var(--bg);
  padding: 5px 12px;
  border-radius: 6px;
  font: 12px var(--sans);
  pointer-events: none;
  opacity: 0;
  transition: opacity .15s;
  z-index: 5;
}
.toast.show { opacity: .92; }
.spin { display: inline-block; width: 11px; height: 11px; border: 2px solid currentColor; border-right-color: transparent; border-radius: 50%; animation: spin .7s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spin { animation-duration: 2s; } .toast { transition: none; } }
`;
