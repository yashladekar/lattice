// The app URL is user-configured; there is no default. Without one, opening a
// capture shows the setup UI (the popup as a tab) instead of a dead link.
async function appUrl() {
  const stored = await chrome.storage.sync.get("appUrl");
  return typeof stored.appUrl === "string" ? stored.appUrl.trim() : "";
}

function captureUrl(base, payload) {
  const url = new URL("/app", base);
  url.searchParams.set("view", "inbox");
  if (payload.title) url.searchParams.set("title", payload.title);
  if (payload.url) url.searchParams.set("url", payload.url);
  if (payload.text) url.searchParams.set("text", payload.text);
  return url.toString();
}

async function openCapture(payload) {
  const base = await appUrl();
  if (!base) {
    await chrome.tabs.create({ url: chrome.runtime.getURL("popup.html") });
    return;
  }
  await chrome.tabs.create({ url: captureUrl(base, payload) });
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "lattice-save-page",
    title: "Save page to Lattice",
    contexts: ["page", "link", "selection"],
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== "lattice-save-page") return;
  void openCapture({
    title: tab?.title ?? "Clipped page",
    url: info.linkUrl ?? tab?.url ?? "",
    text: info.selectionText ?? "",
  });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "lattice-capture") return false;
  void openCapture(message.payload ?? {}).then(() => sendResponse({ ok: true }));
  return true;
});
