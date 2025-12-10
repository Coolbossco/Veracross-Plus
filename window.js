// Firefox compatibility: Create browser namespace polyfill
const browser = chrome || browser;

const WINDOW_DEFAULTS = {
  enableChecklist: false,
  enableCustomAssignments: false,
};

function storageGet(defaults) {
  return new Promise((resolve) => {
    chrome.storage.sync.get(defaults, (vals) => resolve(vals || defaults));
  });
}

async function readPreferences() {
  const defaults = { ...WINDOW_DEFAULTS };
  if (!window.RemoteSyncClient) {
    return defaults;
  }

  let status = null;

  try {
    await window.RemoteSyncClient.ensureInitialized();
    status = window.RemoteSyncClient.getStatus?.();
    if (status?.authenticated) {
      const remote = await window.RemoteSyncClient.get();
      if (remote && typeof remote === "object") {
        const preferences = remote.preferences || remote;
        return { ...defaults, ...preferences };
      }
    } else {
      return defaults;
    }
  } catch (_error) {}

  if (status?.authenticated) {
    return await storageGet(defaults);
  }

  return defaults;
}

async function savePreferences() {
  const updates = {};
  ["enableChecklist", "enableCustomAssignments"].forEach((k) => {
    const el = document.getElementById(k);
    if (el) {
      updates[k] = el.type === "checkbox" ? el.checked : el.value.trim();
    }
  });

  const merged = { ...(await readPreferences()), ...updates };

  let status = null;

  if (window.RemoteSyncClient) {
    try {
      await window.RemoteSyncClient.ensureInitialized();
      status = window.RemoteSyncClient.getStatus?.();
      if (status?.authenticated) {
        await window.RemoteSyncClient.set({ preferences: merged });
        await updateStatus();
        return;
      }
      return;
    } catch (error) {
      status = status || window.RemoteSyncClient.getStatus?.();
    }
  }

  if (status?.authenticated) {
    chrome.storage.sync.set(merged, updateStatus);
  }
}

async function updateStatus() {
  const statusEl = document.getElementById("syncStatus");
  if (!statusEl) return;
  if (!window.RemoteSyncClient) {
    statusEl.textContent = "Remote sync unavailable";
    statusEl.dataset.state = "offline";
    return;
  }
  try {
    await window.RemoteSyncClient.ensureInitialized();
  } catch (_err) {
    statusEl.textContent = "Remote sync unavailable";
    statusEl.dataset.state = "offline";
    return;
  }
  const status = window.RemoteSyncClient.getStatus();
  if (status.authenticated) {
    const emailLine = status.email ? `Signed in as ${status.email}` : "";
    statusEl.innerHTML = `Remote sync: online${emailLine ? `<br>${emailLine}` : ""}`;
    statusEl.dataset.state = "online";
  } else if (status.lastError) {
    statusEl.textContent = `Remote sync: offline (${status.lastError})`;
    statusEl.dataset.state = "offline";
  } else {
    statusEl.textContent = "Remote sync: sign in required";
    statusEl.dataset.state = "offline";
  }
}

async function loadPreferencesIntoUI() {
  const values = await readPreferences();
  Object.entries(values).forEach(([k, v]) => {
    const el = document.getElementById(k);
    if (!el) return;
    if (el.type === "checkbox") el.checked = !!v;
    else el.value = v || "";
  });
}

function showSection(sectionId) {
  document.querySelectorAll(".section").forEach((section) => {
    section.classList.toggle("active", section.id === sectionId);
  });
}

function setAuthMessage(message, tone = "info") {
  const messageEl = document.getElementById("authMessage");
  if (!messageEl) return;
  messageEl.textContent = message || "";
  messageEl.style.color = tone === "error" ? "#d9534f" : tone === "success" ? "#28a745" : "#6c757d";
}

function updateAccountSummary(email) {
  const summaryEl = document.getElementById("accountSummary");
  if (!summaryEl) return;
  if (email) {
    summaryEl.innerHTML = `
      <span style="font-weight:600;">Account</span>
      <span>${email}</span>
    `;
  } else {
    summaryEl.textContent = "";
  }
}

async function refreshView() {
  await updateStatus();
  if (!window.RemoteSyncClient) {
    showSection("preferencesSection");
    await loadPreferencesIntoUI();
    updateAccountSummary(null);
    return;
  }

  await window.RemoteSyncClient.ensureInitialized();
  const status = window.RemoteSyncClient.getStatus();
  if (status.authenticated) {
    showSection("preferencesSection");
    updateAccountSummary(status.email || "");
    await loadPreferencesIntoUI();
    setAuthMessage("");
  } else {
    showSection("authSection");
    updateAccountSummary(null);
    setAuthMessage("");
  }
}

async function handleLogin(event) {
  event.preventDefault();
  if (!window.RemoteSyncClient) return;
  const emailInput = document.getElementById("authEmail");
  const passwordInput = document.getElementById("authPassword");
  if (!emailInput || !passwordInput) return;

  setAuthMessage("Signing in…");
  try {
    await window.RemoteSyncClient.login(emailInput.value, passwordInput.value);
    passwordInput.value = "";
    setAuthMessage("Signed in successfully.", "success");
    await refreshView();
  } catch (error) {
    setAuthMessage(error.message || "Unable to sign in.", "error");
  }
}

async function handleSignup() {
  if (!window.RemoteSyncClient) return;
  const emailInput = document.getElementById("authEmail");
  const passwordInput = document.getElementById("authPassword");
  if (!emailInput || !passwordInput) return;

  setAuthMessage("Creating account…");
  try {
    await window.RemoteSyncClient.signUp(emailInput.value, passwordInput.value);
    passwordInput.value = "";
    setAuthMessage("Account created! You're signed in.", "success");
    await refreshView();
  } catch (error) {
    setAuthMessage(error.message || "Unable to create account.", "error");
  }
}

async function handleLogout() {
  if (!window.RemoteSyncClient) return;
  try {
    await window.RemoteSyncClient.logout();
  } catch (_error) {}
  await refreshView();
  setAuthMessage("You have been signed out.");
}

async function handleManualSync() {
  const statusEl = document.getElementById("syncStatus");
  if (statusEl) {
    statusEl.textContent = "Remote sync: fetching…";
    statusEl.dataset.state = "offline";
  }
  if (window.RemoteSyncClient) {
    try {
      await window.RemoteSyncClient.ensureInitialized();
      await window.RemoteSyncClient.ensureAuthReady();
      await Promise.all([
        window.RemoteSyncClient.get("customAssignments"),
        window.RemoteSyncClient.get("vc_checked_assignments")
      ]);
    } catch (error) {
      setAuthMessage(error.message || "Sync failed.", "error");
    }
  }
  await updateStatus();
}

document.addEventListener("DOMContentLoaded", () => {
  refreshView();
  setInterval(updateStatus, 5000);

  const authForm = document.getElementById("authForm");
  if (authForm) {
    authForm.addEventListener("submit", handleLogin);
  }

  const signupBtn = document.getElementById("signupBtn");
  if (signupBtn) {
    signupBtn.addEventListener("click", handleSignup);
  }

  const logoutBtn = document.getElementById("logoutBtn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", handleLogout);
  }

  const retryBtn = document.getElementById("retrySync");
  if (retryBtn) {
    retryBtn.addEventListener("click", handleManualSync);
  }

  const checklistToggle = document.getElementById("enableChecklist");
  if (checklistToggle) {
    checklistToggle.addEventListener("change", savePreferences);
    checklistToggle.addEventListener("input", savePreferences);
  }

  const customAssignmentsToggle = document.getElementById("enableCustomAssignments");
  if (customAssignmentsToggle) {
    customAssignmentsToggle.addEventListener("change", savePreferences);
    customAssignmentsToggle.addEventListener("input", savePreferences);
  }

  const clickOutsideOverlay = document.getElementById("clickOutsideOverlay");
  const container = document.querySelector(".container");

  clickOutsideOverlay.addEventListener("click", (e) => {
    if (e.target === clickOutsideOverlay) {
      window.close();
    }
  });

  let windowFocused = true;
  window.addEventListener("blur", () => {
    windowFocused = false;
    setTimeout(() => {
      if (!windowFocused) {
        window.close();
      }
    }, 150);
  });

  window.addEventListener("focus", () => {
    windowFocused = true;
  });

  if (chrome.windows) {
    chrome.windows.onFocusChanged.addListener((windowId) => {
      if (windowId === chrome.windows.WINDOW_ID_NONE) {
        setTimeout(() => window.close(), 100);
      }
    });
  }

  container.addEventListener("click", (e) => {
    e.stopPropagation();
  });
});
