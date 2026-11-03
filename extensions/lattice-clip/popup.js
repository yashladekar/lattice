const DEFAULT_APP_URL = "http://localhost:3101";

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function load() {
  const tab = await activeTab();
  const stored = await chrome.storage.sync.get(["appUrl"]);
  document.getElementById("title").value = tab?.title ?? "";
  document.getElementById("url").value = tab?.url ?? "";
  document.getElementById("appUrl").value = stored.appUrl ?? DEFAULT_APP_URL;
}

document.getElementById("save").addEventListener("click", async () => {
  const title = document.getElementById("title").value;
  const url = document.getElementById("url").value;
  const text = document.getElementById("text").value;
  const appUrl = document.getElementById("appUrl").value || DEFAULT_APP_URL;
  const target = new URL("/app", appUrl.replace(/\/$/, ""));
  target.searchParams.set("view", "inbox");
  if (title) target.searchParams.set("title", title);
  if (url) target.searchParams.set("url", url);
  if (text) target.searchParams.set("text", text);
  await chrome.tabs.create({ url: target.toString() });
  window.close();
});

document.getElementById("saveSettings").addEventListener("click", async () => {
  const appUrl = document.getElementById("appUrl").value.trim() || DEFAULT_APP_URL;
  await chrome.storage.sync.set({ appUrl });
  document.getElementById("saveSettings").textContent = "Saved";
});

void load();
