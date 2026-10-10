/* odeX background: injects (or toggles) the ORM box in the active tab when the
 * toolbar button or the keyboard shortcut is used. Injection relies on the
 * activeTab permission, so odeX never has standing access to any site.
 */
const api = globalThis.browser || globalThis.chrome;

const FILES = ["src/shared/pyparse.js", "src/content/panel-css.js", "src/content/odex.js"];

async function toggle(tab) {
  if (!tab || tab.id === undefined) return;
  try {
    await api.scripting.executeScript({ target: { tabId: tab.id }, files: FILES });
    api.action.setBadgeText({ tabId: tab.id, text: "" });
  } catch (e) {
    // chrome://, about:, the web stores, PDF viewers... can't be scripted.
    api.action.setBadgeBackgroundColor({ tabId: tab.id, color: "#c0392b" });
    api.action.setBadgeText({ tabId: tab.id, text: "!" });
    api.action.setTitle({ tabId: tab.id, title: `odeX can't run on this page: ${e && e.message ? e.message : e}` });
  }
}

api.action.onClicked.addListener(toggle);
