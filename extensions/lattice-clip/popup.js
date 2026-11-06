// No built-in app URL: a store install must not guess. Until the user saves one,
// the popup explains the setup instead of opening a dead localhost tab.
async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function appUrl() {
  const stored = await chrome.storage.sync.get(["appUrl"]);
  return typeof stored.appUrl === "string" ? stored.appUrl.trim() : "";
}

function setStatus(message) {
  document.getElementById("status").textContent = message;
}

async function load() {
  const tab = await activeTab();
  document.getElementById("title").value = tab?.title ?? "";
  document.getElementById("url").value = tab?.url ?? "";
  const saved = await appUrl();
  document.getElementById("appUrl").value = saved;
  setStatus(saved ? "" : "Set your Lattice URL below before saving a page.");
}

document.getElementById("save").addEventListener("click", async () => {
  const title = document.getElementById("title").value;
  const url = document.getElementById("url").value;
  const text = document.getElementById("text").value;
  const base = await appUrl();
  if (!base) {
    setStatus("Set your Lattice URL below first.");
    document.getElementById("appUrl").focus();
    return;
  }
  let target;
  try {
    target = new URL("/app", base.replace(/\/$/, ""));
  } catch {
    setStatus("That Lattice URL is not valid.");
    return;
  }
  target.searchParams.set("view", "inbox");
  if (title) target.searchParams.set("title", title);
  if (url) target.searchParams.set("url", url);
  if (text) target.searchParams.set("text", text);
  await chrome.tabs.create({ url: target.toString() });
  window.close();
});

document.getElementById("saveSettings").addEventListener("click", async () => {
  const value = document.getElementById("appUrl").value.trim();
  if (!value) {
    setStatus("Enter the URL of your Lattice instance.");
    return;
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    setStatus("Enter a full URL, like https://notes.example.com");
    return;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    setStatus("Use an http or https URL.");
    return;
  }
  const normalized = value.replace(/\/+$/, "");
  await chrome.storage.sync.set({ appUrl: normalized });
  document.getElementById("appUrl").value = normalized;
  setStatus("Connection saved.");
});

void load();
