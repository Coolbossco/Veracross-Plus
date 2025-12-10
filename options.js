const DEFAULT_BASE_URL = "https://api.veracross-plus.example.com/api";
const BASE_URL_KEY = "vc_remote_base_url";

function setStatus(message, tone = "neutral") {
  const el = document.getElementById("saveStatus");
  if (!el) return;
  el.textContent = message;
  el.style.color = tone === "success" ? "#28a745" : tone === "error" ? "#d9534f" : "#6c757d";
}

async function loadBaseUrl() {
  return new Promise((resolve) => {
    chrome.storage.local.get([BASE_URL_KEY], (result) => {
      resolve(result[BASE_URL_KEY] || DEFAULT_BASE_URL);
    });
  });
}

async function saveBaseUrl(value) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [BASE_URL_KEY]: value }, () => resolve());
  });
}

async function refreshAccountStatus() {
  const statusEl = document.getElementById("accountStatus");
  const logoutBtn = document.getElementById("logoutBtn");
  if (!statusEl || !logoutBtn) return;

  if (!window.RemoteSyncClient) {
    statusEl.textContent = "Remote sync client unavailable.";
    logoutBtn.disabled = true;
    return;
  }

  try {
    await window.RemoteSyncClient.ensureInitialized();
  } catch (error) {
    statusEl.textContent = error.message || "Unable to load account status.";
    logoutBtn.disabled = true;
    return;
  }

  const status = window.RemoteSyncClient.getStatus();
  if (status.authenticated && status.email) {
    statusEl.textContent = `Signed in as ${status.email}`;
    logoutBtn.disabled = false;
  } else {
    statusEl.textContent = "Not signed in.";
    logoutBtn.disabled = true;
  }
}

async function handleLogout() {
  if (!window.RemoteSyncClient) {
    setStatus("Remote client unavailable.", "error");
    return;
  }
  try {
    await window.RemoteSyncClient.ensureInitialized();
    await window.RemoteSyncClient.logout();
    setStatus("Signed out on this device.", "success");
  } catch (error) {
    setStatus(error.message || "Unable to sign out.", "error");
  } finally {
    refreshAccountStatus();
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  const input = document.getElementById("apiBaseUrl");
  const saveBtn = document.getElementById("saveBtn");
  const logoutBtn = document.getElementById("logoutBtn");

  const currentBaseUrl = await loadBaseUrl();
  input.value = currentBaseUrl;
  refreshAccountStatus();

  saveBtn.addEventListener("click", async () => {
    const value = input.value.trim() || DEFAULT_BASE_URL;
    try {
      new URL(value);
    } catch (_err) {
      setStatus("Please provide a valid URL (include https://)", "error");
      return;
    }

    await saveBaseUrl(value);

    if (window.RemoteSyncClient) {
      await window.RemoteSyncClient.setBaseUrl(value);
      await window.RemoteSyncClient.ensureInitialized();
    }

    setStatus("API base URL saved.", "success");
  });

  if (logoutBtn) {
    logoutBtn.addEventListener("click", handleLogout);
  }
});

