// server/index.js
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import oracledb from 'oracledb';
import { authRoutes, jwtMiddleware, requireRole } from './auth.js';
import {
  USER_TABLE_NAME,
  PROJECT_TABLE_NAME,
  PROJECT_EARNINGS_TABLE_NAME,
  fetchAppUserSnapshot,
  tryInsertChangeLog,
  tryInsertEntityChangeLog,
  parseLogJson,
  buildActorContext,
  applyUserSnapshot,
  archiveUser,
  toHttpErrorResponse,
} from './change-log.js';

// Para anexo de arquivo
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

const app = express();
const jsonLimit = String(process.env.API_JSON_LIMIT || '5mb').trim() || '5mb';
const configuredOrigins = String(
  process.env.CORS_ORIGIN || process.env.APP_WEB_URL || process.env.FRONTEND_URL,
)
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    if (!origin || configuredOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));
app.use(express.json({ limit: jsonLimit }));

// servir arquivos estáticos de uploads
const staticUploadsDir = path.join(process.cwd(), 'uploads');
app.use('/uploads', express.static(staticUploadsDir));


const uploadBaseDir = path.join(process.cwd(), 'uploads', 'projects');
fs.mkdirSync(uploadBaseDir, { recursive: true });

// Storage de arquivos por projeto
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const projectId = req.params.id;
    const dir = path.join(uploadBaseDir, String(projectId));
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const safeName = file.originalname.replace(/[^\w.\-]/g, '_');
    const finalName = `${Date.now()}_${safeName}`;
    cb(null, finalName);
  },
});

const upload = multer({ storage });


// Resultados como objetos + CLOB -> string
oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
oracledb.fetchAsString = [oracledb.CLOB];

// Helpers
const d = v => (v ? String(v).slice(0, 10) : null); // 'YYYY-MM-DD'
const num = v => (v === '' || v === null || v === undefined ? null : Number(v));
const up = v => (v ? String(v).toUpperCase() : null);
const AUDIT_ALLOWED_ACTIONS = new Set(['C', 'U', 'D', 'R']);
const AUDIT_ALLOWED_TABLES = new Set([
  USER_TABLE_NAME,
  PROJECT_TABLE_NAME,
  PROJECT_EARNINGS_TABLE_NAME,
]);

function parseDateQuery(value, { endOfDay = false } = {}) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const stamp = raw.length <= 10
    ? `${raw}${endOfDay ? 'T23:59:59.999' : 'T00:00:00.000'}`
    : raw;
  const dt = new Date(stamp);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function parseListQuery(value, { upper = false, lower = false } = {}) {
  const raw = Array.isArray(value) ? value.join(',') : String(value || '');
  const values = raw
    .split(',')
    .map(item => String(item || '').trim())
    .filter(Boolean)
    .map(item => {
      if (upper) return item.toUpperCase();
      if (lower) return item.toLowerCase();
      return item;
    });

  return [...new Set(values)];
}

function parseBooleanQuery(value) {
  if (typeof value === 'boolean') return value;
  const raw = String(value || '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function buildEarningStatusMatcher(query = {}) {
  const filter = new Set(parseListQuery(query.earningStatuses, { upper: true }));
  return (rawStatus) => {
    if (!filter.size) return true;
    const status = String(rawStatus || 'PREVISTO').trim().toUpperCase();
    return filter.has(status);
  };
}

function isOraMissingTableOrColumn(error) {
  const code = Number(error?.errorNum || 0);
  return code === 942 || code === 904;
}

function parseEarningYear(rawValue) {
  const year = Number.parseInt(String(rawValue ?? '').trim(), 10);
  if (!Number.isInteger(year) || year < 1900 || year > 3000) return null;
  return year;
}

function parseEarningMonth(rawValue) {
  const month = Number.parseInt(String(rawValue ?? '').trim(), 10);
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  return month;
}

function parseEarningValue(rawValue) {
  if (rawValue === null || rawValue === undefined || rawValue === '') return 0;
  const value = Number(rawValue);
  if (!Number.isFinite(value)) return null;
  return value;
}

function parseEarningTipo(rawValue) {
  if (rawValue === null || rawValue === undefined || rawValue === '') return null;
  const normalized = String(rawValue).trim().toUpperCase();
  if (normalized === 'REVENUE' || normalized === 'RECEITA') return 'REVENUE';
  if (normalized === 'SAVING' || normalized === 'SAVINGS' || normalized === 'ECONOMIA'
    || normalized === 'CUSTOS' || normalized === 'CUSTO' || normalized === 'COST' || normalized === 'COSTS'
    || normalized === 'COST REDUCTION') return 'SAVING';
  return null;
}

function parseEarningDolarValue(rawValue) {
  if (rawValue === null || rawValue === undefined || rawValue === '') return null;
  if (typeof rawValue === 'number' && Number.isFinite(rawValue)) return rawValue;
  const normalized = String(rawValue).trim().replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, '');
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseEarningStatus(rawValue) {
  if (rawValue === null || rawValue === undefined || rawValue === '') return 'PREVISTO';
  const normalized = String(rawValue).trim().toUpperCase();
  if (normalized === 'REALIZADO' || normalized === 'DONE' || normalized === 'COMPLETED'
      || normalized === 'CONCLUIDO' || normalized === 'CONCLUÍDO') return 'REALIZADO';
  return 'PREVISTO';
}

const PROJECT_IMPORT_MAX_ROWS = Math.max(
  1,
  Number.parseInt(process.env.PROJECT_IMPORT_MAX_ROWS || '', 10) || 1000,
);

const PROJECT_IMPORT_JOB_MAX_ROWS = Math.max(
  PROJECT_IMPORT_MAX_ROWS,
  Number.parseInt(process.env.PROJECT_IMPORT_JOB_MAX_ROWS || '', 10) || 5000,
);

const PROJECT_IMPORT_JOB_RETENTION_MINUTES = Math.max(
  5,
  Number.parseInt(process.env.PROJECT_IMPORT_JOB_RETENTION_MINUTES || '', 10) || 120,
);

const PROJECT_ALLOWED_STATUSES = new Set([
  'BACKLOG',
  'TODO',
  'IN_PROGRESS',
  'REVIEW',
  'ON_HOLD',
  'DONE',
  'ARCHIVED',
]);

const PROJECT_ALLOWED_PRIORITIES = new Set(['LOW', 'MEDIUM', 'HIGH']);

function toTrimmedString(value, maxLength = 0) {
  if (value === null || value === undefined) return '';
  const out = String(value).trim();
  if (!out) return '';
  if (maxLength > 0) return out.slice(0, maxLength);
  return out;
}

function toYmdFromDate(dt) {
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const dValue = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${dValue}`;
}

function parseStrictYmd(yyyy, mm, dd) {
  const year = Number(yyyy);
  const month = Number(mm);
  const day = Number(dd);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  const date = new Date(year, month - 1, day);
  if (
    Number.isNaN(date.getTime())
    || date.getFullYear() !== year
    || date.getMonth() + 1 !== month
    || date.getDate() !== day
  ) {
    return null;
  }
  return toYmdFromDate(date);
}

function normalizeTwoDigitYear(yy) {
  const year = Number.parseInt(String(yy), 10);
  if (!Number.isInteger(year) || year < 0 || year > 99) return null;
  return year <= 69 ? 2000 + year : 1900 + year;
}

function parseImportDateValue(rawValue) {
  if (rawValue === null || rawValue === undefined || rawValue === '') return '';

  if (rawValue instanceof Date && !Number.isNaN(rawValue.getTime())) {
    return toYmdFromDate(rawValue);
  }

  if (typeof rawValue === 'number' && Number.isFinite(rawValue) && rawValue > 20000 && rawValue < 80000) {
    const millis = Math.round((rawValue - 25569) * 86400 * 1000);
    const date = new Date(millis);
    if (!Number.isNaN(date.getTime())) return toYmdFromDate(date);
  }

  const value = String(rawValue).trim();
  if (!value) return '';

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [yyyy, mm, dd] = value.split('-');
    return parseStrictYmd(yyyy, mm, dd);
  }

  const dayFirst = value.match(/^(\d{2})[\/\-](\d{2})[\/\-](\d{4})$/);
  if (dayFirst) {
    const [, dd, mm, yyyy] = dayFirst;
    return parseStrictYmd(yyyy, mm, dd);
  }

  const dayFirstShortYear = value.match(/^(\d{2})[\/\-](\d{2})[\/\-](\d{2})$/);
  if (dayFirstShortYear) {
    const [, dd, mm, yy] = dayFirstShortYear;
    const fullYear = normalizeTwoDigitYear(yy);
    return fullYear ? parseStrictYmd(fullYear, mm, dd) : null;
  }

  const yearFirst = value.match(/^(\d{4})[\/\-](\d{2})[\/\-](\d{2})$/);
  if (yearFirst) {
    const [, yyyy, mm, dd] = yearFirst;
    return parseStrictYmd(yyyy, mm, dd);
  }

  const yearFirstShortYear = value.match(/^(\d{2})[\/\-](\d{2})[\/\-](\d{2})$/);
  if (yearFirstShortYear) {
    const [, yy, mm, dd] = yearFirstShortYear;
    const fullYear = normalizeTwoDigitYear(yy);
    return fullYear ? parseStrictYmd(fullYear, mm, dd) : null;
  }

  return null;
}

function parseImportNumberValue(rawValue) {
  if (rawValue === null || rawValue === undefined || rawValue === '') return null;
  if (typeof rawValue === 'number' && Number.isFinite(rawValue)) return rawValue;

  const normalized = String(rawValue)
    .trim()
    .replace(/\./g, '')
    .replace(',', '.')
    .replace(/[^\d.-]/g, '');
  if (!normalized) return null;

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function normalizeImportStatus(rawValue) {
  const raw = toTrimmedString(rawValue);
  if (!raw) return 'TODO';

  const normalized = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[\s-]+/g, '_');

  const aliases = {
    TO_DO: 'TODO',
    TODO: 'TODO',
    NOT_STARTED: 'TODO',
    NAO_INICIADO: 'TODO',
    BACKLOG: 'BACKLOG',
    IN_PROGRESS: 'IN_PROGRESS',
    INPROGRESS: 'IN_PROGRESS',
    EM_ANDAMENTO: 'IN_PROGRESS',
    EM_PROGRESSO: 'IN_PROGRESS',
    REVIEW: 'REVIEW',
    ON_HOLD: 'ON_HOLD',
    HOLD: 'ON_HOLD',
    PAUSED: 'ON_HOLD',
    EM_ESPERA: 'ON_HOLD',
    PAUSADO: 'ON_HOLD',
    DONE: 'DONE',
    CONCLUIDO: 'DONE',
    ARCHIVED: 'ARCHIVED',
    ARQUIVADO: 'ARCHIVED',
    CANCELADO: 'ARCHIVED',
    CANCELED: 'ARCHIVED',
    CANCELLED: 'ARCHIVED',
  };

  const direct = aliases[normalized];
  if (direct) return direct;

  if (normalized.includes('PAUSADO') || normalized.includes('PAUSED') || normalized.includes('ON_HOLD') || normalized.includes('EM_ESPERA') || normalized.includes('HOLD')) {
    return 'ON_HOLD';
  }
  if (normalized.includes('CONCLUIDO') || normalized.includes('DONE') || normalized.includes('COMPLETED')) {
    return 'DONE';
  }
  if (normalized.includes('CANCELADO') || normalized.includes('CANCELED') || normalized.includes('CANCELLED') || normalized.includes('ARQUIVADO') || normalized.includes('ARCHIVED')) {
    return 'ARCHIVED';
  }
  if (normalized.includes('ANDAMENTO') || normalized.includes('PROGRESSO') || normalized.includes('IN_PROGRESS')) {
    return 'IN_PROGRESS';
  }
  if (normalized.includes('NAO_INICIADO') || normalized.includes('NOT_STARTED') || normalized.includes('TODO') || normalized.includes('A_FAZER')) {
    return 'TODO';
  }

  return normalized;
}

function normalizeImportPriority(rawValue) {
  const raw = toTrimmedString(rawValue);
  if (!raw) return 'MEDIUM';

  const normalized = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[\s-]+/g, '_');

  const aliases = {
    LOW: 'LOW',
    BAIXA: 'LOW',
    MEDIUM: 'MEDIUM',
    MEDIA: 'MEDIUM',
    HIGH: 'HIGH',
    ALTA: 'HIGH',
  };

  return aliases[normalized] || normalized;
}

function normalizeImportComite(rawValue) {
  const raw = toTrimmedString(rawValue);
  if (!raw) return null;

  const normalized = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  if (['sim', 'yes', 'y', 'true', '1'].includes(normalized)) return 'sim';
  if (['nao', 'não', 'no', 'n', 'false', '0'].includes(normalized)) return 'nao';
  return null;
}

function projectImportError({ type = 'validation', row = null, field = '', column = '', message = '' } = {}) {
  return {
    type,
    row: row ? Number(row) : null,
    field: field || '',
    column: column || '',
    message: String(message || ''),
  };
}

function normalizeExternalImportErrors(items) {
  if (!Array.isArray(items)) return [];
  return items
    .filter(item => item && typeof item === 'object')
    .map(item =>
      projectImportError({
        type: item.type || 'validation',
        row: item.row || null,
        field: item.field || '',
        column: item.column || '',
        message: item.message || '',
      }),
    )
    .filter(item => item.message);
}

function normalizeImportProjectRow(rawRow, rowNumber) {
  const row = rawRow && typeof rawRow === 'object' ? rawRow : {};
  const errors = [];
  const warnings = [];
  const pushError = (message, field = '') => {
    errors.push(projectImportError({
      type: 'validation',
      row: rowNumber,
      field,
      message,
    }));
  };
  const pushWarning = (message, field = '') => {
    warnings.push(projectImportError({
      type: 'warning',
      row: rowNumber,
      field,
      message,
    }));
  };

  const payload = {
    title: toTrimmedString(row.title, 300),
    description: toTrimmedString(row.description, 4000) || null,
    status: normalizeImportStatus(row.status ?? row.etapa),
    priority: normalizeImportPriority(row.priority),
    origem: toTrimmedString(row.origem, 120) || null,
    comite: normalizeImportComite(row.comite),
    it: toTrimmedString(row.it, 120) || null,
    registroInterno: toTrimmedString(row.registroInterno, 120) || null,
    vinculoProjeto: toTrimmedString(row.vinculoProjeto, 200) || null,
    codigoILean: toTrimmedString(row.codigoILean, 120) || null,
    areaGrupo: toTrimmedString(row.areaGrupo, 200) || null,
    impactoComite: toTrimmedString(row.impactoComite, 120) || null,
    categoriaKaizen: toTrimmedString(row.categoriaKaizen, 200) || null,
    metrics: toTrimmedString(row.metrics, 4000) || null,
    goeKaizenAward: toTrimmedString(row.goeKaizenAward, 200) || null,
    premioKaizen: toTrimmedString(row.premioKaizen, 200) || null,
    categoriaBoletimExop: toTrimmedString(row.categoriaBoletimExop, 120) || null,
    reNo: toTrimmedString(row.reNo, 120) || null,
    employeeName: toTrimmedString(row.employeeName, 200) || null,
    validador: toTrimmedString(row.validador, 200) || null,
    champion: toTrimmedString(row.champion, 200) || null,
    holdJustification: toTrimmedString(row.holdJustification, 1000) || null,
    members: Array.isArray(row.members) ? row.members : [],
  };

  if (!payload.title) {
    payload.title = `Imported row ${rowNumber}`;
    pushWarning('Missing project title. Generated fallback title.', 'title');
  }

  if (!PROJECT_ALLOWED_STATUSES.has(payload.status)) {
    pushWarning(`Invalid status "${row.status ?? row.etapa}". Stored as default TODO.`, 'status');
    payload.status = null;
  }

  if (!PROJECT_ALLOWED_PRIORITIES.has(payload.priority)) {
    pushWarning(`Invalid priority "${row.priority}". Stored as default MEDIUM.`, 'priority');
    payload.priority = null;
  }

  if (row.comite !== null && row.comite !== undefined && row.comite !== '' && payload.comite === null) {
    pushWarning(`Invalid committee value "${row.comite}". Stored as empty.`, 'comite');
  }

  const parseDateField = (fieldName, rawValue) => {
    const parsed = parseImportDateValue(rawValue);
    if (parsed === null) {
      pushWarning(`Invalid date for ${fieldName}: "${rawValue}". Stored as empty.`, fieldName);
      return null;
    }
    return parsed || null;
  };

  payload.chegada = parseDateField('chegada', row.chegada);
  payload.dataInicioGanho = parseDateField('dataInicioGanho', row.dataInicioGanho);
  payload.dataFimPrevisto = parseDateField('dataFimPrevisto', row.dataFimPrevisto);
  payload.startDate = parseDateField('startDate', row.startDate);
  payload.dueDate = parseDateField('dueDate', row.dueDate);

  const parseNumberField = (fieldName, rawValue) => {
    const parsed = parseImportNumberValue(rawValue);
    if (Number.isNaN(parsed)) {
      pushWarning(`Invalid number for ${fieldName}: "${rawValue}". Stored as empty.`, fieldName);
      return null;
    }
    return parsed;
  };

  payload.ganhoEstimado = parseNumberField('ganhoEstimado', row.ganhoEstimado);
  payload.ganhoRealizado = parseNumberField('ganhoRealizado', row.ganhoRealizado);
  payload.anoConsiderado = parseNumberField('anoConsiderado', row.anoConsiderado);
  payload.goeAwardYear = parseNumberField('goeAwardYear', row.goeAwardYear);
  payload.premioKaizenYear = parseNumberField('premioKaizenYear', row.premioKaizenYear);
  payload.projectLinkId = parseNumberField('projectLinkId', row.projectLinkId);

  if (payload.projectLinkId !== null && (!Number.isInteger(payload.projectLinkId) || payload.projectLinkId <= 0)) {
    pushWarning(`Invalid number for projectLinkId: "${row.projectLinkId}". Stored as empty.`, 'projectLinkId');
    payload.projectLinkId = null;
  }

  payload.goeAwardQ = toTrimmedString(row.goeAwardQ, 80) || null;
  payload.premioKaizenQ = toTrimmedString(row.premioKaizenQ, 80) || null;

  return { payload, errors, warnings };
}

function buildProjectDuplicateKey(payload) {
  const title = String(payload?.title || '').trim().toLowerCase();
  const startDate = String(payload?.startDate || '');
  const dueDate = String(payload?.dueDate || '');
  return `${title}|${startDate}|${dueDate}`;
}

async function projectExistsByKey(cn, payload) {
  const rs = await cn.execute(
    `
      SELECT ID
      FROM EC_APP.PROJECTS
      WHERE UPPER(TRIM(TITLE)) = UPPER(TRIM(:title))
        AND NVL(TO_CHAR(START_DATE,'YYYY-MM-DD'),'~') = NVL(:startDate,'~')
        AND NVL(TO_CHAR(DUE_DATE,'YYYY-MM-DD'),'~') = NVL(:dueDate,'~')
        AND ROWNUM = 1
    `,
    {
      title: payload.title,
      startDate: payload.startDate || null,
      dueDate: payload.dueDate || null,
    },
  );
  return Boolean(rs.rows?.length);
}

function buildProjectInsertBinds(projectBody) {
  const b = projectBody || {};
  const normalizedStatus = up(b.status) || 'TODO';
  return {
    TITLE: b.title,
    DESCRIPTION: b.description || null,
    STATUS: normalizedStatus,
    PRIORITY: b.priority || 'MEDIUM',

    ORIGEM: b.origem || null,
    COMITE: b.comite ? up(b.comite) : null,
    IT: b.it || null,
    REGISTRO_INT: b.registroInterno || null,
    VINCULO_PROJ: b.vinculoProjeto || null,
    CODIGO_ILEAN: b.codigoILean || null,
    AREA_GRUPO: b.areaGrupo || null,
    IMPACTO_COMITE: b.impactoComite || null,
    CATEGORIA_KAIZEN: b.categoriaKaizen || null,
    GOE_AWARD_Q: b.goeAwardQ || null,
    GOE_AWARD_YEAR: num(b.goeAwardYear),
    PREMIO_KAIZEN_Q: b.premioKaizenQ || null,
    PREMIO_KAIZEN_YEAR: num(b.premioKaizenYear),
    GANHO_ESTIMADO: num(b.ganhoEstimado),
    GANHO_REALIZADO: num(b.ganhoRealizado),
    RE_NO: b.reNo || null,
    EMPLOYEE_NAME: b.employeeName || null,
    VALIDADOR: b.validador || null,
    CHAMPION: b.champion || null,
    METRICS: b.metrics || null,
    GOE_KAIZEN_AWARD: b.goeKaizenAward || null,
    PREMIO_KAIZEN: b.premioKaizen || null,
    CATEGORIA_BOLETIM_EXOP: b.categoriaBoletimExop || null,
    PROJECT_LINK_ID: num(b.projectLinkId),
    HOLD_JUSTIFICATION: b.holdJustification || null,
    ANO_CONSIDERADO: num(b.anoConsiderado),

    CHEGADA: d(b.chegada),
    DATA_INICIO_GANHO: d(b.dataInicioGanho),
    DATA_FIM_PREV: d(b.dataFimPrevisto),
    START_DATE: d(b.startDate),
    DUE_DATE: d(b.dueDate),

    OUT_ID: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
  };
}

const INSERT_PROJECT_SQL = `
  INSERT INTO EC_APP.PROJECTS (
    TITLE, DESCRIPTION, STATUS, PRIORITY,
    ORIGEM, COMITE, IT, REGISTRO_INT, VINCULO_PROJ, CODIGO_ILEAN,
    AREA_GRUPO, IMPACTO_COMITE, CATEGORIA_KAIZEN,
    GOE_AWARD_Q, GOE_AWARD_YEAR, PREMIO_KAIZEN_Q, PREMIO_KAIZEN_YEAR,
    GANHO_ESTIMADO, GANHO_REALIZADO,
    RE_NO, EMPLOYEE_NAME, VALIDADOR, CHAMPION,
    METRICS, GOE_KAIZEN_AWARD, PREMIO_KAIZEN, CATEGORIA_BOLETIM_EXOP, PROJECT_LINK_ID,
    HOLD_JUSTIFICATION, ANO_CONSIDERADO, COMPLETED_AT,
    CHEGADA, DATA_INICIO_GANHO, DATA_FIM_PREV, START_DATE, DUE_DATE
  )
  VALUES (
    :TITLE, :DESCRIPTION, :STATUS, :PRIORITY,
    :ORIGEM, :COMITE, :IT, :REGISTRO_INT, :VINCULO_PROJ, :CODIGO_ILEAN,
    :AREA_GRUPO, :IMPACTO_COMITE, :CATEGORIA_KAIZEN,
    :GOE_AWARD_Q, :GOE_AWARD_YEAR, :PREMIO_KAIZEN_Q, :PREMIO_KAIZEN_YEAR,
    :GANHO_ESTIMADO, :GANHO_REALIZADO,
    :RE_NO, :EMPLOYEE_NAME, :VALIDADOR, :CHAMPION,
    :METRICS, :GOE_KAIZEN_AWARD, :PREMIO_KAIZEN, :CATEGORIA_BOLETIM_EXOP, :PROJECT_LINK_ID,
    :HOLD_JUSTIFICATION, :ANO_CONSIDERADO,
    CASE WHEN :STATUS = 'DONE' THEN SYSTIMESTAMP ELSE NULL END,
    TO_DATE(:CHEGADA,'YYYY-MM-DD'),
    TO_DATE(:DATA_INICIO_GANHO,'YYYY-MM-DD'),
    TO_DATE(:DATA_FIM_PREV,'YYYY-MM-DD'),
    TO_DATE(:START_DATE,'YYYY-MM-DD'),
    TO_DATE(:DUE_DATE,'YYYY-MM-DD')
  )
  RETURNING ID INTO :OUT_ID
`;

async function insertProjectMembers(cn, projectId, members) {
  if (!Array.isArray(members) || members.length === 0) return;

  const insertMemberSql = `
    INSERT INTO EC_APP.EC_PROJECT_MEMBERS
      (PROJECT_ID, MEMBER_NAME, MEMBER_ROLE)
    VALUES
      (:projectId, :memberName, :memberRole)
  `;

  for (const m of members) {
    if (!m) continue;

    const name = String(m.memberName ?? m.name ?? '').trim();
    const role = m.memberRole ?? m.role ?? null;
    if (!name) continue;

    await cn.execute(insertMemberSql, {
      projectId,
      memberName: name,
      memberRole: role,
    });
  }
}

async function insertProjectRecord(cn, projectBody) {
  const binds = buildProjectInsertBinds(projectBody);
  const r = await cn.execute(INSERT_PROJECT_SQL, binds, { autoCommit: false });
  const projectId = r.outBinds.OUT_ID?.[0];
  await insertProjectMembers(cn, projectId, projectBody?.members);
  return projectId;
}

async function ensureProjectExists(cn, projectId) {
  const rs = await cn.execute(
    `
      SELECT ID
      FROM EC_APP.PROJECTS
      WHERE ID = :projectId
      FETCH FIRST 1 ROWS ONLY
    `,
    { projectId },
  );
  return Boolean(rs.rows?.length);
}

async function syncProjectRealizedGain(cn, projectId) {
  const rs = await cn.execute(
    `
      SELECT NVL(SUM(VALOR), 0) AS TOTAL
      FROM EC_APP.PROJECT_EARNINGS
      WHERE PROJECT_ID = :projectId
    `,
    { projectId },
  );
  const total = Number(rs.rows?.[0]?.TOTAL || 0);
  await cn.execute(
    `
      UPDATE EC_APP.PROJECTS
      SET GANHO_REALIZADO = :total
      WHERE ID = :projectId
    `,
    { total, projectId },
    { autoCommit: false },
  );
  return total;
}

function normalizeProjectMemberSnapshotRows(rows) {
  return (rows || []).map(row => ({
    id: Number(row.ID),
    memberName: row.MEMBER_NAME || '',
    memberRole: row.MEMBER_ROLE || null,
  }));
}

async function fetchProjectMembersSnapshot(cn, projectId) {
  const rs = await cn.execute(
    `
      SELECT
        ID,
        MEMBER_NAME,
        MEMBER_ROLE
      FROM EC_APP.EC_PROJECT_MEMBERS
      WHERE PROJECT_ID = :projectId
      ORDER BY UPPER(MEMBER_NAME), UPPER(NVL(MEMBER_ROLE, '')), ID
    `,
    { projectId },
  );
  return normalizeProjectMemberSnapshotRows(rs.rows);
}

async function fetchProjectSnapshot(cn, projectId, { includeMembers = true } = {}) {
  const rs = await cn.execute(
    `
      SELECT
        ID,
        TITLE,
        DESCRIPTION AS "description",
        STATUS,
        PRIORITY,
        ORIGEM AS "origem",
        COMITE AS "comite",
        IT AS "it",
        REGISTRO_INT AS "registroInterno",
        VINCULO_PROJ AS "vinculoProjeto",
        CODIGO_ILEAN AS "codigoILean",
        AREA_GRUPO AS "areaGrupo",
        IMPACTO_COMITE AS "impactoComite",
        CATEGORIA_KAIZEN AS "categoriaKaizen",
        GOE_AWARD_Q AS "goeAwardQ",
        GOE_AWARD_YEAR AS "goeAwardYear",
        PREMIO_KAIZEN_Q AS "premioKaizenQ",
        PREMIO_KAIZEN_YEAR AS "premioKaizenYear",
        GANHO_ESTIMADO AS "ganhoEstimado",
        GANHO_REALIZADO AS "ganhoRealizado",
        RE_NO AS "reNo",
        EMPLOYEE_NAME AS "employeeName",
        VALIDADOR AS "validador",
        CHAMPION AS "champion",
        METRICS AS "metrics",
        GOE_KAIZEN_AWARD AS "goeKaizenAward",
        PREMIO_KAIZEN AS "premioKaizen",
        CATEGORIA_BOLETIM_EXOP AS "categoriaBoletimExop",
        PROJECT_LINK_ID AS "projectLinkId",
        HOLD_JUSTIFICATION AS "holdJustification",
        ANO_CONSIDERADO AS "anoConsiderado",
        TO_CHAR(CHEGADA,'YYYY-MM-DD') AS "chegada",
        TO_CHAR(DATA_INICIO_GANHO,'YYYY-MM-DD') AS "dataInicioGanho",
        TO_CHAR(DATA_FIM_PREV,'YYYY-MM-DD') AS "dataFimPrevisto",
        TO_CHAR(START_DATE,'YYYY-MM-DD') AS "startDate",
        TO_CHAR(DUE_DATE,'YYYY-MM-DD') AS "dueDate",
        TO_CHAR(CREATED_AT,'YYYY-MM-DD"T"HH24:MI:SS') AS "createdAt",
        TO_CHAR(COMPLETED_AT,'YYYY-MM-DD"T"HH24:MI:SS') AS "completedAt"
      FROM EC_APP.PROJECTS
      WHERE ID = :projectId
    `,
    { projectId },
  );

  const row = rs.rows?.[0];
  if (!row) return null;

  const snapshot = {
    ...row,
    id: Number(row.ID || row.id || projectId),
  };
  delete snapshot.ID;

  if (includeMembers) {
    snapshot.members = await fetchProjectMembersSnapshot(cn, projectId);
  }

  return snapshot;
}

async function fetchProjectEarningsSnapshot(cn, projectId) {
  const rs = await cn.execute(
    `
      SELECT
        ANO AS "year",
        MES AS "month",
        VALOR AS "value",
        TIPO AS "tipo",
        DOLLAR_VALUE AS "dolarValue",
        EARNING_STATUS AS "earningStatus"
      FROM EC_APP.PROJECT_EARNINGS
      WHERE PROJECT_ID = :projectId
      ORDER BY ANO, MES
    `,
    { projectId },
  );

  return (rs.rows || []).map(row => ({
    year: Number(row.year),
    month: Number(row.month),
    value: Number(row.value || 0),
    tipo: row.tipo || null,
    dolarValue: row.dolarValue === null || row.dolarValue === undefined
      ? null
      : Number(row.dolarValue),
    earningStatus: row.earningStatus || 'PREVISTO',
  }));
}

async function prepareProjectImportRows(cn, rows, { seedErrors = [], onRow = null, shouldAbort = null } = {}) {
  const errors = Array.isArray(seedErrors) ? [...seedErrors] : [];
  const readyRows = [];
  const seenKeys = new Map();
  let duplicateCount = errors.filter(err => err?.type === 'duplicate').length;
  let aborted = false;

  for (let index = 0; index < rows.length; index += 1) {
    if (typeof shouldAbort === 'function' && shouldAbort()) {
      aborted = true;
      break;
    }

    const source = rows[index] && typeof rows[index] === 'object' ? rows[index] : {};
    const rowNumber = Number(source.__rowNumber) || index + 2;
    const { payload, errors: rowErrors, warnings: rowWarnings } = normalizeImportProjectRow(source, rowNumber);

    if (Array.isArray(rowWarnings) && rowWarnings.length) {
      errors.push(...rowWarnings);
    }

    if (rowErrors.length) {
      errors.push(...rowErrors);
      if (typeof onRow === 'function') {
        onRow({
          phase: 'validate',
          index: index + 1,
          total: rows.length,
          accepted: readyRows.length,
          rejected: (index + 1) - readyRows.length,
          duplicateCount,
          errorsCount: errors.length,
        });
      }
      continue;
    }

    const duplicateKey = buildProjectDuplicateKey(payload);
    const duplicateSourceRow = seenKeys.get(duplicateKey);
    if (duplicateSourceRow) {
      duplicateCount += 1;
      errors.push(
        projectImportError({
          type: 'duplicate',
          row: rowNumber,
          field: 'title',
          message: `Duplicate row in file (same title/start/due as row ${duplicateSourceRow}).`,
        }),
      );
      if (typeof onRow === 'function') {
        onRow({
          phase: 'validate',
          index: index + 1,
          total: rows.length,
          accepted: readyRows.length,
          rejected: (index + 1) - readyRows.length,
          duplicateCount,
          errorsCount: errors.length,
        });
      }
      continue;
    }
    seenKeys.set(duplicateKey, rowNumber);

    const alreadyExists = await projectExistsByKey(cn, payload);
    if (alreadyExists) {
      duplicateCount += 1;
      errors.push(
        projectImportError({
          type: 'duplicate',
          row: rowNumber,
          field: 'title',
          message: 'Project already exists with same title/start/due date.',
        }),
      );
      if (typeof onRow === 'function') {
        onRow({
          phase: 'validate',
          index: index + 1,
          total: rows.length,
          accepted: readyRows.length,
          rejected: (index + 1) - readyRows.length,
          duplicateCount,
          errorsCount: errors.length,
        });
      }
      continue;
    }

    readyRows.push({
      ...payload,
      __rowNumber: rowNumber,
    });

    if (typeof onRow === 'function') {
      onRow({
        phase: 'validate',
        index: index + 1,
        total: rows.length,
        accepted: readyRows.length,
        rejected: (index + 1) - readyRows.length,
        duplicateCount,
        errorsCount: errors.length,
      });
    }
  }

  return {
    readyRows,
    errors,
    duplicateCount,
    rejectedCount: rows.length - readyRows.length,
    aborted,
  };
}

async function executePreparedProjectImport(
  cn,
  readyRows,
  { seedErrors = [], seedLogs = [], onRow = null, shouldAbort = null, auditContext = null } = {},
) {
  const errors = Array.isArray(seedErrors) ? [...seedErrors] : [];
  const logs = Array.isArray(seedLogs) ? [...seedLogs] : [];
  let imported = 0;
  let failedOnInsert = 0;
  let duplicateCount = errors.filter(err => err?.type === 'duplicate').length;
  let aborted = false;

  for (let index = 0; index < readyRows.length; index += 1) {
    if (typeof shouldAbort === 'function' && shouldAbort()) {
      aborted = true;
      break;
    }

    const row = readyRows[index] || {};
    const rowNumber = Number(row.__rowNumber) || null;
    const { __rowNumber, ...payload } = row;

    try {
      const projectId = await insertProjectRecord(cn, payload);
      if (auditContext && typeof auditContext === 'object') {
        const afterSnapshot = await fetchProjectSnapshot(cn, projectId, { includeMembers: true });
        await tryInsertChangeLog(cn, {
          tableName: PROJECT_TABLE_NAME,
          recordId: projectId,
          action: 'C',
          actorId: (() => {
            const parsed = Number(auditContext.actorId);
            return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
          })(),
          actorIdent: String(auditContext.actorIdent || auditContext.actorEmail || 'SYSTEM'),
          oldRow: null,
          newRow: afterSnapshot,
        });
      }
      imported += 1;
      logs.push({
        type: 'success',
        message: `Row ${rowNumber || '-'} imported (project ID ${projectId}).`,
      });
    } catch (error) {
      failedOnInsert += 1;
      const rawMessage = String(error?.message || 'Import error');
      const duplicate = /duplicate|already exists|unique|ora-00001/i.test(rawMessage);
      if (duplicate) duplicateCount += 1;

      errors.push(
        projectImportError({
          type: duplicate ? 'duplicate' : 'import',
          row: rowNumber,
          field: duplicate ? 'title' : '',
          message: rawMessage,
        }),
      );
      logs.push({
        type: 'error',
        message: `Row ${rowNumber || '-'} failed: ${rawMessage}`,
      });
    }

    if (typeof onRow === 'function') {
      onRow({
        phase: 'import',
        index: index + 1,
        total: readyRows.length,
        imported,
        failedOnInsert,
        duplicateCount,
        errorsCount: errors.length,
      });
    }
  }

  return {
    imported,
    failedOnInsert,
    duplicateCount,
    errors,
    logs,
    aborted,
  };
}

const projectImportJobs = new Map();
const projectImportJobQueue = [];
let projectImportWorkerRunning = false;

function nowIso() {
  return new Date().toISOString();
}

function computeImportPercent(current, total) {
  const safeTotal = Number(total) || 0;
  if (safeTotal <= 0) return 0;
  const safeCurrent = Math.max(0, Number(current) || 0);
  return Math.max(0, Math.min(100, Math.round((safeCurrent / safeTotal) * 100)));
}

function parseJsonSafe(raw, fallback) {
  if (raw === null || raw === undefined || raw === '') return fallback;
  try {
    return JSON.parse(String(raw));
  } catch {
    return fallback;
  }
}

function toIsoString(value) {
  if (!value) return null;
  const dt = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(dt.getTime())) return String(value);
  return dt.toISOString();
}

function mapImportJobRow(row) {
  if (!row) return null;
  const payload = parseJsonSafe(row.PAYLOAD_JSON, null);
  const progressRaw = parseJsonSafe(row.PROGRESS_JSON, {});
  const defaultTotal = Array.isArray(payload?.rows)
    ? payload.rows.length
    : Math.max(0, Number(progressRaw?.total || 0));

  const progress = {
    phase: String(progressRaw?.phase || '').trim() || String(row.STATUS || '').trim().toLowerCase() || 'queued',
    current: Math.max(0, Number(progressRaw?.current || 0)),
    total: Math.max(0, Number(progressRaw?.total ?? defaultTotal ?? 0)),
    imported: Math.max(0, Number(progressRaw?.imported || 0)),
    failed: Math.max(0, Number(progressRaw?.failed || 0)),
    skipped: Math.max(0, Number(progressRaw?.skipped || 0)),
    duplicated: Math.max(0, Number(progressRaw?.duplicated || 0)),
  };
  progress.percent = computeImportPercent(progress.current, progress.total);

  return {
    id: String(row.ID),
    status: String(row.STATUS || '').trim().toLowerCase(),
    createdAt: toIsoString(row.CREATED_AT),
    updatedAt: toIsoString(row.UPDATED_AT),
    startedAt: toIsoString(row.STARTED_AT),
    finishedAt: toIsoString(row.FINISHED_AT),
    actorEmail: row.ACTOR_EMAIL || null,
    actorId: row.ACTOR_ID === null || row.ACTOR_ID === undefined ? null : Number(row.ACTOR_ID),
    cancelRequested: String(row.CANCEL_REQUESTED || 'N').trim().toUpperCase() === 'Y',
    payload,
    progress,
    result: parseJsonSafe(row.RESULT_JSON, null),
    error: parseJsonSafe(row.ERROR_JSON, null),
  };
}

async function loadImportJobFromDbById(jobId, { actorEmail = null, includePayload = false } = {}) {
  let cn;
  try {
    cn = await pool.getConnection();
    const binds = { jobId: String(jobId || '').trim() };
    const where = ['j.ID = :jobId'];
    if (actorEmail) {
      binds.actorEmail = String(actorEmail).trim().toLowerCase();
      where.push('LOWER(j.ACTOR_EMAIL) = :actorEmail');
    }

    const payloadSelect = includePayload ? 'j.PAYLOAD_JSON' : 'NULL AS PAYLOAD_JSON';
    const rs = await cn.execute(
      `
        SELECT
          j.ID,
          j.STATUS,
          j.ACTOR_EMAIL,
          j.ACTOR_ID,
          j.CANCEL_REQUESTED,
          ${payloadSelect},
          j.PROGRESS_JSON,
          j.RESULT_JSON,
          j.ERROR_JSON,
          j.CREATED_AT,
          j.UPDATED_AT,
          j.STARTED_AT,
          j.FINISHED_AT
        FROM EC_APP.PROJECT_IMPORT_JOBS j
        WHERE ${where.join(' AND ')}
        FETCH FIRST 1 ROWS ONLY
      `,
      binds,
    );

    if (!rs.rows?.length) return null;
    return mapImportJobRow(rs.rows[0]);
  } finally {
    try { await cn?.close(); } catch { }
  }
}

async function persistImportJobCreate(job) {
  let cn;
  try {
    cn = await pool.getConnection();
    const progress = { ...(job.progress || {}) };
    progress.percent = computeImportPercent(progress.current, progress.total);
    await cn.execute(
      `
        INSERT INTO EC_APP.PROJECT_IMPORT_JOBS
          (ID, STATUS, ACTOR_EMAIL, ACTOR_ID, CANCEL_REQUESTED, PAYLOAD_JSON, PROGRESS_JSON)
        VALUES
          (:id, :status, :actorEmail, :actorId, :cancelRequested, :payloadJson, :progressJson)
      `,
      {
        id: String(job.id),
        status: String(job.status || 'queued').trim().toUpperCase(),
        actorEmail: String(job.actorEmail || '').trim(),
        actorId: job.actorId === null || job.actorId === undefined ? null : Number(job.actorId),
        cancelRequested: job.cancelRequested ? 'Y' : 'N',
        payloadJson: JSON.stringify(job.payload || {}),
        progressJson: JSON.stringify(progress),
      },
      { autoCommit: true },
    );
  } finally {
    try { await cn?.close(); } catch { }
  }
}

async function persistImportJobState(
  job,
  { clearPayload = false, resetStartedAt = false, resetFinishedAt = false } = {},
) {
  let cn;
  try {
    cn = await pool.getConnection();
    const progress = { ...(job.progress || {}) };
    progress.percent = computeImportPercent(progress.current, progress.total);
    await cn.execute(
      `
        UPDATE EC_APP.PROJECT_IMPORT_JOBS
        SET STATUS = :status,
            CANCEL_REQUESTED = :cancelRequested,
            PROGRESS_JSON = :progressJson,
            RESULT_JSON = :resultJson,
            ERROR_JSON = :errorJson,
            UPDATED_AT = SYSTIMESTAMP,
            STARTED_AT = CASE
              WHEN :resetStartedAt = 1 THEN NULL
              WHEN :status = 'RUNNING' THEN NVL(STARTED_AT, SYSTIMESTAMP)
              ELSE STARTED_AT
            END,
            FINISHED_AT = CASE
              WHEN :resetFinishedAt = 1 THEN NULL
              WHEN :status IN ('COMPLETED', 'FAILED', 'CANCELED') THEN NVL(FINISHED_AT, SYSTIMESTAMP)
              ELSE FINISHED_AT
            END
            ${clearPayload ? ', PAYLOAD_JSON = NULL' : ''}
        WHERE ID = :id
      `,
      {
        id: String(job.id),
        status: String(job.status || 'queued').trim().toUpperCase(),
        cancelRequested: job.cancelRequested ? 'Y' : 'N',
        resetStartedAt: resetStartedAt ? 1 : 0,
        resetFinishedAt: resetFinishedAt ? 1 : 0,
        progressJson: JSON.stringify(progress),
        resultJson: job.result ? JSON.stringify(job.result) : null,
        errorJson: job.error ? JSON.stringify(job.error) : null,
      },
      { autoCommit: true },
    );
  } finally {
    try { await cn?.close(); } catch { }
  }
}

async function persistImportJobStateSafe(job, options = {}, label = 'state update') {
  try {
    await persistImportJobState(job, options);
  } catch (error) {
    console.error(`ERR persist import job ${label}`, error);
  }
}

async function pruneImportJobsInDb() {
  let cn;
  try {
    cn = await pool.getConnection();
    await cn.execute(
      `
        DELETE FROM EC_APP.PROJECT_IMPORT_JOBS
        WHERE STATUS IN ('COMPLETED', 'FAILED', 'CANCELED')
          AND FINISHED_AT IS NOT NULL
          AND FINISHED_AT < SYSTIMESTAMP - NUMTODSINTERVAL(:ttlMinutes, 'MINUTE')
      `,
      {
        ttlMinutes: PROJECT_IMPORT_JOB_RETENTION_MINUTES,
      },
      { autoCommit: true },
    );
  } catch (error) {
    console.error('ERR prune import jobs db', error);
  } finally {
    try { await cn?.close(); } catch { }
  }
}

function pruneProjectImportJobs() {
  void pruneImportJobsInDb();
  const ttlMs = PROJECT_IMPORT_JOB_RETENTION_MINUTES * 60 * 1000;
  const now = Date.now();
  for (const [jobId, job] of projectImportJobs.entries()) {
    if (!(job.status === 'completed' || job.status === 'failed' || job.status === 'canceled')) continue;
    const finishedStamp = Date.parse(job.finishedAt || job.updatedAt || job.createdAt || '');
    if (!Number.isFinite(finishedStamp)) continue;
    if ((now - finishedStamp) > ttlMs) {
      projectImportJobs.delete(jobId);
    }
  }
}

function removeQueuedProjectImportJob(jobId) {
  const idx = projectImportJobQueue.indexOf(jobId);
  if (idx >= 0) {
    projectImportJobQueue.splice(idx, 1);
  }
}

function cancelProjectImportJob(job, { message = 'Import canceled by user.', resultPatch = {} } = {}) {
  const rowsCount = Array.isArray(job.payload?.rows)
    ? job.payload.rows.length
    : Math.max(0, Number(job.progress?.total || 0));
  const skipped = Math.max(
    0,
    Number(job.payload?.invalidRowsCount ?? job.progress?.skipped ?? 0),
  );
  const failed = Math.max(0, Number(job.progress?.failed || 0));
  const duplicated = Math.max(0, Number(job.progress?.duplicated || 0));
  const warningError = projectImportError({
    type: 'canceled',
    row: null,
    field: '',
    message,
  });

  const baseResult = {
    canceled: true,
    totalProcessed: rowsCount + skipped,
    imported: 0,
    failed,
    skipped,
    duplicated,
    errors: [warningError],
    logs: [{ type: 'warning', message }],
  };

  const patch = resultPatch && typeof resultPatch === 'object' ? resultPatch : {};
  const nextResult = {
    ...baseResult,
    ...patch,
    errors: Array.isArray(patch.errors) ? patch.errors : baseResult.errors,
    logs: Array.isArray(patch.logs) ? patch.logs : baseResult.logs,
  };

  job.status = 'canceled';
  job.cancelRequested = true;
  job.finishedAt = nowIso();
  job.updatedAt = job.finishedAt;
  job.error = null;
  job.result = nextResult;
  setProjectImportJobProgress(job, { phase: 'canceled' });
}

function toProjectImportJobApi(job) {
  const queuePosition = job.status === 'queued'
    ? Math.max(0, projectImportJobQueue.indexOf(job.id) + 1)
    : 0;

  return {
    id: job.id,
    status: job.status,
    queuePosition,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    cancelRequested: Boolean(job.cancelRequested),
    progress: {
      ...job.progress,
      percent: computeImportPercent(job.progress.current, job.progress.total),
    },
    result: job.result || null,
    error: job.error || null,
  };
}

function setProjectImportJobProgress(job, patch = {}) {
  job.progress = {
    ...job.progress,
    ...patch,
  };
  job.progress.percent = computeImportPercent(job.progress.current, job.progress.total);
  job.updatedAt = nowIso();
  void persistImportJobState(job).catch(error => {
    console.error('ERR persist import job progress', error);
  });
}

async function runProjectImportJob(jobId) {
  const job = projectImportJobs.get(jobId);
  if (!job || job.status !== 'queued') return;
  if (job.cancelRequested || job.status === 'canceled') {
    cancelProjectImportJob(job, { message: 'Import canceled before processing.' });
    await persistImportJobStateSafe(job, { clearPayload: true }, 'cancel before processing');
    job.payload = null;
    return;
  }

  let cn;
  try {
    job.status = 'running';
    job.startedAt = nowIso();
    job.updatedAt = nowIso();
    await persistImportJobState(job);

    const rows = Array.isArray(job.payload?.rows) ? job.payload.rows : [];
    const invalidRowsCount = Math.max(0, Number(job.payload?.invalidRowsCount || 0));
    const externalErrors = normalizeExternalImportErrors(job.payload?.externalErrors);
    const shouldAbort = () => Boolean(job.cancelRequested);

    cn = await getConnWithActorEmail(job.actorEmail);
    const prepared = await prepareProjectImportRows(cn, rows, {
      seedErrors: externalErrors,
      shouldAbort,
      onRow: state => {
        setProjectImportJobProgress(job, {
          phase: 'validating',
          total: rows.length,
          current: state.index,
          imported: 0,
          failed: state.rejected,
          duplicated: state.duplicateCount,
          skipped: invalidRowsCount,
        });
      },
    });

    if (prepared.aborted) {
      await cn.rollback();
      cancelProjectImportJob(job, {
        message: 'Import canceled by user.',
        resultPatch: {
          totalProcessed: rows.length + invalidRowsCount,
          imported: 0,
          failed: prepared.rejectedCount,
          skipped: invalidRowsCount,
          duplicated: prepared.duplicateCount,
          errors: prepared.errors,
          logs: [{
            type: 'warning',
            message: 'Import canceled by user during validation.',
          }],
        },
      });
      await persistImportJobStateSafe(job, { clearPayload: true }, 'cancel during validation');
      return;
    }

    if (!prepared.readyRows.length) {
      await cn.rollback();
      const result = {
        totalProcessed: rows.length + invalidRowsCount,
        imported: 0,
        failed: prepared.rejectedCount,
        skipped: invalidRowsCount,
        duplicated: prepared.duplicateCount,
        errors: prepared.errors,
        logs: [{
          type: 'info',
          message: `Import finished without insertions: ${prepared.rejectedCount} row(s) rejected during validation.`,
        }],
      };

      job.status = 'completed';
      job.finishedAt = nowIso();
      job.updatedAt = job.finishedAt;
      job.result = result;
      setProjectImportJobProgress(job, {
        phase: 'completed',
        total: rows.length,
        current: rows.length,
        imported: 0,
        failed: prepared.rejectedCount,
        duplicated: prepared.duplicateCount,
        skipped: invalidRowsCount,
      });
      await persistImportJobStateSafe(job, { clearPayload: true }, 'completed with no rows');
      return;
    }

    const baseRejected = prepared.rejectedCount;
    setProjectImportJobProgress(job, {
      phase: 'importing',
      total: rows.length + prepared.readyRows.length,
      current: rows.length,
      imported: 0,
      failed: baseRejected,
      duplicated: prepared.duplicateCount,
      skipped: invalidRowsCount,
    });

    const execution = await executePreparedProjectImport(cn, prepared.readyRows, {
      seedErrors: prepared.errors,
      shouldAbort,
      auditContext: {
        actorId: job.actorId,
        actorEmail: job.actorEmail,
        actorIdent: job.actorEmail || 'SYSTEM',
      },
      onRow: state => {
        setProjectImportJobProgress(job, {
          phase: 'importing',
          total: rows.length + prepared.readyRows.length,
          current: rows.length + state.index,
          imported: state.imported,
          failed: baseRejected + state.failedOnInsert,
          duplicated: state.duplicateCount,
          skipped: invalidRowsCount,
        });
      },
    });

    if (execution.aborted) {
      await cn.rollback();
      cancelProjectImportJob(job, {
        message: 'Import canceled by user.',
        resultPatch: {
          totalProcessed: rows.length + invalidRowsCount,
          imported: 0,
          failed: baseRejected + execution.failedOnInsert,
          skipped: invalidRowsCount,
          duplicated: execution.duplicateCount,
          errors: execution.errors,
          logs: [
            ...execution.logs,
            {
              type: 'warning',
              message: 'Import canceled by user before commit. All pending inserts were rolled back.',
            },
          ],
        },
      });
      await persistImportJobStateSafe(job, { clearPayload: true }, 'cancel before commit');
      return;
    }

    if (execution.imported > 0) {
      await cn.commit();
    } else {
      await cn.rollback();
    }

    const result = {
      totalProcessed: rows.length + invalidRowsCount,
      imported: execution.imported,
      failed: baseRejected + execution.failedOnInsert,
      skipped: invalidRowsCount,
      duplicated: execution.duplicateCount,
      errors: execution.errors,
      logs: execution.logs,
    };

    job.status = 'completed';
    job.finishedAt = nowIso();
    job.updatedAt = job.finishedAt;
    job.result = result;
    setProjectImportJobProgress(job, {
      phase: 'completed',
      total: rows.length + prepared.readyRows.length,
      current: rows.length + prepared.readyRows.length,
      imported: execution.imported,
      failed: baseRejected + execution.failedOnInsert,
      duplicated: execution.duplicateCount,
      skipped: invalidRowsCount,
    });
    await persistImportJobStateSafe(job, { clearPayload: true }, 'completed');
  } catch (error) {
    if (cn) {
      try { await cn.rollback(); } catch { }
    }

    if (job.cancelRequested && job.status !== 'completed' && job.status !== 'canceled') {
      cancelProjectImportJob(job, { message: 'Import canceled by user.' });
      await persistImportJobStateSafe(job, { clearPayload: true }, 'cancel on exception');
    } else {
      job.status = 'failed';
      job.finishedAt = nowIso();
      job.updatedAt = job.finishedAt;
      job.error = {
        code: 'PROJECT_IMPORT_JOB_FAILED',
        message: String(error?.message || 'Project import job failed.'),
      };
      setProjectImportJobProgress(job, {
        phase: 'failed',
      });
      await persistImportJobStateSafe(job, { clearPayload: true }, 'failed');
    }
  } finally {
    try { await cn?.close(); } catch { }
    job.payload = null;
    pruneProjectImportJobs();
  }
}

async function runProjectImportWorkerQueue() {
  if (projectImportWorkerRunning) return;
  projectImportWorkerRunning = true;
  try {
    while (projectImportJobQueue.length > 0) {
      const jobId = projectImportJobQueue.shift();
      if (!jobId) continue;
      await runProjectImportJob(jobId);
    }
  } finally {
    projectImportWorkerRunning = false;
  }
}

function enqueueProjectImportJob(job) {
  projectImportJobQueue.push(job.id);
  void runProjectImportWorkerQueue();
}

async function createProjectImportJob({ rows, invalidRowsCount, externalErrors, actorEmail, actorId }) {
  pruneProjectImportJobs();
  const id = crypto.randomUUID();
  const job = {
    id,
    status: 'queued',
    createdAt: nowIso(),
    updatedAt: nowIso(),
    startedAt: null,
    finishedAt: null,
    actorEmail: actorEmail || null,
    actorId: actorId || null,
    cancelRequested: false,
    progress: {
      phase: 'queued',
      current: 0,
      total: rows.length,
      imported: 0,
      failed: 0,
      skipped: Math.max(0, Number(invalidRowsCount || 0)),
      duplicated: 0,
      percent: 0,
    },
    result: null,
    error: null,
    payload: {
      rows,
      invalidRowsCount: Math.max(0, Number(invalidRowsCount || 0)),
      externalErrors: Array.isArray(externalErrors) ? externalErrors : [],
    },
  };

  await persistImportJobCreate(job);
  projectImportJobs.set(id, job);
  enqueueProjectImportJob(job);
  return job;
}

async function getProjectImportJobForRequester(req, jobId) {
  const safeJobId = String(jobId || '').trim();
  if (!safeJobId) {
    return { job: null, error: { status: 400, code: 'IMPORT_JOB_ID_INVALID', message: 'Invalid import job ID.' } };
  }

  pruneProjectImportJobs();
  const requester = String(req.actorEmail || '').trim().toLowerCase();
  if (!requester) {
    return { job: null, error: { status: 404, code: 'IMPORT_JOB_NOT_FOUND', message: 'Import job not found.' } };
  }

  let job = projectImportJobs.get(safeJobId);
  if (!job) {
    job = await loadImportJobFromDbById(safeJobId, {
      actorEmail: requester,
      includePayload: false,
    });
    if (!job) {
      return { job: null, error: { status: 404, code: 'IMPORT_JOB_NOT_FOUND', message: 'Import job not found.' } };
    }
  }

  const owner = String(job.actorEmail || '').trim().toLowerCase();
  if (owner !== requester) {
    return { job: null, error: { status: 404, code: 'IMPORT_JOB_NOT_FOUND', message: 'Import job not found.' } };
  }

  return { job, error: null };
}

async function recoverProjectImportJobsFromDb() {
  let cn;
  try {
    cn = await pool.getConnection();
    const rs = await cn.execute(
      `
        SELECT
          ID,
          STATUS,
          ACTOR_EMAIL,
          ACTOR_ID,
          CANCEL_REQUESTED,
          PAYLOAD_JSON,
          PROGRESS_JSON,
          RESULT_JSON,
          ERROR_JSON,
          CREATED_AT,
          UPDATED_AT,
          STARTED_AT,
          FINISHED_AT
        FROM EC_APP.PROJECT_IMPORT_JOBS
        WHERE STATUS IN ('QUEUED', 'RUNNING')
        ORDER BY CREATED_AT ASC, ID ASC
      `,
    );

    const recoveredIds = [];
    for (const row of rs.rows || []) {
      const job = mapImportJobRow(row);
      if (!job) continue;

      const rowTotal = Array.isArray(job.payload?.rows) ? job.payload.rows.length : 0;
      if (rowTotal <= 0) {
        job.status = 'failed';
        job.updatedAt = nowIso();
        job.finishedAt = job.updatedAt;
        job.error = {
          code: 'PROJECT_IMPORT_RECOVERY_MISSING_PAYLOAD',
          message: 'Import job payload is missing and cannot be resumed after restart.',
        };
        job.result = {
          totalProcessed: Math.max(0, Number(job.progress?.total || 0)),
          imported: 0,
          failed: Math.max(0, Number(job.progress?.failed || 0)),
          skipped: Math.max(0, Number(job.progress?.skipped || 0)),
          duplicated: Math.max(0, Number(job.progress?.duplicated || 0)),
          errors: [
            projectImportError({
              type: 'import',
              message: 'Import job payload is unavailable after restart.',
            }),
          ],
          logs: [
            {
              type: 'error',
              message: 'Import job failed during startup recovery because payload is missing.',
            },
          ],
        };
        setProjectImportJobProgress(job, { phase: 'failed' });
        await persistImportJobStateSafe(job, { clearPayload: true }, 'recovery missing payload');
        job.payload = null;
        projectImportJobs.set(job.id, job);
        continue;
      }

      const skipped = Math.max(
        0,
        Number(job.payload?.invalidRowsCount ?? job.progress?.skipped ?? 0),
      );
      job.status = 'queued';
      job.cancelRequested = false;
      job.updatedAt = nowIso();
      job.startedAt = null;
      job.finishedAt = null;
      job.result = null;
      job.error = null;
      job.progress = {
        phase: 'queued',
        current: 0,
        total: rowTotal,
        imported: 0,
        failed: 0,
        skipped,
        duplicated: 0,
        percent: 0,
      };
      projectImportJobs.set(job.id, job);
      recoveredIds.push(job.id);
      await persistImportJobStateSafe(
        job,
        { resetStartedAt: true, resetFinishedAt: true },
        'recovery requeue',
      );
    }

    if (recoveredIds.length > 0) {
      for (const jobId of recoveredIds) {
        if (!projectImportJobQueue.includes(jobId)) {
          projectImportJobQueue.push(jobId);
        }
      }
      void runProjectImportWorkerQueue();
      console.log(`Recovered ${recoveredIds.length} import job(s) from database.`);
    }
  } catch (error) {
    console.error('ERR recover import jobs db', error);
  } finally {
    try { await cn?.close(); } catch { }
  }
}

function normalizeAuditActions(value) {
  if (!value) return [];
  const raw = Array.isArray(value) ? value.join(',') : String(value);
  const actions = raw
    .split(',')
    .map(item => item.trim().toUpperCase())
    .filter(item => AUDIT_ALLOWED_ACTIONS.has(item));
  return [...new Set(actions)];
}

function normalizeAuditTables(value) {
  if (!value) return [];
  const raw = Array.isArray(value) ? value.join(',') : String(value);
  const tables = raw
    .split(',')
    .map(item => item.trim().toUpperCase())
    .filter(item => AUDIT_ALLOWED_TABLES.has(item));
  return [...new Set(tables)];
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

function snapshotsDiffer(before, after) {
  return stableStringify(before || null) !== stableStringify(after || null);
}

function buildSnapshotDiff(oldRow, newRow) {
  const before = oldRow && typeof oldRow === 'object' ? oldRow : {};
  const after = newRow && typeof newRow === 'object' ? newRow : {};
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .sort((a, b) => a.localeCompare(b));

  return keys.reduce((acc, field) => {
    const oldValue = before[field] ?? null;
    const newValue = after[field] ?? null;
    if (stableStringify(oldValue) !== stableStringify(newValue)) {
      acc.push({ field, before: oldValue, after: newValue });
    }
    return acc;
  }, []);
}

function getAuditSummary(action, diffCount, tableName = USER_TABLE_NAME) {
  const table = String(tableName || '').toUpperCase();
  if (table === PROJECT_TABLE_NAME) {
    if (action === 'C') return 'Project created';
    if (action === 'D') return 'Project deleted/archived';
    if (action === 'R') return 'Project revert executed';
    return diffCount > 0 ? `${diffCount} project field(s) changed` : 'Project updated';
  }
  if (table === PROJECT_EARNINGS_TABLE_NAME) {
    if (action === 'C') return 'Project earnings created';
    if (action === 'D') return 'Project earnings deleted';
    if (action === 'R') return 'Project earnings revert executed';
    return diffCount > 0 ? `${diffCount} earning field(s) changed` : 'Project earnings updated';
  }

  if (action === 'C') return 'User created';
  if (action === 'D') return 'User archived/deleted';
  if (action === 'R') return 'Reversal executed';
  return diffCount > 0 ? `${diffCount} field(s) changed` : 'User updated';
}

function toAuditListItem(row) {
  const tableName = String(row.TABLE_NAME || '').toUpperCase();
  const action = String(row.ACTION || '').trim().toUpperCase();
  const oldRow = parseLogJson(row.OLD_ROW_JSON);
  const newRow = parseLogJson(row.NEW_ROW_JSON);
  const diff = buildSnapshotDiff(oldRow, newRow);
  const targetProjectTitle = row.TARGET_PROJECT_TITLE || newRow?.title || oldRow?.title || null;

  let targetLabel = `#${Number(row.RECORD_ID)}`;
  if (tableName === USER_TABLE_NAME) {
    targetLabel = row.TARGET_EMAIL || row.TARGET_NAME || row.TARGET_USERNAME || targetLabel;
  } else if (tableName === PROJECT_TABLE_NAME) {
    targetLabel = targetProjectTitle || `Project #${Number(row.RECORD_ID)}`;
  } else if (tableName === PROJECT_EARNINGS_TABLE_NAME) {
    targetLabel = targetProjectTitle
      ? `${targetProjectTitle} (#${Number(row.RECORD_ID)})`
      : `Project Earnings #${Number(row.RECORD_ID)}`;
  }

  return {
    id: Number(row.ID),
    tableName,
    recordId: Number(row.RECORD_ID),
    action,
    changedAt: row.CHANGED_AT,
    actorId: row.ACTOR_ID === null || row.ACTOR_ID === undefined ? null : Number(row.ACTOR_ID),
    actorIdent: row.ACTOR_IDENT || 'SYSTEM',
    targetEmail: row.TARGET_EMAIL || newRow?.email || oldRow?.email || null,
    targetName: row.TARGET_NAME || newRow?.displayName || oldRow?.displayName || null,
    targetUsername: row.TARGET_USERNAME || newRow?.username || oldRow?.username || null,
    targetProjectTitle,
    targetLabel,
    changedFields: diff.map(item => item.field),
    diffCount: diff.length,
    summary: getAuditSummary(action, diff.length, tableName),
    reversible: tableName === USER_TABLE_NAME && (action === 'C' || action === 'U' || action === 'D'),
  };
}

function toAuditDetailItem(row) {
  const tableName = String(row.TABLE_NAME || '').toUpperCase();
  const action = String(row.ACTION || '').trim().toUpperCase();
  const oldRow = parseLogJson(row.OLD_ROW_JSON);
  const newRow = parseLogJson(row.NEW_ROW_JSON);
  const diff = buildSnapshotDiff(oldRow, newRow);
  const targetProjectTitle = row.TARGET_PROJECT_TITLE || newRow?.title || oldRow?.title || null;

  let targetLabel = `#${Number(row.RECORD_ID)}`;
  if (tableName === USER_TABLE_NAME) {
    targetLabel = row.TARGET_EMAIL || row.TARGET_NAME || row.TARGET_USERNAME || targetLabel;
  } else if (tableName === PROJECT_TABLE_NAME) {
    targetLabel = targetProjectTitle || `Project #${Number(row.RECORD_ID)}`;
  } else if (tableName === PROJECT_EARNINGS_TABLE_NAME) {
    targetLabel = targetProjectTitle
      ? `${targetProjectTitle} (#${Number(row.RECORD_ID)})`
      : `Project Earnings #${Number(row.RECORD_ID)}`;
  }

  return {
    id: Number(row.ID),
    tableName,
    recordId: Number(row.RECORD_ID),
    action,
    changedAt: row.CHANGED_AT,
    actorId: row.ACTOR_ID === null || row.ACTOR_ID === undefined ? null : Number(row.ACTOR_ID),
    actorIdent: row.ACTOR_IDENT || 'SYSTEM',
    targetProjectTitle,
    targetLabel,
    oldRow,
    newRow,
    diff,
    reversible: tableName === USER_TABLE_NAME && (action === 'C' || action === 'U' || action === 'D'),
  };
}

// Pool (usa .env)
// ORA_USER=EC_APP
// ORA_PASSWORD=...
// ORA_CONNECT=//localhost:1521/xepdb1
const pool = await oracledb.createPool({
  user: process.env.ORA_USER,
  password: process.env.ORA_PASSWORD,
  connectString: process.env.ORA_CONNECT,
  poolMin: 1,
  poolMax: 5,
  poolIncrement: 1,
});

// reusa a mesma lógica do auth.js
const requireAdmin = requireRole(pool, 'ADMIN');

// helper: abre conexão e seta CLIENT_IDENTIFIER a partir do JWT (req.actorEmail)
async function getConnWithActorEmail(actorEmail) {
  const cn = await pool.getConnection();
  const actor = String(actorEmail || '').slice(0, 200); // e-mail do usuario logado
  if (actor) {
    await cn.execute(
      `BEGIN DBMS_SESSION.SET_IDENTIFIER(:id); END;`,
      { id: actor }
    );
  } else {
    await cn.execute(`BEGIN DBMS_SESSION.CLEAR_IDENTIFIER; END;`);
  }
  return cn;
}

async function getConnWithActor(req) {
  return getConnWithActorEmail(req?.actorEmail || null);
}

await recoverProjectImportJobsFromDb();

// ---------------- Healthcheck ----------------
app.get('/api/db/ping', async (req, res) => {
  let cn;
  try {
    cn = await pool.getConnection();
    const r = await cn.execute(`
      SELECT
        SYS_CONTEXT('USERENV','SESSION_USER') AS "user",
        SYS_CONTEXT('USERENV','CON_NAME')     AS "pdb",
        TO_CHAR(SYSDATE,'YYYY-MM-DD HH24:MI:SS') AS "now"
      FROM dual
    `);
    res.json(r.rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  } finally { try { await cn?.close(); } catch { } }
});

// ---------------- Auth (login / register / me) ----------------
authRoutes(app, pool); // define /api/auth/register, /api/auth/login, /api/auth/me

// ---------------- PROJECTS ----------------

// LISTAR (retorna todos os campos já mapeados para o front)
app.get('/api/projects', jwtMiddleware, async (req, res) => {
  let cn;
  try {
    cn = await getConnWithActor(req);

    // 1) projetos
    const rsProj = await cn.execute(`
      SELECT
        ID,
        TITLE,
        DESCRIPTION                  AS "description",
        STATUS,
        PRIORITY,
        ORIGEM                       AS "origem",
        COMITE                       AS "comite",
        IT                           AS "it",
        REGISTRO_INT                 AS "registroInterno",
        VINCULO_PROJ                 AS "vinculoProjeto",
        CODIGO_ILEAN                 AS "codigoILean",
        AREA_GRUPO                   AS "areaGrupo",
        IMPACTO_COMITE               AS "impactoComite",
        CATEGORIA_KAIZEN             AS "categoriaKaizen",
        GOE_AWARD_Q                  AS "goeAwardQ",
        GOE_AWARD_YEAR               AS "goeAwardYear",
        PREMIO_KAIZEN_Q              AS "premioKaizenQ",
        PREMIO_KAIZEN_YEAR           AS "premioKaizenYear",
        GANHO_ESTIMADO               AS "ganhoEstimado",
        NVL((
          SELECT SUM(
            CASE
              WHEN UPPER(NVL(e.EARNING_STATUS, 'PREVISTO')) = 'REALIZADO' THEN NVL(e.VALOR, 0)
              ELSE 0
            END
          )
          FROM EC_APP.PROJECT_EARNINGS e
          WHERE e.PROJECT_ID = p.ID
        ), GANHO_REALIZADO)          AS "ganhoRealizado",
        CASE
          WHEN EXISTS (
            SELECT 1
            FROM EC_APP.PROJECT_EARNINGS e
            WHERE e.PROJECT_ID = p.ID
              AND UPPER(NVL(e.EARNING_STATUS, 'PREVISTO')) = 'REALIZADO'
          ) THEN 1 ELSE 0
        END                           AS "hasRealizedEarnings",
        CASE
          WHEN EXISTS (
            SELECT 1
            FROM EC_APP.PROJECT_EARNINGS e
            WHERE e.PROJECT_ID = p.ID
              AND UPPER(NVL(e.EARNING_STATUS, 'PREVISTO')) = 'PREVISTO'
          ) THEN 1 ELSE 0
        END                           AS "hasProjectedEarnings",
        RE_NO                        AS "reNo",
        EMPLOYEE_NAME                AS "employeeName",
        VALIDADOR                    AS "validador",
        CHAMPION                     AS "champion",
        METRICS                      AS "metrics",
        GOE_KAIZEN_AWARD             AS "goeKaizenAward",
        PREMIO_KAIZEN                AS "premioKaizen",
        CATEGORIA_BOLETIM_EXOP       AS "categoriaBoletimExop",
        PROJECT_LINK_ID              AS "projectLinkId",
        HOLD_JUSTIFICATION           AS "holdJustification",
        ANO_CONSIDERADO              AS "anoConsiderado",
        TO_CHAR(CHEGADA,'YYYY-MM-DD')           AS "chegada",
        TO_CHAR(DATA_INICIO_GANHO,'YYYY-MM-DD') AS "dataInicioGanho",
        TO_CHAR(DATA_FIM_PREV,'YYYY-MM-DD')     AS "dataFimPrevisto",
        TO_CHAR(START_DATE,'YYYY-MM-DD')        AS "startDate",
        TO_CHAR(DUE_DATE,'YYYY-MM-DD')          AS "dueDate",
        CREATED_AT,
        COMPLETED_AT
      FROM EC_APP.PROJECTS p
      ORDER BY ID DESC
    `);

    const projects = rsProj.rows;

    // 2) membros de TODOS os projetos
    const rsMembers = await cn.execute(`
      SELECT
        ID,
        PROJECT_ID,
        MEMBER_NAME,
        MEMBER_ROLE
      FROM EC_APP.EC_PROJECT_MEMBERS
    `);

    const membersByProject = {};
    rsMembers.rows.forEach(m => {
      const pid = m.PROJECT_ID;
      if (!membersByProject[pid]) membersByProject[pid] = [];
      membersByProject[pid].push({
        id: m.ID,
        memberName: m.MEMBER_NAME,
        memberRole: m.MEMBER_ROLE,
        // também já manda no formato genérico:
        name: m.MEMBER_NAME,
        role: m.MEMBER_ROLE,
      });
    });


    // 3) cola members em cada projeto
    const withMembers = projects.map(p => ({
      ...p,
      members: membersByProject[p.ID] || [],
    }));

    res.json(withMembers);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  } finally { try { await cn?.close(); } catch { } }
});

app.get('/api/projects/:id/earnings', jwtMiddleware, async (req, res) => {
  const projectId = Number(req.params.id);
  if (!Number.isInteger(projectId) || projectId <= 0) {
    return res.status(400).json({ error: 'Invalid project ID', code: 'INVALID_PROJECT_ID' });
  }

  const yearRaw = req.query?.year;
  const year = yearRaw === undefined || yearRaw === null || yearRaw === ''
    ? null
    : Number.parseInt(String(yearRaw), 10);
  if (year !== null && !Number.isInteger(year)) {
    return res.status(400).json({ error: 'Invalid year', code: 'INVALID_YEAR' });
  }

  let cn;
  try {
    cn = await getConnWithActor(req);
    const rs = await cn.execute(
      `
        SELECT
          ANO AS "year",
          MES AS "month",
          VALOR AS "value",
          TIPO AS "tipo",
          DOLLAR_VALUE AS "dolarValue",
          EARNING_STATUS AS "earningStatus"
        FROM EC_APP.PROJECT_EARNINGS
        WHERE PROJECT_ID = :projectId
          AND (:year IS NULL OR ANO = :year)
        ORDER BY ANO, MES
      `,
      {
        projectId,
        year,
      },
    );

    const items = (rs.rows || []).map(row => ({
      year: Number(row.year),
      month: Number(row.month),
      value: Number(row.value || 0),
      tipo: row.tipo || null,
      dolarValue: row.dolarValue != null ? Number(row.dolarValue) : null,
      earningStatus: row.earningStatus || 'PREVISTO',
    }));

    return res.json({
      projectId,
      totalRealized: items.reduce((sum, item) => (
        parseEarningStatus(item.earningStatus) === 'REALIZADO'
          ? sum + (Number(item.value) || 0)
          : sum
      ), 0),
      items,
    });
  } catch (error) {
    if (isOraMissingTableOrColumn(error)) {
      return res.status(501).json({
        error: 'Project earnings table is not available in this environment.',
        code: 'PROJECT_EARNINGS_NOT_AVAILABLE',
      });
    }
    console.error('ERR list project earnings', error);
    return res.status(500).json({ error: error.message });
  } finally {
    try { await cn?.close(); } catch { }
  }
});

app.post('/api/projects/:id/earnings', jwtMiddleware, async (req, res) => {
  const projectId = Number(req.params.id);
  if (!Number.isInteger(projectId) || projectId <= 0) {
    return res.status(400).json({ error: 'Invalid project ID', code: 'INVALID_PROJECT_ID' });
  }

  const year = parseEarningYear(req.body?.year);
  const month = parseEarningMonth(req.body?.month);
  const value = parseEarningValue(req.body?.value);
  const tipo = parseEarningTipo(req.body?.tipo);
  const dolarValue = parseEarningDolarValue(req.body?.dolarValue);
  const earningStatus = parseEarningStatus(req.body?.earningStatus);
  if (year === null) {
    return res.status(400).json({ error: 'Invalid year', code: 'INVALID_YEAR' });
  }
  if (month === null) {
    return res.status(400).json({ error: 'Invalid month', code: 'INVALID_MONTH' });
  }
  if (value === null) {
    return res.status(400).json({ error: 'Invalid value', code: 'INVALID_VALUE' });
  }

  let cn;
  try {
    cn = await getConnWithActor(req);
    const exists = await ensureProjectExists(cn, projectId);
    if (!exists) {
      return res.status(404).json({ error: 'Project not found', code: 'PROJECT_NOT_FOUND' });
    }
    const beforeEarningsSnapshot = await fetchProjectEarningsSnapshot(cn, projectId);

    if (value === 0) {
      await cn.execute(
        `
          DELETE FROM EC_APP.PROJECT_EARNINGS
          WHERE PROJECT_ID = :projectId
            AND ANO = :year
            AND MES = :month
        `,
        { projectId, year, month },
        { autoCommit: false },
      );
    } else {
      const updated = await cn.execute(
        `
          UPDATE EC_APP.PROJECT_EARNINGS
          SET VALOR = :value,
              TIPO = :tipo,
              DOLLAR_VALUE = :dolarValue,
              EARNING_STATUS = :earningStatus
          WHERE PROJECT_ID = :projectId
            AND ANO = :year
            AND MES = :month
        `,
        { projectId, year, month, value, tipo, dolarValue, earningStatus },
        { autoCommit: false },
      );

      if (!updated.rowsAffected) {
        await cn.execute(
          `
            INSERT INTO EC_APP.PROJECT_EARNINGS
              (PROJECT_ID, ANO, MES, VALOR, TIPO, DOLLAR_VALUE, EARNING_STATUS)
            VALUES
              (:projectId, :year, :month, :value, :tipo, :dolarValue, :earningStatus)
          `,
          { projectId, year, month, value, tipo, dolarValue, earningStatus },
          { autoCommit: false },
        );
      }
    }

    const totalRealized = await syncProjectRealizedGain(cn, projectId);
    const afterEarningsSnapshot = await fetchProjectEarningsSnapshot(cn, projectId);
    await tryInsertEntityChangeLog(cn, req, {
      tableName: PROJECT_EARNINGS_TABLE_NAME,
      recordId: projectId,
      beforeSnapshot: beforeEarningsSnapshot,
      afterSnapshot: afterEarningsSnapshot,
      fallbackAction: 'U',
    });
    await cn.commit();

    return res.json({
      ok: true,
      projectId,
      year,
      month,
      value,
      totalRealized,
    });
  } catch (error) {
    if (cn) {
      try { await cn.rollback(); } catch { }
    }
    if (isOraMissingTableOrColumn(error)) {
      return res.status(501).json({
        error: 'Project earnings table is not available in this environment.',
        code: 'PROJECT_EARNINGS_NOT_AVAILABLE',
      });
    }
    console.error('ERR upsert project earning', error);
    return res.status(500).json({ error: error.message });
  } finally {
    try { await cn?.close(); } catch { }
  }
});

app.put('/api/projects/:id/earnings', jwtMiddleware, async (req, res) => {
  const projectId = Number(req.params.id);
  if (!Number.isInteger(projectId) || projectId <= 0) {
    return res.status(400).json({ error: 'Invalid project ID', code: 'INVALID_PROJECT_ID' });
  }

  const payload = Array.isArray(req.body?.items) ? req.body.items : null;
  if (!payload) {
    return res.status(400).json({ error: 'Invalid items payload', code: 'INVALID_ITEMS_PAYLOAD' });
  }
  if (payload.length > 600) {
    return res.status(400).json({ error: 'Too many items', code: 'EARNINGS_ITEMS_LIMIT_EXCEEDED' });
  }

  const seen = new Set();
  const normalizedItems = [];
  for (const item of payload) {
    const year = parseEarningYear(item?.year);
    const month = parseEarningMonth(item?.month);
    const value = parseEarningValue(item?.value);
    const tipo = parseEarningTipo(item?.tipo);
    const dolarValue = parseEarningDolarValue(item?.dolarValue);
    const earningStatus = parseEarningStatus(item?.earningStatus);
    if (year === null || month === null || value === null) {
      return res.status(400).json({ error: 'Invalid earnings item', code: 'INVALID_EARNINGS_ITEM' });
    }
    const key = `${year}-${month}`;
    if (seen.has(key)) {
      return res.status(400).json({ error: `Duplicate earnings item for ${key}`, code: 'DUPLICATE_EARNINGS_ITEM' });
    }
    seen.add(key);
    if (value === 0) continue;
    normalizedItems.push({ year, month, value, tipo, dolarValue, earningStatus });
  }

  let cn;
  try {
    cn = await getConnWithActor(req);
    const exists = await ensureProjectExists(cn, projectId);
    if (!exists) {
      return res.status(404).json({ error: 'Project not found', code: 'PROJECT_NOT_FOUND' });
    }
    const beforeEarningsSnapshot = await fetchProjectEarningsSnapshot(cn, projectId);

    await cn.execute(
      `
        DELETE FROM EC_APP.PROJECT_EARNINGS
        WHERE PROJECT_ID = :projectId
      `,
      { projectId },
      { autoCommit: false },
    );

    for (const item of normalizedItems) {
      await cn.execute(
        `
          INSERT INTO EC_APP.PROJECT_EARNINGS
            (PROJECT_ID, ANO, MES, VALOR, TIPO, DOLLAR_VALUE, EARNING_STATUS)
          VALUES
            (:projectId, :year, :month, :value, :tipo, :dolarValue, :earningStatus)
        `,
        {
          projectId,
          year: item.year,
          month: item.month,
          value: item.value,
          tipo: item.tipo,
          dolarValue: item.dolarValue,
          earningStatus: item.earningStatus,
        },
        { autoCommit: false },
      );
    }

    const totalRealized = await syncProjectRealizedGain(cn, projectId);
    const afterEarningsSnapshot = await fetchProjectEarningsSnapshot(cn, projectId);
    await tryInsertEntityChangeLog(cn, req, {
      tableName: PROJECT_EARNINGS_TABLE_NAME,
      recordId: projectId,
      beforeSnapshot: beforeEarningsSnapshot,
      afterSnapshot: afterEarningsSnapshot,
      fallbackAction: 'U',
    });
    await cn.commit();
    return res.json({
      ok: true,
      projectId,
      itemsStored: normalizedItems.length,
      totalRealized,
    });
  } catch (error) {
    if (cn) {
      try { await cn.rollback(); } catch { }
    }
    if (isOraMissingTableOrColumn(error)) {
      return res.status(501).json({
        error: 'Project earnings table is not available in this environment.',
        code: 'PROJECT_EARNINGS_NOT_AVAILABLE',
      });
    }
    console.error('ERR replace project earnings', error);
    return res.status(500).json({ error: error.message });
  } finally {
    try { await cn?.close(); } catch { }
  }
});

app.delete('/api/projects/:id/earnings/:year/:month', jwtMiddleware, async (req, res) => {
  const projectId = Number(req.params.id);
  const year = parseEarningYear(req.params.year);
  const month = parseEarningMonth(req.params.month);
  if (!Number.isInteger(projectId) || projectId <= 0) {
    return res.status(400).json({ error: 'Invalid project ID', code: 'INVALID_PROJECT_ID' });
  }
  if (year === null) {
    return res.status(400).json({ error: 'Invalid year', code: 'INVALID_YEAR' });
  }
  if (month === null) {
    return res.status(400).json({ error: 'Invalid month', code: 'INVALID_MONTH' });
  }

  let cn;
  try {
    cn = await getConnWithActor(req);
    const exists = await ensureProjectExists(cn, projectId);
    if (!exists) {
      return res.status(404).json({ error: 'Project not found', code: 'PROJECT_NOT_FOUND' });
    }
    const beforeEarningsSnapshot = await fetchProjectEarningsSnapshot(cn, projectId);

    const deleted = await cn.execute(
      `
        DELETE FROM EC_APP.PROJECT_EARNINGS
        WHERE PROJECT_ID = :projectId
          AND ANO = :year
          AND MES = :month
      `,
      { projectId, year, month },
      { autoCommit: false },
    );

    if (!deleted.rowsAffected) {
      await cn.rollback();
      return res.status(404).json({ error: 'Earning entry not found', code: 'EARNING_NOT_FOUND' });
    }

    const totalRealized = await syncProjectRealizedGain(cn, projectId);
    const afterEarningsSnapshot = await fetchProjectEarningsSnapshot(cn, projectId);
    await tryInsertEntityChangeLog(cn, req, {
      tableName: PROJECT_EARNINGS_TABLE_NAME,
      recordId: projectId,
      beforeSnapshot: beforeEarningsSnapshot,
      afterSnapshot: afterEarningsSnapshot,
      fallbackAction: 'U',
    });
    await cn.commit();
    return res.json({ ok: true, projectId, year, month, totalRealized });
  } catch (error) {
    if (cn) {
      try { await cn.rollback(); } catch { }
    }
    if (isOraMissingTableOrColumn(error)) {
      return res.status(501).json({
        error: 'Project earnings table is not available in this environment.',
        code: 'PROJECT_EARNINGS_NOT_AVAILABLE',
      });
    }
    console.error('ERR delete project earning', error);
    return res.status(500).json({ error: error.message });
  } finally {
    try { await cn?.close(); } catch { }
  }
});


// ---------------- BULK EARNINGS IMPORT ----------------

app.post('/api/projects/earnings/import', jwtMiddleware, async (req, res) => {
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  if (rows.length === 0) {
    return res.status(400).json({ error: 'No rows provided', code: 'EMPTY_PAYLOAD' });
  }
  if (rows.length > 5000) {
    return res.status(400).json({ error: 'Too many rows (max 5000)', code: 'TOO_MANY_ROWS' });
  }

  let cn;
  try {
    cn = await getConnWithActor(req);

    // Build a cache of project titles -> IDs for fast lookup
    const titleCacheRs = await cn.execute(`
      SELECT ID, UPPER(TRIM(TITLE)) AS NORM_TITLE
      FROM EC_APP.PROJECTS
    `);
    const titleToId = new Map();
    for (const row of (titleCacheRs.rows || [])) {
      const normTitle = row.NORM_TITLE;
      // Keep the first match (lowest ID) if duplicate titles exist
      if (!titleToId.has(normTitle)) {
        titleToId.set(normTitle, row.ID);
      }
    }

    const errors = [];
    const logs = [];
    let imported = 0;
    let failed = 0;
    const affectedProjectIds = new Set();
    const beforeEarningsByProject = new Map();

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] || {};
      const rowNumber = Number(row.__rowNumber) || i + 2;
      const projectTitle = String(row.projectTitle || row.projeto || '').trim();

      if (!projectTitle) {
        failed++;
        errors.push({
          type: 'validation',
          row: rowNumber,
          field: 'projectTitle',
          message: `Row ${rowNumber}: Missing project title.`,
        });
        continue;
      }

      const normTitle = projectTitle.toUpperCase().trim();
      const projectId = titleToId.get(normTitle);
      if (!projectId) {
        failed++;
        errors.push({
          type: 'not_found',
          row: rowNumber,
          field: 'projectTitle',
          message: `Row ${rowNumber}: Project "${projectTitle}" not found.`,
        });
        continue;
      }

      const year = parseEarningYear(row.year);
      const month = parseEarningMonth(row.month);
      const value = parseEarningValue(row.value);
      const tipo = parseEarningTipo(row.tipo);
      const dolarValue = parseEarningDolarValue(row.dolarValue);
      const earningStatus = parseEarningStatus(row.earningStatus);

      if (year === null) {
        failed++;
        errors.push({ type: 'validation', row: rowNumber, field: 'year', message: `Row ${rowNumber}: Invalid year "${row.year}".` });
        continue;
      }
      if (month === null) {
        failed++;
        errors.push({ type: 'validation', row: rowNumber, field: 'month', message: `Row ${rowNumber}: Invalid month "${row.month}".` });
        continue;
      }
      if (value === null) {
        failed++;
        errors.push({ type: 'validation', row: rowNumber, field: 'value', message: `Row ${rowNumber}: Invalid value "${row.value}".` });
        continue;
      }

      try {
        if (!beforeEarningsByProject.has(projectId)) {
          beforeEarningsByProject.set(
            projectId,
            await fetchProjectEarningsSnapshot(cn, projectId),
          );
        }

        // Upsert: try update first, then insert
        const updated = await cn.execute(
          `
            UPDATE EC_APP.PROJECT_EARNINGS
            SET VALOR = :value,
                TIPO = :tipo,
                DOLLAR_VALUE = :dolarValue,
                EARNING_STATUS = :earningStatus
            WHERE PROJECT_ID = :projectId
              AND ANO = :year
              AND MES = :month
          `,
          { projectId, year, month, value, tipo, dolarValue, earningStatus },
          { autoCommit: false },
        );

        if (!updated.rowsAffected) {
          await cn.execute(
            `
              INSERT INTO EC_APP.PROJECT_EARNINGS
                (PROJECT_ID, ANO, MES, VALOR, TIPO, DOLLAR_VALUE, EARNING_STATUS)
              VALUES
                (:projectId, :year, :month, :value, :tipo, :dolarValue, :earningStatus)
            `,
            { projectId, year, month, value, tipo, dolarValue, earningStatus },
            { autoCommit: false },
          );
        }

        imported++;
        affectedProjectIds.add(projectId);
        logs.push({ type: 'success', message: `Row ${rowNumber}: Imported earning for project "${projectTitle}" (${year}/${month}).` });
      } catch (err) {
        failed++;
        errors.push({ type: 'import', row: rowNumber, field: '', message: `Row ${rowNumber}: ${err.message}` });
      }
    }

    // Sync realized gain for all affected projects
    for (const pid of affectedProjectIds) {
      await syncProjectRealizedGain(cn, pid);
      const beforeSnapshot = beforeEarningsByProject.get(pid) || [];
      const afterSnapshot = await fetchProjectEarningsSnapshot(cn, pid);
      await tryInsertEntityChangeLog(cn, req, {
        tableName: PROJECT_EARNINGS_TABLE_NAME,
        recordId: pid,
        beforeSnapshot,
        afterSnapshot,
        fallbackAction: 'U',
      });
    }

    await cn.commit();

    return res.json({
      imported,
      failed,
      totalProcessed: rows.length,
      errors,
      logs,
    });
  } catch (error) {
    if (cn) {
      try { await cn.rollback(); } catch { }
    }
    if (isOraMissingTableOrColumn(error)) {
      return res.status(501).json({
        error: 'Project earnings table is not available in this environment.',
        code: 'PROJECT_EARNINGS_NOT_AVAILABLE',
      });
    }
    console.error('ERR bulk import earnings', error);
    return res.status(500).json({ error: error.message });
  } finally {
    try { await cn?.close(); } catch { }
  }
});


// ---------------- PROJECT FILES ----------------

app.post(
  '/api/projects/:id/files',
  jwtMiddleware,
  upload.array('files', 10),
  async (req, res) => {
    const projectId = Number(req.params.id);
    const files = req.files || [];

    if (!projectId || !Number.isInteger(projectId)) {
      return res.status(400).json({ error: 'ID de projeto inválido' });
    }
    if (!files.length) {
      return res.status(400).json({ error: 'Nenhum arquivo enviado' });
    }

    let cn;
    try {
      cn = await getConnWithActor(req);

      for (const f of files) {
        // caminho relativo que o front vai usar
        const relativePath = `/uploads/projects/${projectId}/${f.filename}`;

        await cn.execute(
          `
          INSERT INTO EC_APP.PROJECT_FILES
            (PROJECT_ID, FILE_NAME, FILE_PATH, MIME_TYPE, FILE_SIZE)
          VALUES
            (:projectId, :fileName, :filePath, :mimeType, :fileSize)
          `,
          {
            projectId,
            fileName: f.originalname,
            filePath: relativePath,
            mimeType: f.mimetype,
            fileSize: f.size,
          },
          { autoCommit: false }
        );
      }

      await cn.commit();
      return res.json({ ok: true, count: files.length });
    } catch (e) {
      console.error('ERR upload files', e);
      if (cn) {
        try { await cn.rollback(); } catch { }
      }
      return res.status(500).json({ error: e.message });
    } finally {
      if (cn) {
        try { await cn.close(); } catch { }
      }
    }
  }
);

// LISTAR arquivos de um projeto
app.get(
  '/api/projects/:id/files',
  jwtMiddleware,
  async (req, res) => {
    const projectId = Number(req.params.id);
    if (!Number.isInteger(projectId) || projectId <= 0) {
      return res.status(400).json({ error: 'ID de projeto inválido' });
    }

    let cn;
    try {
      cn = await getConnWithActor(req);
      const rs = await cn.execute(`
        SELECT
          ID,
          PROJECT_ID,
          FILE_NAME,
          FILE_PATH,
          MIME_TYPE,
          FILE_SIZE,
          UPLOADED_AT
        FROM EC_APP.PROJECT_FILES
        WHERE PROJECT_ID = :id
        ORDER BY UPLOADED_AT DESC
      `, { id: projectId });

      res.json(rs.rows);
    } catch (e) {
      console.error('ERR list project files', e);
      res.status(500).json({ error: e.message });
    } finally {
      try { await cn?.close(); } catch { }
    }
  }
);

app.delete(
  '/api/projects/:projectId/files/:fileId',
  jwtMiddleware,
  async (req, res) => {
    const projectId = Number(req.params.projectId);
    const fileId = Number(req.params.fileId);

    if (!Number.isInteger(projectId) || !Number.isInteger(fileId)) {
      return res.status(400).json({ error: 'IDs inválidos' });
    }

    let cn;
    try {
      cn = await getConnWithActor(req);

      // 1) pega o caminho do arquivo
      const rs = await cn.execute(
        `
        SELECT FILE_PATH
          FROM EC_APP.PROJECT_FILES
         WHERE ID = :fileId
           AND PROJECT_ID = :projectId
        `,
        { fileId, projectId }
      );

      if (rs.rows.length === 0) {
        return res.status(404).json({ error: 'Arquivo não encontrado' });
      }

      const filePath = rs.rows[0].FILE_PATH;

      // 2) apaga registro
      await cn.execute(
        `
        DELETE FROM EC_APP.PROJECT_FILES
         WHERE ID = :fileId
           AND PROJECT_ID = :projectId
        `,
        { fileId, projectId },
        { autoCommit: false }
      );

      // 3) tenta remover o arquivo físico
      if (filePath) {
        const absPath = path.join(process.cwd(), filePath.replace(/^\//, ''));
        fs.unlink(absPath, (err) => {
          if (err) console.warn('Erro ao remover arquivo físico:', err.message);
        });
      }

      await cn.commit();
      return res.status(204).end();
    } catch (e) {
      console.error('ERR delete file', e);
      if (cn) { try { await cn.rollback(); } catch { } }
      return res.status(500).json({ error: e.message });
    } finally {
      if (cn) { try { await cn.close(); } catch { } }
    }
  }
);

// --- ADMIN: listar usuários + roles ---
app.get(
  '/api/admin/users',
  jwtMiddleware,
  requireAdmin,
  async (req, res) => {
    let cn;
    try {
      cn = await pool.getConnection();
      const rs = await cn.execute(`
        SELECT
          u.ID,
          u.EMAIL,
          u.USERNAME,
          u.DISPLAY_NAME,
          u.STATUS,
          u.IS_VERIFIED,
          u.CREATED_AT,
          NVL((
            SELECT LISTAGG(r.NAME, ',') WITHIN GROUP (ORDER BY r.NAME)
            FROM EC_APP.USER_ROLES ur
            JOIN EC_APP.ROLES r ON r.ID = ur.ROLE_ID
            WHERE ur.USER_ID = u.ID
          ), '') AS ROLES
        FROM EC_APP.APP_USERS u
        ORDER BY u.ID
      `);
      res.json(rs.rows);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e.message });
    } finally {
      try { await cn?.close(); } catch { }
    }
  }
);

// --- ADMIN: atualizar usuário + roles ---
app.put(
  '/api/admin/users/:id',
  jwtMiddleware,
  requireAdmin,
  async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'ID inválido' });
    }

    const { status, displayName, name, roles } = req.body || {};

    let cn;
    try {
      cn = await getConnWithActor(req);
      const actorContext = buildActorContext(req);
      const beforeSnapshot = await fetchAppUserSnapshot(cn, id);
      if (!beforeSnapshot) {
        return res.status(404).json({ error: 'Usuario nao encontrado', code: 'USER_NOT_FOUND' });
      }

      // UPDATE básico
      await cn.execute(
        `
        UPDATE EC_APP.APP_USERS
           SET STATUS       = NVL(:1, STATUS),
               DISPLAY_NAME = NVL(:2, DISPLAY_NAME),
               NAME         = NVL(:3, NAME)
         WHERE ID = :4
        `,
        [
          status ?? null,
          displayName ?? null,
          name ?? null,
          id,
        ],
        { autoCommit: false }
      );

      // ROLES (se vier)
      if (Array.isArray(roles)) {
        await cn.execute(
          `DELETE FROM EC_APP.USER_ROLES WHERE USER_ID = :1`,
          [id]
        );

        const sqlInsertRole = `
          INSERT INTO EC_APP.USER_ROLES (USER_ID, ROLE_ID)
          SELECT :1, r.ID
            FROM EC_APP.ROLES r
           WHERE TRIM(UPPER(r.NAME)) = TRIM(UPPER(:2))
        `;

        for (const roleName of roles) {
          await cn.execute(sqlInsertRole, [id, roleName]);
        }
      }

      const afterSnapshot = await fetchAppUserSnapshot(cn, id);
      if (!afterSnapshot) {
        return res.status(404).json({ error: 'Usuario nao encontrado', code: 'USER_NOT_FOUND' });
      }

      if (snapshotsDiffer(beforeSnapshot, afterSnapshot)) {
        const beforeStatus = String(beforeSnapshot.status || '').toUpperCase();
        const afterStatus = String(afterSnapshot.status || '').toUpperCase();
        const action = beforeStatus !== 'ARCHIVED' && afterStatus === 'ARCHIVED' ? 'D' : 'U';

        await tryInsertChangeLog(cn, {
          tableName: USER_TABLE_NAME,
          recordId: id,
          action,
          actorId: actorContext.actorId,
          actorIdent: actorContext.actorIdent,
          oldRow: beforeSnapshot,
          newRow: afterSnapshot,
        });
      }

      await cn.commit();
      return res.json({ ok: true });
    } catch (e) {
      console.error('ERR adminUpdateUser', e);
      if (cn) {
        try { await cn.rollback(); } catch { }
      }
      return res.status(500).json({ error: e.message });
    } finally {
      if (cn) {
        try { await cn.close(); } catch { }
      }
    }
  }
);

// --- ADMIN: listar logs de auditoria ---
app.get(
  '/api/admin/audit/users',
  jwtMiddleware,
  requireAdmin,
  async (req, res) => {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(100, Math.max(5, Number.parseInt(req.query.pageSize, 10) || 20));
    const offsetRows = (page - 1) * pageSize;

    const actionList = normalizeAuditActions(req.query.action);
    const actorIdent = String(req.query.actor || req.query.actorIdent || '').trim();
    const targetSearch = String(req.query.target || '').trim();
    const actorId = Number.parseInt(req.query.actorId, 10);
    const recordId = Number.parseInt(req.query.recordId, 10);
    const dateFrom = parseDateQuery(req.query.dateFrom);
    const dateTo = parseDateQuery(req.query.dateTo, { endOfDay: true });
    const tableList = normalizeAuditTables(req.query.table || req.query.tableName || req.query.entity);

    const whereClauses = [];
    const binds = {};

    if (tableList.length) {
      const placeholders = tableList.map((value, index) => {
        const key = `table_${index}`;
        binds[key] = value;
        return `:${key}`;
      });
      whereClauses.push(`l.TABLE_NAME IN (${placeholders.join(', ')})`);
    } else {
      whereClauses.push(
        `l.TABLE_NAME IN ('${USER_TABLE_NAME}', '${PROJECT_TABLE_NAME}', '${PROJECT_EARNINGS_TABLE_NAME}')`,
      );
    }

    if (actionList.length) {
      const placeholders = actionList.map((value, index) => {
        const key = `action_${index}`;
        binds[key] = value;
        return `:${key}`;
      });
      whereClauses.push(`l.ACTION IN (${placeholders.join(', ')})`);
    }

    if (dateFrom) {
      whereClauses.push('l.CHANGED_AT >= :dateFrom');
      binds.dateFrom = dateFrom;
    }

    if (dateTo) {
      whereClauses.push('l.CHANGED_AT <= :dateTo');
      binds.dateTo = dateTo;
    }

    if (Number.isInteger(actorId) && actorId > 0) {
      whereClauses.push('l.ACTOR_ID = :actorId');
      binds.actorId = actorId;
    }

    if (actorIdent) {
      whereClauses.push(`LOWER(NVL(l.ACTOR_IDENT, '')) LIKE :actorIdentLike`);
      binds.actorIdentLike = `%${actorIdent.toLowerCase()}%`;
    }

    if (Number.isInteger(recordId) && recordId > 0) {
      whereClauses.push('l.RECORD_ID = :recordId');
      binds.recordId = recordId;
    }

    if (targetSearch) {
      const needle = targetSearch.toLowerCase();
      const targetClauses = [
        `LOWER(NVL(u.EMAIL, '')) LIKE :targetLike`,
        `LOWER(NVL(u.USERNAME, '')) LIKE :targetLike`,
        `LOWER(NVL(u.DISPLAY_NAME, '')) LIKE :targetLike`,
        `LOWER(NVL(p.TITLE, '')) LIKE :targetLike`,
        `DBMS_LOB.INSTR(LOWER(NVL(l.OLD_ROW_JSON, EMPTY_CLOB())), :targetNeedle) > 0`,
        `DBMS_LOB.INSTR(LOWER(NVL(l.NEW_ROW_JSON, EMPTY_CLOB())), :targetNeedle) > 0`,
      ];
      binds.targetLike = `%${needle}%`;
      binds.targetNeedle = needle;

      const targetRecordId = Number.parseInt(targetSearch, 10);
      if (Number.isInteger(targetRecordId) && targetRecordId > 0) {
        targetClauses.unshift('l.RECORD_ID = :targetRecordId');
        binds.targetRecordId = targetRecordId;
      }

      whereClauses.push(`(${targetClauses.join(' OR ')})`);
    }

    const whereSql = whereClauses.join('\n          AND ');

    let cn;
    try {
      cn = await getConnWithActor(req);

      const countRs = await cn.execute(
        `
          SELECT COUNT(1) AS TOTAL
          FROM EC_APP.CHANGE_LOG l
          LEFT JOIN EC_APP.APP_USERS u
            ON u.ID = l.RECORD_ID
           AND l.TABLE_NAME = '${USER_TABLE_NAME}'
          LEFT JOIN EC_APP.PROJECTS p
            ON p.ID = l.RECORD_ID
           AND l.TABLE_NAME IN ('${PROJECT_TABLE_NAME}', '${PROJECT_EARNINGS_TABLE_NAME}')
          WHERE ${whereSql}
        `,
        binds,
      );
      const total = Number(countRs.rows?.[0]?.TOTAL || 0);

      const rowsRs = await cn.execute(
        `
          SELECT
            l.ID,
            l.TABLE_NAME,
            l.RECORD_ID,
            l.ACTION,
            l.CHANGED_AT,
            l.ACTOR_ID,
            l.ACTOR_IDENT,
            l.OLD_ROW_JSON,
            l.NEW_ROW_JSON,
            u.EMAIL AS TARGET_EMAIL,
            u.USERNAME AS TARGET_USERNAME,
            u.DISPLAY_NAME AS TARGET_NAME,
            p.TITLE AS TARGET_PROJECT_TITLE
          FROM EC_APP.CHANGE_LOG l
          LEFT JOIN EC_APP.APP_USERS u
            ON u.ID = l.RECORD_ID
           AND l.TABLE_NAME = '${USER_TABLE_NAME}'
          LEFT JOIN EC_APP.PROJECTS p
            ON p.ID = l.RECORD_ID
           AND l.TABLE_NAME IN ('${PROJECT_TABLE_NAME}', '${PROJECT_EARNINGS_TABLE_NAME}')
          WHERE ${whereSql}
          ORDER BY l.CHANGED_AT DESC, l.ID DESC
          OFFSET :offsetRows ROWS
          FETCH NEXT :fetchRows ROWS ONLY
        `,
        {
          ...binds,
          offsetRows,
          fetchRows: pageSize,
        },
      );

      return res.json({
        items: rowsRs.rows.map(toAuditListItem),
        availableTables: [USER_TABLE_NAME, PROJECT_TABLE_NAME, PROJECT_EARNINGS_TABLE_NAME],
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      });
    } catch (e) {
      console.error('ERR list audit users', e);
      return res.status(500).json({ error: 'Failed to list audit records', code: 'AUDIT_LIST_FAILED' });
    } finally {
      if (cn) {
        try { await cn.close(); } catch { }
      }
    }
  }
);

// --- ADMIN: detalhe de log de auditoria ---
app.get(
  '/api/admin/audit/users/:id',
  jwtMiddleware,
  requireAdmin,
  async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid log ID', code: 'INVALID_LOG_ID' });
    }

    let cn;
    try {
      cn = await getConnWithActor(req);
      const rs = await cn.execute(
        `
          SELECT
            l.ID,
            l.TABLE_NAME,
            l.RECORD_ID,
            l.ACTION,
            l.CHANGED_AT,
            l.ACTOR_ID,
            l.ACTOR_IDENT,
            l.OLD_ROW_JSON,
            l.NEW_ROW_JSON,
            u.EMAIL AS TARGET_EMAIL,
            u.USERNAME AS TARGET_USERNAME,
            u.DISPLAY_NAME AS TARGET_NAME,
            p.TITLE AS TARGET_PROJECT_TITLE
          FROM EC_APP.CHANGE_LOG l
          LEFT JOIN EC_APP.APP_USERS u
            ON u.ID = l.RECORD_ID
           AND l.TABLE_NAME = '${USER_TABLE_NAME}'
          LEFT JOIN EC_APP.PROJECTS p
            ON p.ID = l.RECORD_ID
           AND l.TABLE_NAME IN ('${PROJECT_TABLE_NAME}', '${PROJECT_EARNINGS_TABLE_NAME}')
          WHERE l.ID = :id
          FETCH FIRST 1 ROWS ONLY
        `,
        { id },
      );

      if (!rs.rows.length) {
        return res.status(404).json({ error: 'Audit record not found', code: 'AUDIT_NOT_FOUND' });
      }

      const detail = toAuditDetailItem(rs.rows[0]);
      detail.targetEmail = rs.rows[0].TARGET_EMAIL || detail.newRow?.email || detail.oldRow?.email || null;
      detail.targetUsername = rs.rows[0].TARGET_USERNAME || detail.newRow?.username || detail.oldRow?.username || null;
      detail.targetName = rs.rows[0].TARGET_NAME || detail.newRow?.displayName || detail.oldRow?.displayName || null;
      detail.targetProjectTitle = rs.rows[0].TARGET_PROJECT_TITLE || detail.newRow?.title || detail.oldRow?.title || null;
      detail.targetLabel = detail.targetLabel
        || detail.targetEmail
        || detail.targetName
        || detail.targetProjectTitle
        || `#${detail.recordId}`;
      return res.json(detail);
    } catch (e) {
      console.error('ERR audit detail', e);
      return res.status(500).json({ error: 'Failed to load audit detail', code: 'AUDIT_DETAIL_FAILED' });
    } finally {
      if (cn) {
        try { await cn.close(); } catch { }
      }
    }
  }
);

// --- ADMIN: reverter alteracao de usuario a partir de um log ---
app.post(
  '/api/admin/audit/users/:id/revert',
  jwtMiddleware,
  requireAdmin,
  async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid log ID', code: 'INVALID_LOG_ID' });
    }

    let cn;
    try {
      cn = await getConnWithActor(req);
      const actorContext = buildActorContext(req);

      const logRs = await cn.execute(
        `
          SELECT
            l.ID,
            l.TABLE_NAME,
            l.RECORD_ID,
            l.ACTION,
            l.CHANGED_AT,
            l.ACTOR_ID,
            l.ACTOR_IDENT,
            l.OLD_ROW_JSON,
            l.NEW_ROW_JSON
          FROM EC_APP.CHANGE_LOG l
          WHERE l.ID = :id
            AND l.TABLE_NAME = :tableName
          FETCH FIRST 1 ROWS ONLY
        `,
        {
          id,
          tableName: USER_TABLE_NAME,
        },
      );

      if (!logRs.rows.length) {
        return res.status(404).json({ error: 'Audit record not found', code: 'AUDIT_NOT_FOUND' });
      }

      const logRow = logRs.rows[0];
      const action = String(logRow.ACTION || '').trim().toUpperCase();
      if (!(action === 'C' || action === 'U' || action === 'D')) {
        return res.status(409).json({
          error: 'This audit action cannot be reverted.',
          code: 'AUDIT_ACTION_NOT_REVERSIBLE',
        });
      }

      const recordId = Number(logRow.RECORD_ID);
      if (!Number.isInteger(recordId) || recordId <= 0) {
        return res.status(400).json({ error: 'Invalid target record ID', code: 'INVALID_RECORD_ID' });
      }

      const oldSnapshot = parseLogJson(logRow.OLD_ROW_JSON);
      const beforeSnapshot = await fetchAppUserSnapshot(cn, recordId);

      if (action === 'U') {
        if (!oldSnapshot) {
          return res.status(409).json({
            error: 'Cannot revert update because old state is unavailable.',
            code: 'AUDIT_OLD_STATE_MISSING',
          });
        }
        await applyUserSnapshot(cn, recordId, oldSnapshot, { allowCreate: false });
      } else if (action === 'D') {
        if (!oldSnapshot) {
          return res.status(409).json({
            error: 'Cannot revert deletion because old state is unavailable.',
            code: 'AUDIT_OLD_STATE_MISSING',
          });
        }
        await applyUserSnapshot(cn, recordId, oldSnapshot, { allowCreate: true });
      } else if (action === 'C') {
        if (!beforeSnapshot) {
          return res.status(409).json({
            error: 'Cannot undo creation because user no longer exists.',
            code: 'AUDIT_CREATE_ALREADY_UNDONE',
          });
        }
        await archiveUser(cn, recordId);
      }

      const afterSnapshot = await fetchAppUserSnapshot(cn, recordId);
      await tryInsertChangeLog(cn, {
        tableName: USER_TABLE_NAME,
        recordId,
        action: 'U',
        actorId: actorContext.actorId,
        actorIdent: actorContext.actorIdent,
        oldRow: beforeSnapshot || oldSnapshot || null,
        newRow: afterSnapshot || null,
      });

      await cn.commit();
      return res.json({
        ok: true,
        revertedLogId: id,
        sourceAction: action,
        recordId,
        before: beforeSnapshot || null,
        after: afterSnapshot || null,
      });
    } catch (error) {
      console.error('ERR revert audit', error);
      if (cn) {
        try { await cn.rollback(); } catch { }
      }
      return toHttpErrorResponse(res, error, 'Failed to revert audit record');
    } finally {
      if (cn) {
        try { await cn.close(); } catch { }
      }
    }
  }
);

// CRIAR projeto
app.post('/api/projects', jwtMiddleware, async (req, res) => {
  const b = req.body || {};
  let cn;
  try {
    cn = await getConnWithActor(req);
    const projectId = await insertProjectRecord(cn, b);
    const afterSnapshot = await fetchProjectSnapshot(cn, projectId, { includeMembers: true });
    await tryInsertEntityChangeLog(cn, req, {
      tableName: PROJECT_TABLE_NAME,
      recordId: projectId,
      beforeSnapshot: null,
      afterSnapshot,
      fallbackAction: 'C',
    });
    await cn.commit();
    res.status(201).json({ id: projectId });
  } catch (e) {
    console.error(e);
    if (cn) { try { await cn.rollback(); } catch { } }
    res.status(500).json({ error: e.message });
  } finally { try { await cn?.close(); } catch { } }
});

// IMPORTAR projetos em lote (validacao por linha + dry-run opcional)
app.post('/api/projects/import', jwtMiddleware, async (req, res) => {
  const body = req.body || {};
  const rows = Array.isArray(body.rows) ? body.rows : [];
  const dryRun = parseBooleanQuery(body.dryRun);
  const invalidRowsCount = Math.max(
    0,
    Number.parseInt(body.invalidRowsCount || '', 10) || 0,
  );
  const externalErrors = normalizeExternalImportErrors(body.externalErrors);

  if (!rows.length) {
    return res.status(400).json({
      error: 'No rows provided for import.',
      code: 'IMPORT_EMPTY',
    });
  }

  if (rows.length > PROJECT_IMPORT_MAX_ROWS) {
    return res.status(400).json({
      error: `Import limit exceeded. Maximum rows per request: ${PROJECT_IMPORT_MAX_ROWS}.`,
      code: 'IMPORT_MAX_ROWS_EXCEEDED',
    });
  }

  let cn;
  try {
    cn = await getConnWithActor(req);
    const prepared = await prepareProjectImportRows(cn, rows, {
      seedErrors: externalErrors,
    });

    if (dryRun) {
      const logs = [{
        type: 'info',
        message: `Dry-run finished: ${prepared.readyRows.length} ready row(s), ${prepared.rejectedCount} rejected row(s).`,
      }];

      return res.json({
        dryRun: true,
        totalProcessed: rows.length + invalidRowsCount,
        imported: 0,
        failed: prepared.rejectedCount,
        skipped: invalidRowsCount,
        duplicated: prepared.duplicateCount,
        errors: prepared.errors,
        logs,
        readyRows: prepared.readyRows,
      });
    }

    const execution = await executePreparedProjectImport(cn, prepared.readyRows, {
      seedErrors: prepared.errors,
      auditContext: buildActorContext(req),
    });

    if (execution.imported > 0) {
      await cn.commit();
    } else {
      await cn.rollback();
    }

    return res.json({
      dryRun: false,
      totalProcessed: rows.length + invalidRowsCount,
      imported: execution.imported,
      failed: prepared.rejectedCount + execution.failedOnInsert,
      skipped: invalidRowsCount,
      duplicated: execution.duplicateCount,
      errors: execution.errors,
      logs: execution.logs,
    });
  } catch (e) {
    console.error('ERR bulk import projects', e);
    if (cn) {
      try { await cn.rollback(); } catch { }
    }
    return res.status(500).json({
      error: 'Failed to import projects in bulk.',
      code: 'PROJECT_IMPORT_FAILED',
    });
  } finally {
    try { await cn?.close(); } catch { }
  }
});

// IMPORTAR projetos em lote de forma assincrona (job + polling)
app.post('/api/projects/import/jobs', jwtMiddleware, async (req, res) => {
  const body = req.body || {};
  const rows = Array.isArray(body.rows) ? body.rows : [];
  const invalidRowsCount = Math.max(
    0,
    Number.parseInt(body.invalidRowsCount || '', 10) || 0,
  );
  const externalErrors = normalizeExternalImportErrors(body.externalErrors);

  if (!rows.length) {
    return res.status(400).json({
      error: 'No rows provided for import.',
      code: 'IMPORT_EMPTY',
    });
  }

  if (rows.length > PROJECT_IMPORT_JOB_MAX_ROWS) {
    return res.status(400).json({
      error: `Import job limit exceeded. Maximum rows per job: ${PROJECT_IMPORT_JOB_MAX_ROWS}.`,
      code: 'IMPORT_JOB_MAX_ROWS_EXCEEDED',
    });
  }

  try {
    const job = await createProjectImportJob({
      rows,
      invalidRowsCount,
      externalErrors,
      actorEmail: req.actorEmail || null,
      actorId: req.user?.id || null,
    });

    return res.status(202).json({
      ...toProjectImportJobApi(job),
      pollAfterMs: 1500,
    });
  } catch (error) {
    console.error('ERR create import job', error);
    return res.status(500).json({
      error: 'Failed to create import job.',
      code: 'IMPORT_JOB_CREATE_FAILED',
    });
  }
});

app.get('/api/projects/import/jobs/:jobId', jwtMiddleware, async (req, res) => {
  try {
    const { job, error } = await getProjectImportJobForRequester(req, req.params.jobId);
    if (error) {
      return res.status(error.status).json({ error: error.message, code: error.code });
    }

    return res.json(toProjectImportJobApi(job));
  } catch (error) {
    console.error('ERR get import job', error);
    return res.status(500).json({
      error: 'Failed to fetch import job.',
      code: 'IMPORT_JOB_FETCH_FAILED',
    });
  }
});

app.delete('/api/projects/import/jobs/:jobId', jwtMiddleware, async (req, res) => {
  try {
    const { job, error } = await getProjectImportJobForRequester(req, req.params.jobId);
    if (error) {
      return res.status(error.status).json({ error: error.message, code: error.code });
    }

    if (job.status === 'completed' || job.status === 'failed' || job.status === 'canceled') {
      return res.status(409).json({
        error: 'Import job is already finished.',
        code: 'IMPORT_JOB_ALREADY_FINISHED',
        job: toProjectImportJobApi(job),
      });
    }

    if (job.status === 'queued') {
      removeQueuedProjectImportJob(job.id);
      cancelProjectImportJob(job, {
        message: 'Import canceled before execution.',
        resultPatch: {
          failed: 0,
        },
      });
      await persistImportJobStateSafe(job, { clearPayload: true }, 'cancel queued endpoint');
      job.payload = null;
      return res.json(toProjectImportJobApi(job));
    }

    if (job.status === 'running') {
      job.cancelRequested = true;
      setProjectImportJobProgress(job, {
        phase: 'cancel_requested',
      });
      await persistImportJobStateSafe(job, {}, 'cancel requested endpoint');
      return res.status(202).json({
        ...toProjectImportJobApi(job),
        pollAfterMs: 1000,
      });
    }

    return res.status(409).json({
      error: 'Import job state does not allow cancellation.',
      code: 'IMPORT_JOB_CANCEL_NOT_ALLOWED',
    });
  } catch (error) {
    console.error('ERR cancel import job', error);
    return res.status(500).json({
      error: 'Failed to cancel import job.',
      code: 'IMPORT_JOB_CANCEL_FAILED',
    });
  }
});

// ATUALIZAR projeto (parcial)
app.put('/api/projects/:id', jwtMiddleware, async (req, res) => {
  const id = Number(req.params.id);
  const b = req.body || {};
  const set = [];
  const binds = { id };
  const hasStatusUpdate = b.status !== undefined;

  const map = {
    TITLE: 'title',
    DESCRIPTION: 'description',
    STATUS: 'status',
    PRIORITY: 'priority',
    ORIGEM: 'origem',
    COMITE: 'comite',
    IT: 'it',
    REGISTRO_INT: 'registroInterno',
    VINCULO_PROJ: 'vinculoProjeto',
    CODIGO_ILEAN: 'codigoILean',
    AREA_GRUPO: 'areaGrupo',
    IMPACTO_COMITE: 'impactoComite',
    CATEGORIA_KAIZEN: 'categoriaKaizen',
    GOE_AWARD_Q: 'goeAwardQ',
    GOE_AWARD_YEAR: 'goeAwardYear',
    PREMIO_KAIZEN_Q: 'premioKaizenQ',
    PREMIO_KAIZEN_YEAR: 'premioKaizenYear',
    GANHO_ESTIMADO: 'ganhoEstimado',
    GANHO_REALIZADO: 'ganhoRealizado',
    RE_NO: 'reNo',
    EMPLOYEE_NAME: 'employeeName',
    VALIDADOR: 'validador',
    CHAMPION: 'champion',
    METRICS: 'metrics',
    GOE_KAIZEN_AWARD: 'goeKaizenAward',
    PREMIO_KAIZEN: 'premioKaizen',
    CATEGORIA_BOLETIM_EXOP: 'categoriaBoletimExop',
    PROJECT_LINK_ID: 'projectLinkId',
    HOLD_JUSTIFICATION: 'holdJustification',
    ANO_CONSIDERADO: 'anoConsiderado',
  };

  for (const col in map) {
    const key = map[col];
    if (b[key] !== undefined) {
      if (col === 'COMITE' || col === 'STATUS') {
        binds[col] = up(b[key]);
      } else if (['GOE_AWARD_YEAR', 'PREMIO_KAIZEN_YEAR', 'GANHO_ESTIMADO', 'GANHO_REALIZADO', 'ANO_CONSIDERADO', 'PROJECT_LINK_ID'].includes(col)) {
        binds[col] = num(b[key]);
      } else {
        binds[col] = b[key];
      }
      set.push(`${col} = :${col}`);
    }
  }

  const dateCols = {
    CHEGADA: 'chegada',
    DATA_INICIO_GANHO: 'dataInicioGanho',
    DATA_FIM_PREV: 'dataFimPrevisto',
    START_DATE: 'startDate',
    DUE_DATE: 'dueDate',
  };
  for (const col in dateCols) {
    const key = dateCols[col];
    if (b[key] !== undefined) {
      binds[col] = d(b[key]);
      set.push(`${col} = TO_DATE(:${col},'YYYY-MM-DD')`);
    }
  }

  if (!set.length && !Array.isArray(b.members)) {
    return res.status(400).json({ error: 'Nada para atualizar' });
  }

  let cn;
  try {
    cn = await getConnWithActor(req);
    const beforeSnapshot = await fetchProjectSnapshot(cn, id, { includeMembers: true });

    if (hasStatusUpdate) {
      const currentStatusRs = await cn.execute(
        `
          SELECT STATUS
          FROM EC_APP.PROJECTS
          WHERE ID = :id
        `,
        { id },
      );
      const statusBefore = String(currentStatusRs.rows?.[0]?.STATUS || '').trim().toUpperCase();
      const statusAfter = String(binds.STATUS || '').trim().toUpperCase();

      const movedToDone = statusBefore !== 'DONE' && statusAfter === 'DONE';
      const movedOutOfDone = statusBefore === 'DONE' && statusAfter !== 'DONE';

      if (movedToDone) {
        set.push('COMPLETED_AT = SYSTIMESTAMP');
      } else if (movedOutOfDone) {
        set.push('COMPLETED_AT = NULL');
      }
    }

    // 1) atualiza projeto (se tiver campos)
    if (set.length) {
      await cn.execute(
        `UPDATE EC_APP.PROJECTS SET ${set.join(', ')} WHERE ID = :id`,
        binds
      );
    }

    // 2) atualiza membros (se veio members)
    if (Array.isArray(b.members)) {
      // apaga todos os membros antigos do projeto
      await cn.execute(
        `DELETE FROM EC_APP.EC_PROJECT_MEMBERS WHERE PROJECT_ID = :id`,
        { id }
      );

      const insertMemberSql = `
        INSERT INTO EC_APP.EC_PROJECT_MEMBERS
          (PROJECT_ID, MEMBER_NAME, MEMBER_ROLE)
        VALUES
          (:projectId, :memberName, :memberRole)
      `;

      for (const m of b.members) {
        if (!m) continue;

        const name = (m.memberName ?? m.name ?? '').trim();
        const role = m.memberRole ?? m.role ?? null;

        if (!name) continue;

        await cn.execute(insertMemberSql, {
          projectId: id,
          memberName: name,
          memberRole: role,
        });
      }
    }


    const afterSnapshot = await fetchProjectSnapshot(cn, id, { includeMembers: true });
    await tryInsertEntityChangeLog(cn, req, {
      tableName: PROJECT_TABLE_NAME,
      recordId: id,
      beforeSnapshot,
      afterSnapshot,
      fallbackAction: 'U',
    });

    await cn.commit();
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    if (cn) { try { await cn.rollback(); } catch { } }
    res.status(500).json({ error: e.message });
  } finally { try { await cn?.close(); } catch { } }
});

// EXCLUIR projeto (ADMIN only)
app.delete('/api/projects/:id', jwtMiddleware, requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'Invalid project ID', code: 'INVALID_PROJECT_ID' });
  }

  let cn;
  try {
    cn = await getConnWithActor(req);
    const beforeSnapshot = await fetchProjectSnapshot(cn, id, { includeMembers: true });

    const exists = await cn.execute(
      `
        SELECT ID
        FROM EC_APP.PROJECTS
        WHERE ID = :id
      `,
      { id }
    );

    if (!exists.rows.length) {
      return res.status(404).json({ error: 'Project not found', code: 'PROJECT_NOT_FOUND' });
    }

    // Remove child records explicitly to keep delete behavior stable when FK cascade is not configured.
    const childTables = [
      'PROJECT_FILES',
      'EC_PROJECT_MEMBERS',
      'PROJECT_SUBTASKS',
      'PROJECT_EARNINGS',
      'PROJECT_ACL',
    ];

    for (const tableName of childTables) {
      await cn.execute(
        `DELETE FROM EC_APP.${tableName} WHERE PROJECT_ID = :projectId`,
        { projectId: id },
        { autoCommit: false }
      );
    }

    const deleted = await cn.execute(
      `DELETE FROM EC_APP.PROJECTS WHERE ID = :id`,
      { id },
      { autoCommit: false }
    );

    if (!deleted.rowsAffected) {
      await cn.rollback();
      return res.status(404).json({ error: 'Project not found', code: 'PROJECT_NOT_FOUND' });
    }

    await tryInsertEntityChangeLog(cn, req, {
      tableName: PROJECT_TABLE_NAME,
      recordId: id,
      beforeSnapshot,
      afterSnapshot: null,
      fallbackAction: 'D',
    });

    await cn.commit();

    // Best-effort cleanup for orphaned project files on disk.
    const projectUploadsDir = path.join(uploadBaseDir, String(id));
    fs.rm(projectUploadsDir, { recursive: true, force: true }, err => {
      if (err) {
        console.warn('WARN delete project uploads dir failed:', err.message);
      }
    });

    return res.status(204).end();
  } catch (e) {
    console.error('ERR delete project', e);
    if (cn) {
      try { await cn.rollback(); } catch { }
    }
    return res.status(500).json({ error: 'Failed to delete project', code: 'PROJECT_DELETE_FAILED' });
  } finally {
    try { await cn?.close(); } catch { }
  }
});

// ==================================================================
// DASHBOARD & ANALYTICS
// ==================================================================

// Helper 1: Busca dados crus do banco (reutiliza conexão segura)
async function fetchRawDashboardData(req) {
  let cn;
  try {
    cn = await getConnWithActor(req);
    // Traz apenas colunas necessárias para estatísticas
    const rs = await cn.execute(`
      SELECT 
        ID, TITLE, DESCRIPTION, STATUS, PRIORITY,
        IMPACTO_COMITE, CATEGORIA_KAIZEN, AREA_GRUPO, EMPLOYEE_NAME, 
        ANO_CONSIDERADO, GANHO_ESTIMADO,
        NVL((
          SELECT SUM(
            CASE
              WHEN UPPER(NVL(e.EARNING_STATUS, 'PREVISTO')) = 'REALIZADO' THEN NVL(e.VALOR, 0)
              ELSE 0
            END
          )
          FROM EC_APP.PROJECT_EARNINGS e
          WHERE e.PROJECT_ID = p.ID
        ), GANHO_REALIZADO) AS GANHO_REALIZADO,
        CASE
          WHEN EXISTS (
            SELECT 1
            FROM EC_APP.PROJECT_EARNINGS e
            WHERE e.PROJECT_ID = p.ID
              AND UPPER(NVL(e.EARNING_STATUS, 'PREVISTO')) = 'REALIZADO'
          ) THEN 1 ELSE 0
        END AS HAS_REALIZED_EARNINGS,
        CASE
          WHEN EXISTS (
            SELECT 1
            FROM EC_APP.PROJECT_EARNINGS e
            WHERE e.PROJECT_ID = p.ID
              AND UPPER(NVL(e.EARNING_STATUS, 'PREVISTO')) = 'PREVISTO'
          ) THEN 1 ELSE 0
        END AS HAS_PROJECTED_EARNINGS,
        TO_CHAR(START_DATE, 'YYYY-MM-DD') as START_DATE,
        TO_CHAR(CHEGADA, 'YYYY-MM-DD') as CHEGADA,
        TO_CHAR(DATA_INICIO_GANHO, 'YYYY-MM-DD') as DATA_INICIO_GANHO,
        TO_CHAR(DUE_DATE, 'YYYY-MM-DD') as DUE_DATE,
        TO_CHAR(DATA_FIM_PREV, 'YYYY-MM-DD') as DATA_FIM_PREV,
        TO_CHAR(CREATED_AT, 'YYYY-MM-DD') as CREATED_AT,
        TO_CHAR(COMPLETED_AT, 'YYYY-MM-DD') as COMPLETED_AT
      FROM EC_APP.PROJECTS p
      WHERE STATUS != 'ARCHIVED'
    `);
    return rs.rows; // Retorna array de objetos
  } finally {
    if (cn) try { await cn.close(); } catch { }
  }
}

// Helper 2: Busca ganhos na granularidade mensal por projeto.
async function fetchRawDashboardEarningsData(req) {
  let cn;
  try {
    cn = await getConnWithActor(req);
    const rs = await cn.execute(`
      SELECT
        e.PROJECT_ID,
        e.ANO,
        e.MES,
        e.VALOR,
        TRIM(UPPER(NVL(e.EARNING_STATUS, 'PREVISTO'))) AS EARNING_STATUS,
        p.ID,
        p.TITLE,
        p.DESCRIPTION,
        p.STATUS,
        p.PRIORITY,
        p.IMPACTO_COMITE,
        p.CATEGORIA_KAIZEN,
        p.AREA_GRUPO,
        p.EMPLOYEE_NAME,
        p.ANO_CONSIDERADO,
        p.GANHO_ESTIMADO,
        p.GANHO_REALIZADO,
        TO_CHAR(p.START_DATE, 'YYYY-MM-DD') as START_DATE,
        TO_CHAR(p.CHEGADA, 'YYYY-MM-DD') as CHEGADA,
        TO_CHAR(p.DATA_INICIO_GANHO, 'YYYY-MM-DD') as DATA_INICIO_GANHO,
        TO_CHAR(p.DUE_DATE, 'YYYY-MM-DD') as DUE_DATE,
        TO_CHAR(p.DATA_FIM_PREV, 'YYYY-MM-DD') as DATA_FIM_PREV,
        TO_CHAR(p.CREATED_AT, 'YYYY-MM-DD') as CREATED_AT
      FROM EC_APP.PROJECT_EARNINGS e
      JOIN EC_APP.PROJECTS p
        ON p.ID = e.PROJECT_ID
      WHERE p.STATUS != 'ARCHIVED'
    `);
    return rs.rows || [];
  } finally {
    if (cn) try { await cn.close(); } catch { }
  }
}

// Helper 3: Filtra os dados na memoria (Search + Date Range)
function filterData(rows, query, options = {}) {
  let data = rows;
  const dateMode = String(options.dateMode || 'project').trim().toLowerCase();
  const statusFilter = new Set(parseListQuery(query.statuses, { upper: true }));
  const earningStatusFilter = new Set(parseListQuery(query.earningStatuses, { upper: true }));
  const impactFilter = new Set(parseListQuery(query.committeeImpacts, { lower: true }));
  const kaizenFilter = new Set(parseListQuery(query.kaizenCategories, { lower: true }));
  const priorityFilter = new Set(parseListQuery(query.priorities, { upper: true }));
  const unscheduledOnly = parseBooleanQuery(query.unscheduled);

  // 1. Busca por texto
  if (query.search) {
    const term = String(query.search).toLowerCase().trim();
    data = data.filter(p =>
      (p.TITLE && String(p.TITLE).toLowerCase().includes(term)) ||
      (p.DESCRIPTION && String(p.DESCRIPTION).toLowerCase().includes(term)) ||
      (p.EMPLOYEE_NAME && String(p.EMPLOYEE_NAME).toLowerCase().includes(term))
    );
  }

  // 2. Filtros globais
  if (statusFilter.size || earningStatusFilter.size || impactFilter.size || kaizenFilter.size || priorityFilter.size || unscheduledOnly) {
    data = data.filter(p => {
      const status = String(p.STATUS || 'TODO').trim().toUpperCase();
      const earningStatus = String(p.EARNING_STATUS || 'PREVISTO').trim().toUpperCase();
      const impact = String(p.IMPACTO_COMITE || 'N/A').trim().toLowerCase();
      const kaizen = String(p.CATEGORIA_KAIZEN || 'N/A').trim().toLowerCase();
      const priority = String(p.PRIORITY || 'MEDIUM').trim().toUpperCase();
      const startReference = p.START_DATE || p.CHEGADA || p.CREATED_AT || null;
      const endReference = p.DUE_DATE || p.DATA_FIM_PREV || null;
      const isUnscheduled = !startReference || !endReference;

      if (statusFilter.size && !statusFilter.has(status)) return false;
      if (earningStatusFilter.size && !earningStatusFilter.has(earningStatus)) {
        return false;
      }
      if (impactFilter.size && !impactFilter.has(impact)) return false;
      if (kaizenFilter.size && !kaizenFilter.has(kaizen)) return false;
      if (priorityFilter.size && !priorityFilter.has(priority)) return false;
      if (unscheduledOnly && !isUnscheduled) return false;
      return true;
    });
  }

  // 3. Filtro de data (de/ate)
  if (query.dateFrom || query.dateTo) {
    const from = query.dateFrom ? new Date(`${String(query.dateFrom).slice(0, 10)}T00:00:00`) : null;
    let to = query.dateTo ? new Date(`${String(query.dateTo).slice(0, 10)}T23:59:59`) : null;

    data = data.filter(p => {
      let pDate = null;

      if (dateMode === 'earning') {
        const earningYear = Number.parseInt(String(p.ANO ?? '').trim(), 10);
        const earningMonth = Number.parseInt(String(p.MES ?? '').trim(), 10);
        if (
          Number.isInteger(earningYear)
          && Number.isInteger(earningMonth)
          && earningMonth >= 1
          && earningMonth <= 12
        ) {
          pDate = new Date(`${earningYear}-${String(earningMonth).padStart(2, '0')}-15T12:00:00`);
        } else {
          // In earning mode with active date filter, only earning-period rows are valid.
          // Do not fallback to project dates, otherwise rows can leak across years.
          return false;
        }
      }

      if (!pDate) {
        const startReference = p.START_DATE || p.CHEGADA || p.CREATED_AT || null;
        const endReference = p.DUE_DATE || p.DATA_FIM_PREV || null;
        const rawDate = startReference || endReference;
        if (!rawDate) return false;
        pDate = new Date(`${String(rawDate).slice(0, 10)}T12:00:00`);
      }

      if (Number.isNaN(pDate.getTime())) return false;
      if (from && pDate < from) return false;
      if (to && pDate > to) return false;
      return true;
    });
  }

  return data;
}

const DASHBOARD_DAY_MS = 24 * 60 * 60 * 1000;

function parseDashboardDate(value) {
  if (!value) return null;
  const raw = String(value).slice(0, 10);
  if (!raw) return null;
  const dt = new Date(`${raw}T12:00:00`);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function toDashboardYmd(value) {
  const dt = value instanceof Date ? value : null;
  if (!dt || Number.isNaN(dt.getTime())) return '';
  const year = dt.getFullYear();
  const month = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function computeDurationDays(startDate, endDate) {
  if (!(startDate instanceof Date) || Number.isNaN(startDate.getTime())) return null;
  if (!(endDate instanceof Date) || Number.isNaN(endDate.getTime())) return null;
  const diff = endDate.getTime() - startDate.getTime();
  return Math.max(0, Math.ceil(diff / DASHBOARD_DAY_MS));
}

function averageDurationDays(rows = []) {
  if (!rows.length) return 0;
  const total = rows.reduce((sum, row) => sum + Number(row.durationDays || 0), 0);
  return total / rows.length;
}

function medianDurationDays(rows = []) {
  if (!rows.length) return 0;
  const sorted = rows
    .map(row => Number(row.durationDays || 0))
    .filter(value => Number.isFinite(value))
    .sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }
  return sorted[middle];
}

function buildLeadTimeRows(rows = []) {
  const todayYmd = toDashboardYmd(new Date());
  const doneRows = [];
  const ongoingRows = [];
  const doneMissingDueDateRows = [];

  for (const row of rows) {
    const status = String(row.STATUS || '').trim().toUpperCase();
    const isDone = status === 'DONE';
    const isOngoing = status === 'IN_PROGRESS' || status === 'REVIEW';
    if (!isDone && !isOngoing) continue;

    // Business rule requested by user:
    // DONE duration must be measured from START_DATE to DUE_DATE.
    // Ongoing rows keep fallback start reference.
    const startRef = isDone
      ? (row.START_DATE || '')
      : (row.START_DATE || row.CHEGADA || row.CREATED_AT || '');
    const startDate = parseDashboardDate(startRef);
    if (!startDate) continue;

    const endRef = isDone
      ? (row.DUE_DATE || '')
      : todayYmd;
    const endDate = parseDashboardDate(endRef);
    if (!endDate) {
      if (isDone) {
        doneMissingDueDateRows.push({
          id: row.ID,
          title: row.TITLE || '',
          status,
          employeeName: row.EMPLOYEE_NAME || '',
          startRef: String(startRef || '').slice(0, 10),
          dueDate: String(row.DUE_DATE || '').slice(0, 10),
        });
      }
      continue;
    }

    const durationDays = computeDurationDays(startDate, endDate);
    if (durationDays === null) continue;

    const normalized = {
      id: row.ID,
      title: row.TITLE || '',
      status,
      employeeName: row.EMPLOYEE_NAME || '',
      expectedGain: Number(row.GANHO_ESTIMADO) || 0,
      plannedRef: String(isDone ? (row.DUE_DATE || '') : (row.DATA_FIM_PREV || row.DUE_DATE || '')).slice(0, 10),
      durationDays,
      startRef: String(startRef || '').slice(0, 10),
      endRef: String(endRef || '').slice(0, 10),
    };

    if (isDone) doneRows.push(normalized);
    if (isOngoing) ongoingRows.push(normalized);
  }

  doneRows.sort((a, b) => Number(b.durationDays || 0) - Number(a.durationDays || 0));
  ongoingRows.sort((a, b) => Number(b.durationDays || 0) - Number(a.durationDays || 0));
  doneMissingDueDateRows.sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')));

  return { doneRows, ongoingRows, doneMissingDueDateRows };
}

function buildUpcomingCompletionRows(rows = [], limit = 12) {
  const candidates = [];
  const undated = [];

  for (const row of rows) {
    const status = String(row.STATUS || '').trim().toUpperCase();
    const isOpenStage = status !== 'DONE' && status !== 'ARCHIVED';
    if (!isOpenStage && status !== 'DONE') continue;

    // Prioritize delivery date for timeline ordering/display.
    // Fallback to estimated end date, then completion stamp.
    const plannedDateRef = row.DUE_DATE || row.DATA_FIM_PREV || row.COMPLETED_AT || '';
    const plannedDate = parseDashboardDate(plannedDateRef);
    if (!plannedDate) {
      undated.push({
        id: row.ID,
        title: row.TITLE || '',
        status,
        employeeName: row.EMPLOYEE_NAME || '',
        plannedDate: '',
        expectedGain: Number(row.GANHO_ESTIMADO) || 0,
      });
      continue;
    }

    const plannedMs = plannedDate.getTime();
    candidates.push({
      id: row.ID,
      title: row.TITLE || '',
      status,
      employeeName: row.EMPLOYEE_NAME || '',
      plannedDate: String(plannedDateRef || '').slice(0, 10),
      expectedGain: Number(row.GANHO_ESTIMADO) || 0,
      __plannedMs: plannedMs,
    });
  }

  candidates.sort((a, b) => {
    const byDate = a.__plannedMs - b.__plannedMs;
    if (byDate !== 0) return byDate;
    const byTitle = String(a.title || '').localeCompare(String(b.title || ''));
    if (byTitle !== 0) return byTitle;
    return Number(a.id || 0) - Number(b.id || 0);
  });

  undated.sort((a, b) => {
    const gainDiff = Number(b.expectedGain || 0) - Number(a.expectedGain || 0);
    if (gainDiff !== 0) return gainDiff;
    return String(a.title || '').localeCompare(String(b.title || ''));
  });

  return [...candidates, ...undated]
    .slice(0, limit)
    .map(({ __plannedMs, ...item }) => item);
}

function filterDataForUpcoming(rows, query) {
  const baseQuery = {
    ...query,
    // Keep date/status filters from the active dashboard context.
    // Upcoming tree must follow the same temporal window selected by the user.
    unscheduled: false,
  };
  return filterData(rows, baseQuery);
}
// ROTA 1: KPIs Principais
app.get('/api/dashboard/kpis', jwtMiddleware, async (req, res) => {
  try {
    const raw = await fetchRawDashboardData(req);
    const data = filterData(raw, req.query);

    const total = data.length;

    // Contagem por Status
    const counts = { TODO: 0, IN_PROGRESS: 0, DONE: 0 };
    data.forEach(p => {
      if (counts[p.STATUS] !== undefined) counts[p.STATUS]++;
    });

    // Financeiro
    const estimado = data.reduce((sum, p) => sum + (Number(p.GANHO_ESTIMADO) || 0), 0);
    const realizado = data.reduce((sum, p) => sum + (Number(p.GANHO_REALIZADO) || 0), 0);
    const diff = realizado - estimado;

    res.json({
      counts: {
        total,
        todo: counts.TODO,
        inProgress: counts.IN_PROGRESS,
        done: counts.DONE
      },
      financial: {
        estimado,
        realizado,
        performanceDiff: Math.abs(diff),
        performanceType: diff >= 0 ? 'up' : 'down'
      }
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ROTA 2: Gráficos Visuais
app.get('/api/dashboard/charts', jwtMiddleware, async (req, res) => {
  try {
    const raw = await fetchRawDashboardData(req);
    const data = filterData(raw, req.query);

    // --- A. Status Chart ---
    const statusCounts = {};
    data.forEach(p => {
      const s = p.STATUS || 'TODO';
      statusCounts[s] = (statusCounts[s] || 0) + 1;
    });

    const statusItems = Object.keys(statusCounts).map(key => ({
      label: key,
      value: statusCounts[key],
      percentage: ((statusCounts[key] / data.length) * 100).toFixed(1) + '%',
    }));

    // --- B. Impacto ---
    const palette = ['#7C7AD5', '#33EBA3', '#FF719A', '#f59e0b', '#64748b'];
    const impactCounts = {};
    data.forEach(p => {
      let val = (p.IMPACTO_COMITE || 'N/A').toLowerCase();
      if (val.includes('receita') || val.includes('savings')) val = 'Receita/Savings';
      else if (val.includes('safety')) val = 'Safety';
      else if (val.includes('produtividade')) val = 'Produtividade';

      const label = val === 'n/a' ? 'N/A' : val.charAt(0).toUpperCase() + val.slice(1);
      if (label !== 'N/A') impactCounts[label] = (impactCounts[label] || 0) + 1;
    });

    const impactItems = Object.keys(impactCounts).map((key, i) => ({
      label: key,
      value: impactCounts[key],
      color: palette[i % palette.length]
    }));

    // --- C. Kaizen Radar (dinâmico)
    const kaizenMap = {};
    data.forEach(p => {
      let k = (p.CATEGORIA_KAIZEN || 'N/A').toString().trim();
      if (k === 'N/A' || k === '') return;

      const kLower = k.toLowerCase();
      if (kLower.includes('waste')) k = 'Waste';
      else if (kLower.includes('safety')) k = 'Safety';
      else if (kLower.includes('performance')) k = 'Performance';
      else if (kLower.includes('5s')) k = '5S';
      else if (kLower.includes('quality')) k = 'Quality';

      kaizenMap[k] = (kaizenMap[k] || 0) + 1;
    });

    const kKeys = Object.keys(kaizenMap);
    const kData = Object.values(kaizenMap);

    // --- D. Stacked Data Helper ---
    const getStacked = (field) => {
      const map = {};
      data.forEach(p => {
        const key = p[field] || 'N/A';
        if (key === 'N/A') return;
        if (!map[key]) map[key] = { DONE: 0, IN_PROGRESS: 0, TODO: 0 };
        let statusBucket = 'TODO';
        if (p.STATUS === 'DONE') statusBucket = 'DONE';
        if (p.STATUS === 'IN_PROGRESS' || p.STATUS === 'REVIEW') statusBucket = 'IN_PROGRESS';

        if (map[key][statusBucket] !== undefined) map[key][statusBucket]++;
      });
      const labels = Object.keys(map).sort();
      return {
        labels,
        done: labels.map(l => map[l].DONE),
        inProgress: labels.map(l => map[l].IN_PROGRESS),
        todo: labels.map(l => map[l].TODO)
      };
    };

    res.json({
      status: { items: statusItems },
      impact: { items: impactItems },
      kaizen: { labels: kKeys, data: kData },
      area: getStacked('AREA_GRUPO'),
      assignee: getStacked('EMPLOYEE_NAME')
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/dashboard/lead-time', jwtMiddleware, async (req, res) => {
  try {
    const raw = await fetchRawDashboardData(req);
    const data = filterData(raw, req.query);
    const { doneRows, ongoingRows, doneMissingDueDateRows } = buildLeadTimeRows(data);
    const upcomingBase = filterDataForUpcoming(raw, req.query);
    // Return a broader list so the frontend can apply presentation ordering
    // without being constrained to the first 5 records from the API.
    const upcomingRows = buildUpcomingCompletionRows(upcomingBase, 200);

    return res.json({
      summary: {
        avgDoneDays: averageDurationDays(doneRows),
        medianDoneDays: medianDurationDays(doneRows),
        avgOngoingDays: averageDurationDays(ongoingRows),
        maxOngoingDays: ongoingRows.length ? Number(ongoingRows[0].durationDays || 0) : 0,
        doneCount: doneRows.length,
        ongoingCount: ongoingRows.length,
        doneMissingDueDateCount: doneMissingDueDateRows.length,
      },
      topDone: doneRows.slice(0, 5),
      topOngoing: ongoingRows.slice(0, 5),
      inProgressOpen: ongoingRows.filter(row => row.status === 'IN_PROGRESS'),
      upcoming: upcomingRows,
      doneMissingDueDate: doneMissingDueDateRows,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
});

// ROTA 3: Custos com Drilldown (valores agregados)
app.get('/api/dashboard/costs', jwtMiddleware, async (req, res) => {
  try {
    const matchesEarningStatus = buildEarningStatusMatcher(req.query);
    const dateMode = String(req.query.dateMode || '').trim().toLowerCase() === 'earning'
      ? 'earning'
      : 'project';
    const yearParam = req.query.year;
    const year = yearParam === undefined || yearParam === null || yearParam === ''
      ? null
      : Number.parseInt(String(yearParam), 10);
    if (year !== null && !Number.isInteger(year)) {
      return res.status(400).json({ error: 'Invalid year', code: 'INVALID_YEAR' });
    }

    let labels = [], values = [], pendingValues = [], counts = [];
    let usedEarnings = false;

    try {
      const rawEarnings = await fetchRawDashboardEarningsData(req);
      const earningsData = filterData(rawEarnings, req.query, { dateMode });

      if (earningsData.length > 0) {
        usedEarnings = true;

        if (year !== null) {
          const monthRealized = Array(12).fill(0);
          const monthPending = Array(12).fill(0);
          const monthProjects = Array.from({ length: 12 }, () => new Set());
          earningsData.forEach(row => {
            const earningYear = Number(row.ANO);
            const earningMonth = Number(row.MES);
            if (!Number.isInteger(earningYear) || !Number.isInteger(earningMonth)) return;
            if (earningYear !== year || earningMonth < 1 || earningMonth > 12) return;
            if (!matchesEarningStatus(row.EARNING_STATUS)) return;
            const val = Number(row.VALOR) || 0;
            const isRealized = String(row.EARNING_STATUS || '').toUpperCase() === 'REALIZADO';
            const hasDefinedGain = Math.abs(val) > 0;
            if (isRealized) {
              monthRealized[earningMonth - 1] += val;
            } else {
              monthPending[earningMonth - 1] += val;
            }
            if (hasDefinedGain) {
              monthProjects[earningMonth - 1].add(Number(row.PROJECT_ID || row.ID));
            }
          });
          labels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
          values = monthRealized;
          pendingValues = monthPending;
          counts = monthProjects.map(set => set.size);
        } else {
          const mapRealized = {};
          const mapPending = {};
          const mapProjects = {};
          earningsData.forEach(row => {
            const earningYear = Number(row.ANO);
            if (!Number.isInteger(earningYear)) return;
            if (!matchesEarningStatus(row.EARNING_STATUS)) return;
            const key = String(earningYear);
            if (!mapProjects[key]) mapProjects[key] = new Set();
            const val = Number(row.VALOR) || 0;
            const isRealized = String(row.EARNING_STATUS || '').toUpperCase() === 'REALIZADO';
            const hasDefinedGain = Math.abs(val) > 0;
            if (isRealized) {
              mapRealized[key] = (mapRealized[key] || 0) + val;
            } else {
              mapPending[key] = (mapPending[key] || 0) + val;
            }
            if (hasDefinedGain) {
              mapProjects[key].add(Number(row.PROJECT_ID || row.ID));
            }
          });
          const allKeys = new Set([...Object.keys(mapRealized), ...Object.keys(mapPending)]);
          labels = Array.from(allKeys).sort((a, b) => Number(a) - Number(b));
          values = labels.map(label => mapRealized[label] || 0);
          pendingValues = labels.map(label => mapPending[label] || 0);
          counts = labels.map(label => mapProjects[label]?.size || 0);
        }
      }
    } catch (error) {
      if (!isOraMissingTableOrColumn(error)) throw error;
    }

    if (!usedEarnings) {
      const raw = await fetchRawDashboardData(req);
      const data = filterData(raw, req.query);

      if (year !== null) {
        const monthVals = Array(12).fill(0);
        const monthCounts = Array(12).fill(0);
        data.forEach(p => {
          const d = p.DATA_INICIO_GANHO || p.START_DATE;
          if (!d) return;
          const dt = new Date(d + 'T12:00:00');
          if (dt.getFullYear() === year) {
            const gain = Number(p.GANHO_REALIZADO) || 0;
            monthVals[dt.getMonth()] += gain;
            if (Math.abs(gain) > 0) {
              monthCounts[dt.getMonth()]++;
            }
          }
        });
        labels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        values = monthVals;
        pendingValues = Array(12).fill(0);
        counts = monthCounts;
      } else {
        const mapVal = {}, mapCount = {};
        data.forEach(p => {
          let y = p.ANO_CONSIDERADO;
          if (!y && p.START_DATE) y = parseInt(p.START_DATE.substring(0, 4), 10);
          if (!y) return;
          const gain = Number(p.GANHO_REALIZADO) || 0;
          mapVal[y] = (mapVal[y] || 0) + gain;
          if (Math.abs(gain) > 0) {
            mapCount[y] = (mapCount[y] || 0) + 1;
          }
        });
        labels = Object.keys(mapVal).sort((a, b) => Number(a) - Number(b));
        values = labels.map(l => mapVal[l]);
        pendingValues = labels.map(() => 0);
        counts = labels.map(l => mapCount[l]);
      }
    }

    // Keep project count exact (no smoothing) to preserve auditable totals.
    res.json({ labels, values, pendingValues, counts });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ROTA 4: Lista de projetos que contribuíram para o ganho (drilldown real)
app.get('/api/dashboard/costs/matrix', jwtMiddleware, async (req, res) => {
  try {
    const matchesEarningStatus = buildEarningStatusMatcher(req.query);
    const dateMode = String(req.query.dateMode || '').trim().toLowerCase() === 'earning'
      ? 'earning'
      : 'project';
    const yearParam = req.query.year;
    const year = yearParam === undefined || yearParam === null || yearParam === ''
      ? null
      : Number.parseInt(String(yearParam), 10);
    if (year !== null && !Number.isInteger(year)) {
      return res.status(400).json({ error: 'Invalid year', code: 'INVALID_YEAR' });
    }

    // const topParam = Number.parseInt(String(req.query.top || ''), 10);
    // const topProjects = Number.isInteger(topParam)
    //   ? Math.max(3, Math.min(12, topParam))
    //   : 6;

    // suporte para top all
    const topRaw = String(req.query.top ?? '').trim().toLowerCase();
    const topParam = Number.parseInt(topRaw, 10);

    // regra principal
    const topProjects =
      year === null
        ? 6
        : (topRaw === 'all' || topRaw === '*' || topRaw === 'todos')
          ? Number.POSITIVE_INFINITY
          : Number.isInteger(topParam)
            ? Math.max(3, topParam)
            : Number.POSITIVE_INFINITY;

    const monthLabels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const matrixByPeriod = new Map();
    const projectTotals = new Map();
    const projectTitles = new Map();

    const pushCell = ({ periodKey, periodLabel, periodOrder, projectId, projectTitle, value, earningStatus }) => {
      if (!Number.isInteger(projectId) || !Number.isFinite(value) || value === 0) return;

      if (!matrixByPeriod.has(periodKey)) {
        matrixByPeriod.set(periodKey, {
          period: periodKey,
          label: periodLabel,
          order: periodOrder,
          valuesByProject: new Map(),
          statusByProject: new Map(),
        });
      }

      const bucket = matrixByPeriod.get(periodKey);
      bucket.valuesByProject.set(projectId, (bucket.valuesByProject.get(projectId) || 0) + value);
      // Cell status precedence: if any portion is projected, mark as PREVISTO.
      // This keeps matrix coloring binary (REALIZADO x PREVISTO) and highlights planned amounts.
      const currentStatus = String(bucket.statusByProject.get(projectId) || '').toUpperCase();
      const nextStatus = String(earningStatus || 'PREVISTO').toUpperCase() === 'REALIZADO'
        ? 'REALIZADO'
        : 'PREVISTO';
      if (currentStatus === 'PREVISTO' || nextStatus === 'PREVISTO') {
        bucket.statusByProject.set(projectId, 'PREVISTO');
      } else {
        bucket.statusByProject.set(projectId, 'REALIZADO');
      }
      projectTotals.set(projectId, (projectTotals.get(projectId) || 0) + value);
      if (!projectTitles.has(projectId)) {
        projectTitles.set(projectId, String(projectTitle || `Project ${projectId}`));
      }
    };

    let usedEarnings = false;
    try {
      const rawEarnings = await fetchRawDashboardEarningsData(req);
      const earningsData = filterData(rawEarnings, req.query, { dateMode });
      if (earningsData.length > 0) {
        usedEarnings = true;
        earningsData.forEach(row => {
          const earningYear = Number(row.ANO);
          const earningMonth = Number(row.MES);
          const projectId = Number(row.PROJECT_ID || row.ID);
          const value = Number(row.VALOR) || 0;
          const earningStatus = String(row.EARNING_STATUS || 'PREVISTO').toUpperCase();
          if (!matchesEarningStatus(earningStatus)) return;
          if (!Number.isInteger(earningYear) || !Number.isInteger(earningMonth) || earningMonth < 1 || earningMonth > 12) return;
          if (year !== null && earningYear !== year) return;

          if (year === null) {
            pushCell({
              periodKey: `Y-${earningYear}`,
              periodLabel: String(earningYear),
              periodOrder: earningYear,
              projectId,
              projectTitle: row.TITLE,
              value,
              earningStatus,
            });
            return;
          }

          pushCell({
            periodKey: `M-${earningMonth}`,
            periodLabel: monthLabels[earningMonth - 1],
            periodOrder: earningMonth,
            projectId,
            projectTitle: row.TITLE,
            value,
            earningStatus,
          });
        });
      }
    } catch (error) {
      if (!isOraMissingTableOrColumn(error)) throw error;
    }

    if (!usedEarnings) {
      const raw = await fetchRawDashboardData(req);
      const data = filterData(raw, req.query);

      data.forEach(row => {
        const projectId = Number(row.ID);
        const value = Number(row.GANHO_REALIZADO) || 0;
        const baseDate = parseDashboardDate(row.DATA_INICIO_GANHO || row.START_DATE || row.CHEGADA || row.CREATED_AT);
        if (!baseDate) return;

        const earningYear = baseDate.getFullYear();
        const earningMonth = baseDate.getMonth() + 1;
        if (year !== null && earningYear !== year) return;

        if (year === null) {
          pushCell({
            periodKey: `Y-${earningYear}`,
            periodLabel: String(earningYear),
            periodOrder: earningYear,
            projectId,
            projectTitle: row.TITLE,
            value,
            earningStatus: 'REALIZADO',
          });
          return;
        }

        pushCell({
          periodKey: `M-${earningMonth}`,
          periodLabel: monthLabels[earningMonth - 1],
          periodOrder: earningMonth,
          projectId,
          projectTitle: row.TITLE,
          value,
          earningStatus: 'REALIZADO',
        });
      });
    }

    if (year !== null) {
      for (let month = 1; month <= 12; month += 1) {
        const key = `M-${month}`;
        if (!matrixByPeriod.has(key)) {
          matrixByPeriod.set(key, {
            period: key,
            label: monthLabels[month - 1],
            order: month,
            valuesByProject: new Map(),
            statusByProject: new Map(),
          });
        }
      }
    }

    // const selectedProjectIds = Array.from(projectTotals.entries())
    //   .sort((a, b) => Math.abs(Number(b[1] || 0)) - Math.abs(Number(a[1] || 0)))
    //   .slice(0, topProjects)
    //   .map(([projectId]) => projectId);

    const rankedProjectIds = Array.from(projectTotals.entries())
      .sort((a, b) => Math.abs(Number(b[1] || 0)) - Math.abs(Number(a[1] || 0)));

    const selectedProjectIds = Number.isFinite(topProjects)
      ? rankedProjectIds.slice(0, topProjects).map(([projectId]) => projectId)
      : rankedProjectIds.map(([projectId]) => projectId);

      
      const projects = selectedProjectIds.map(projectId => ({
        id: projectId,
        title: projectTitles.get(projectId) || `Project ${projectId}`,
        total: Number(projectTotals.get(projectId) || 0),
      }));

    const rows = Array.from(matrixByPeriod.values())
      .sort((a, b) => Number(a.order || 0) - Number(b.order || 0))
      .map(periodRow => {
        const values = selectedProjectIds.map(projectId => Number(periodRow.valuesByProject.get(projectId) || 0));
        const statuses = selectedProjectIds.map(projectId => periodRow.statusByProject.get(projectId) || null);
        return {
          period: periodRow.period,
          label: periodRow.label,
          total: values.reduce((sum, value) => sum + value, 0),
          values,
          statuses,
        };
      });

    const maxCellValue = rows.reduce((max, row) => (
      Math.max(max, ...row.values.map(value => Math.abs(Number(value || 0))))
    ), 0);

    return res.json({
      granularity: year === null ? 'year' : 'month',
      year,
      projects,
      rows,
      maxCellValue,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
});

app.get('/api/dashboard/costs/projects', jwtMiddleware, async (req, res) => {
  try {
    const matchesEarningStatus = buildEarningStatusMatcher(req.query);
    const dateMode = String(req.query.dateMode || '').trim().toLowerCase() === 'earning'
      ? 'earning'
      : 'project';
    const year = req.query.year === undefined || req.query.year === null || req.query.year === ''
      ? null
      : Number.parseInt(String(req.query.year), 10);
    const month = req.query.month === undefined || req.query.month === null || req.query.month === ''
      ? null
      : Number.parseInt(String(req.query.month), 10);

    if (year !== null && !Number.isInteger(year)) {
      return res.status(400).json({ error: 'Invalid year', code: 'INVALID_YEAR' });
    }
    if (month !== null && (!Number.isInteger(month) || month < 1 || month > 12)) {
      return res.status(400).json({ error: 'Invalid month', code: 'INVALID_MONTH' });
    }

    try {
      const rawEarnings = await fetchRawDashboardEarningsData(req);
      const earningsData = filterData(rawEarnings, req.query, { dateMode });
      if (earningsData.length > 0) {
        const grouped = new Map();
        for (const row of earningsData) {
          const earningYear = Number(row.ANO);
          const earningMonth = Number(row.MES);
          if (!Number.isInteger(earningYear) || !Number.isInteger(earningMonth)) continue;
          if (year !== null && earningYear !== year) continue;
          if (month !== null && earningMonth !== month) continue;
          if (!matchesEarningStatus(row.EARNING_STATUS)) continue;

          const value = Number(row.VALOR) || 0;
          if (value === 0) continue;

          const id = Number(row.PROJECT_ID || row.ID);
          if (!grouped.has(id)) {
            grouped.set(id, {
              id: row.ID,
              title: row.TITLE,
              status: row.STATUS,
              employeeName: row.EMPLOYEE_NAME,
              anoConsiderado: row.ANO_CONSIDERADO,
              ganhoEstimado: Number(row.GANHO_ESTIMADO) || 0,
              ganhoRealizado: 0,
              dataInicioGanho: row.DATA_INICIO_GANHO,
              startDate: row.START_DATE,
            });
          }
          grouped.get(id).ganhoRealizado += value;
        }

        const list = Array.from(grouped.values()).sort(
          (a, b) => Math.abs(Number(b.ganhoRealizado) || 0) - Math.abs(Number(a.ganhoRealizado) || 0),
        );
        return res.json(list);
      }
    } catch (error) {
      if (!isOraMissingTableOrColumn(error)) throw error;
    }

    const raw = await fetchRawDashboardData(req);
    const data = filterData(raw, req.query);

    const list = data
      .filter(p => {
        const d = p.DATA_INICIO_GANHO || p.START_DATE;
        if (!d) return false;

        const dt = new Date(d + 'T12:00:00');
        if (year && dt.getFullYear() !== year) return false;
        if (month && (dt.getMonth() + 1) !== month) return false;

        const ganho = Number(p.GANHO_REALIZADO) || 0;
        return ganho !== 0;
      })
      .map(p => ({
        id: p.ID,
        title: p.TITLE,
        status: p.STATUS,
        employeeName: p.EMPLOYEE_NAME,
        anoConsiderado: p.ANO_CONSIDERADO,
        ganhoEstimado: Number(p.GANHO_ESTIMADO) || 0,
        ganhoRealizado: Number(p.GANHO_REALIZADO) || 0,
        dataInicioGanho: p.DATA_INICIO_GANHO,
        startDate: p.START_DATE,
      }));

    return res.json(list);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`API on http://localhost:${PORT}`));
