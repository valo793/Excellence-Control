import { useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Loader2,
  UploadCloud,
  XCircle,
} from 'lucide-react';
import Modal from './Modal';
import { STATUS_MAP, ui } from '../ui/visuals';

const MAX_FILE_SIZE_BYTES = 8 * 1024 * 1024;
const PREVIEW_LIMIT = 8;

const FIELD_CONFIG = [
  { key: 'title', label: 'Project Title', required: true, aliases: ['title', 'project title', 'titulo', 'nome do projeto'] },
  { key: 'description', label: 'Description', required: false, aliases: ['description', 'descricao'] },
  { key: 'status', label: 'Status', required: false, aliases: ['status', 'etapa', 'stage'] },
  { key: 'origem', label: 'Origin', required: false, aliases: ['origin', 'origem'] },
  { key: 'areaGrupo', label: 'Area Group', required: false, aliases: ['area group', 'area', 'grupo da area', 'area_grupo'] },
  { key: 'impactoComite', label: 'Committee Impact', required: false, aliases: ['committee impact', 'impacto comite', 'impacto no comite', 'impacto_comite'] },
  { key: 'categoriaKaizen', label: 'Kaizen Category', required: false, aliases: ['kaizen category', 'categoria kaizen', 'categoria_kaizen'] },
  { key: 'categoriaBoletimExop', label: 'Boletim ExOp Category', required: false, aliases: ['boletim exop category', 'categoria boletim exop', 'categoria_boletim_exop'] },
  { key: 'startDate', label: 'Start Date', required: false, aliases: ['start date', 'start_date', 'data inicio', 'data de inicio', 'data inicial', 'inicio', 'inicio projeto', 'data inicio projeto'] },
  { key: 'dueDate', label: 'Due Date', required: false, aliases: ['due date', 'due_date', 'data fim', 'data de fim', 'data final', 'fim', 'prazo', 'deadline', 'termino', 'término', 'data termino', 'data término', 'data fim previsto'] },
  { key: 'employeeName', label: 'Owner', required: false, aliases: ['employee name', 'owner', 'responsavel'] },
  { key: 'ganhoEstimado', label: 'Estimated Gain', required: false, aliases: ['estimated gain', 'ganho estimado', 'ganho_estimado'] },
  { key: 'metrics', label: 'Metrics', required: false, aliases: ['metrics', 'metrica', 'metricas'] },
  { key: 'goeKaizenAward', label: 'GOE Kaizen Award', required: false, aliases: ['goe kaizen award', 'goe award', 'goe_kaizen_award'] },
  { key: 'premioKaizen', label: 'Premio Kaizen', required: false, aliases: ['premio kaizen', 'premio_kaizen'] },
  { key: 'projectLinkId', label: 'Project Link ID', required: false, aliases: ['project link id', 'project link', 'project_link_id', 'project_link'] },
];

const TEMPLATE_HEADERS = [
  'title',
  'description',
  'status',
  'origem',
  'areaGrupo',
  'impactoComite',
  'categoriaKaizen',
  'categoriaBoletimExop',
  'startDate',
  'dueDate',
  'employeeName',
  'ganhoEstimado',
  'metrics',
  'goeKaizenAward',
  'premioKaizen',
  'projectLinkId',
];

const EARNINGS_FIELD_CONFIG = [
  { key: 'projectTitle', label: 'Project', required: true, aliases: ['projeto', 'project', 'project title', 'nome do projeto', 'titulo do projeto', 'titulo'] },
  { key: 'month', label: 'Month', required: true, aliases: ['mes', 'mês', 'month'] },
  { key: 'year', label: 'Year', required: true, aliases: ['ano', 'year'] },
  { key: 'value', label: 'Value', required: true, aliases: ['valor', 'value', 'amount'] },
  { key: 'tipo', label: 'Type (Revenue/Saving)', required: true, aliases: ['tipo', 'type'] },
  { key: 'dolarValue', label: 'Dollar Rate', required: true, aliases: ['conversao', 'conversão', 'dolar', 'dollar', 'dolar value', 'dollar value', 'cotacao', 'cotação', 'dollar rate', 'taxa dolar'] },
  { key: 'earningStatus', label: 'Status', required: false, aliases: ['status', 'situacao', 'situação', 'earning status'] },
];

const EARNINGS_TEMPLATE_HEADERS = ['Projeto', 'Mês', 'Ano', 'Valor', 'Tipo', 'Conversão', 'Status'];

const TIPO_LOOKUP = new Map([
  ['revenue', 'REVENUE'],
  ['receita', 'REVENUE'],
  ['saving', 'SAVING'],
  ['savings', 'SAVING'],
  ['economia', 'SAVING'],
  ['custos', 'SAVING'],
  ['custo', 'SAVING'],
  ['cost', 'SAVING'],
  ['costs', 'SAVING'],
  ['cost reduction', 'SAVING'],
]);

const MONTH_NAME_LOOKUP = new Map([
  // PT-BR abbreviations
  ['jan', 1], ['fev', 2], ['mar', 3], ['abr', 4], ['mai', 5], ['jun', 6],
  ['jul', 7], ['ago', 8], ['set', 9], ['out', 10], ['nov', 11], ['dez', 12],
  // PT-BR full
  ['janeiro', 1], ['fevereiro', 2], ['marco', 3], ['março', 3], ['abril', 4],
  ['maio', 5], ['junho', 6], ['julho', 7], ['agosto', 8], ['setembro', 9],
  ['outubro', 10], ['novembro', 11], ['dezembro', 12],
  // EN abbreviations
  ['feb', 2], ['apr', 4], ['may', 5], ['aug', 8], ['sep', 9], ['oct', 10], ['dec', 12],
  // EN full
  ['january', 1], ['february', 2], ['march', 3], ['april', 4],
  ['june', 6], ['july', 7], ['august', 8], ['september', 9],
  ['october', 10], ['november', 11], ['december', 12],
]);

function parseMonthValue(raw) {
  if (raw === null || raw === undefined || raw === '') return NaN;
  const num = Number.parseInt(String(raw), 10);
  if (Number.isInteger(num) && num >= 1 && num <= 12) return num;
  const normalized = String(raw).trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const fromName = MONTH_NAME_LOOKUP.get(normalized);
  if (fromName) return fromName;
  // Try without accents on the lookup too
  for (const [key, val] of MONTH_NAME_LOOKUP) {
    if (key.normalize('NFD').replace(/[\u0300-\u036f]/g, '') === normalized) return val;
  }
  return NaN;
}

const STATUS_LOOKUP = (() => {
  const map = new Map();
  Object.entries(STATUS_MAP).forEach(([key, label]) => {
    map.set(normalizeKey(key), key);
    map.set(normalizeKey(label), key);
  });
  map.set(normalizeKey('to do'), 'TODO');
  map.set(normalizeKey('not started'), 'TODO');
  map.set(normalizeKey('nao iniciado'), 'TODO');
  map.set(normalizeKey('in progress'), 'IN_PROGRESS');
  map.set(normalizeKey('on hold'), 'ON_HOLD');
  map.set(normalizeKey('a fazer'), 'TODO');
  map.set(normalizeKey('em andamento'), 'IN_PROGRESS');
  map.set(normalizeKey('em progresso'), 'IN_PROGRESS');
  map.set(normalizeKey('pausado'), 'ON_HOLD');
  map.set(normalizeKey('em espera'), 'ON_HOLD');
  map.set(normalizeKey('concluido'), 'DONE');
  map.set(normalizeKey('arquivado'), 'ARCHIVED');
  map.set(normalizeKey('cancelado'), 'ARCHIVED');
  map.set(normalizeKey('canceled'), 'ARCHIVED');
  map.set(normalizeKey('cancelled'), 'ARCHIVED');
  return map;
})();

function normalizeKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function collectHeaders(rows) {
  const set = new Set();
  for (const row of rows) {
    Object.keys(row || {}).forEach(header => {
      const clean = String(header || '').trim();
      if (clean) set.add(clean);
    });
  }
  return Array.from(set);
}

function detectInitialMapping(headers) {
  const normalized = new Map(headers.map(h => [normalizeKey(h), h]));
  const mapping = {};
  for (const field of FIELD_CONFIG) {
    const hit = field.aliases.find(alias => normalized.has(normalizeKey(alias)));
    mapping[field.key] = hit ? normalized.get(normalizeKey(hit)) : '';
  }
  return mapping;
}

function resolveStatus(rawValue) {
  if (!rawValue) return '';
  const normalized = normalizeKey(rawValue);
  const direct = STATUS_LOOKUP.get(normalized);
  if (direct) return direct;

  if (normalized.includes('pausado') || normalized.includes('on hold') || normalized.includes('em espera') || normalized.includes('paused')) {
    return 'ON_HOLD';
  }
  if (normalized.includes('concluido') || normalized.includes('done') || normalized.includes('completed')) {
    return 'DONE';
  }
  if (normalized.includes('cancelado') || normalized.includes('canceled') || normalized.includes('cancelled') || normalized.includes('arquivado') || normalized.includes('archived')) {
    return 'ARCHIVED';
  }
  if (normalized.includes('andamento') || normalized.includes('progresso') || normalized.includes('progress')) {
    return 'IN_PROGRESS';
  }
  if (normalized.includes('nao iniciado') || normalized.includes('not started') || normalized.includes('a fazer') || normalized.includes('todo')) {
    return 'TODO';
  }

  return '';
}

function toYmdFromDate(dateObj) {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, '0');
  const d = String(dateObj.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
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

function parseDateValue(rawValue) {
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

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;

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

  const fallback = new Date(value);
  if (!Number.isNaN(fallback.getTime())) return toYmdFromDate(fallback);

  return null;
}

function parseNumber(value) {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Number(String(value).replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

async function parseCsv(file) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: header => String(header || '').trim(),
      complete: result => resolve(result),
      error: error => reject(error),
    });
  });
}

async function parseSpreadsheetFile(file) {
  const ext = String(file?.name || '').split('.').pop()?.toLowerCase();
  if (!['csv', 'xlsx', 'xls'].includes(ext || '')) {
    throw new Error('Unsupported file type. Use .csv, .xlsx or .xls');
  }

  if (ext === 'csv') {
    const parsed = await parseCsv(file);
    return {
      rows: parsed.data || [],
      parseErrors: parsed.errors || [],
    };
  }

  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) return { rows: [], parseErrors: [] };
  const worksheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json(worksheet, { defval: '' });
  return { rows, parseErrors: [] };
}

export default function ImportSpreadsheetModal({ open, onClose, onImportRows, onImportEarningsRows, onGoToProjects, language = 'en' }) {
  const [file, setFile] = useState(null);
  const [headers, setHeaders] = useState([]);
  const [rows, setRows] = useState([]);
  const [mapping, setMapping] = useState({});
  const [fileErrors, setFileErrors] = useState([]);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [cancelRequested, setCancelRequested] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0, imported: 0, failed: 0 });
  const [result, setResult] = useState(null);
  const [showAllRowErrors, setShowAllRowErrors] = useState(false);
  const fileInputRef = useRef(null);

  // Earnings import state
  const [earningsFile, setEarningsFile] = useState(null);
  const [earningsHeaders, setEarningsHeaders] = useState([]);
  const [earningsRows, setEarningsRows] = useState([]);
  const [earningsMapping, setEarningsMapping] = useState({});
  const [earningsFileErrors, setEarningsFileErrors] = useState([]);
  const [earningsParsing, setEarningsParsing] = useState(false);
  const [earningsImporting, setEarningsImporting] = useState(false);
  const [earningsResult, setEarningsResult] = useState(null);
  const earningsFileInputRef = useRef(null);
  const cancelTokenRef = useRef({ cancelRequested: false, reason: '' });

  const isPtBr = language === 'pt-BR';
  const tr = (enText, ptBrText) => (isPtBr ? ptBrText : enText);
  const resultErrors = result?.errors || [];

  const analysis = useMemo(() => {
    const globalErrors = [];
    const preview = [];
    const validRows = [];
    const rowErrors = [];

    if (!rows.length) {
      return { globalErrors, preview, validRows, rowErrors, total: 0, validCount: 0, invalidCount: 0, ready: false };
    }

    const missingRequired = FIELD_CONFIG.filter(f => f.required && !mapping[f.key]);
    if (missingRequired.length) {
      globalErrors.push(tr('Map required columns before importing.', 'Mapeie as colunas obrigatórias antes de importar.'));
    }

    rows.forEach((row, idx) => {
      const rowIssues = [];
      const pushIssue = (field, message, rawValue = '') => {
        rowIssues.push({
          field,
          column: mapping[field] || '',
          value: rawValue,
          message,
        });
      };

      const pick = fieldKey => {
        const col = mapping[fieldKey];
        if (!col) return '';
        const value = row?.[col];
        return typeof value === 'string' ? value.trim() : value;
      };

      const payload = {};
      const rowNumber = idx + 2;

      const title = String(pick('title') || '').trim();
      if (!title) {
        pushIssue('title', tr('Missing project title.', 'Título do projeto ausente.'));
        payload.title = `Imported row ${rowNumber}`;
      } else {
        payload.title = title;
      }

      const description = String(pick('description') || '').trim();
      if (description) payload.description = description;

      const owner = String(pick('employeeName') || '').trim();
      if (owner) payload.employeeName = owner;

      const origem = String(pick('origem') || '').trim();
      if (origem) payload.origem = origem;

      const areaGrupo = String(pick('areaGrupo') || '').trim();
      if (areaGrupo) payload.areaGrupo = areaGrupo;

      const impactoComite = String(pick('impactoComite') || '').trim();
      if (impactoComite) payload.impactoComite = impactoComite;

      const categoriaKaizen = String(pick('categoriaKaizen') || '').trim();
      if (categoriaKaizen) payload.categoriaKaizen = categoriaKaizen;

      const categoriaBoletimExop = String(pick('categoriaBoletimExop') || '').trim();
      if (categoriaBoletimExop) payload.categoriaBoletimExop = categoriaBoletimExop;

      const metrics = String(pick('metrics') || '').trim();
      if (metrics) payload.metrics = metrics;

      const goeKaizenAward = String(pick('goeKaizenAward') || '').trim();
      if (goeKaizenAward) payload.goeKaizenAward = goeKaizenAward;

      const premioKaizen = String(pick('premioKaizen') || '').trim();
      if (premioKaizen) payload.premioKaizen = premioKaizen;

      const statusRaw = pick('status');
      if (statusRaw !== '' && statusRaw !== null && statusRaw !== undefined) {
        const normalizedStatus = resolveStatus(statusRaw);
        if (!normalizedStatus) {
          pushIssue('status', tr(`Invalid status: ${statusRaw}`, `Status inválido: ${statusRaw}`), statusRaw);
        } else {
          payload.status = normalizedStatus;
        }
      }

      const startRaw = pick('startDate');
      if (startRaw !== '' && startRaw !== null && startRaw !== undefined) {
        const parsedDate = parseDateValue(startRaw);
        if (parsedDate === null) {
          pushIssue('startDate', tr(`Invalid start date: ${startRaw}`, `Data de início inválida: ${startRaw}`), startRaw);
        } else if (parsedDate) {
          payload.startDate = parsedDate;
        }
      }

      const dueRaw = pick('dueDate');
      if (dueRaw !== '' && dueRaw !== null && dueRaw !== undefined) {
        const parsedDate = parseDateValue(dueRaw);
        if (parsedDate === null) {
          pushIssue('dueDate', tr(`Invalid due date: ${dueRaw}`, `Data final inválida: ${dueRaw}`), dueRaw);
        } else if (parsedDate) {
          payload.dueDate = parsedDate;
        }
      }

      const ganhoEstimadoRaw = pick('ganhoEstimado');
      if (ganhoEstimadoRaw !== '' && ganhoEstimadoRaw !== null && ganhoEstimadoRaw !== undefined) {
        const value = parseNumber(ganhoEstimadoRaw);
        if (value === null) {
          pushIssue('ganhoEstimado', tr(`Invalid estimated gain: ${ganhoEstimadoRaw}`, `Ganho estimado inválido: ${ganhoEstimadoRaw}`), ganhoEstimadoRaw);
        } else if (value !== '') {
          payload.ganhoEstimado = value;
        }
      }

      const projectLinkIdRaw = pick('projectLinkId');
      if (projectLinkIdRaw !== '' && projectLinkIdRaw !== null && projectLinkIdRaw !== undefined) {
        const value = parseNumber(projectLinkIdRaw);
        if (value === null || value === '' || !Number.isInteger(value) || value <= 0) {
          pushIssue('projectLinkId', tr(`Invalid project link ID: ${projectLinkIdRaw}`, `ID de vínculo inválido: ${projectLinkIdRaw}`), projectLinkIdRaw);
        } else {
          payload.projectLinkId = value;
        }
      }
      if (rowIssues.length) {
        rowErrors.push({
          row: rowNumber,
          errors: rowIssues.map(issue => issue.message),
          items: rowIssues,
        });
      }

      validRows.push({
        ...payload,
        __rowNumber: rowNumber,
      });

      if (idx < PREVIEW_LIMIT) {
        preview.push({
          row: rowNumber,
          title: payload.title || '-',
          status: payload.status || 'TODO',
          startDate: payload.startDate || '-',
          dueDate: payload.dueDate || '-',
          errors: rowIssues.map(issue => issue.message),
        });
      }
    });

    return {
      globalErrors,
      preview,
      validRows,
      rowErrors,
      total: rows.length,
      validCount: validRows.length,
      invalidCount: rowErrors.length,
      ready: globalErrors.length === 0 && validRows.length > 0,
    };
  }, [mapping, rows, language]);

  function resetState() {
    setFile(null);
    setHeaders([]);
    setRows([]);
    setMapping({});
    setFileErrors([]);
    setParsing(false);
    setImporting(false);
    setCancelRequested(false);
    setProgress({ current: 0, total: 0, imported: 0, failed: 0 });
    setResult(null);
    setShowAllRowErrors(false);
    cancelTokenRef.current = { cancelRequested: false, reason: '' };
    resetEarningsState();
  }

  function resetEarningsState() {
    setEarningsFile(null);
    setEarningsHeaders([]);
    setEarningsRows([]);
    setEarningsMapping({});
    setEarningsFileErrors([]);
    setEarningsParsing(false);
    setEarningsImporting(false);
    setEarningsResult(null);
  }

  async function handleSelectFile(selectedFile) {
    if (!selectedFile) return;
    resetState();
    setFile(selectedFile);

    const ext = String(selectedFile.name || '').split('.').pop()?.toLowerCase();
    if (!['csv', 'xlsx', 'xls'].includes(ext || '')) {
      setFileErrors([tr('Unsupported file type. Accepted: .csv, .xlsx, .xls.', 'Formato não suportado. Aceitos: .csv, .xlsx, .xls.')]);
      return;
    }

    if (selectedFile.size > MAX_FILE_SIZE_BYTES) {
      setFileErrors([tr('File is too large. Max size is 8 MB.', 'Arquivo muito grande. Tamanho máximo: 8 MB.')]);
      return;
    }

    setParsing(true);
    try {
      const { rows: parsedRows, parseErrors } = await parseSpreadsheetFile(selectedFile);
      if (!parsedRows.length) {
        setFileErrors([tr('No data rows found in the file.', 'Nenhuma linha de dados encontrada no arquivo.')]);
        return;
      }
      const detectedHeaders = collectHeaders(parsedRows);
      if (!detectedHeaders.length) {
        setFileErrors([tr('Could not detect headers in spreadsheet.', 'Não foi possível identificar os cabeçalhos da planilha.')]);
        return;
      }

      const warningMessages = (parseErrors || [])
        .filter(err => err?.message)
        .slice(0, 3)
        .map(err => tr(`Parse warning: ${err.message}`, `Aviso de leitura: ${err.message}`));

      setRows(parsedRows);
      setHeaders(detectedHeaders);
      setMapping(detectInitialMapping(detectedHeaders));
      setFileErrors(warningMessages);
    } catch (error) {
      console.error(error);
      setFileErrors([error.message || tr('Failed to parse file.', 'Falha ao ler o arquivo.')]);
    } finally {
      setParsing(false);
    }
  }

  async function handleImport() {
    if (!analysis.ready || importing) return;
    cancelTokenRef.current = { cancelRequested: false, reason: '' };
    setCancelRequested(false);
    setImporting(true);
    setProgress({ current: 0, total: analysis.validRows.length, imported: 0, failed: 0 });
    setResult(null);
    try {
      const validationErrors = analysis.rowErrors.flatMap(rowErr =>
        (rowErr.items || []).map(item => ({
          type: 'warning',
          row: rowErr.row,
          field: item.field || '',
          column: item.column || '',
          message: item.message || '',
        })),
      );

      const importResult = await onImportRows(
        analysis.validRows,
        0,
        next => setProgress(next),
        {
          validationErrors,
          cancelToken: cancelTokenRef.current,
        },
      );
      setResult(importResult);
    } catch (error) {
      const isCanceled = error?.code === 'IMPORT_CANCELED';
      setResult({
        totalProcessed: analysis.total,
        imported: 0,
        failed: isCanceled ? 0 : analysis.validRows.length,
        skipped: analysis.invalidCount,
        duplicated: 0,
        errors: isCanceled
          ? [{ type: 'canceled', row: '', column: '', field: '', message: tr('Import canceled by user.', 'Importação cancelada pelo usuário.') }]
          : [],
        logs: [{
          type: isCanceled ? 'warning' : 'error',
          message: error.message || (isCanceled
            ? tr('Import canceled by user.', 'Importacao cancelada pelo usuario.')
            : tr('Import failed.', 'Falha na importacao.')),
        }],
        canceled: isCanceled,
      });
    } finally {
      setImporting(false);
      setCancelRequested(false);
      cancelTokenRef.current = { cancelRequested: false, reason: '' };
    }
  }

  function handleCancelImport() {
    if (!importing || cancelRequested) return;
    setCancelRequested(true);
    cancelTokenRef.current = {
      cancelRequested: true,
      reason: tr('Import canceled by user.', 'Importação cancelada pelo usuário.'),
    };
  }

  function handleMappingChange(fieldKey, selectedHeader) {
    setMapping(prev => {
      const next = { ...prev, [fieldKey]: selectedHeader };
      if (!selectedHeader) return next;
      FIELD_CONFIG.forEach(field => {
        if (field.key !== fieldKey && next[field.key] === selectedHeader) {
          next[field.key] = '';
        }
      });
      return next;
    });
  }

  // ---------- Earnings-specific logic ----------

  function detectEarningsMapping(headers) {
    const normalized = new Map(headers.map(h => [normalizeKey(h), h]));
    const mapping = {};
    for (const field of EARNINGS_FIELD_CONFIG) {
      const hit = field.aliases.find(alias => normalized.has(normalizeKey(alias)));
      mapping[field.key] = hit ? normalized.get(normalizeKey(hit)) : '';
    }
    return mapping;
  }

  function handleEarningsMappingChange(fieldKey, selectedHeader) {
    setEarningsMapping(prev => {
      const next = { ...prev, [fieldKey]: selectedHeader };
      if (!selectedHeader) return next;
      EARNINGS_FIELD_CONFIG.forEach(field => {
        if (field.key !== fieldKey && next[field.key] === selectedHeader) {
          next[field.key] = '';
        }
      });
      return next;
    });
  }

  const earningsAnalysis = useMemo(() => {
    const globalErrors = [];
    const preview = [];
    const validRows = [];
    const rowErrors = [];

    if (!earningsRows.length) {
      return { globalErrors, preview, validRows, rowErrors, total: 0, validCount: 0, invalidCount: 0, ready: false };
    }

    const missingRequired = EARNINGS_FIELD_CONFIG.filter(f => f.required && !earningsMapping[f.key]);
    if (missingRequired.length) {
      globalErrors.push(tr('Map all required columns before importing earnings.', 'Mapeie todas as colunas obrigatórias antes de importar ganhos.'));
    }

    earningsRows.forEach((row, idx) => {
      const rowIssues = [];
      const rowNumber = idx + 2;

      const pick = fieldKey => {
        const col = earningsMapping[fieldKey];
        if (!col) return '';
        const value = row?.[col];
        return typeof value === 'string' ? value.trim() : value;
      };

      const payload = { __rowNumber: rowNumber };

      const projectTitle = String(pick('projectTitle') || '').trim();
      if (!projectTitle) {
        rowIssues.push(tr('Missing project name.', 'Nome do projeto ausente.'));
      }
      payload.projectTitle = projectTitle;

      const monthRaw = pick('month');
      const monthParsed = parseMonthValue(monthRaw);
      if (!Number.isInteger(monthParsed) || monthParsed < 1 || monthParsed > 12) {
        rowIssues.push(tr(`Invalid month: ${monthRaw}`, `Mês inválido: ${monthRaw}`));
      }
      payload.month = monthParsed;

      const yearRaw = pick('year');
      const yearParsed = Number.parseInt(String(yearRaw), 10);
      if (!Number.isInteger(yearParsed) || yearParsed < 1900 || yearParsed > 3000) {
        rowIssues.push(tr(`Invalid year: ${yearRaw}`, `Ano inválido: ${yearRaw}`));
      }
      payload.year = yearParsed;

      const valueRaw = pick('value');
      const valueParsed = parseNumber(valueRaw);
      if (valueParsed === null) {
        rowIssues.push(tr(`Invalid value: ${valueRaw}`, `Valor inválido: ${valueRaw}`));
      }
      payload.value = valueParsed;

      const tipoRaw = pick('tipo');
      const tipoNorm = TIPO_LOOKUP.get(normalizeKey(tipoRaw));
      if (tipoRaw && !tipoNorm) {
        rowIssues.push(tr(`Invalid type: ${tipoRaw}. Use Revenue or Saving.`, `Tipo inválido: ${tipoRaw}. Use Revenue ou Saving.`));
      }
      payload.tipo = tipoNorm || null;

      const dolarRaw = pick('dolarValue');
      const dolarParsed = dolarRaw !== '' && dolarRaw !== null && dolarRaw !== undefined ? parseNumber(dolarRaw) : null;
      if (dolarRaw && dolarParsed === null) {
        rowIssues.push(tr(`Invalid dollar rate: ${dolarRaw}`, `Cotação inválida: ${dolarRaw}`));
      }
      payload.dolarValue = dolarParsed;

      const statusRaw = pick('earningStatus');
      payload.earningStatus = statusRaw ? String(statusRaw).trim() : 'PREVISTO';

      if (rowIssues.length) {
        rowErrors.push({ row: rowNumber, errors: rowIssues });
      }

      if (!rowIssues.some(i => i.includes('Missing project') || i.includes('Nome do projeto'))) {
        validRows.push(payload);
      } else {
        validRows.push(payload); // still push it, let the backend resolve
      }

      if (idx < PREVIEW_LIMIT) {
        preview.push({
          row: rowNumber,
          projectTitle: payload.projectTitle || '-',
          month: payload.month || '-',
          year: payload.year || '-',
          value: payload.value ?? '-',
          tipo: payload.tipo || '-',
          dolarValue: payload.dolarValue ?? '-',
          earningStatus: payload.earningStatus || '-',
          errors: rowIssues,
        });
      }
    });

    return {
      globalErrors,
      preview,
      validRows,
      rowErrors,
      total: earningsRows.length,
      validCount: validRows.length,
      invalidCount: rowErrors.length,
      ready: globalErrors.length === 0 && validRows.length > 0,
    };
  }, [earningsMapping, earningsRows, language]);

  async function handleSelectEarningsFile(selectedFile) {
    if (!selectedFile) return;
    resetEarningsState();
    setEarningsFile(selectedFile);

    const ext = String(selectedFile.name || '').split('.').pop()?.toLowerCase();
    if (!['csv', 'xlsx', 'xls'].includes(ext || '')) {
      setEarningsFileErrors([tr('Unsupported file type. Accepted: .csv, .xlsx, .xls.', 'Formato não suportado. Aceitos: .csv, .xlsx, .xls.')]);
      return;
    }
    if (selectedFile.size > MAX_FILE_SIZE_BYTES) {
      setEarningsFileErrors([tr('File is too large. Max size is 8 MB.', 'Arquivo muito grande. Tamanho máximo: 8 MB.')]);
      return;
    }

    setEarningsParsing(true);
    try {
      const { rows: parsedRows, parseErrors } = await parseSpreadsheetFile(selectedFile);
      if (!parsedRows.length) {
        setEarningsFileErrors([tr('No data rows found in the file.', 'Nenhuma linha de dados encontrada no arquivo.')]);
        return;
      }
      const detectedHeaders = collectHeaders(parsedRows);
      if (!detectedHeaders.length) {
        setEarningsFileErrors([tr('Could not detect headers in spreadsheet.', 'Não foi possível identificar os cabeçalhos da planilha.')]);
        return;
      }

      const warningMessages = (parseErrors || [])
        .filter(err => err?.message)
        .slice(0, 3)
        .map(err => tr(`Parse warning: ${err.message}`, `Aviso de leitura: ${err.message}`));

      setEarningsRows(parsedRows);
      setEarningsHeaders(detectedHeaders);
      setEarningsMapping(detectEarningsMapping(detectedHeaders));
      setEarningsFileErrors(warningMessages);
    } catch (error) {
      console.error(error);
      setEarningsFileErrors([error.message || tr('Failed to parse file.', 'Falha ao ler o arquivo.')]);
    } finally {
      setEarningsParsing(false);
    }
  }

  async function handleEarningsImport() {
    if (!earningsAnalysis.ready || earningsImporting) return;
    setEarningsImporting(true);
    setEarningsResult(null);
    try {
      const importResult = await onImportEarningsRows(earningsAnalysis.validRows);
      setEarningsResult(importResult);
    } catch (error) {
      setEarningsResult({
        totalProcessed: earningsAnalysis.total,
        imported: 0,
        failed: earningsAnalysis.validRows.length,
        errors: [{ type: 'error', row: '', field: '', message: error.message || tr('Earnings import failed.', 'Falha na importação de ganhos.') }],
        logs: [],
      });
    } finally {
      setEarningsImporting(false);
    }
  }

  function downloadEarningsTemplate() {
    const exampleRows = [
      ['Line A Optimization', '3', '2026', '50000', 'Revenue', '5.85'],
      ['Safety Walk 2.0', '4', '2026', '15000', 'Saving', '5.72'],
    ];
    const csv = [EARNINGS_TEMPLATE_HEADERS, ...exampleRows]
      .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'excellence-control-earnings-template.csv';
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function downloadTemplate() {
    const exampleRows = [
      ['Line A Optimization', 'Reduce setup time in production line A', 'IN_PROGRESS', 'Kaizen', 'Operations', 'Productivity', 'Increase Performance', 'Productivity', '2026-03-01', '2026-04-15', 'Joana Silva', '120000', 'Savings from setup reduction formula (baseline vs target).', 'Q1 Winner', 'Regional Lean Award', ''],
      ['Safety Walk 2.0', 'Standardize monthly safety rounds', 'TODO', 'Greenbelt', 'HSSE', 'Safety', 'Safety Improvement', 'Safety', '2026-03-10', '2026-05-10', 'Carlos Souza', '35000', 'Safety incident cost avoidance model.', '', '', '1024'],
    ];
    const csv = [TEMPLATE_HEADERS, ...exampleRows]
      .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'excellence-control-import-template.csv';
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function downloadErrorReport() {
    const errors = result?.errors || [];
    if (!errors.length) return;

    const headers = ['type', 'row', 'column', 'field', 'message'];
    const lines = errors.map(err => [
      err.type || '',
      err.row || '',
      err.column || '',
      err.field || '',
      err.message || '',
    ]);
    const csv = [headers, ...lines]
      .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');

    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'import-error-report.csv';
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function handleViewProjects() {
    if (typeof onGoToProjects === 'function') {
      onGoToProjects();
      return;
    }
    onClose();
  }

  function closeModal() {
    if (importing) return;
    onClose();
  }

  return (
    <Modal open={open} onClose={closeModal} maxWidth="max-w-6xl">
      <div className="p-6 sm:p-7 space-y-6">
        <header className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold text-foreground flex items-center gap-2">
              <FileSpreadsheet className="w-5 h-5 text-primary" />
              {tr('Import Spreadsheet', 'Importar planilha')}
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              {tr('Accepted formats: CSV/XLSX. Max size: 8 MB. Map columns, preview and import safely.', 'Formatos aceitos: CSV/XLSX. Tamanho máximo: 8 MB. Mapeie colunas, visualize e importe com segurança.')}
            </p>
          </div>
          <button type="button" onClick={downloadTemplate} className={`${ui.button.base} ${ui.button.subtle}`}>
            <Download className="w-4 h-4" />
            {tr('Download Template', 'Baixar template')}
          </button>
        </header>

        <section className="surface-card p-5">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div className="text-sm">
              <p className="font-semibold text-foreground">{tr('Step 1: Select your file', 'Passo 1: Selecione seu arquivo')}</p>
              <p className="text-muted-foreground text-xs mt-1">{tr('Only the first sheet is used for .xlsx/.xls files.', 'Apenas a primeira aba é utilizada em arquivos .xlsx/.xls.')}</p>
            </div>
            <div className="flex gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                className="hidden"
                onChange={e => handleSelectFile(e.target.files?.[0])}
              />
              <button type="button" onClick={() => fileInputRef.current?.click()} className={`${ui.button.base} ${ui.button.primary}`}>
                <UploadCloud className="w-4 h-4" />
                {file ? tr('Change File', 'Trocar arquivo') : tr('Choose File', 'Selecionar arquivo')}
              </button>
              {file && (
                <button type="button" onClick={resetState} className={`${ui.button.base} ${ui.button.subtle}`}>
                  {tr('Clear', 'Limpar')}
                </button>
              )}
            </div>
          </div>
          {file && (
            <div className="mt-3 text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">{file.name}</span> - {(file.size / 1024).toFixed(1)} KB
            </div>
          )}
          {parsing && (
            <div className="mt-3 text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              {tr('Reading spreadsheet...', 'Lendo planilha...')}
            </div>
          )}
          {fileErrors.length > 0 && (
            <div className="mt-3 space-y-1">
              {fileErrors.map((msg, idx) => (
                <div key={idx} className="text-xs text-amber-500">{msg}</div>
              ))}
            </div>
          )}
        </section>

        {headers.length > 0 && (
          <section className="surface-card p-5 space-y-4">
            <h3 className="text-sm font-semibold uppercase tracking-[0.13em] text-muted-foreground">
              {tr('Step 2: Map columns', 'Passo 2: Mapear colunas')}
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {FIELD_CONFIG.map(field => (
                <label key={field.key} className="space-y-1.5">
                  <span className="text-xs font-semibold text-foreground">
                    {field.label} {field.required ? '*' : ''}
                  </span>
                  <select
                    value={mapping[field.key] || ''}
                    onChange={e => handleMappingChange(field.key, e.target.value)}
                    className={`${ui.field.select} h-10`}
                  >
                    <option value="">{field.required ? tr('Select required column', 'Selecione a coluna obrigatória') : tr('Not mapped', 'Não mapear')}</option>
                    {headers.map(header => (
                      <option key={header} value={header}>{header}</option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </section>
        )}

        {rows.length > 0 && (
          <section className="surface-card p-5 space-y-4">
            <h3 className="text-sm font-semibold uppercase tracking-[0.13em] text-muted-foreground">
              {tr('Step 3: Review and import', 'Passo 3: Revisar e importar')}
            </h3>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
              <div className="surface-muted p-3">
                <div className="text-muted-foreground">{tr('Total rows', 'Total de linhas')}</div>
                <div className="text-lg font-semibold text-foreground">{analysis.total}</div>
              </div>
              <div className="surface-muted p-3">
                <div className="text-muted-foreground">{tr('Valid', 'Válidas')}</div>
                <div className="text-lg font-semibold text-emerald-500">{analysis.validCount}</div>
              </div>
              <div className="surface-muted p-3">
                <div className="text-muted-foreground">{tr('Invalid', 'Inválidas')}</div>
                <div className="text-lg font-semibold text-amber-500">{analysis.invalidCount}</div>
              </div>
              <div className="surface-muted p-3">
                <div className="text-muted-foreground">{tr('Headers', 'Cabeçalhos')}</div>
                <div className="text-lg font-semibold text-foreground">{headers.length}</div>
              </div>
            </div>

            {analysis.globalErrors.length > 0 && (
              <div className="space-y-1">
                {analysis.globalErrors.map((message, idx) => (
                  <div key={idx} className="text-sm text-destructive flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4" />
                    {message}
                  </div>
                ))}
              </div>
            )}

            <div className="overflow-x-auto rounded-xl border border-border/70">
              <table className="min-w-full text-xs">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-3 py-2 text-left">#</th>
                    <th className="px-3 py-2 text-left">{tr('Title', 'Título')}</th>
                    <th className="px-3 py-2 text-left">{tr('Status', 'Status')}</th>
                    <th className="px-3 py-2 text-left">{tr('Start', 'Início')}</th>
                    <th className="px-3 py-2 text-left">{tr('Due', 'Fim')}</th>
                    <th className="px-3 py-2 text-left">{tr('Validation', 'Validação')}</th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.preview.map(row => (
                    <tr key={row.row} className="border-t border-border/60">
                      <td className="px-3 py-2">{row.row}</td>
                      <td className="px-3 py-2">{row.title}</td>
                      <td className="px-3 py-2">{STATUS_MAP[row.status] || row.status}</td>
                      <td className="px-3 py-2">{row.startDate}</td>
                      <td className="px-3 py-2">{row.dueDate}</td>
                      <td className="px-3 py-2">
                        {row.errors.length ? (
                          <span className="text-amber-500 inline-flex items-center gap-1">
                            <XCircle className="w-3.5 h-3.5" />
                            {row.errors[0]}
                          </span>
                        ) : (
                          <span className="text-emerald-500 inline-flex items-center gap-1">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            {tr('Ready', 'Pronta')}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {analysis.rowErrors.length > 0 && (
              <div className="text-xs text-muted-foreground space-y-1">
                <p className="font-semibold text-foreground">{tr('Common errors found:', 'Erros encontrados:')}</p>
                {(showAllRowErrors ? analysis.rowErrors : analysis.rowErrors.slice(0, 5)).map(err => (
                  <p key={err.row} className="text-amber-500">
                    {tr(`Row ${err.row}: ${err.errors.join(' | ')}`, `Linha ${err.row}: ${err.errors.join(' | ')}`)}
                  </p>
                ))}
                {analysis.rowErrors.length > 5 && (
                  <button
                    type="button"
                    onClick={() => setShowAllRowErrors(prev => !prev)}
                    className={`${ui.button.base} ${ui.button.subtle} text-[11px] px-3 py-1.5`}
                  >
                    {showAllRowErrors
                      ? tr('Show less', 'Mostrar menos')
                      : tr(`Show all issues (+${analysis.rowErrors.length - 5})`, `Ver todos os erros (+${analysis.rowErrors.length - 5})`)}
                  </button>
                )}
              </div>
            )}

            {importing && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{cancelRequested ? tr('Canceling import...', 'Cancelando importação...') : tr('Importing...', 'Importando...')}</span>
                  <span>{progress.current}/{progress.total}</span>
                </div>
                <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all"
                    style={{ width: `${progress.total ? Math.round((progress.current / progress.total) * 100) : 0}%` }}
                  />
                </div>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={handleCancelImport}
                    disabled={cancelRequested}
                    className={`${ui.button.base} ${ui.button.subtle} disabled:opacity-60`}
                  >
                    {cancelRequested ? tr('Cancel requested', 'Cancelamento solicitado') : tr('Cancel import', 'Cancelar importação')}
                  </button>
                </div>
              </div>
            )}

            {result && (
              <section className="surface-muted p-4 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-foreground">{tr('Import result', 'Resultado da importação')}</p>
                  <span
                    className={`chip ${(result.failed > 0 || resultErrors.length > 0) ? 'chip-warning' : 'chip-success'}`}
                  >
                    {(result.failed > 0 || resultErrors.length > 0)
                      ? tr('Completed with warnings', 'Concluído com alertas')
                      : tr('Completed successfully', 'Concluído com sucesso')}
                  </span>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3 text-xs">
                  <div className="surface-card p-3">
                    <p className="text-muted-foreground">{tr('Total processed', 'Total processado')}</p>
                    <p className="text-lg font-semibold text-foreground">{result.totalProcessed ?? analysis.total}</p>
                  </div>
                  <div className="surface-card p-3">
                    <p className="text-muted-foreground">{tr('Imported', 'Importados')}</p>
                    <p className="text-lg font-semibold text-emerald-500">{result.imported ?? 0}</p>
                  </div>
                  <div className="surface-card p-3">
                    <p className="text-muted-foreground">{tr('Skipped', 'Ignorados')}</p>
                    <p className="text-lg font-semibold text-muted-foreground">{result.skipped ?? 0}</p>
                  </div>
                  <div className="surface-card p-3">
                    <p className="text-muted-foreground">{tr('Duplicates', 'Duplicados')}</p>
                    <p className="text-lg font-semibold text-amber-500">{result.duplicated ?? 0}</p>
                  </div>
                  <div className="surface-card p-3">
                    <p className="text-muted-foreground">{tr('Errors', 'Erros')}</p>
                    <p className="text-lg font-semibold text-destructive">{resultErrors.length}</p>
                  </div>
                </div>

                {resultErrors.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                      {tr('Rejected items / errors', 'Itens rejeitados / erros')}
                    </p>
                    <div className="overflow-x-auto rounded-xl border border-border/70 max-h-56">
                      <table className="min-w-full text-xs">
                        <thead className="bg-muted/50">
                          <tr>
                            <th className="px-3 py-2 text-left">{tr('Type', 'Tipo')}</th>
                            <th className="px-3 py-2 text-left">{tr('Row', 'Linha')}</th>
                            <th className="px-3 py-2 text-left">{tr('Column', 'Coluna')}</th>
                            <th className="px-3 py-2 text-left">{tr('Field', 'Campo')}</th>
                            <th className="px-3 py-2 text-left">{tr('Message', 'Mensagem')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {resultErrors.map((item, idx) => (
                            <tr key={`${item.type || 'err'}-${item.row || idx}-${idx}`} className="border-t border-border/60">
                              <td className="px-3 py-2">{item.type || '-'}</td>
                              <td className="px-3 py-2">{item.row || '-'}</td>
                              <td className="px-3 py-2">{item.column || '-'}</td>
                              <td className="px-3 py-2">{item.field || '-'}</td>
                              <td className="px-3 py-2 text-amber-500">{item.message || '-'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    onClick={downloadErrorReport}
                    disabled={!resultErrors.length}
                    className={`${ui.button.base} ${ui.button.subtle} disabled:opacity-60`}
                  >
                    <Download className="w-4 h-4" />
                    {tr('Download error report', 'Baixar relatório de erros')}
                  </button>
                  <button type="button" onClick={resetState} className={`${ui.button.base} ${ui.button.subtle}`}>
                    {tr('Import another file', 'Importar outra planilha')}
                  </button>
                  <button type="button" onClick={handleViewProjects} className={`${ui.button.base} ${ui.button.primary}`}>
                    {tr('View projects', 'Ver projetos')}
                  </button>
                </div>
              </section>
            )}

            {/* ===== STEP 4: Earnings import (optional, appears after project import result) ===== */}
            {result && !earningsResult && (
              <section className="surface-card p-5 space-y-4">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                  <div>
                    <h3 className="text-sm font-semibold uppercase tracking-[0.13em] text-muted-foreground">
                      {tr('Step 4: Import earnings spreadsheet (optional)', 'Passo 4: Importar planilha de ganhos (opcional)')}
                    </h3>
                    <p className="text-xs text-muted-foreground mt-1">
                      {tr(
                        'Upload a separate CSV/XLSX with project earnings. Projects will be linked by title.',
                        'Envie um CSV/XLSX separado com os ganhos dos projetos. Os projetos serão vinculados pelo título.',
                      )}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button type="button" onClick={downloadEarningsTemplate} className={`${ui.button.base} ${ui.button.subtle}`}>
                      <Download className="w-4 h-4" />
                      {tr('Earnings Template', 'Template de ganhos')}
                    </button>
                  </div>
                </div>

                <div className="flex gap-2">
                  <input
                    ref={earningsFileInputRef}
                    type="file"
                    accept=".csv,.xlsx,.xls"
                    className="hidden"
                    onChange={e => handleSelectEarningsFile(e.target.files?.[0])}
                  />
                  <button type="button" onClick={() => earningsFileInputRef.current?.click()} className={`${ui.button.base} ${ui.button.primary}`}>
                    <UploadCloud className="w-4 h-4" />
                    {earningsFile ? tr('Change File', 'Trocar arquivo') : tr('Choose Earnings File', 'Selecionar planilha de ganhos')}
                  </button>
                  {earningsFile && (
                    <button type="button" onClick={resetEarningsState} className={`${ui.button.base} ${ui.button.subtle}`}>
                      {tr('Clear', 'Limpar')}
                    </button>
                  )}
                </div>

                {earningsFile && (
                  <div className="text-xs text-muted-foreground">
                    <span className="font-semibold text-foreground">{earningsFile.name}</span> - {(earningsFile.size / 1024).toFixed(1)} KB
                  </div>
                )}
                {earningsParsing && (
                  <div className="text-sm text-muted-foreground flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {tr('Reading spreadsheet...', 'Lendo planilha...')}
                  </div>
                )}
                {earningsFileErrors.length > 0 && (
                  <div className="space-y-1">
                    {earningsFileErrors.map((msg, idx) => (
                      <div key={idx} className="text-xs text-amber-500">{msg}</div>
                    ))}
                  </div>
                )}

                {/* Earnings column mapping */}
                {earningsHeaders.length > 0 && (
                  <div className="space-y-3">
                    <h4 className="text-xs font-semibold uppercase tracking-[0.13em] text-muted-foreground">
                      {tr('Map earnings columns', 'Mapear colunas de ganhos')}
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                      {EARNINGS_FIELD_CONFIG.map(field => (
                        <label key={field.key} className="space-y-1.5">
                          <span className="text-xs font-semibold text-foreground">
                            {field.label} {field.required ? '*' : ''}
                          </span>
                          <select
                            value={earningsMapping[field.key] || ''}
                            onChange={e => handleEarningsMappingChange(field.key, e.target.value)}
                            className={`${ui.field.select} h-10`}
                          >
                            <option value="">{field.required ? tr('Select required column', 'Selecione a coluna obrigatória') : tr('Not mapped', 'Não mapear')}</option>
                            {earningsHeaders.map(header => (
                              <option key={header} value={header}>{header}</option>
                            ))}
                          </select>
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                {/* Earnings validation errors */}
                {earningsAnalysis.globalErrors.length > 0 && (
                  <div className="space-y-1">
                    {earningsAnalysis.globalErrors.map((message, idx) => (
                      <div key={idx} className="text-sm text-destructive flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4" />
                        {message}
                      </div>
                    ))}
                  </div>
                )}

                {/* Earnings preview table */}
                {earningsRows.length > 0 && earningsAnalysis.globalErrors.length === 0 && (
                  <>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs">
                      <div className="surface-muted p-3">
                        <div className="text-muted-foreground">{tr('Total rows', 'Total de linhas')}</div>
                        <div className="text-lg font-semibold text-foreground">{earningsAnalysis.total}</div>
                      </div>
                      <div className="surface-muted p-3">
                        <div className="text-muted-foreground">{tr('Valid', 'Válidas')}</div>
                        <div className="text-lg font-semibold text-emerald-500">{earningsAnalysis.validCount}</div>
                      </div>
                      <div className="surface-muted p-3">
                        <div className="text-muted-foreground">{tr('With issues', 'Com erros')}</div>
                        <div className="text-lg font-semibold text-amber-500">{earningsAnalysis.invalidCount}</div>
                      </div>
                    </div>

                    <div className="overflow-x-auto rounded-xl border border-border/70">
                      <table className="min-w-full text-xs">
                        <thead className="bg-muted/50">
                          <tr>
                            <th className="px-3 py-2 text-left">#</th>
                            <th className="px-3 py-2 text-left">{tr('Project', 'Projeto')}</th>
                            <th className="px-3 py-2 text-left">{tr('Month', 'Mês')}</th>
                            <th className="px-3 py-2 text-left">{tr('Year', 'Ano')}</th>
                            <th className="px-3 py-2 text-left">{tr('Value', 'Valor')}</th>
                            <th className="px-3 py-2 text-left">{tr('Type', 'Tipo')}</th>
                            <th className="px-3 py-2 text-left">{tr('Dollar Rate', 'Cotação USD')}</th>
                            <th className="px-3 py-2 text-left">{tr('Validation', 'Validação')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {earningsAnalysis.preview.map(row => (
                            <tr key={row.row} className="border-t border-border/60">
                              <td className="px-3 py-2">{row.row}</td>
                              <td className="px-3 py-2">{row.projectTitle}</td>
                              <td className="px-3 py-2">{row.month}</td>
                              <td className="px-3 py-2">{row.year}</td>
                              <td className="px-3 py-2">{row.value}</td>
                              <td className="px-3 py-2">{row.tipo}</td>
                              <td className="px-3 py-2">{row.dolarValue}</td>
                              <td className="px-3 py-2">
                                {row.errors.length ? (
                                  <span className="text-amber-500 inline-flex items-center gap-1">
                                    <XCircle className="w-3.5 h-3.5" />
                                    {row.errors[0]}
                                  </span>
                                ) : (
                                  <span className="text-emerald-500 inline-flex items-center gap-1">
                                    <CheckCircle2 className="w-3.5 h-3.5" />
                                    {tr('Ready', 'Pronta')}
                                  </span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* Earnings import button */}
                    <div className="flex flex-wrap justify-end gap-2">
                      <button
                        type="button"
                        onClick={handleEarningsImport}
                        disabled={!earningsAnalysis.ready || earningsImporting}
                        className={`${ui.button.base} ${ui.button.primary} disabled:opacity-60`}
                      >
                        {earningsImporting ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            {tr('Importing earnings...', 'Importando ganhos...')}
                          </>
                        ) : (
                          tr(`Import ${earningsAnalysis.validCount} earnings`, `Importar ${earningsAnalysis.validCount} ganhos`)
                        )}
                      </button>
                    </div>
                  </>
                )}
              </section>
            )}

            {/* Earnings result */}
            {earningsResult && (
              <section className="surface-muted p-4 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-foreground">{tr('Earnings import result', 'Resultado da importação de ganhos')}</p>
                  <span
                    className={`chip ${(earningsResult.failed > 0 || (earningsResult.errors || []).length > 0) ? 'chip-warning' : 'chip-success'}`}
                  >
                    {(earningsResult.failed > 0 || (earningsResult.errors || []).length > 0)
                      ? tr('Completed with warnings', 'Concluído com alertas')
                      : tr('Completed successfully', 'Concluído com sucesso')}
                  </span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs">
                  <div className="surface-card p-3">
                    <p className="text-muted-foreground">{tr('Total processed', 'Total processado')}</p>
                    <p className="text-lg font-semibold text-foreground">{earningsResult.totalProcessed ?? 0}</p>
                  </div>
                  <div className="surface-card p-3">
                    <p className="text-muted-foreground">{tr('Imported', 'Importados')}</p>
                    <p className="text-lg font-semibold text-emerald-500">{earningsResult.imported ?? 0}</p>
                  </div>
                  <div className="surface-card p-3">
                    <p className="text-muted-foreground">{tr('Errors', 'Erros')}</p>
                    <p className="text-lg font-semibold text-destructive">{earningsResult.failed ?? 0}</p>
                  </div>
                </div>
                {(earningsResult.errors || []).length > 0 && (
                  <div className="overflow-x-auto rounded-xl border border-border/70 max-h-56">
                    <table className="min-w-full text-xs">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="px-3 py-2 text-left">{tr('Row', 'Linha')}</th>
                          <th className="px-3 py-2 text-left">{tr('Message', 'Mensagem')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(earningsResult.errors || []).map((err, idx) => (
                          <tr key={idx} className="border-t border-border/60">
                            <td className="px-3 py-2">{err.row || '-'}</td>
                            <td className="px-3 py-2 text-amber-500">{err.message || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            )}

            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" onClick={closeModal} disabled={importing || earningsImporting} className={`${ui.button.base} ${ui.button.subtle} disabled:opacity-60`}>
                {result ? tr('Done', 'Concluir') : tr('Close', 'Fechar')}
              </button>
              {!result && (
                <button
                  type="button"
                  onClick={handleImport}
                  disabled={!analysis.ready || importing}
                  className={`${ui.button.base} ${ui.button.primary} disabled:opacity-60`}
                >
                  {importing ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      {tr('Importing...', 'Importando...')}
                    </>
                  ) : (
                    tr(`Import ${analysis.validCount} projects`, `Importar ${analysis.validCount} projetos`)
                  )}
                </button>
              )}
            </div>
          </section>
        )}
      </div>
    </Modal>
  );
}



