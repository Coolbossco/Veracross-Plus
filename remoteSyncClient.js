(function () {
  const DEFAULT_API_BASE = 'http://localhost:4000/api';

  const LOCAL_STORAGE_KEYS = {
    email: 'vc_remote_email',
    userId: 'vc_remote_user_id',
    accessToken: 'vc_remote_access_token',
    accessTokenExpiresAt: 'vc_remote_access_token_expires_at',
    refreshToken: 'vc_remote_refresh_token',
    refreshTokenExpiresAt: 'vc_remote_refresh_token_expires_at',
    deviceId: 'vc_remote_device_id',
    baseUrl: 'vc_remote_base_url'
  };

  const LEGACY_KEYS = [
    'vc_remote_username_hash',
    'vc_remote_migration_complete'
  ];

  const SYNC_STORAGE_KEYS = {
    checkedAssignments: 'vc_checked_assignments',
    customAssignments: 'customAssignments'
  };

  const LOCAL_CACHE_KEYS = {
    settings: 'vc_local_cache_settings_v1',
    customAssignments: 'vc_local_cache_custom_assignments_v1',
    checkedAssignments: 'vc_local_cache_checked_assignments_v1'
  };

  function deepCopy(value) {
    if (value === null || value === undefined) {
      return value;
    }
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (_err) {
      return value;
    }
  }

  function readLocalCache(key) {
    if (!key) return null;
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') {
        return null;
      }
      return {
        data: parsed.data,
        updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0
      };
    } catch (error) {
      logDebug('readLocalCache: failed', key, error?.message);
      return null;
    }
  }

  function writeLocalCache(key, value) {
    if (!key) return;
    try {
      const payload = {
        data: value,
        updatedAt: Date.now()
      };
      window.localStorage.setItem(key, JSON.stringify(payload));
    } catch (error) {
      logDebug('writeLocalCache: failed', key, error?.message);
    }
  }

  function clearLocalCache(key) {
    if (!key) return;
    try {
      window.localStorage.removeItem(key);
    } catch (error) {
      logDebug('clearLocalCache: failed', key, error?.message);
    }
  }

  function debugStateSnapshot(context) {
    logDebug(context, {
      accessToken: !!state.accessToken,
      accessTokenExpiresIn: state.accessTokenExpiresAt - Date.now(),
      refreshToken: !!state.refreshToken,
      refreshTokenExpiresIn: state.refreshTokenExpiresAt - Date.now(),
      status: { ...state.status },
      caches: {
        customAssignments: !!state.caches.customAssignments,
        checkedAssignments: !!state.caches.checkedAssignments
      }
    });
  }

  function resolveLocalCacheKey(key) {
    if (key === undefined || key === 'preferences') {
      return LOCAL_CACHE_KEYS.settings;
    }
    if (key === SYNC_STORAGE_KEYS.customAssignments) {
      return LOCAL_CACHE_KEYS.customAssignments;
    }
    if (key === SYNC_STORAGE_KEYS.checkedAssignments) {
      return LOCAL_CACHE_KEYS.checkedAssignments;
    }
    return null;
  }

  function clearAllLocalCaches() {
    Object.values(LOCAL_CACHE_KEYS).forEach((key) => clearLocalCache(key));
  }

  const state = {
    baseUrl: DEFAULT_API_BASE,
    email: null,
    userId: null,
    accessToken: null,
    accessTokenExpiresAt: 0,
    refreshToken: null,
    refreshTokenExpiresAt: 0,
    deviceId: null,
    initialized: false,
    initializing: null,
    caches: {
      customAssignments: null,
      customAssignmentsSignature: null,
      checkedAssignments: null
    },
    status: {
      online: false,
      lastError: null,
      lastSync: null,
      authenticated: null,
      authCheckedAt: null
    }
  };

  function storageGet(area, keys) {
    return new Promise((resolve) => {
      try {
        chrome.storage[area].get(keys, (result) => {
          if (chrome.runtime.lastError) {
            resolve({});
            return;
          }
          resolve(result);
        });
      } catch (_err) {
        resolve({});
      }
    });
  }

  function storageSet(area, items) {
    return new Promise((resolve) => {
      try {
        chrome.storage[area].set(items, () => resolve());
      } catch (_err) {
        resolve();
      }
    });
  }

  function storageRemove(area, keys) {
    return new Promise((resolve) => {
      try {
        chrome.storage[area].remove(keys, () => resolve());
      } catch (_err) {
        resolve();
      }
    });
  }

  function ensureDeviceId() {
    if (!state.deviceId) {
      const array = new Uint8Array(16);
      crypto.getRandomValues(array);
      state.deviceId = Array.from(array, (b) => b.toString(16).padStart(2, '0')).join('');
      storageSet('local', { [LOCAL_STORAGE_KEYS.deviceId]: state.deviceId });
    }
    return state.deviceId;
  }

  function accessTokenValid() {
    return !!state.accessToken && state.accessTokenExpiresAt - Date.now() > 5000;
  }

  function refreshTokenValid() {
    return !!state.refreshToken && state.refreshTokenExpiresAt - Date.now() > 0;
  }

  function logDebug() {}

  function isAuthenticationError(error) {
    if (!error) return false;
    if (error.status === 401) return true;
    const message = String(error?.message || '').toLowerCase();
    return (
      message.includes('authentication required') ||
      message.includes('unauthorized') ||
      message.includes('not authenticated')
    );
  }

  async function fetchWithTimeout(url, options = {}, timeout = 15000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      return response;
    } finally {
      clearTimeout(timer);
    }
  }

  async function safeJson(response) {
    try {
      return await response.json();
    } catch (_err) {
      return null;
    }
  }

  async function callAuthEndpoint(path, payload) {
    const response = await fetchWithTimeout(new URL(path, state.baseUrl).toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const body = await safeJson(response);
      const error = new Error(body?.error || response.statusText);
      error.status = response.status;
      throw error;
    }
    return response.json();
  }

  function applyAuthResponse(result, emailHint) {
    state.accessToken = result.accessToken || null;
    state.accessTokenExpiresAt = Date.now() + Number(result.expiresInMs || 0);
    state.refreshToken = result.refreshToken || null;
    state.refreshTokenExpiresAt = result.refreshExpiresAt ? Date.parse(result.refreshExpiresAt) : 0;
    state.userId = result.userId || state.userId;
    state.email = (result.email || emailHint || state.email || '').toLowerCase() || null;
    state.status.online = true;
    state.status.lastError = null;
    state.status.authenticated = true;
    state.status.authCheckedAt = new Date().toISOString();
  }

  async function loadStateFromStorage() {
    const localValues = await storageGet('local', Object.values(LOCAL_STORAGE_KEYS));
    state.baseUrl = localValues[LOCAL_STORAGE_KEYS.baseUrl] || DEFAULT_API_BASE;
    state.email = localValues[LOCAL_STORAGE_KEYS.email] || null;
    state.userId = localValues[LOCAL_STORAGE_KEYS.userId] || null;
    state.accessToken = localValues[LOCAL_STORAGE_KEYS.accessToken] || null;
    state.accessTokenExpiresAt = Number(localValues[LOCAL_STORAGE_KEYS.accessTokenExpiresAt] || 0);
    state.refreshToken = localValues[LOCAL_STORAGE_KEYS.refreshToken] || null;
    state.refreshTokenExpiresAt = Number(localValues[LOCAL_STORAGE_KEYS.refreshTokenExpiresAt] || 0);
    state.deviceId = localValues[LOCAL_STORAGE_KEYS.deviceId] || null;
    if (accessTokenValid()) {
      state.status.authenticated = true;
      state.status.authCheckedAt = state.status.authCheckedAt || new Date().toISOString();
    } else if (state.accessToken || state.refreshToken) {
      state.status.authenticated = false;
    }
  }

  async function persistAuthState() {
    await storageSet('local', {
      [LOCAL_STORAGE_KEYS.email]: state.email,
      [LOCAL_STORAGE_KEYS.userId]: state.userId,
      [LOCAL_STORAGE_KEYS.accessToken]: state.accessToken,
      [LOCAL_STORAGE_KEYS.accessTokenExpiresAt]: state.accessTokenExpiresAt,
      [LOCAL_STORAGE_KEYS.refreshToken]: state.refreshToken,
      [LOCAL_STORAGE_KEYS.refreshTokenExpiresAt]: state.refreshTokenExpiresAt,
      [LOCAL_STORAGE_KEYS.deviceId]: state.deviceId,
      [LOCAL_STORAGE_KEYS.baseUrl]: state.baseUrl
    });
  }

  async function clearAuthState() {
    state.email = null;
    state.userId = null;
    state.accessToken = null;
    state.accessTokenExpiresAt = 0;
    state.refreshToken = null;
    state.refreshTokenExpiresAt = 0;
    state.caches.customAssignments = null;
    state.caches.customAssignmentsSignature = null;
    state.caches.checkedAssignments = null;
    state.status.authenticated = false;
    state.status.authCheckedAt = new Date().toISOString();
    clearAllLocalCaches();
    await storageRemove('sync', Object.values(SYNC_STORAGE_KEYS));
    await storageRemove('local', [
      LOCAL_STORAGE_KEYS.email,
      LOCAL_STORAGE_KEYS.userId,
      LOCAL_STORAGE_KEYS.accessToken,
      LOCAL_STORAGE_KEYS.accessTokenExpiresAt,
      LOCAL_STORAGE_KEYS.refreshToken,
      LOCAL_STORAGE_KEYS.refreshTokenExpiresAt
    ]);
    debugStateSnapshot('clearAuthState: state cleared');
  }

  async function signUp(email, password) {
    await RemoteSyncClient.ensureInitialized();
    const payload = {
      email: email.trim(),
      password,
      deviceId: ensureDeviceId(),
      userAgent: navigator.userAgent
    };
    const result = await callAuthEndpoint('/api/auth/signup', payload);
    applyAuthResponse(result, payload.email);
    await persistAuthState();
    return { email: state.email, userId: state.userId };
  }

  async function login(email, password) {
    await RemoteSyncClient.ensureInitialized();
    const payload = {
      email: email.trim(),
      password,
      deviceId: ensureDeviceId(),
      userAgent: navigator.userAgent
    };
    const result = await callAuthEndpoint('/api/auth/login', payload);
    applyAuthResponse(result, payload.email);
    await persistAuthState();
    return { email: state.email, userId: state.userId };
  }

  async function logout() {
    if (state.refreshToken) {
      try {
        await callAuthEndpoint('/api/auth/logout', { refreshToken: state.refreshToken });
      } catch (error) {
        logDebug('Logout warning:', error.message);
      }
    }
    await clearAuthState();
  }

  async function refreshTokens() {
    if (!refreshTokenValid()) {
      throw new Error('Refresh token missing or expired');
    }
    try {
      const result = await callAuthEndpoint('/api/auth/refresh', {
        refreshToken: state.refreshToken
      });
      applyAuthResponse(result);
      await persistAuthState();
    } catch (error) {
      state.status.online = false;
      state.status.lastError = error.message;
      await clearAuthState();
      throw error;
    }
  }

  async function ensureAuthReady() {
    if (accessTokenValid()) {
      logDebug('ensureAuthReady: access token valid');
      return;
    }
    if (refreshTokenValid()) {
      logDebug('ensureAuthReady: refreshing with valid refresh token');
      await refreshTokens();
      return;
    }
    debugStateSnapshot('ensureAuthReady: missing authentication');
    throw new Error('Authentication required');
  }

  async function callApi(path, options = {}, retryOnAuthError = true) {
    await RemoteSyncClient.ensureInitialized();
    await ensureAuthReady();
    if (!state.accessToken) {
      throw new Error('Not authenticated');
    }

    const method = (options && options.method) || 'GET';
    logDebug('callApi: requesting', method, path);

    const headers = Object.assign(
      {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${state.accessToken}`
      },
      options.headers || {}
    );

    const response = await fetchWithTimeout(
      new URL(path, state.baseUrl).toString(),
      { ...options, headers },
      options.timeout || 15000
    );

    logDebug('callApi: response', method, path, 'status', response.status);

    if (response.status === 401 && retryOnAuthError) {
      logDebug('callApi: received 401, attempting token refresh');
      await refreshTokens();
      return callApi(path, options, false);
    }

    if (!response.ok && response.status !== 304) {
      const body = await safeJson(response);
      const error = new Error(body?.error || response.statusText);
      error.status = response.status;
      logDebug('callApi: error', method, path, 'status', response.status, 'message', error.message);
      throw error;
    }

    return response;
  }

  function normalizeDueDate(value) {
    if (!value) return value;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toISOString().slice(0, 10);
  }

  function mapRemoteAssignment(item) {
    return {
      id: item.id,
      title: item.title,
      description: item.description,
      dueDate: normalizeDueDate(item.dueDate),
      class: item.courseName || '',
      courseName: item.courseName || '',
      status: item.status || 'pending',
      externalId: item.externalId || null,
      createdAt: item.createdAt
    };
  }

  function localCourseName(assignment) {
    return assignment.courseName || assignment.class || '';
  }

  function toApiAssignment(assignment) {
    const payload = {
      id: assignment.id,
      title: assignment.title,
      description: assignment.description,
      courseName: localCourseName(assignment),
      status: assignment.status || 'pending',
      externalId: assignment.externalId
    };
    if (assignment.dueDate) {
      payload.dueDate = assignment.dueDate;
    }
    return payload;
  }

  async function listRemoteCustomAssignments() {
    const response = await callApi('/api/custom-assignments', { method: 'GET' });
    const data = (await response.json()) || [];
    const assignments = data.map(mapRemoteAssignment);
    cacheCustomAssignments(assignments);
    return assignments;
  }

  function computeCustomAssignmentsSignature(assignments = []) {
    return assignments
      .map((assignment) => {
        const signaturePayload = {
          id: assignment.id || '',
          title: assignment.title || '',
          description: assignment.description || '',
          dueDate: normalizeDueDate(assignment.dueDate) || '',
          status: assignment.status || 'pending',
          externalId: assignment.externalId || '',
          courseName: localCourseName(assignment)
        };
        return JSON.stringify(signaturePayload);
      })
      .sort()
      .join('|');
  }

  function cacheCustomAssignments(assignments, options = {}) {
    const persist = options.persist !== false;
    const clonedAssignments = assignments.map((assignment) => ({ ...assignment }));
    state.caches.customAssignments = clonedAssignments;
    state.caches.customAssignmentsSignature = computeCustomAssignmentsSignature(assignments);
    if (persist) {
      writeLocalCache(LOCAL_CACHE_KEYS.customAssignments, clonedAssignments);
    }
  }

  function toCheckedAssignmentsMap(records) {
    const mapped = {};
    for (const entry of records) {
      if (entry.assignmentId && entry.status === 'success') {
        mapped[entry.assignmentId] = 1;
      }
    }
    return mapped;
  }

  async function fetchCheckedAssignments(opts = {}) {
    const { forceRefresh = false } = opts;
    if (!forceRefresh && state.caches.checkedAssignments) {
      return state.caches.checkedAssignments;
    }

    logDebug('fetchCheckedAssignments: start', { forceRefresh });

    const response = await callApi('/api/assignment-checks', { method: 'GET' });
    if (response.status === 304) {
      logDebug('fetchCheckedAssignments: received 304, using cached data');
      let mapped = state.caches.checkedAssignments;
      if (!mapped) {
        const fallback = await storageGet('sync', [SYNC_STORAGE_KEYS.checkedAssignments]);
        mapped = fallback?.[SYNC_STORAGE_KEYS.checkedAssignments] || {};
        logDebug('fetchCheckedAssignments: loaded fallback from sync storage', {
          hasFallback: !!mapped && Object.keys(mapped).length > 0
        });
      }
      state.caches.checkedAssignments = mapped || {};
      writeLocalCache(LOCAL_CACHE_KEYS.checkedAssignments, state.caches.checkedAssignments);
      state.status.online = true;
      state.status.lastSync = new Date().toISOString();
      return { ...(state.caches.checkedAssignments || {}) };
    }

    const records = (await safeJson(response)) || [];
    const mapped = toCheckedAssignmentsMap(records);
    logDebug('fetchCheckedAssignments: fetched records', { count: records.length });

    state.caches.checkedAssignments = mapped;
    writeLocalCache(LOCAL_CACHE_KEYS.checkedAssignments, mapped);
    state.status.online = true;
    state.status.lastSync = new Date().toISOString();
    return { ...mapped };
  }

  async function replaceRemoteCustomAssignments(assignments) {
    await ensureAuthReady();
    const safeAssignments = Array.isArray(assignments) ? assignments : [];
    const nextSignature = computeCustomAssignmentsSignature(safeAssignments);

    if (state.caches.customAssignmentsSignature === nextSignature) {
      return;
    }

    await callApi('/api/custom-assignments', {
      method: 'PUT',
      body: JSON.stringify({
        assignments: safeAssignments.map(toApiAssignment)
      })
    });

    cacheCustomAssignments(safeAssignments);
    state.status.lastSync = new Date().toISOString();
  }

  async function syncCheckedAssignments(checked) {
    await ensureAuthReady();
    const existing = await fetchCheckedAssignments();
    const next = {};
    const checkedIds = [];
    for (const [assignmentId, flag] of Object.entries(checked || {})) {
      if (flag) {
        next[assignmentId] = 1;
        checkedIds.push(assignmentId);
      }
    }

    const existingIds = Object.keys(existing || {});
    if (
      existingIds.length === checkedIds.length &&
      existingIds.every((id) => next[id])
    ) {
      return;
    }

    await callApi('/api/assignment-checks', {
      method: 'PUT',
      body: JSON.stringify({
        assignmentIds: checkedIds,
        assignmentDate: new Date().toISOString(),
        status: 'success',
        metadata: { checked: true }
      })
    });

    state.caches.checkedAssignments = next;
    state.status.lastSync = new Date().toISOString();
  }

  async function removeLegacyStorage() {
    await storageRemove('local', LEGACY_KEYS);
  }

  async function ensureInitialized() {
    if (state.initialized) return;
    if (state.initializing) {
      await state.initializing;
      return;
    }
    state.initializing = (async () => {
      await removeLegacyStorage();
      await loadStateFromStorage();
      ensureDeviceId();
      if (refreshTokenValid() && !accessTokenValid()) {
        try {
          await refreshTokens();
        } catch (error) {
          logDebug('Refresh during init failed:', error.message);
        }
      }
      state.initialized = true;
    })();
    await state.initializing;
  }

  function defaultValueForKey(key) {
    if (key === SYNC_STORAGE_KEYS.customAssignments) {
      return [];
    }
    if (key === SYNC_STORAGE_KEYS.checkedAssignments) {
      return {};
    }
    return null;
  }

  const RemoteSyncClient = {
    getStatus() {
      const authStatus =
        typeof state.status.authenticated === 'boolean'
          ? state.status.authenticated
          : accessTokenValid();
      return {
        ...state.status,
        authenticated: authStatus,
        baseUrl: state.baseUrl,
        email: state.email
      };
    },
    async ensureInitialized() {
      await ensureInitialized();
    },
    async setBaseUrl(baseUrl) {
      state.baseUrl = baseUrl || DEFAULT_API_BASE;
      await storageSet('local', { [LOCAL_STORAGE_KEYS.baseUrl]: state.baseUrl });
    },
    async signUp(email, password) {
      return signUp(email, password);
    },
    async login(email, password) {
      return login(email, password);
    },
    async logout() {
      await logout();
    },
    getEmail() {
      return state.email;
    },
    async ensureAuthReady() {
      await ensureAuthReady();
    },
    async get(key) {
      await RemoteSyncClient.ensureInitialized();
      const hasAuth =
        accessTokenValid() || refreshTokenValid() || state.status.authenticated === true;

      if (!hasAuth) {
        state.status.authenticated = false;
        logDebug('RemoteSyncClient.get: no auth available', { key });
        return deepCopy(defaultValueForKey(key));
      }

      try {
        if (key === SYNC_STORAGE_KEYS.customAssignments) {
          await ensureAuthReady();
          const assignments = await listRemoteCustomAssignments();
          cacheCustomAssignments(assignments);
          state.status.online = true;
          state.status.lastSync = new Date().toISOString();
          return assignments.map((assignment) => ({ ...assignment }));
        }

        if (key === SYNC_STORAGE_KEYS.checkedAssignments) {
          await ensureAuthReady();
          const mapped = await fetchCheckedAssignments({ forceRefresh: true });
          return { ...mapped };
        }

        if (key === undefined) {
          await ensureAuthReady();
          const response = await callApi('/api/settings', { method: 'GET' });
          const settings = await response.json();
          writeLocalCache(LOCAL_CACHE_KEYS.settings, settings?.preferences || settings || {});
          state.status.online = true;
          state.status.lastSync = new Date().toISOString();
          return settings;
        }
      } catch (error) {
        state.status.online = false;
        state.status.lastError = error.message;
        if (isAuthenticationError(error)) {
          logDebug('RemoteSyncClient.get: authentication error', { key, error: error.message });
          await clearAuthState();
          return deepCopy(defaultValueForKey(key));
        }
        logDebug('RemoteSyncClient.get: non-auth error', { key, error: error.message });
      }

      const fallback = await storageGet('sync', key ? [key] : null);
      const fallbackValue = key ? fallback[key] : fallback;
      if (key === undefined) {
        writeLocalCache(LOCAL_CACHE_KEYS.settings, fallbackValue?.preferences || fallbackValue || {});
      } else if (key === SYNC_STORAGE_KEYS.customAssignments) {
        cacheCustomAssignments(Array.isArray(fallbackValue) ? fallbackValue : [], { persist: true });
      } else if (key === SYNC_STORAGE_KEYS.checkedAssignments) {
        writeLocalCache(LOCAL_CACHE_KEYS.checkedAssignments, fallbackValue || {});
      }
      return fallbackValue;
    },
    async set(payload) {
      await RemoteSyncClient.ensureInitialized();
      const entries = Object.entries(payload || {});
      const fallbackPayload = {};
      const hasAuth =
        accessTokenValid() || refreshTokenValid() || state.status.authenticated === true;

      if (!hasAuth) {
        state.status.authenticated = false;
        logDebug('RemoteSyncClient.set: blocked due to auth', { keys: Object.keys(payload || {}) });
        return;
      }

      for (const [key, value] of entries) {
        try {
          if (key === SYNC_STORAGE_KEYS.customAssignments) {
            const normalizedAssignments = Array.isArray(value) ? value : [];
            await replaceRemoteCustomAssignments(normalizedAssignments);
            cacheCustomAssignments(normalizedAssignments);
          } else if (key === SYNC_STORAGE_KEYS.checkedAssignments) {
            await syncCheckedAssignments(value || {});
          } else if (key === 'preferences') {
            await ensureAuthReady();
            await callApi('/api/settings', {
              method: 'PUT',
              body: JSON.stringify({ preferences: value })
            });
          } else {
            await ensureAuthReady();
            await callApi('/api/settings', {
              method: 'PUT',
              body: JSON.stringify(value)
            });
          }
          if (key === SYNC_STORAGE_KEYS.customAssignments) {
            cacheCustomAssignments(Array.isArray(value) ? value : [], { persist: true });
          } else if (key === SYNC_STORAGE_KEYS.checkedAssignments) {
            writeLocalCache(LOCAL_CACHE_KEYS.checkedAssignments, value || {});
          } else if (key === 'preferences') {
            writeLocalCache(LOCAL_CACHE_KEYS.settings, value || {});
          }
          state.status.online = true;
          state.status.lastError = null;
        } catch (error) {
          state.status.online = false;
          state.status.lastError = error.message;
          if (isAuthenticationError(error)) {
            logDebug('RemoteSyncClient.set: authentication error', { key, error: error.message });
            await clearAuthState();
          } else {
            logDebug('RemoteSyncClient.set: non-auth error', { key, error: error.message });
            fallbackPayload[key] = value;
          }
        }
      }

      if (Object.keys(fallbackPayload).length > 0) {
        await storageSet('sync', fallbackPayload);
      } else if (entries.length === 0) {
        await storageRemove('sync', Object.values(SYNC_STORAGE_KEYS));
      }
    },
    async checkAuthStatus(options = {}) {
      const { timeout = 5000 } = options;
      await RemoteSyncClient.ensureInitialized();
      if (!state.accessToken) {
        logDebug('checkAuthStatus: no access token');
        await clearAuthState();
        return { authenticated: false };
      }

      try {
        const response = await callApi('/api/auth/status', { method: 'GET', timeout });
        const data = await safeJson(response);
        state.status.online = true;
        state.status.lastError = null;
        state.status.authenticated = true;
        state.status.authCheckedAt = new Date().toISOString();
        state.status.lastSync = new Date().toISOString();
        logDebug('checkAuthStatus: authenticated', {
          userId: data?.userId || state.userId || null,
          sessionId: data?.sessionId || null
        });
        return {
          authenticated: true,
          userId: data?.userId || state.userId || null,
          sessionId: data?.sessionId || null,
          serverTime: data?.serverTime || null
        };
      } catch (error) {
        if (error && error.status === 401) {
          logDebug('checkAuthStatus: received 401, clearing auth');
          state.status.authenticated = false;
          state.status.online = false;
          state.status.lastError = 'Unauthorized';
          await clearAuthState();
          return { authenticated: false };
        }
        state.status.online = false;
        state.status.lastError = error.message;
        state.status.authenticated = false;
        logDebug('checkAuthStatus: error', { message: error.message });
        throw error;
      }
    },
    getLocalCacheSnapshot(key) {
      const localKey = resolveLocalCacheKey(key);
      const entry = readLocalCache(localKey);
      return entry ? deepCopy(entry.data) : null;
    },
    getLocalCacheMeta(key) {
      const localKey = resolveLocalCacheKey(key);
      const entry = readLocalCache(localKey);
      return entry ? { updatedAt: entry.updatedAt || 0 } : null;
    }
  };

  window.RemoteSyncClient = RemoteSyncClient;
})();

