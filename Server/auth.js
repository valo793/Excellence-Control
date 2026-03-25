import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import oracledb from 'oracledb';
import { sendMail } from './mailer.js';
import {
  USER_TABLE_NAME,
  fetchAppUserSnapshot,
  tryInsertChangeLog,
  buildActorContext,
} from './change-log.js';

const FALLBACK_JWT_SECRET = 'dev-secret-change-me';
const JWT_SECRET = String(process.env.JWT_SECRET || FALLBACK_JWT_SECRET).trim() || FALLBACK_JWT_SECRET;
const JWT_EXPIRES_SHORT = process.env.JWT_EXPIRES_SHORT || '1h';
const JWT_EXPIRES_LONG = process.env.JWT_EXPIRES_LONG || '30d';
const VERIFY_TOKEN_TTL_HOURS = Number(process.env.VERIFY_TOKEN_TTL_HOURS || 24);
const VERIFY_RESEND_COOLDOWN_SECONDS = Number(process.env.VERIFY_RESEND_COOLDOWN_SECONDS || 60);
const APP_WEB_URL = (process.env.APP_WEB_URL || process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/+$/, '');
const REFRESH_TOKEN_TTL_DAYS = Number(process.env.REFRESH_TOKEN_TTL_DAYS || 30);
const REFRESH_COOKIE_NAME = process.env.REFRESH_COOKIE_NAME || 'ec_refresh';
const REFRESH_COOKIE_PATH = process.env.REFRESH_COOKIE_PATH || '/api/auth';
const REFRESH_COOKIE_SAMESITE = String(process.env.REFRESH_COOKIE_SAMESITE || 'Lax');
const REFRESH_COOKIE_SECURE = String(
  process.env.REFRESH_COOKIE_SECURE || (process.env.NODE_ENV === 'production' ? 'true' : 'false'),
).toLowerCase() === 'true';
const AUTH_RATE_LIMIT_ENABLED = String(process.env.AUTH_RATE_LIMIT_ENABLED || 'true').toLowerCase() !== 'false';

if (process.env.NODE_ENV === 'production' && JWT_SECRET === FALLBACK_JWT_SECRET) {
  throw new Error('JWT_SECRET must be configured in production and cannot use the development fallback.');
}

if (JWT_SECRET === FALLBACK_JWT_SECRET) {
  console.warn('[AUTH] JWT_SECRET is using the development fallback. Configure JWT_SECRET for secure environments.');
}

const registerSchema = z.object({
  email: z.string().email().max(255),
  username: z.string().min(3).max(150).optional(),
  name: z.string().min(1).max(200).optional(),
  password: z.string().min(8).max(100),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  rememberMe: z.boolean().optional().default(false),
});

const forgotSchema = z.object({
  email: z.string().email(),
});

const resetSchema = z.object({
  email: z.string().email(),
  token: z.string().min(4).max(128),
  password: z.string().min(8).max(100),
});

const resendVerificationSchema = z.object({
  email: z.string().email(),
});

let capabilitiesCache = null;
let capabilitiesCacheAt = 0;

function toPositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function createAuthLimiter({
  windowMs = 15 * 60 * 1000,
  max = 20,
  errorCode = 'AUTH_RATE_LIMIT',
} = {}) {
  return rateLimit({
    windowMs: toPositiveInt(windowMs, 15 * 60 * 1000),
    max: toPositiveInt(max, 20),
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => !AUTH_RATE_LIMIT_ENABLED,
    handler(_req, res) {
      return res.status(429).json({
        error: 'Too many authentication requests. Please try again shortly.',
        code: errorCode,
      });
    },
  });
}

function generateResetCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function generateRandomToken() {
  return crypto.randomBytes(32).toString('hex');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

function issueJwt({ id, email }, rememberMe) {
  const expiresIn = rememberMe ? JWT_EXPIRES_LONG : JWT_EXPIRES_SHORT;
  const token = jwt.sign(
    { sub: String(id), email, rememberMe: !!rememberMe },
    JWT_SECRET,
    { expiresIn },
  );
  return { token, expiresIn };
}

function getVerifyLink(rawToken) {
  return `${APP_WEB_URL}/verify-email?token=${encodeURIComponent(rawToken)}`;
}

function normalizeSameSite(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'strict') return 'Strict';
  if (normalized === 'none') return 'None';
  return 'Lax';
}

function refreshCookieOptions(maxAgeMs) {
  const sameSite = normalizeSameSite(REFRESH_COOKIE_SAMESITE);
  return {
    httpOnly: true,
    secure: REFRESH_COOKIE_SECURE,
    sameSite,
    path: REFRESH_COOKIE_PATH,
    maxAge: typeof maxAgeMs === 'number' ? maxAgeMs : undefined,
  };
}

function setRefreshCookie(res, rawToken, maxAgeMs) {
  res.cookie(REFRESH_COOKIE_NAME, rawToken, refreshCookieOptions(maxAgeMs));
}

function clearRefreshCookie(res) {
  res.clearCookie(REFRESH_COOKIE_NAME, refreshCookieOptions());
}

function parseCookies(req) {
  const header = String(req.headers?.cookie || '');
  if (!header) return {};

  return header
    .split(';')
    .map(part => part.trim())
    .filter(Boolean)
    .reduce((acc, item) => {
      const idx = item.indexOf('=');
      if (idx <= 0) return acc;
      const key = item.slice(0, idx).trim();
      const value = item.slice(idx + 1).trim();
      if (!key) return acc;
      try {
        acc[key] = decodeURIComponent(value);
      } catch {
        acc[key] = value;
      }
      return acc;
    }, {});
}

function getRefreshTokenFromRequest(req) {
  const cookies = parseCookies(req);
  const raw = String(cookies[REFRESH_COOKIE_NAME] || '').trim();
  return raw || null;
}

function getRefreshTokenMaxAgeMs() {
  return Math.max(1, REFRESH_TOKEN_TTL_DAYS) * 24 * 60 * 60 * 1000;
}

async function persistRefreshToken(connection, { userId, tokenHash, expiresAt, userAgent, ipAddress }) {
  await connection.execute(
    `
      INSERT INTO EC_APP.AUTH_REFRESH_TOKENS
        (USER_ID, TOKEN_HASH, EXPIRES_AT, USER_AGENT, IP_ADDRESS)
      VALUES
        (:userId, :tokenHash, :expiresAt, :userAgent, :ipAddress)
    `,
    {
      userId,
      tokenHash,
      expiresAt,
      userAgent: userAgent ? String(userAgent).slice(0, 512) : null,
      ipAddress: ipAddress ? String(ipAddress).slice(0, 64) : null,
    },
    { autoCommit: false },
  );
}

async function createRefreshSessionToken(connection, { userId, userAgent, ipAddress }) {
  const rawToken = generateRandomToken();
  const tokenHash = hashToken(rawToken);
  const maxAgeMs = getRefreshTokenMaxAgeMs();
  const expiresAt = new Date(Date.now() + maxAgeMs);

  await persistRefreshToken(connection, { userId, tokenHash, expiresAt, userAgent, ipAddress });
  return { rawToken, tokenHash, expiresAt, maxAgeMs };
}

async function revokeRefreshTokenByHash(connection, tokenHash, reason = 'LOGOUT') {
  if (!tokenHash) return;
  await connection.execute(
    `
      UPDATE EC_APP.AUTH_REFRESH_TOKENS
      SET
        REVOKED_AT = NVL(REVOKED_AT, SYSTIMESTAMP),
        REVOKE_REASON = NVL(REVOKE_REASON, :reason)
      WHERE TOKEN_HASH = :tokenHash
    `,
    { tokenHash, reason: String(reason || 'LOGOUT').slice(0, 120) },
    { autoCommit: false },
  );
}

async function revokeAllRefreshTokensForUser(connection, userId, reason = 'SECURITY_EVENT') {
  if (!userId) return;
  await connection.execute(
    `
      UPDATE EC_APP.AUTH_REFRESH_TOKENS
      SET
        REVOKED_AT = NVL(REVOKED_AT, SYSTIMESTAMP),
        REVOKE_REASON = NVL(REVOKE_REASON, :reason)
      WHERE USER_ID = :userId
        AND REVOKED_AT IS NULL
    `,
    {
      userId,
      reason: String(reason || 'SECURITY_EVENT').slice(0, 120),
    },
    { autoCommit: false },
  );
}

async function getAuthSchemaCapabilities(connection) {
  const now = Date.now();
  if (capabilitiesCache && now - capabilitiesCacheAt < 60_000) {
    return capabilitiesCache;
  }

  const cols = await connection.execute(
    `
      SELECT COLUMN_NAME
      FROM ALL_TAB_COLUMNS
      WHERE OWNER = 'EC_APP'
        AND TABLE_NAME = 'APP_USERS'
        AND COLUMN_NAME IN ('EMAIL_VERIFIED', 'VERIFIED_AT')
    `,
  );

  const tables = await connection.execute(
    `
      SELECT TABLE_NAME
      FROM ALL_TABLES
      WHERE OWNER = 'EC_APP'
        AND TABLE_NAME IN ('EMAIL_VERIFICATION_TOKENS', 'AUTH_REFRESH_TOKENS')
    `,
  );

  const columnSet = new Set(cols.rows.map(r => r[0] || r.COLUMN_NAME));
  const tableSet = new Set(tables.rows.map(r => r[0] || r.TABLE_NAME));
  capabilitiesCache = {
    hasEmailVerifiedColumns: columnSet.has('EMAIL_VERIFIED') && columnSet.has('VERIFIED_AT'),
    hasEmailVerificationTokensTable: tableSet.has('EMAIL_VERIFICATION_TOKENS'),
    hasRefreshTokensTable: tableSet.has('AUTH_REFRESH_TOKENS'),
  };
  capabilitiesCacheAt = now;
  return capabilitiesCache;
}

async function createEmailVerificationToken(connection, userId, requestMeta) {
  const rawToken = generateRandomToken();
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + VERIFY_TOKEN_TTL_HOURS * 60 * 60 * 1000);

  await connection.execute(
    `
      INSERT INTO EC_APP.EMAIL_VERIFICATION_TOKENS
        (USER_ID, TOKEN_HASH, EXPIRES_AT, METADATA_JSON)
      VALUES
        (:userId, :tokenHash, :expiresAt, :metadataJson)
    `,
    {
      userId,
      tokenHash,
      expiresAt,
      metadataJson: JSON.stringify(requestMeta || {}),
    },
  );

  return rawToken;
}

async function sendVerificationEmail(email, token) {
  const verifyLink = getVerifyLink(token);
  await sendMail({
    to: email,
    subject: 'Verify your e-mail - Excellence Control',
    text:
      `Welcome to Excellence Control.\n\n` +
      `Please verify your e-mail by clicking the link below:\n${verifyLink}\n\n` +
      `This link expires in ${VERIFY_TOKEN_TTL_HOURS} hour(s).`,
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.5;color:#0f172a">
        <h2 style="margin:0 0 12px 0;color:#2563eb">Excellence Control</h2>
        <p style="margin:0 0 12px 0">Welcome. Please verify your e-mail to activate your account.</p>
        <p style="margin:0 0 16px 0">
          <a href="${verifyLink}" style="display:inline-block;padding:10px 14px;border-radius:8px;background:#2563eb;color:#fff;text-decoration:none;font-weight:600">
            Verify e-mail
          </a>
        </p>
        <p style="margin:0 0 6px 0;font-size:13px;color:#475569">If the button does not work, copy this URL:</p>
        <p style="margin:0 0 6px 0;font-size:13px;word-break:break-all">${verifyLink}</p>
        <p style="margin:0;font-size:12px;color:#64748b">This link expires in ${VERIFY_TOKEN_TTL_HOURS} hour(s).</p>
      </div>
    `,
  });
}

function neutralResendResponse(res) {
  return res.json({
    ok: true,
    message: 'If the account exists and is eligible, a verification e-mail has been sent.',
  });
}

export function authRoutes(app, pool) {
  const strictAuthLimiter = createAuthLimiter({
    windowMs: process.env.AUTH_RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000,
    max: process.env.AUTH_RATE_LIMIT_STRICT_MAX || 20,
    errorCode: 'AUTH_RATE_LIMIT_STRICT',
  });

  const regularAuthLimiter = createAuthLimiter({
    windowMs: process.env.AUTH_RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000,
    max: process.env.AUTH_RATE_LIMIT_MAX || 120,
    errorCode: 'AUTH_RATE_LIMIT',
  });

  app.post('/api/auth/register', strictAuthLimiter, async (req, res) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid payload', code: 'INVALID_PAYLOAD' });
    }

    let { email, username, name, password } = parsed.data;
    email = String(email).trim().toLowerCase();

    if (!username || !username.trim()) {
      username = email.split('@')[0].slice(0, 150);
    }
    username = username.trim();

    const displayName = (name && name.trim()) || username;
    const personName = name && name.trim() ? name.trim() : null;
    const passwordHash = await bcrypt.hash(password, 12);
    const requestMeta = {
      ip: req.ip || null,
      userAgent: req.headers['user-agent'] || null,
    };
    const actorContext = buildActorContext(req, { actorIdent: email });

    let connection;
    try {
      connection = await pool.getConnection();
      const capabilities = await getAuthSchemaCapabilities(connection);

      const existing = await connection.execute(
        `
          SELECT ID
          FROM EC_APP.APP_USERS
          WHERE EMAIL = :email
        `,
        { email },
      );
      if (existing.rows.length) {
        return res.status(409).json({ error: 'E-mail already registered', code: 'EMAIL_EXISTS' });
      }

      const insertUserSql = capabilities.hasEmailVerifiedColumns
        ? `
            INSERT INTO EC_APP.APP_USERS
              (EMAIL, USERNAME, DISPLAY_NAME, NAME, PASSWORD_HASH, IS_VERIFIED, EMAIL_VERIFIED, VERIFIED_AT)
            VALUES
              (:email, :username, :displayName, :personName, :passwordHash, 'N', 'N', NULL)
            RETURNING ID INTO :id
          `
        : `
            INSERT INTO EC_APP.APP_USERS
              (EMAIL, USERNAME, DISPLAY_NAME, NAME, PASSWORD_HASH, IS_VERIFIED)
            VALUES
              (:email, :username, :displayName, :personName, :passwordHash, 'N')
            RETURNING ID INTO :id
          `;

      const created = await connection.execute(
        insertUserSql,
        {
          email,
          username,
          displayName,
          personName,
          passwordHash,
          id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
        },
        { autoCommit: false },
      );

      const userId = created.outBinds.id[0];

      await connection.execute(
        `
          INSERT INTO EC_APP.USER_ROLES (USER_ID, ROLE_ID)
          SELECT :uid, r.ID
          FROM EC_APP.ROLES r
          WHERE r.NAME = 'VIEWER'
        `,
        { uid: userId },
        { autoCommit: false },
      );

      const createdSnapshot = await fetchAppUserSnapshot(connection, userId);
      await tryInsertChangeLog(connection, {
        tableName: USER_TABLE_NAME,
        recordId: userId,
        action: 'C',
        actorId: actorContext.actorId,
        actorIdent: actorContext.actorIdent,
        oldRow: null,
        newRow: createdSnapshot || {
          id: userId,
          email,
          username,
          displayName,
          name: personName,
          roles: ['VIEWER'],
        },
      });

      if (capabilities.hasEmailVerificationTokensTable) {
        const rawToken = await createEmailVerificationToken(connection, userId, requestMeta);
        await sendVerificationEmail(email, rawToken);
        await connection.commit();

        return res.status(201).json({
          ok: true,
          verificationRequired: true,
          message: 'Account created. Please verify your e-mail before login.',
        });
      }

      // Safe fallback for compatibility if the verification migration is not applied yet.
      const auth = issueJwt({ id: userId, email }, true);
      await connection.commit();
      return res.status(201).json({
        token: auth.token,
        expiresIn: auth.expiresIn,
        warning: 'Email verification schema not available. Run migration to enable verification flow.',
      });
    } catch (error) {
      console.error(error);
      if (connection) {
        try { await connection.rollback(); } catch {}
      }
      return res.status(500).json({ error: 'Failed to register account' });
    } finally {
      try { await connection?.close(); } catch {}
    }
  });

  app.post('/api/auth/login', strictAuthLimiter, async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid payload', code: 'INVALID_PAYLOAD' });
    }

    const { email: inputEmail, password, rememberMe } = parsed.data;
    const email = String(inputEmail).trim().toLowerCase();

    let connection;
    try {
      connection = await pool.getConnection();
      const capabilities = await getAuthSchemaCapabilities(connection);

      const selectUserSql = capabilities.hasEmailVerifiedColumns
        ? `
            SELECT ID, PASSWORD_HASH, IS_VERIFIED, EMAIL_VERIFIED
            FROM EC_APP.APP_USERS
            WHERE EMAIL = :email
          `
        : `
            SELECT ID, PASSWORD_HASH, IS_VERIFIED
            FROM EC_APP.APP_USERS
            WHERE EMAIL = :email
          `;

      const userRs = await connection.execute(selectUserSql, { email });
      if (!userRs.rows.length) {
        return res.status(401).json({ error: 'Invalid credentials', code: 'INVALID_CREDENTIALS' });
      }

      const row = userRs.rows[0];
      const passwordOk = await bcrypt.compare(password, row.PASSWORD_HASH);
      if (!passwordOk) {
        return res.status(401).json({ error: 'Invalid credentials', code: 'INVALID_CREDENTIALS' });
      }

      if (capabilities.hasEmailVerifiedColumns && capabilities.hasEmailVerificationTokensTable) {
        const verified = row.EMAIL_VERIFIED === 'Y' || row.IS_VERIFIED === 'Y';
        if (!verified) {
          return res.status(403).json({
            error: 'E-mail not verified. Please verify your account before login.',
            code: 'EMAIL_NOT_VERIFIED',
          });
        }
      }

      if (capabilities.hasRefreshTokensTable) {
        const currentRefreshRaw = getRefreshTokenFromRequest(req);

        if (rememberMe) {
          if (currentRefreshRaw) {
            await revokeRefreshTokenByHash(connection, hashToken(currentRefreshRaw), 'ROTATED');
          }

          const refreshToken = await createRefreshSessionToken(connection, {
            userId: row.ID,
            userAgent: req.headers['user-agent'] || null,
            ipAddress: req.ip || null,
          });
          await connection.commit();
          setRefreshCookie(res, refreshToken.rawToken, refreshToken.maxAgeMs);
        } else {
          if (currentRefreshRaw) {
            await revokeRefreshTokenByHash(connection, hashToken(currentRefreshRaw), 'LOGOUT');
            await connection.commit();
          }
          clearRefreshCookie(res);
        }
      } else {
        clearRefreshCookie(res);
      }

      const auth = issueJwt({ id: row.ID, email }, rememberMe);
      return res.json({
        token: auth.token,
        expiresIn: auth.expiresIn,
        rememberMe: !!rememberMe,
      });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Login failed' });
    } finally {
      try { await connection?.close(); } catch {}
    }
  });

  app.post('/api/auth/refresh', regularAuthLimiter, async (req, res) => {
    const currentRefreshRaw = getRefreshTokenFromRequest(req);
    if (!currentRefreshRaw) {
      clearRefreshCookie(res);
      return res.status(401).json({ error: 'Refresh token missing', code: 'REFRESH_REQUIRED' });
    }

    let connection;
    try {
      connection = await pool.getConnection();
      const capabilities = await getAuthSchemaCapabilities(connection);
      if (!capabilities.hasRefreshTokensTable) {
        clearRefreshCookie(res);
        return res.status(503).json({
          error: 'Refresh token storage is not configured.',
          code: 'SCHEMA_NOT_READY',
        });
      }

      const tokenHash = hashToken(currentRefreshRaw);
      const rs = await connection.execute(
        `
          SELECT
            t.ID,
            t.USER_ID,
            t.EXPIRES_AT,
            t.REVOKED_AT,
            u.EMAIL
          FROM EC_APP.AUTH_REFRESH_TOKENS t
          JOIN EC_APP.APP_USERS u ON u.ID = t.USER_ID
          WHERE t.TOKEN_HASH = :tokenHash
          FETCH FIRST 1 ROWS ONLY
        `,
        { tokenHash },
        { autoCommit: false },
      );

      if (!rs.rows.length) {
        clearRefreshCookie(res);
        return res.status(401).json({ error: 'Invalid refresh token', code: 'INVALID_REFRESH_TOKEN' });
      }

      const row = rs.rows[0];
      if (row.REVOKED_AT) {
        clearRefreshCookie(res);
        return res.status(401).json({ error: 'Refresh token revoked', code: 'REFRESH_REVOKED' });
      }

      if (new Date(row.EXPIRES_AT).getTime() < Date.now()) {
        await connection.execute(
          `
            UPDATE EC_APP.AUTH_REFRESH_TOKENS
            SET
              REVOKED_AT = NVL(REVOKED_AT, SYSTIMESTAMP),
              REVOKE_REASON = NVL(REVOKE_REASON, 'EXPIRED')
            WHERE ID = :id
          `,
          { id: row.ID },
          { autoCommit: false },
        );
        await connection.commit();
        clearRefreshCookie(res);
        return res.status(401).json({ error: 'Refresh token expired', code: 'REFRESH_EXPIRED' });
      }

      const rotatedRefreshToken = await createRefreshSessionToken(connection, {
        userId: row.USER_ID,
        userAgent: req.headers['user-agent'] || null,
        ipAddress: req.ip || null,
      });

      await connection.execute(
        `
          UPDATE EC_APP.AUTH_REFRESH_TOKENS
          SET
            REVOKED_AT = SYSTIMESTAMP,
            REVOKE_REASON = 'ROTATED',
            LAST_USED_AT = SYSTIMESTAMP
          WHERE ID = :id
        `,
        { id: row.ID },
        { autoCommit: false },
      );

      await connection.commit();
      setRefreshCookie(res, rotatedRefreshToken.rawToken, rotatedRefreshToken.maxAgeMs);

      const auth = issueJwt({ id: row.USER_ID, email: row.EMAIL }, true);
      return res.json({
        token: auth.token,
        expiresIn: auth.expiresIn,
        rememberMe: true,
      });
    } catch (error) {
      console.error(error);
      if (connection) {
        try { await connection.rollback(); } catch {}
      }
      clearRefreshCookie(res);
      return res.status(500).json({ error: 'Failed to refresh session' });
    } finally {
      try { await connection?.close(); } catch {}
    }
  });

  app.post('/api/auth/logout', regularAuthLimiter, async (req, res) => {
    const currentRefreshRaw = getRefreshTokenFromRequest(req);
    let connection;

    try {
      if (currentRefreshRaw) {
        connection = await pool.getConnection();
        const capabilities = await getAuthSchemaCapabilities(connection);
        if (capabilities.hasRefreshTokensTable) {
          await revokeRefreshTokenByHash(connection, hashToken(currentRefreshRaw), 'LOGOUT');
          await connection.commit();
        }
      }
    } catch (error) {
      console.error(error);
      if (connection) {
        try { await connection.rollback(); } catch {}
      }
    } finally {
      clearRefreshCookie(res);
      try { await connection?.close(); } catch {}
    }

    return res.json({ ok: true });
  });

  app.get('/api/auth/verify-email', async (req, res) => {
    const rawToken = String(req.query?.token || '').trim();
    if (!rawToken) {
      return res.status(400).json({ error: 'Missing token', code: 'INVALID_TOKEN' });
    }

    const tokenHash = hashToken(rawToken);

    let connection;
    try {
      connection = await pool.getConnection();
      const capabilities = await getAuthSchemaCapabilities(connection);
      if (!capabilities.hasEmailVerificationTokensTable) {
        return res.status(503).json({
          error: 'Email verification is not configured yet.',
          code: 'SCHEMA_NOT_READY',
        });
      }

      const tokenRs = await connection.execute(
        `
          SELECT
            t.ID,
            t.USER_ID,
            t.EXPIRES_AT,
            t.USED_AT,
            t.INVALIDATED_AT,
            u.IS_VERIFIED,
            ${capabilities.hasEmailVerifiedColumns ? 'u.EMAIL_VERIFIED' : "NULL AS EMAIL_VERIFIED"}
          FROM EC_APP.EMAIL_VERIFICATION_TOKENS t
          JOIN EC_APP.APP_USERS u ON u.ID = t.USER_ID
          WHERE t.TOKEN_HASH = :tokenHash
          ORDER BY t.CREATED_AT DESC
          FETCH FIRST 1 ROWS ONLY
        `,
        { tokenHash },
        { autoCommit: false },
      );

      if (!tokenRs.rows.length) {
        return res.status(400).json({ error: 'Invalid verification link.', code: 'INVALID_TOKEN' });
      }

      const tokenRow = tokenRs.rows[0];
      if (tokenRow.USED_AT || tokenRow.INVALIDATED_AT) {
        return res.status(409).json({ error: 'This verification link has already been used.', code: 'LINK_ALREADY_USED' });
      }

      if (new Date(tokenRow.EXPIRES_AT).getTime() < Date.now()) {
        await connection.execute(
          `
            UPDATE EC_APP.EMAIL_VERIFICATION_TOKENS
            SET INVALIDATED_AT = SYSTIMESTAMP
            WHERE ID = :id
          `,
          { id: tokenRow.ID },
          { autoCommit: false },
        );
        await connection.commit();
        return res.status(410).json({ error: 'Verification link expired.', code: 'TOKEN_EXPIRED' });
      }

      const alreadyVerified = capabilities.hasEmailVerifiedColumns
        ? tokenRow.EMAIL_VERIFIED === 'Y' || tokenRow.IS_VERIFIED === 'Y'
        : tokenRow.IS_VERIFIED === 'Y';

      if (alreadyVerified) {
        await connection.execute(
          `
            UPDATE EC_APP.EMAIL_VERIFICATION_TOKENS
            SET USED_AT = NVL(USED_AT, SYSTIMESTAMP)
            WHERE ID = :id
          `,
          { id: tokenRow.ID },
          { autoCommit: false },
        );
        await connection.commit();
        return res.json({
          ok: true,
          status: 'ALREADY_VERIFIED',
          message: 'Account already verified.',
        });
      }

      const updateUserSql = capabilities.hasEmailVerifiedColumns
        ? `
            UPDATE EC_APP.APP_USERS
            SET
              IS_VERIFIED = 'Y',
              EMAIL_VERIFIED = 'Y',
              VERIFIED_AT = SYSTIMESTAMP
            WHERE ID = :id
          `
        : `
            UPDATE EC_APP.APP_USERS
            SET IS_VERIFIED = 'Y'
            WHERE ID = :id
          `;

      await connection.execute(updateUserSql, { id: tokenRow.USER_ID }, { autoCommit: false });
      await connection.execute(
        `
          UPDATE EC_APP.EMAIL_VERIFICATION_TOKENS
          SET USED_AT = SYSTIMESTAMP
          WHERE ID = :id
        `,
        { id: tokenRow.ID },
        { autoCommit: false },
      );

      await connection.execute(
        `
          UPDATE EC_APP.EMAIL_VERIFICATION_TOKENS
          SET INVALIDATED_AT = SYSTIMESTAMP
          WHERE USER_ID = :userId
            AND ID <> :tokenId
            AND USED_AT IS NULL
            AND INVALIDATED_AT IS NULL
        `,
        { userId: tokenRow.USER_ID, tokenId: tokenRow.ID },
        { autoCommit: false },
      );

      await connection.commit();
      return res.json({
        ok: true,
        status: 'VERIFIED',
        message: 'E-mail verified successfully.',
      });
    } catch (error) {
      console.error(error);
      if (connection) {
        try { await connection.rollback(); } catch {}
      }
      return res.status(500).json({ error: 'Failed to verify e-mail' });
    } finally {
      try { await connection?.close(); } catch {}
    }
  });

  app.post('/api/auth/resend-verification', strictAuthLimiter, async (req, res) => {
    const parsed = resendVerificationSchema.safeParse(req.body);
    if (!parsed.success) {
      return neutralResendResponse(res);
    }

    const email = String(parsed.data.email).trim().toLowerCase();

    let connection;
    try {
      connection = await pool.getConnection();
      const capabilities = await getAuthSchemaCapabilities(connection);
      if (!capabilities.hasEmailVerificationTokensTable) {
        return neutralResendResponse(res);
      }

      const userRs = await connection.execute(
        `
          SELECT
            ID,
            IS_VERIFIED
            ${capabilities.hasEmailVerifiedColumns ? ', EMAIL_VERIFIED' : ''}
          FROM EC_APP.APP_USERS
          WHERE EMAIL = :email
        `,
        { email },
      );

      if (!userRs.rows.length) {
        return neutralResendResponse(res);
      }

      const user = userRs.rows[0];
      const verified = capabilities.hasEmailVerifiedColumns
        ? user.EMAIL_VERIFIED === 'Y' || user.IS_VERIFIED === 'Y'
        : user.IS_VERIFIED === 'Y';
      if (verified) {
        return neutralResendResponse(res);
      }

      const latestToken = await connection.execute(
        `
          SELECT CREATED_AT
          FROM EC_APP.EMAIL_VERIFICATION_TOKENS
          WHERE USER_ID = :userId
          ORDER BY CREATED_AT DESC
          FETCH FIRST 1 ROWS ONLY
        `,
        { userId: user.ID },
      );

      if (latestToken.rows.length > 0) {
        const latestCreatedAt = new Date(latestToken.rows[0].CREATED_AT).getTime();
        const elapsedSeconds = Math.floor((Date.now() - latestCreatedAt) / 1000);
        if (elapsedSeconds < VERIFY_RESEND_COOLDOWN_SECONDS) {
          return neutralResendResponse(res);
        }
      }

      await connection.execute(
        `
          UPDATE EC_APP.EMAIL_VERIFICATION_TOKENS
          SET INVALIDATED_AT = SYSTIMESTAMP
          WHERE USER_ID = :userId
            AND USED_AT IS NULL
            AND INVALIDATED_AT IS NULL
        `,
        { userId: user.ID },
        { autoCommit: false },
      );

      const rawToken = await createEmailVerificationToken(connection, user.ID, {
        ip: req.ip || null,
        userAgent: req.headers['user-agent'] || null,
        reason: 'resend',
      });

      await sendVerificationEmail(email, rawToken);
      await connection.commit();
      return neutralResendResponse(res);
    } catch (error) {
      console.error(error);
      if (connection) {
        try { await connection.rollback(); } catch {}
      }
      return neutralResendResponse(res);
    } finally {
      try { await connection?.close(); } catch {}
    }
  });

  app.post('/api/auth/forgot-password', strictAuthLimiter, async (req, res) => {
    const parsed = forgotSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid payload', code: 'INVALID_PAYLOAD' });
    }

    const email = String(parsed.data.email).trim().toLowerCase();
    const code = generateResetCode();
    const codeHash = hashToken(code);

    let connection;
    try {
      connection = await pool.getConnection();

      const updated = await connection.execute(
        `
          UPDATE EC_APP.APP_USERS
          SET RESET_TOKEN = :token,
              RESET_EXPIRES = SYSDATE + (1/24)
          WHERE EMAIL = :email
        `,
        { token: codeHash, email },
        { autoCommit: true },
      );

      if (updated.rowsAffected === 0) {
        return res.json({ ok: true });
      }

      await sendMail({
        to: email,
        subject: 'Password reset code - Excellence Control',
        text:
          `You requested a password reset.\n\n` +
          `Your verification code is: ${code}\n\n` +
          `The code expires in 1 hour.`,
      });

      return res.json({ ok: true });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Failed to process password reset request' });
    } finally {
      try { await connection?.close(); } catch {}
    }
  });

  app.post('/api/auth/reset-password', strictAuthLimiter, async (req, res) => {
    const parsed = resetSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid payload', code: 'INVALID_PAYLOAD' });
    }

    const email = String(parsed.data.email).trim().toLowerCase();
    const token = String(parsed.data.token).trim();
    const tokenHash = hashToken(token);
    const newPassword = parsed.data.password;

    let connection;
    try {
      connection = await pool.getConnection();
      const userRs = await connection.execute(
        `
          SELECT ID, RESET_TOKEN, RESET_EXPIRES
          FROM EC_APP.APP_USERS
          WHERE EMAIL = :email
        `,
        { email },
      );

      if (!userRs.rows.length) {
        return res.status(400).json({ error: 'Invalid e-mail or reset code', code: 'INVALID_RESET' });
      }

      const user = userRs.rows[0];
      if (!user.RESET_TOKEN || !user.RESET_EXPIRES) {
        return res.status(400).json({ error: 'No reset request in progress', code: 'NO_RESET_REQUEST' });
      }

      const storedResetToken = String(user.RESET_TOKEN || '').trim();
      const tokenMatches = storedResetToken === tokenHash || storedResetToken === token;
      if (!tokenMatches) {
        return res.status(400).json({ error: 'Invalid reset code', code: 'INVALID_RESET_TOKEN' });
      }

      if (new Date(user.RESET_EXPIRES).getTime() < Date.now()) {
        return res.status(400).json({ error: 'Reset code expired', code: 'RESET_TOKEN_EXPIRED' });
      }

      const capabilities = await getAuthSchemaCapabilities(connection);
      const passwordHash = await bcrypt.hash(newPassword, 12);
      await connection.execute(
        `
          UPDATE EC_APP.APP_USERS
          SET PASSWORD_HASH = :passwordHash,
              RESET_TOKEN = NULL,
              RESET_EXPIRES = NULL
          WHERE ID = :id
        `,
        { passwordHash, id: user.ID },
        { autoCommit: false },
      );

      if (capabilities.hasRefreshTokensTable) {
        await revokeAllRefreshTokensForUser(connection, user.ID, 'PASSWORD_RESET');
      }

      await connection.commit();
      return res.json({ ok: true });
    } catch (error) {
      console.error(error);
      if (connection) {
        try { await connection.rollback(); } catch {}
      }
      return res.status(500).json({ error: 'Failed to reset password' });
    } finally {
      try { await connection?.close(); } catch {}
    }
  });

  app.get('/api/auth/me', jwtMiddleware, async (req, res) => {
    let connection;
    try {
      connection = await pool.getConnection();
      const capabilities = await getAuthSchemaCapabilities(connection);

      const meSql = capabilities.hasEmailVerifiedColumns
        ? `
            SELECT
              u.ID,
              u.EMAIL,
              u.USERNAME,
              u.DISPLAY_NAME,
              u.NAME,
              u.STATUS,
              u.IS_VERIFIED,
              u.EMAIL_VERIFIED,
              u.VERIFIED_AT,
              u.CREATED_AT,
              (
                SELECT LISTAGG(r.NAME, ',') WITHIN GROUP (ORDER BY r.NAME)
                FROM EC_APP.USER_ROLES ur
                JOIN EC_APP.ROLES r ON r.ID = ur.ROLE_ID
                WHERE ur.USER_ID = u.ID
              ) AS ROLES
            FROM EC_APP.APP_USERS u
            WHERE u.ID = :id
          `
        : `
            SELECT
              u.ID,
              u.EMAIL,
              u.USERNAME,
              u.DISPLAY_NAME,
              u.NAME,
              u.STATUS,
              u.IS_VERIFIED,
              NULL AS EMAIL_VERIFIED,
              NULL AS VERIFIED_AT,
              u.CREATED_AT,
              (
                SELECT LISTAGG(r.NAME, ',') WITHIN GROUP (ORDER BY r.NAME)
                FROM EC_APP.USER_ROLES ur
                JOIN EC_APP.ROLES r ON r.ID = ur.ROLE_ID
                WHERE ur.USER_ID = u.ID
              ) AS ROLES
            FROM EC_APP.APP_USERS u
            WHERE u.ID = :id
          `;

      const rs = await connection.execute(meSql, { id: Number(req.user.sub) });
      return res.json(rs.rows[0] || null);
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Failed to load current user' });
    } finally {
      try { await connection?.close(); } catch {}
    }
  });
}

export async function jwtMiddleware(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) {
      return res.status(401).json({ error: 'Authentication required', code: 'AUTH_REQUIRED' });
    }

    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    req.actorEmail = payload.email || null;
    return next();
  } catch (error) {
    console.error(error);
    return res.status(401).json({ error: 'Invalid or expired token', code: 'INVALID_TOKEN' });
  }
}

export function requireRole(pool, roleName) {
  return async function roleMiddleware(req, res, next) {
    let connection;
    try {
      connection = await pool.getConnection();
      const rs = await connection.execute(
        `
          SELECT 1
          FROM EC_APP.USER_ROLES ur
          JOIN EC_APP.ROLES r ON r.ID = ur.ROLE_ID
          WHERE ur.USER_ID = :userId
            AND TRIM(UPPER(r.NAME)) = TRIM(UPPER(:roleName))
        `,
        {
          userId: Number(req.user.sub),
          roleName,
        },
      );

      if (!rs.rows.length) {
        return res.status(403).json({ error: 'Access denied', code: 'FORBIDDEN' });
      }

      return next();
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Authorization check failed' });
    } finally {
      try { await connection?.close(); } catch {}
    }
  };
}
