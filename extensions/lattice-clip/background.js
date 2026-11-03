const DEFAULT_APP_URL = "http://localhost:3101";

async function appUrl() {
  const stored = await chrome.storage.sync.get("appUrl");
  return (stored.appUrl || DEFAULT_APP_URL).replace(/\/$/, "");
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
