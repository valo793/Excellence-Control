// src/config/oracle.js
const BASE = (import.meta.env?.VITE_API_URL || 'http://localhost:3001').replace(/\/+$/, '');
const TOKEN_KEY = 'ec_token';

function getStoredToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function storeToken(token, rememberMe = false) {
  try {
    localStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(TOKEN_KEY);
    if (!token) return;

    if (rememberMe) {
      localStorage.setItem(TOKEN_KEY, token);
    } else {
      sessionStorage.setItem(TOKEN_KEY, token);
    }
  } catch (error) {
    console.error('Failed to persist auth token', error);
  }
}

function clearToken() {
  try {
    localStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(TOKEN_KEY);
  } catch (error) {
    console.error('Failed to clear auth token', error);
  }
}

function hasLocalToken() {
  try {
    return !!localStorage.getItem(TOKEN_KEY);
  } catch {
    return false;
  }
}

function buildApiError({ message, status, code }) {
  const err = new Error(message || 'Request failed');
  err.status = status;
  err.code = code || null;
  return err;
}

async function parseError(res) {
  let message = 'Request failed';
  let code = null;

  try {
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const data = await res.json();
      message = data?.error || data?.message || message;
      code = data?.code || null;
    } else {
      const text = await res.text();
      if (text) message = text;
    }
  } catch { }

  return { message, code };
}

async function handle(res) {
  if (!res.ok) {
    const { message, code } = await parseError(res);
    if (res.status === 401) {
      clearToken();
    }
    throw buildApiError({ message, status: res.status, code });
  }

  if (res.status === 204) return null;

  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return res.json();
  }
  return res.text();
}

function authHeaders() {
  const token = getStoredToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function request(url, options = {}) {
  return fetch(url, {
    credentials: 'include',
    ...options,
  });
}

// ---------------- AUTH ----------------

export async function registerUser({ email, name, password }) {
  const res = await request(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
    },
    body: JSON.stringify({ email, name, password }),
  });

  const data = await handle(res);
  // Compatibility path if backend falls back and still returns token.
  if (data?.token) {
    storeToken(data.token, false);
  }
  return data;
}

export async function loginUser({ email, password, rememberMe = false }) {
  const res = await request(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
    },
    body: JSON.stringify({ email, password, rememberMe: !!rememberMe }),
  });

  const data = await handle(res);
  if (data?.token) {
    storeToken(data.token, !!rememberMe);
  }
  return data;
}

export async function refreshSession() {
  const res = await request(`${BASE}/api/auth/refresh`, {
    method: 'POST',
    headers: {
      ...authHeaders(),
    },
  });

  const data = await handle(res);
  if (data?.token) {
    const shouldPersist = hasLocalToken() || !!data?.rememberMe;
    storeToken(data.token, shouldPersist);
  }
  return data;
}

export async function verifyEmailToken(token) {
  const params = new URLSearchParams();
  params.set('token', token || '');

  const res = await request(`${BASE}/api/auth/verify-email?${params.toString()}`, {
    method: 'GET',
    headers: {
      ...authHeaders(),
    },
  });
  return handle(res);
}

export async function resendVerificationEmail({ email }) {
  const res = await request(`${BASE}/api/auth/resend-verification`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
    },
    body: JSON.stringify({ email }),
  });
  return handle(res);
}

export async function logoutUser() {
  try {
    const res = await request(`${BASE}/api/auth/logout`, {
      method: 'POST',
      headers: {
        ...authHeaders(),
      },
    });
    await handle(res);
  } finally {
    clearToken();
  }
}

export async function getCurrentUser() {
  const res = await request(`${BASE}/api/auth/me`, {
    headers: {
      ...authHeaders(),
    },
  });
  return handle(res);
}

export async function forgotPassword({ email }) {
  const res = await request(`${BASE}/api/auth/forgot-password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
    },
    body: JSON.stringify({ email }),
  });
  return handle(res);
}

export async function resetPassword({ email, token, password }) {
  const res = await request(`${BASE}/api/auth/reset-password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
    },
    body: JSON.stringify({ email, token, password }),
  });
  return handle(res);
}

// ---------------- PROJECTS ----------------

export async function getProjects() {
  const res = await request(`${BASE}/api/projects`, {
    headers: {
      ...authHeaders(),
    },
  });
  return handle(res);
}

export async function getProjectEarnings(projectId, { year } = {}) {
  const params = new URLSearchParams();
  if (year !== undefined && year !== null && year !== '') {
    params.set('year', String(year));
  }
  const qs = params.toString();
  const url = qs
    ? `${BASE}/api/projects/${projectId}/earnings?${qs}`
    : `${BASE}/api/projects/${projectId}/earnings`;
  const res = await request(url, {
    headers: {
      ...authHeaders(),
    },
  });
  return handle(res);
}

export async function upsertProjectEarning(projectId, { year, month, value, tipo, dolarValue, earningStatus }) {
  const res = await request(`${BASE}/api/projects/${projectId}/earnings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
    },
    body: JSON.stringify({
      year,
      month,
      value,
      tipo: tipo || null,
      dolarValue: dolarValue ?? null,
      earningStatus: earningStatus || null,
    }),
  });
  return handle(res);
}

export async function importEarningsBulk(rows = []) {
  const res = await request(`${BASE}/api/projects/earnings/import`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
    },
    body: JSON.stringify({ rows }),
  });
  return handle(res);
}

export async function replaceProjectEarnings(projectId, items = []) {
  const safeItems = Array.isArray(items) ? items : [];
  const res = await request(`${BASE}/api/projects/${projectId}/earnings`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
    },
    body: JSON.stringify({ items: safeItems }),
  });
  return handle(res);
}

export async function deleteProjectEarning(projectId, year, month) {
  const safeYear = encodeURIComponent(String(year ?? '').trim());
  const safeMonth = encodeURIComponent(String(month ?? '').trim());
  const res = await request(`${BASE}/api/projects/${projectId}/earnings/${safeYear}/${safeMonth}`, {
    method: 'DELETE',
    headers: {
      ...authHeaders(),
    },
  });
  return handle(res);
}

export async function createProject(projectData) {
  const res = await request(`${BASE}/api/projects`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
    },
    body: JSON.stringify(projectData),
  });
  return handle(res);
}

export async function importProjectsBulk({
  rows = [],
  dryRun = false,
  invalidRowsCount = 0,
  externalErrors = [],
} = {}) {
  const res = await request(`${BASE}/api/projects/import`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
    },
    body: JSON.stringify({
      rows,
      dryRun: !!dryRun,
      invalidRowsCount,
      externalErrors,
    }),
  });
  return handle(res);
}

export async function createProjectImportJob({
  rows = [],
  invalidRowsCount = 0,
  externalErrors = [],
} = {}) {
  const res = await request(`${BASE}/api/projects/import/jobs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
    },
    body: JSON.stringify({
      rows,
      invalidRowsCount,
      externalErrors,
    }),
  });
  return handle(res);
}

export async function getProjectImportJob(jobId) {
  const safeId = encodeURIComponent(String(jobId || '').trim());
  const res = await request(`${BASE}/api/projects/import/jobs/${safeId}`, {
    headers: {
      ...authHeaders(),
    },
  });
  return handle(res);
}

export async function cancelProjectImportJob(jobId) {
  const safeId = encodeURIComponent(String(jobId || '').trim());
  const res = await request(`${BASE}/api/projects/import/jobs/${safeId}`, {
    method: 'DELETE',
    headers: {
      ...authHeaders(),
    },
  });
  return handle(res);
}

export async function updateProject(id, partialData) {
  const res = await request(`${BASE}/api/projects/${id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
    },
    body: JSON.stringify(partialData),
  });
  return handle(res);
}

export async function deleteProject(id) {
  const res = await request(`${BASE}/api/projects/${id}`, {
    method: 'DELETE',
    headers: {
      ...authHeaders(),
    },
  });
  if (res.status === 204) return true;
  return handle(res);
}

// ---------------- DB Ping ----------------

export async function pingDb() {
  const res = await request(`${BASE}/api/db/ping`, {
    headers: {
      ...authHeaders(),
    },
  });
  return handle(res);
}

// ---------------- ADMIN ----------------

export async function adminGetUsers() {
  const res = await request(`${BASE}/api/admin/users`, {
    headers: {
      ...authHeaders(),
    },
  });
  return handle(res);
}

export async function adminUpdateUser(id, payload) {
  const res = await request(`${BASE}/api/admin/users/${id}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
    },
    body: JSON.stringify(payload),
  });
  return handle(res);
}

export async function adminGetUserAuditLogs(params = {}) {
  const qs = new URLSearchParams();
  const append = (key, value) => {
    if (value === null || value === undefined) return;
    const str = String(value).trim();
    if (!str) return;
    qs.set(key, str);
  };

  append('page', params.page);
  append('pageSize', params.pageSize);
  append('dateFrom', params.dateFrom);
  append('dateTo', params.dateTo);
  append('actor', params.actor);
  append('actorId', params.actorId);
  append('action', params.action);
  append('recordId', params.recordId);
  append('target', params.target);
  append('table', params.table);

  const query = qs.toString();
  const url = query
    ? `${BASE}/api/admin/audit/users?${query}`
    : `${BASE}/api/admin/audit/users`;

  const res = await request(url, {
    headers: {
      ...authHeaders(),
    },
  });
  return handle(res);
}

export async function adminGetUserAuditDetail(id) {
  const res = await request(`${BASE}/api/admin/audit/users/${id}`, {
    headers: {
      ...authHeaders(),
    },
  });
  return handle(res);
}

export async function adminRevertUserAuditLog(id, payload = {}) {
  const res = await request(`${BASE}/api/admin/audit/users/${id}/revert`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
    },
    body: JSON.stringify(payload || {}),
  });
  return handle(res);
}

// ---------------- DASHBOARD ----------------

export async function getDashboardKpis(queryString) {
  const res = await request(`${BASE}/api/dashboard/kpis?${queryString}`, {
    headers: {
      ...authHeaders(),
    },
  });
  return handle(res);
}

export async function getDashboardCharts(queryString) {
  const res = await request(`${BASE}/api/dashboard/charts?${queryString}`, {
    headers: {
      ...authHeaders(),
    },
  });
  return handle(res);
}

export async function getDashboardLeadTime(queryString) {
  const res = await request(`${BASE}/api/dashboard/lead-time?${queryString}`, {
    headers: {
      ...authHeaders(),
    },
  });
  return handle(res);
}

export async function getDashboardCosts(queryString) {
  const res = await request(`${BASE}/api/dashboard/costs?${queryString}`, {
    headers: {
      ...authHeaders(),
    },
  });
  return handle(res);
}

export async function getDashboardCostsMatrix(queryString) {
  const suffix = queryString ? `?${queryString}` : '';
  const res = await request(`${BASE}/api/dashboard/costs/matrix${suffix}`, {
    headers: {
      ...authHeaders(),
    },
  });
  return handle(res);
}

export async function getDashboardCostProjects({ year, month, search, dateFrom, dateTo } = {}) {
  const params = new URLSearchParams();
  if (year) params.append('year', year);
  if (month) params.append('month', month);
  if (search) params.append('search', search);
  if (dateFrom) params.append('dateFrom', dateFrom);
  if (dateTo) params.append('dateTo', dateTo);

  const qs = params.toString();
  const url = qs
    ? `${BASE}/api/dashboard/costs/projects?${qs}`
    : `${BASE}/api/dashboard/costs/projects`;

  const res = await request(url, {
    headers: {
      ...authHeaders(),
    },
  });
  return handle(res);
}

// ---------------- PROJECT FILES ----------------

export async function uploadProjectFiles(projectId, files) {
  const formData = new FormData();
  for (const file of files) {
    formData.append('files', file);
  }

  const res = await request(`${BASE}/api/projects/${projectId}/files`, {
    method: 'POST',
    headers: {
      ...authHeaders(),
    },
    body: formData,
  });

  return handle(res);
}

export async function getProjectFiles(projectId) {
  const res = await request(`${BASE}/api/projects/${projectId}/files`, {
    headers: {
      ...authHeaders(),
    },
  });
  return handle(res);
}

export async function deleteProjectFile(projectId, fileId) {
  const res = await request(`${BASE}/api/projects/${projectId}/files/${fileId}`, {
    method: 'DELETE',
    headers: {
      ...authHeaders(),
    },
  });
  if (res.status === 204) return true;
  return handle(res);
}
