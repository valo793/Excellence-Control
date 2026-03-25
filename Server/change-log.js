import crypto from 'crypto';

export const USER_TABLE_NAME = 'APP_USERS';
export const PROJECT_TABLE_NAME = 'PROJECTS';
export const PROJECT_EARNINGS_TABLE_NAME = 'PROJECT_EARNINGS';

let userCapabilitiesCache = null;
let userCapabilitiesCacheAt = 0;

function toIsoString(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function normalizeYesNo(value, fallback = 'N') {
  if (value === null || value === undefined || value === '') return fallback;
  const normalized = String(value).trim().toUpperCase();
  return normalized === 'Y' ? 'Y' : 'N';
}

function normalizeString(value, maxLen = null) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  return typeof maxLen === 'number' ? text.slice(0, maxLen) : text;
}

function normalizeRoleList(value) {
  const roles = [];

  const append = item => {
    if (!item) return;
    if (Array.isArray(item)) {
      item.forEach(append);
      return;
    }
    if (typeof item === 'string') {
      item
        .split(',')
        .map(v => v.trim().toUpperCase())
        .filter(Boolean)
        .forEach(v => roles.push(v));
      return;
    }
    if (typeof item === 'object') {
      append(item.name ?? item.role ?? item.ROLE ?? item.NAME);
    }
  };

  append(value);
  return [...new Set(roles)].sort((a, b) => a.localeCompare(b));
}

function normalizeUserSnapshotInput(input) {
  if (!input || typeof input !== 'object') return null;
  return {
    id: Number(input.id ?? input.ID ?? input.recordId ?? input.RECORD_ID) || null,
    email: normalizeString(input.email ?? input.EMAIL, 255),
    username: normalizeString(input.username ?? input.USERNAME, 150),
    displayName: normalizeString(input.displayName ?? input.DISPLAY_NAME, 200),
    name: normalizeString(input.name ?? input.NAME, 200),
    status: normalizeString(input.status ?? input.STATUS, 30) || 'ACTIVE',
    isVerified: normalizeYesNo(input.isVerified ?? input.IS_VERIFIED, 'N'),
    emailVerified:
      input.emailVerified === null || input.EMAIL_VERIFIED === null
        ? null
        : normalizeYesNo(input.emailVerified ?? input.EMAIL_VERIFIED, 'N'),
    verifiedAt: toIsoString(input.verifiedAt ?? input.VERIFIED_AT),
    createdAt: toIsoString(input.createdAt ?? input.CREATED_AT),
    roles: normalizeRoleList(input.roles ?? input.ROLES),
  };
}

function sanitizeAuditPayload(value) {
  if (value === undefined) return null;
  if (value === null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return Number(value);

  if (value instanceof Date) {
    const iso = toIsoString(value);
    return iso ?? null;
  }

  if (Array.isArray(value)) {
    return value.map(sanitizeAuditPayload);
  }

  if (typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value)) {
      out[key] = sanitizeAuditPayload(value[key]);
    }
    return out;
  }

  return String(value);
}

export function parseLogJson(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function buildActorContext(req, fallback = {}) {
  const rawActorId = Number(req?.user?.sub);
  const actorId = Number.isFinite(rawActorId) ? rawActorId : (fallback.actorId ?? null);
  const actorIdent = normalizeString(
    req?.actorEmail ?? req?.user?.email ?? fallback.actorIdent ?? 'SYSTEM',
    250,
  ) || 'SYSTEM';
  return { actorId, actorIdent };
}

function normalizeComparable(value) {
  if (Array.isArray(value)) {
    return value.map(normalizeComparable);
  }
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort((a, b) => a.localeCompare(b))
      .reduce((acc, key) => {
        acc[key] = normalizeComparable(value[key]);
        return acc;
      }, {});
  }
  if (value === undefined) return null;
  return value;
}

function stableStringify(value) {
  return JSON.stringify(normalizeComparable(value));
}

export function snapshotsDiffer(before, after) {
  return stableStringify(before || null) !== stableStringify(after || null);
}

function getAuditActionForSnapshots(beforeSnapshot, afterSnapshot, fallback = 'U') {
  if (!beforeSnapshot && afterSnapshot) return 'C';
  if (beforeSnapshot && !afterSnapshot) return 'D';
  return fallback;
}

async function getUserCapabilities(connection) {
  const now = Date.now();
  if (userCapabilitiesCache && now - userCapabilitiesCacheAt < 60_000) {
    return userCapabilitiesCache;
  }

  const rs = await connection.execute(
    `
      SELECT COLUMN_NAME
      FROM ALL_TAB_COLUMNS
      WHERE OWNER = 'EC_APP'
        AND TABLE_NAME = 'APP_USERS'
        AND COLUMN_NAME IN ('STATUS', 'EMAIL_VERIFIED', 'VERIFIED_AT')
    `,
  );

  const set = new Set(rs.rows.map(row => row.COLUMN_NAME || row[0]));
  userCapabilitiesCache = {
    hasStatus: set.has('STATUS'),
    hasEmailVerified: set.has('EMAIL_VERIFIED'),
    hasVerifiedAt: set.has('VERIFIED_AT'),
  };
  userCapabilitiesCacheAt = now;
  return userCapabilitiesCache;
}

export async function fetchAppUserSnapshot(connection, userId) {
  const id = Number(userId);
  if (!Number.isInteger(id) || id <= 0) return null;

  const capabilities = await getUserCapabilities(connection);
  const statusExpr = capabilities.hasStatus ? 'u.STATUS AS STATUS' : "'ACTIVE' AS STATUS";
  const emailVerifiedExpr = capabilities.hasEmailVerified
    ? 'u.EMAIL_VERIFIED AS EMAIL_VERIFIED'
    : 'NULL AS EMAIL_VERIFIED';
  const verifiedAtExpr = capabilities.hasVerifiedAt
    ? 'u.VERIFIED_AT AS VERIFIED_AT'
    : 'NULL AS VERIFIED_AT';

  const rs = await connection.execute(
    `
      SELECT
        u.ID,
        u.EMAIL,
        u.USERNAME,
        u.DISPLAY_NAME,
        u.NAME,
        ${statusExpr},
        u.IS_VERIFIED,
        ${emailVerifiedExpr},
        ${verifiedAtExpr},
        u.CREATED_AT,
        NVL((
          SELECT LISTAGG(r.NAME, ',') WITHIN GROUP (ORDER BY r.NAME)
          FROM EC_APP.USER_ROLES ur
          JOIN EC_APP.ROLES r ON r.ID = ur.ROLE_ID
          WHERE ur.USER_ID = u.ID
        ), '') AS ROLES
      FROM EC_APP.APP_USERS u
      WHERE u.ID = :id
    `,
    { id },
  );

  if (!rs.rows.length) return null;
  return normalizeUserSnapshotInput(rs.rows[0]);
}

function buildLogPayload(tableName, row) {
  if (row === null || row === undefined) return null;

  if (tableName === USER_TABLE_NAME) {
    const normalized = normalizeUserSnapshotInput(row);
    return normalized || null;
  }

  return sanitizeAuditPayload(row);
}

export async function insertChangeLog(connection, {
  tableName = USER_TABLE_NAME,
  recordId,
  action,
  actorId,
  actorIdent,
  oldRow,
  newRow,
}) {
  const normalizedAction = String(action || '').trim().toUpperCase().slice(0, 1);
  if (!normalizedAction) {
    throw new Error('Audit action is required');
  }

  const normalizedTableName = normalizeString(tableName, 128);
  if (!normalizedTableName) {
    throw new Error('Audit table name is required');
  }

  const rid = Number(recordId);
  if (!Number.isInteger(rid) || rid <= 0) {
    throw new Error('Audit record ID is invalid');
  }

  const oldPayload = buildLogPayload(normalizedTableName, oldRow);
  const newPayload = buildLogPayload(normalizedTableName, newRow);

  await connection.execute(
    `
      INSERT INTO EC_APP.CHANGE_LOG
        (TABLE_NAME, RECORD_ID, ACTION, CHANGED_AT, ACTOR_ID, ACTOR_IDENT, OLD_ROW_JSON, NEW_ROW_JSON)
      VALUES
        (:tableName, :recordId, :action, SYSDATE, :actorId, :actorIdent, :oldRowJson, :newRowJson)
    `,
    {
      tableName: normalizedTableName,
      recordId: rid,
      action: normalizedAction,
      actorId: actorId ? Number(actorId) : null,
      actorIdent: normalizeString(actorIdent, 250) || 'SYSTEM',
      oldRowJson: oldPayload ? JSON.stringify(oldPayload) : null,
      newRowJson: newPayload ? JSON.stringify(newPayload) : null,
    },
    { autoCommit: false },
  );
}

export async function tryInsertChangeLog(connection, payload) {
  try {
    await insertChangeLog(connection, payload);
    return true;
  } catch (error) {
    console.error('WARN audit-log insert failed', error?.message || error);
    return false;
  }
}

export async function tryInsertEntityChangeLog(
  connection,
  req,
  {
    tableName,
    recordId,
    beforeSnapshot,
    afterSnapshot,
    fallbackAction = 'U',
  } = {},
) {
  if (!snapshotsDiffer(beforeSnapshot, afterSnapshot)) return false;

  const actorContext = buildActorContext(req);
  const action = getAuditActionForSnapshots(beforeSnapshot, afterSnapshot, fallbackAction);

  return tryInsertChangeLog(connection, {
    tableName,
    recordId,
    action,
    actorId: actorContext.actorId,
    actorIdent: actorContext.actorIdent,
    oldRow: beforeSnapshot || null,
    newRow: afterSnapshot || null,
  });
}

function httpError(status, code, message) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return err;
}

async function assertUniqueIdentityFields(connection, userId, snapshot) {
  const id = Number(userId);
  if (!Number.isInteger(id) || id <= 0) {
    throw httpError(400, 'INVALID_USER_ID', 'Invalid user ID');
  }

  if (snapshot.email) {
    const emailConflict = await connection.execute(
      `
        SELECT ID
        FROM EC_APP.APP_USERS
        WHERE LOWER(TRIM(EMAIL)) = LOWER(TRIM(:email))
          AND ID <> :id
        FETCH FIRST 1 ROWS ONLY
      `,
      { email: snapshot.email, id },
    );
    if (emailConflict.rows.length) {
      throw httpError(409, 'EMAIL_CONFLICT', 'Cannot restore this change because e-mail is already used.');
    }
  }

  if (snapshot.username) {
    const usernameConflict = await connection.execute(
      `
        SELECT ID
        FROM EC_APP.APP_USERS
        WHERE LOWER(TRIM(USERNAME)) = LOWER(TRIM(:username))
          AND ID <> :id
        FETCH FIRST 1 ROWS ONLY
      `,
      { username: snapshot.username, id },
    );
    if (usernameConflict.rows.length) {
      throw httpError(409, 'USERNAME_CONFLICT', 'Cannot restore this change because username is already used.');
    }
  }
}

export async function syncUserRoles(connection, userId, roles) {
  const id = Number(userId);
  if (!Number.isInteger(id) || id <= 0) return;

  const normalizedRoles = normalizeRoleList(roles);

  await connection.execute(
    `DELETE FROM EC_APP.USER_ROLES WHERE USER_ID = :userId`,
    { userId: id },
    { autoCommit: false },
  );

  for (const roleName of normalizedRoles) {
    await connection.execute(
      `
        INSERT INTO EC_APP.USER_ROLES (USER_ID, ROLE_ID)
        SELECT :userId, r.ID
        FROM EC_APP.ROLES r
        WHERE TRIM(UPPER(r.NAME)) = :roleName
      `,
      { userId: id, roleName },
      { autoCommit: false },
    );
  }
}

export async function applyUserSnapshot(connection, userId, snapshotInput, options = {}) {
  const snapshot = normalizeUserSnapshotInput(snapshotInput);
  if (!snapshot) {
    throw httpError(400, 'INVALID_SNAPSHOT', 'Snapshot payload is invalid');
  }

  const id = Number(userId);
  if (!Number.isInteger(id) || id <= 0) {
    throw httpError(400, 'INVALID_USER_ID', 'Invalid user ID');
  }

  const current = await fetchAppUserSnapshot(connection, id);
  if (!current && !options.allowCreate) {
    throw httpError(409, 'USER_NOT_FOUND', 'Target user does not exist anymore.');
  }

  if (!current && options.allowCreate) {
    throw httpError(
      409,
      'HARD_DELETE_NOT_SUPPORTED',
      'Automatic recreation of hard-deleted users is not supported without sensitive credential fields.',
    );
  }

  await assertUniqueIdentityFields(connection, id, snapshot);
  const capabilities = await getUserCapabilities(connection);

  const setParts = [
    'EMAIL = :email',
    'USERNAME = :username',
    'DISPLAY_NAME = :displayName',
    'NAME = :name',
    'IS_VERIFIED = :isVerified',
  ];
  const binds = {
    id,
    email: snapshot.email || current.email,
    username: snapshot.username || current.username,
    displayName: snapshot.displayName || snapshot.username || current.displayName,
    name: snapshot.name,
    isVerified: normalizeYesNo(snapshot.isVerified, current.isVerified || 'N'),
  };

  if (capabilities.hasStatus) {
    setParts.push('STATUS = :status');
    binds.status = snapshot.status || current.status || 'ACTIVE';
  }
  if (capabilities.hasEmailVerified) {
    setParts.push('EMAIL_VERIFIED = :emailVerified');
    binds.emailVerified = snapshot.emailVerified === null
      ? normalizeYesNo(current.emailVerified, 'N')
      : normalizeYesNo(snapshot.emailVerified, 'N');
  }
  if (capabilities.hasVerifiedAt) {
    setParts.push('VERIFIED_AT = :verifiedAt');
    binds.verifiedAt = snapshot.verifiedAt ? new Date(snapshot.verifiedAt) : null;
  }

  await connection.execute(
    `
      UPDATE EC_APP.APP_USERS
      SET ${setParts.join(', ')}
      WHERE ID = :id
    `,
    binds,
    { autoCommit: false },
  );

  if (Array.isArray(snapshot.roles)) {
    await syncUserRoles(connection, id, snapshot.roles);
  }
}

export async function archiveUser(connection, userId) {
  const id = Number(userId);
  if (!Number.isInteger(id) || id <= 0) {
    throw httpError(400, 'INVALID_USER_ID', 'Invalid user ID');
  }

  const capabilities = await getUserCapabilities(connection);
  if (!capabilities.hasStatus) {
    throw httpError(409, 'STATUS_COLUMN_MISSING', 'User soft delete is not available in this schema.');
  }

  await connection.execute(
    `
      UPDATE EC_APP.APP_USERS
      SET STATUS = 'ARCHIVED'
      WHERE ID = :id
    `,
    { id },
    { autoCommit: false },
  );
}

export function hashToken(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

export function toHttpErrorResponse(res, error, fallbackMessage) {
  const status = Number(error?.status) || 500;
  const code = error?.code || null;
  const message = error?.message || fallbackMessage || 'Operation failed';
  return res.status(status).json(code ? { error: message, code } : { error: message });
}
