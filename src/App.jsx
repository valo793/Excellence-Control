// src/App.jsx
// --- Core React/Hooks ---
import { useEffect, useMemo, useState, useCallback } from 'react';

// --- Componentes de UI ---
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import Modal from './components/Modal';
import ProjectForm from './components/ProjectForm';
import ProjectListModal from './components/ProjectListModal';
import SettingsPanel from './components/SettingsPanel';
import ImportSpreadsheetModal from './components/ImportSpreadsheetModal';
import FiltersPopup from './components/FiltersPopup';
import HowToGuide from './components/HowToGuide';

// --- Views (Telas Principais) ---
import Kanban from './views/Kanban';
import Roadmap from './views/Roadmap';
import TableView from './views/TableView';
import Dashboard from './views/Dashboard';
import AdminUsersView from './views/AdminUsersView';
import AdminAuditView from './views/AdminAuditView';
import AuthView from './views/AuthView';
import Landing from './views/Landing';
import VerifyEmailView from './views/VerifyEmailView';
import dpWorldLogo from './assets/DPWorldLogo.png';

// --- UtilitÃ¡rios ---
import { STATUS_MAP } from './utils/constants';
import { ui } from './ui/visuals';
import { sanitizeGanttTasks } from './utils/gantt';

// --- FunÃ§Ãµes de API (ComunicaÃ§Ã£o com Backend) ---
import {
  buildApiUrl,
  getProjects as apiGetProjects,
  createProject as apiCreateProject,
  importProjectsBulk as apiImportProjectsBulk,
  createProjectImportJob as apiCreateProjectImportJob,
  getProjectImportJob as apiGetProjectImportJob,
  cancelProjectImportJob as apiCancelProjectImportJob,
  updateProject as apiUpdateProject,
  deleteProject as apiDeleteProject,
  getCurrentUser,
  refreshSession,
  logoutUser,
  uploadProjectFiles as apiUploadProjectFiles,
  getProjectFiles,
  deleteProjectFile as apiDeleteProjectFile,
  getProjectEarnings,
  replaceProjectEarnings,
  upsertProjectEarning,
  deleteProjectEarning,
  importEarningsBulk as apiImportEarningsBulk,
} from './config/oracle'

const FOUNDATION_V1_ENABLED = /^(1|true|yes|on)$/i.test(
  String(import.meta.env?.VITE_UI_FOUNDATION_V1 || '').trim(),
);
const FILTERS_STORAGE_KEY = 'ec_project_filters_v1';
const IMPORT_ASYNC_THRESHOLD = Math.max(
  1,
  Number.parseInt(import.meta.env?.VITE_IMPORT_ASYNC_THRESHOLD || '', 10) || 250,
);
const IMPORT_JOB_POLL_INTERVAL_MS = Math.max(
  500,
  Number.parseInt(import.meta.env?.VITE_IMPORT_JOB_POLL_INTERVAL_MS || '', 10) || 1500,
);
const IMPORT_JOB_TIMEOUT_MS = Math.max(
  60_000,
  Number.parseInt(import.meta.env?.VITE_IMPORT_JOB_TIMEOUT_MS || '', 10) || 10 * 60 * 1000,
);

const DEFAULT_PROJECT_FILTERS = Object.freeze({
  dateFrom: '',
  dateTo: '',
  statuses: [],
  earningStatuses: [],
  unscheduled: false,
  committeeImpacts: [],
  kaizenCategories: [],
  priorities: [],
});

function normalizeFilterArray(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(item => String(item || '').trim()).filter(Boolean))];
}

function normalizeProjectFilters(raw) {
  const next = raw && typeof raw === 'object' ? raw : {};
  return {
    dateFrom: typeof next.dateFrom === 'string' ? next.dateFrom.slice(0, 10) : '',
    dateTo: typeof next.dateTo === 'string' ? next.dateTo.slice(0, 10) : '',
    statuses: normalizeFilterArray(next.statuses),
    earningStatuses: normalizeFilterArray(next.earningStatuses).map(item => String(item || '').toUpperCase()),
    unscheduled: Boolean(next.unscheduled),
    committeeImpacts: normalizeFilterArray(next.committeeImpacts),
    kaizenCategories: normalizeFilterArray(next.kaizenCategories),
    priorities: normalizeFilterArray(next.priorities),
  };
}

function normalizeEarningStatus(value) {
  const normalized = String(value || '').trim().toUpperCase();
  if (normalized === 'REALIZADO') return 'REALIZADO';
  return 'PREVISTO';
}

function normalizeStatusKey(value) {
  const raw = String(value || '').trim();
  if (!raw) return 'TODO';

  const upper = raw.toUpperCase();
  if (STATUS_MAP[upper]) return upper;

  const normalized = upper.replace(/[\s-]+/g, '_');
  if (STATUS_MAP[normalized]) return normalized;

  const labelMap = {
    BACKLOG: 'BACKLOG',
    'TO DO': 'TODO',
    TODO: 'TODO',
    NOT_STARTED: 'TODO',
    'NAO INICIADO': 'TODO',
    'NÃO INICIADO': 'TODO',
    'IN PROGRESS': 'IN_PROGRESS',
    IN_PROGRESS: 'IN_PROGRESS',
    PAUSED: 'ON_HOLD',
    PAUSADO: 'ON_HOLD',
    REVIEW: 'REVIEW',
    'ON HOLD': 'ON_HOLD',
    ON_HOLD: 'ON_HOLD',
    DONE: 'DONE',
    COMPLETED: 'DONE',
    ARCHIVED: 'ARCHIVED',
    CANCELADO: 'ARCHIVED',
    CANCELED: 'ARCHIVED',
    CANCELLED: 'ARCHIVED',
    'A FAZER': 'TODO',
    'EM PROGRESSO': 'IN_PROGRESS',
    REVISAO: 'REVIEW',
    REVISÃO: 'REVIEW',
    'EM ESPERA': 'ON_HOLD',
    CONCLUIDO: 'DONE',
    CONCLUÍDO: 'DONE',
    ARQUIVADO: 'ARCHIVED',
  };

  return labelMap[upper] || labelMap[normalized] || 'TODO';
}

function normalizeCommitteeFlag(value) {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return 'nao';
  if (['sim', 's', 'yes', 'y', 'true', '1'].includes(raw)) return 'sim';
  if (['nao', 'não', 'n', 'no', 'false', '0'].includes(raw)) return 'nao';
  return raw.startsWith('s') ? 'sim' : 'nao';
}

function normalizeRoles(...sources) {
  const out = [];

  const append = value => {
    if (!value) return;
    if (Array.isArray(value)) {
      value.forEach(append);
      return;
    }

    if (typeof value === 'string') {
      value
        .split(',')
        .map(item => item.trim())
        .filter(Boolean)
        .forEach(item => out.push(item.toUpperCase()));
      return;
    }

    if (typeof value === 'object') {
      append(value.name ?? value.role ?? value.ROLE ?? value.NAME);
    }
  };

  sources.forEach(append);
  return [...new Set(out)];
}

function mapCurrentUser(rawUser) {
  if (!rawUser) return null;
  return {
    ...rawUser,
    roles: normalizeRoles(
      rawUser.ROLES,
      rawUser.roles,
      rawUser.ROLE,
      rawUser.role,
      rawUser.PERFIL,
      rawUser.perfil,
    ),
  };
}

/**
 * Helper para formatar datas para o formato 'YYYY-MM-DD'.
 * Garante que o backend receba um formato consistente.
 */
function toYMD(d) {
  if (!d) return null
  if (typeof d === 'string') return d.slice(0, 10)
  const dt = new Date(d)
  return Number.isNaN(dt.getTime()) ? null : dt.toISOString().slice(0, 10)
}

function toFiniteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeProjectEarnings(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map(item => ({
      year: Number.parseInt(item?.year, 10),
      month: Number.parseInt(item?.month, 10),
      value: toFiniteNumber(item?.value, 0),
      tipo: item?.tipo || null,
      dolarValue: item?.dolarValue != null ? toFiniteNumber(item.dolarValue, null) : null,
      earningStatus: normalizeEarningStatus(item?.earningStatus),
    }))
    .filter(item =>
      Number.isInteger(item.year)
      && item.year >= 1900
      && item.year <= 9999
      && Number.isInteger(item.month)
      && item.month >= 1
      && item.month <= 12,
    )
    .sort((a, b) => (a.year - b.year) || (a.month - b.month));
}

function sumProjectEarnings(items) {
  return normalizeProjectEarnings(items).reduce((sum, item) => (
    item.earningStatus === 'REALIZADO'
      ? sum + toFiniteNumber(item.value, 0)
      : sum
  ), 0);
}

/**
 * Normaliza um objeto de projeto vindo da API.
 * Garante que a aplicaÃ§Ã£o use nomes de propriedade consistentes (camelCase)
 * e valores padrÃ£o, independentemente do formato retornado pelo backend (ex: SNAKE_CASE).
 */
function mapRow(row) {
  const ganhoRealizadoValue = toFiniteNumber(row.ganhoRealizado ?? row.GANHO_REALIZADO ?? 0, 0);
  const hasRealizedEarnings = Boolean(Number(row.hasRealizedEarnings ?? row.HAS_REALIZED_EARNINGS ?? 0))
    || Math.abs(ganhoRealizadoValue) > 0;
  const hasProjectedEarnings = Boolean(Number(row.hasProjectedEarnings ?? row.HAS_PROJECTED_EARNINGS ?? 0));
  const earningStatuses = [];
  if (hasRealizedEarnings) earningStatuses.push('REALIZADO');
  if (hasProjectedEarnings) earningStatuses.push('PREVISTO');

  return {
    id: String(row.ID ?? row.id),
    title: row.TITLE ?? row.title ?? '',
    description: row.description ?? row.DESCRIPTION ?? '',
    status: normalizeStatusKey(row.STATUS ?? row.status ?? 'TODO'),
    priority: row.priority ?? row.PRIORITY ?? 'MEDIUM',

    employeeName: row.employeeName ?? row.EMPLOYEE_NAME ?? '',
    areaGrupo: row.areaGrupo ?? row.AREA_GRUPO ?? '',
    impactoComite: row.impactoComite ?? row.IMPACTO_COMITE ?? '',
    origem: row.origem ?? row.ORIGEM ?? '',
    comite: normalizeCommitteeFlag(row.comite ?? row.COMITE ?? ''),
    it: row.it ?? row.IT ?? '',
    registroInterno: row.registroInterno ?? row.REGISTRO_INT ?? '',
    vinculoProjeto: row.vinculoProjeto ?? row.VINCULO_PROJ ?? '',
    codigoILean: row.codigoILean ?? row.CODIGO_ILEAN ?? '',
    categoriaKaizen: row.categoriaKaizen ?? row.CATEGORIA_KAIZEN ?? '',
    goeAwardQ: row.goeAwardQ ?? row.GOE_AWARD_Q ?? '',
    goeAwardYear: row.goeAwardYear ?? row.GOE_AWARD_YEAR ?? null,
    premioKaizenQ: row.premioKaizenQ ?? row.PREMIO_KAIZEN_Q ?? '',
    premioKaizenYear: row.premioKaizenYear ?? row.PREMIO_KAIZEN_YEAR ?? null,
    ganhoEstimado: row.ganhoEstimado ?? row.GANHO_ESTIMADO ?? null,
    ganhoRealizado: ganhoRealizadoValue,
    earningsMonthly: [],
    hasRealizedEarnings,
    hasProjectedEarnings,
    earningStatuses,

    relevantKpi: row.relevantKpi ?? row.RELEVANT_KPI ?? '',
    leadingKpi: row.leadingKpi ?? row.LEADING_KPI ?? '',
    baseline: row.baseline ?? row.BASELINE ?? '',
    target: row.target ?? row.TARGET ?? '',
    actualYtd: row.actualYtd ?? row.ACTUAL_YTD ?? '',
    reNo: row.reNo ?? row.RE_NO ?? '',
    validador: row.validador ?? row.VALIDADOR ?? '',
    champion: row.champion ?? row.CHAMPION ?? '',
    metrics: row.metrics ?? row.METRICS ?? '',
    goeKaizenAward: row.goeKaizenAward ?? row.GOE_KAIZEN_AWARD ?? '',
    premioKaizen: row.premioKaizen ?? row.PREMIO_KAIZEN ?? '',
    categoriaBoletimExop: row.categoriaBoletimExop ?? row.CATEGORIA_BOLETIM_EXOP ?? '',
    projectLinkId: row.projectLinkId ?? row.PROJECT_LINK_ID ?? null,
    holdJustification: row.holdJustification ?? row.HOLD_JUSTIFICATION ?? '',
    anoConsiderado: row.anoConsiderado ?? row.ANO_CONSIDERADO ?? null,

    chegada: toYMD(row.chegada ?? row.CHEGADA),
    dataInicioGanho: toYMD(row.dataInicioGanho ?? row.DATA_INICIO_GANHO),
    dataFimPrevisto: toYMD(row.dataFimPrevisto ?? row.DATA_FIM_PREV),
    startDate: toYMD(row.START_DATE ?? row.startDate),
    dueDate: toYMD(row.DUE_DATE ?? row.dueDate),

    createdAt: row.CREATED_AT ?? row.createdAt ?? null,
    completedAt: row.COMPLETED_AT ?? row.completedAt ?? null,

    members: Array.isArray(row.members)
      ? row.members.map((m, idx) => {
        const name =
          m.memberName ??
          m.MEMBER_NAME ??
          m.name ??
          m.NAME ??
          '';

        const role =
          m.memberRole ??
          m.MEMBER_ROLE ??
          m.role ??
          m.ROLE ??
          '';

        return {
          id: m.id ?? m.ID ?? idx,
          // formato â€œnovoâ€
          memberName: name,
          memberRole: role,
          // formato â€œgenÃ©ricoâ€ que alguns componentes usam
          name,
          role,
        };
      })
      : [],


    subtasks: Array.isArray(row.subtasks) ? row.subtasks : []
  }
}

/**
 * Hook customizado para gerenciar a lÃ³gica de dados dos projetos.
 * Encapsula o estado dos projetos, loading, e todas as interaÃ§Ãµes com a API
 * relacionadas a projetos (CRUD, upload de arquivos, etc).
 * @param {boolean} enabled - Se `true`, o hook busca os dados. Usado para esperar a autenticaÃ§Ã£o.
 */
function useProjects(enabled) {
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!enabled) {
      setProjects([])
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const data = await apiGetProjects()
      setProjects(data.map(mapRow))
    } finally {
      setLoading(false)
    }
  }, [enabled]);

  useEffect(() => {
    void load();
  }, [load]);

  const add = useCallback(async (project) => {
    const payload = {
      ...project,
      startDate: toYMD(project.startDate),
      dueDate: toYMD(project.dueDate),
      chegada: toYMD(project.chegada),
      dataInicioGanho: toYMD(project.dataInicioGanho),
      dataFimPrevisto: toYMD(project.dataFimPrevisto),
    };
    const created = await apiCreateProject(payload);
    await load();
    return created;
  }, [load]);

  const update = useCallback(async (project) => {
    const id = project.id || project.ID;
    if (!id) return;
    const payload = {
      ...project,
      START_DATE: toYMD(project.startDate),
      DUE_DATE: toYMD(project.dueDate),
      CHEGADA: toYMD(project.chegada),
      DATA_INICIO_GANHO: toYMD(project.dataInicioGanho),
      DATA_FIM_PREV: toYMD(project.dataFimPrevisto),
    };
    await apiUpdateProject(id, payload);
    await load();
  }, [load]);

  const remove = useCallback(async (id) => {
    await apiDeleteProject(id);
    setProjects(prev => prev.filter(p => p.id !== String(id)));
  }, []);

  const uploadFiles = useCallback(async (projectId, files) => {
    if (!files || !files.length) return;
    await apiUploadProjectFiles(projectId, files);
  }, []);

  const deleteFile = useCallback(async (projectId, fileId) => {
    await apiDeleteProjectFile(projectId, fileId);
  }, []);

  const api = useMemo(() => ({
    add,
    update,
    remove,
    uploadFiles,
    deleteFile,
    reload: load,
  }), [add, update, remove, uploadFiles, deleteFile, load]);

  return { projects, api, dbReady: enabled && !loading }
}

/**
 * Componente principal da aplicaÃ§Ã£o.
 * Orquestra o estado global, renderizaÃ§Ã£o de views, modais e a lÃ³gica de negÃ³cio.
 */
export default function App() {
  // --- Estado de AutenticaÃ§Ã£o e UsuÃ¡rio ---
  const [user, setUser] = useState(null)
  const [authChecked, setAuthChecked] = useState(false)

  // --- Estado da UI ---
  const [isSidebarOpen, setSidebarOpen] = useState(true)
  const [view, setView] = useState('kanban')

  // --- Estado de ConfiguraÃ§Ãµes do UsuÃ¡rio (persistido no localStorage) ---
  const [settings, setSettings] = useState(() => {
    try {
      const raw = localStorage.getItem('ec_settings');
      if (!raw) return { theme: 'light', hideNA: true, language: 'en' };
      // Garante que o tema e outras configs sejam vÃ¡lidas
      const parsed = JSON.parse(raw);
      return {
        theme: parsed.theme === 'light' || parsed.theme === 'dark' || parsed.theme === 'system' ? parsed.theme : 'light',
        hideNA: typeof parsed.hideNA === 'boolean' ? parsed.hideNA : true,
        language: parsed.language === 'pt-BR' || parsed.language === 'en' ? parsed.language : 'en',
      };
    } catch {
      return { theme: 'light', hideNA: true, language: 'en' };
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('ec_settings', JSON.stringify(settings));
    } catch { }
  }, [settings]);

  // --- Estado de Filtros ---
  const [search, setSearch] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [projectFilters, setProjectFilters] = useState(() => {
    try {
      const raw = localStorage.getItem(FILTERS_STORAGE_KEY);
      if (!raw) return normalizeProjectFilters(DEFAULT_PROJECT_FILTERS);
      return normalizeProjectFilters(JSON.parse(raw));
    } catch {
      return normalizeProjectFilters(DEFAULT_PROJECT_FILTERS);
    }
  });
  const [filterDraft, setFilterDraft] = useState(() => normalizeProjectFilters(DEFAULT_PROJECT_FILTERS));
  const [filtersOpen, setFiltersOpen] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify(projectFilters));
    } catch { }
  }, [projectFilters]);

  // --- Estado para Modais e InteraÃ§Ãµes ---
  const [editingProject, setEditingProject] = useState(null)
  const [projectModalOpen, setProjectModalOpen] = useState(false)
  const [howToOpen, setHowToOpen] = useState(false)
  const [importWizardOpen, setImportWizardOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  // --- Estado para Drilldown (detalhamento de dados dos grÃ¡ficos) ---
  const [drillOpen, setDrillOpen] = useState(false)
  const [drillTitle, setDrillTitle] = useState('Projects')
  const [drillRows, setDrillRows] = useState([])
  const [shouldReopenDrilldown, setShouldReopenDrilldown] = useState(false)

  const [routePath, setRoutePath] = useState(() => window.location.pathname || '/');
  const [unauthView, setUnauthView] = useState(() => (window.location.pathname === '/verify-email' ? 'auth' : 'landing')); // 'landing' | 'auth'

  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const isAnyOverlayOpen = (
    projectModalOpen
    || deleteModalOpen
    || settingsOpen
    || howToOpen
    || filtersOpen
    || importWizardOpen
    || drillOpen
  );
  const [deleteError, setDeleteError] = useState('');
  const [deleteSuccess, setDeleteSuccess] = useState('');

  const emitDashboardRefresh = useCallback(() => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new Event('dashboard:refresh'));
  }, []);

  useEffect(() => {
    const onPopState = () => setRoutePath(window.location.pathname || '/');
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigateTo = useCallback((path) => {
    const target = path || '/';
    if (window.location.pathname !== target) {
      window.history.pushState({}, '', target);
    }
    setRoutePath(target);
  }, []);

  // Efeito para verificar a autenticaÃ§Ã£o do usuÃ¡rio na inicializaÃ§Ã£o da aplicaÃ§Ã£o.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const me = await getCurrentUser();
        if (!cancelled) {
          setUser(mapCurrentUser(me));
          setAuthChecked(true);
        }
        return;
      } catch (err) {
        console.error('Erro ao buscar usuario atual', err);
      }

      try {
        await refreshSession();
        const meAfterRefresh = await getCurrentUser();
        if (!cancelled) setUser(mapCurrentUser(meAfterRefresh));
      } catch (refreshErr) {
        console.error('Falha no login automatico por refresh token', refreshErr);
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setAuthChecked(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);


  // Utiliza o hook `useProjects` para buscar e gerenciar os projetos.
  const { projects, api } = useProjects(!!user)

  // Efeito para aplicar o tema (dark/light) na tag `<html>`.
  useEffect(() => {
    const theme = settings.theme
    const el = document.documentElement
    if (theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      el.classList.add('dark')
    } else {
      el.classList.remove('dark')
    }
  }, [settings.theme])

  useEffect(() => {
    const el = document.documentElement;
    if (FOUNDATION_V1_ENABLED) {
      el.setAttribute('data-ui-foundation', 'v1');
      return;
    }
    el.removeAttribute('data-ui-foundation');
  }, []);

  useEffect(() => {
    document.documentElement.lang = settings.language === 'pt-BR' ? 'pt-BR' : 'en';
  }, [settings.language]);

  useEffect(() => {
    const root = document.documentElement;
    let rafId = null;
    let lastClientX = window.innerWidth * 0.5;
    let lastClientY = window.innerHeight * 0.32;

    const setPointer = (x, y) => {
      root.style.setProperty('--pointer-x', `${x}px`);
      root.style.setProperty('--pointer-y', `${y}px`);
    };

    const syncPointer = () => {
      const x = lastClientX + window.scrollX;
      const y = lastClientY + window.scrollY;
      setPointer(x, y);
      rafId = null;
    };

    const scheduleSync = () => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(syncPointer);
    };

    const onPointerMove = event => {
      lastClientX = event.clientX;
      lastClientY = event.clientY;
      scheduleSync();
    };

    const onScrollOrResize = () => {
      scheduleSync();
    };

    scheduleSync();
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('scroll', onScrollOrResize, { passive: true });
    window.addEventListener('resize', onScrollOrResize, { passive: true });

    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('scroll', onScrollOrResize);
      window.removeEventListener('resize', onScrollOrResize);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, []);

  const language = settings.language === 'pt-BR' ? 'pt-BR' : 'en';
  const tr = useCallback((enText, ptBrText) => (language === 'pt-BR' ? ptBrText : enText), [language]);
  const isAdmin = !!user?.roles?.includes('ADMIN');
  const isAdminContextView = view === 'adminUsers' || view === 'adminAudit';

  useEffect(() => {
    if (!isAdmin && (view === 'adminUsers' || view === 'adminAudit')) {
      setView('kanban');
    }
  }, [isAdmin, view]);

  const filterOptions = useMemo(() => {
    const getUniqueValues = (picker, fallback = null) => {
      const values = new Set();
      projects.forEach(project => {
        const raw = picker(project);
        const value = String(raw ?? '').trim();
        if (value) values.add(value);
        else if (fallback) values.add(fallback);
      });
      return Array.from(values).sort((a, b) => a.localeCompare(b));
    };

    return {
      statuses: Object.keys(STATUS_MAP),
      earningStatuses: ['REALIZADO', 'PREVISTO'],
      committeeImpacts: getUniqueValues(p => p.impactoComite, 'N/A'),
      kaizenCategories: getUniqueValues(p => p.categoriaKaizen, 'N/A'),
      priorities: getUniqueValues(p => p.priority, 'MEDIUM'),
    };
  }, [projects]);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (projectFilters.dateFrom) count += 1;
    if (projectFilters.dateTo) count += 1;
    if (projectFilters.unscheduled) count += 1;
    count += projectFilters.statuses.length;
    count += projectFilters.earningStatuses.length;
    count += projectFilters.committeeImpacts.length;
    count += projectFilters.kaizenCategories.length;
    count += projectFilters.priorities.length;
    return count;
  }, [projectFilters]);

  function openFiltersPopup() {
    setFilterDraft(normalizeProjectFilters(projectFilters));
    setFiltersOpen(true);
  }

  function applyFiltersPopup() {
    setProjectFilters(normalizeProjectFilters(filterDraft));
    setFiltersOpen(false);
  }

  function clearFiltersPopup() {
    const cleared = normalizeProjectFilters(DEFAULT_PROJECT_FILTERS);
    setProjectFilters(cleared);
    setFilterDraft(cleared);
  }

  useEffect(() => {
    if (user && routePath === '/verify-email') {
      navigateTo('/');
    }
  }, [user, routePath, navigateTo]);

  /**
   * Memoiza a lista de projetos filtrados com base na busca e no filtro de data.
   * Evita re-cÃ¡lculos desnecessÃ¡rios a cada renderizaÃ§Ã£o.
   */
  const filtered = useMemo(() => {
    const term = search.toLowerCase().trim();
    const fromDate = projectFilters.dateFrom ? new Date(`${projectFilters.dateFrom}T00:00:00`) : null;
    const toDate = projectFilters.dateTo ? new Date(`${projectFilters.dateTo}T23:59:59`) : null;

    return projects.filter(project => {
      const title = String(project.title || '').toLowerCase();
      const description = String(project.description || '').toLowerCase();
      const status = String(project.status || 'TODO');
      const impact = String(project.impactoComite || 'N/A').trim();
      const kaizen = String(project.categoriaKaizen || 'N/A').trim();
      const priority = String(project.priority || 'MEDIUM').trim();
      const earningStatuses = Array.isArray(project.earningStatuses) ? project.earningStatuses : [];
      const startReference = project.startDate || project.chegada || (project.createdAt ? toYMD(project.createdAt) : null);
      const endReference = project.dueDate || project.dataFimPrevisto || null;
      const isUnscheduled = !startReference || !endReference;

      if (term && !title.includes(term) && !description.includes(term)) {
        return false;
      }

      if (projectFilters.statuses.length > 0 && !projectFilters.statuses.includes(status)) {
        return false;
      }

      if (projectFilters.earningStatuses.length > 0) {
        const normalizedProjectStatuses = earningStatuses.map(item => String(item || '').toUpperCase());
        const matchesEarningStatus = projectFilters.earningStatuses.some(filterStatus =>
          normalizedProjectStatuses.includes(String(filterStatus || '').toUpperCase()),
        );
        if (!matchesEarningStatus) return false;
      }

      if (projectFilters.committeeImpacts.length > 0 && !projectFilters.committeeImpacts.includes(impact)) {
        return false;
      }

      if (projectFilters.kaizenCategories.length > 0 && !projectFilters.kaizenCategories.includes(kaizen)) {
        return false;
      }

      if (projectFilters.priorities.length > 0 && !projectFilters.priorities.includes(priority)) {
        return false;
      }

      if (projectFilters.unscheduled && !isUnscheduled) {
        return false;
      }

      if (fromDate || toDate) {
        const dateToFilter = startReference || endReference;
        if (!dateToFilter) return false;
        const projectDate = new Date(`${String(dateToFilter).slice(0, 10)}T12:00:00`);
        if (Number.isNaN(projectDate.getTime())) return false;
        if (fromDate && projectDate < fromDate) return false;
        if (toDate && projectDate > toDate) return false;
      }

      return true;
    });
  }, [projects, search, projectFilters])

  /**
   * Memoiza a transformaÃ§Ã£o dos projetos filtrados para o formato esperado pelo grÃ¡fico de Gantt.
   * Separa tarefas com data das sem data.
   */
  function getGanttStart(p) {
    return (
      p.startDate ||
      p.chegada ||
      (p.createdAt ? toYMD(p.createdAt) : null)
    );
  }

  const ganttTasks = useMemo(() => {
    const scheduledDraft = [];
    const unscheduled = [];
    const todayYMD = toYMD(new Date());

    filtered
      .filter(p => p.status !== 'ARCHIVED')
      .forEach(p => {
        const status = normalizeStatusKey(p.status || 'TODO');
        const estimatedEnd = p.dueDate || p.dataFimPrevisto || null;
        const timelinePoint = status === 'IN_PROGRESS' ? todayYMD : estimatedEnd;
        const start = toYMD(getGanttStart(p));
        const end = toYMD(timelinePoint);

        if (!start || !end) {
          unscheduled.push(p);
          return;
        }

        let progress = 0;
        if (p.subtasks?.length) {
          const total = p.subtasks.reduce((s, t) => s + (t.weight || 1), 0);
          const done = p.subtasks
            .filter(t => t.done)
            .reduce((s, t) => s + (t.weight || 1), 0);
          progress = total > 0 ? (done / total) * 100 : 0;
        }

        scheduledDraft.push({
          id: p.id,
          name: p.title,
          start,
          end,
          progress,
          status,
          plannedEnd: estimatedEnd,
          timelinePoint: end,
          custom_class: `bar-status-${status}`,
        });
      });

    const scheduled = sanitizeGanttTasks(scheduledDraft);
    const scheduledIds = new Set(scheduled.map(task => String(task.id)));
    const dropped = filtered.filter(
      p =>
        p.status !== 'ARCHIVED'
        && !unscheduled.some(row => String(row.id) === String(p.id))
        && !scheduledIds.has(String(p.id)),
    );

    return { scheduled, unscheduled: [...unscheduled, ...dropped] };
  }, [filtered]);



  /**
   * Manipula a remoÃ§Ã£o de um anexo de um projeto.
   * Chamado pelo `ProjectForm` quando um arquivo existente Ã© removido.
   */
  async function handleRemoveAttachment(projectId, file) {
    try {
      if (!file?.id) return;
      await api.deleteFile(projectId, file.id);
    } catch (e) {
      alert(tr('Error removing file: ', 'Erro ao remover arquivo: ') + e.message);
    }
  }

  /**
   * Abre o modal de ediÃ§Ã£o/visualizaÃ§Ã£o de um projeto.
   * Busca os anexos do projeto antes de abrir o modal.
   * @param {string} id - ID do projeto.
   * @param {boolean} fromDrilldown - Flag para saber se a aÃ§Ã£o veio do modal de drilldown.
   */
  const openProject = useCallback(async (id, fromDrilldown = false) => {
    const base = projects.find(x => x.id === id);
    if (!base) return;

    let withAttachments = { ...base };
    // Busca os arquivos associados ao projeto
    try {
      const files = await getProjectFiles(id);
      withAttachments.attachments = files.map(f => ({
        id: f.ID,
        name: f.FILE_NAME,
        size: f.FILE_SIZE,
        type: f.MIME_TYPE,
        path: f.FILE_PATH,
        url: buildApiUrl(f.FILE_PATH),
      }));
    } catch (e) {
      console.error('Erro ao carregar anexos', e);
    }

    try {
      const earnings = await getProjectEarnings(id);
      const items = normalizeProjectEarnings(earnings?.items || []);
      withAttachments.earningsMonthly = items;
      withAttachments.ganhoRealizado = sumProjectEarnings(items);
    } catch (e) {
      if (e?.code !== 'PROJECT_EARNINGS_NOT_AVAILABLE') {
        console.error('Erro ao carregar ganhos mensais', e);
      }
      withAttachments.earningsMonthly = [];
    }

    setEditingProject(withAttachments);
    setProjectModalOpen(true);

    if (fromDrilldown) {
      setShouldReopenDrilldown(true);
    }
  }, [projects]);

  /**
   * Salva um projeto (criaÃ§Ã£o ou atualizaÃ§Ã£o).
   * TambÃ©m lida com o upload de novos arquivos anexados.
   */
  async function handleSaveProject(data) {
    const wasDrilldown = shouldReopenDrilldown;
    setShouldReopenDrilldown(false);

    try {
      if (data) {
        const { _filesToUpload, earningsMonthly, ...projData } = data;
        const normalizedEarnings = normalizeProjectEarnings(earningsMonthly);
        const hasEarningsPayload = Array.isArray(earningsMonthly);

        if (projData.comite !== undefined) {
          projData.comite = normalizeCommitteeFlag(projData.comite);
        }

        if (hasEarningsPayload) {
          projData.ganhoRealizado = sumProjectEarnings(normalizedEarnings);
        }

        const syncEarningsLegacy = async projectId => {
          const current = await getProjectEarnings(projectId);
          const currentItems = normalizeProjectEarnings(current?.items || []);
          const targetKeys = new Set(
            normalizedEarnings.map(item => `${item.year}-${item.month}`),
          );

          for (const item of currentItems) {
            const key = `${item.year}-${item.month}`;
            if (targetKeys.has(key)) continue;
            await deleteProjectEarning(projectId, item.year, item.month);
          }

          for (const item of normalizedEarnings) {
            await upsertProjectEarning(projectId, item);
          }
        };

        const syncEarnings = async projectId => {
          if (!hasEarningsPayload || !projectId) return;
          try {
            await replaceProjectEarnings(projectId, normalizedEarnings);
            await api.reload();
          } catch (error) {
            const isLegacyRouteMissing = error?.status === 404 && /Cannot PUT/i.test(String(error?.message || ''));
            if (isLegacyRouteMissing) {
              await syncEarningsLegacy(projectId);
              await api.reload();
              return;
            }
            if (error?.code !== 'PROJECT_EARNINGS_NOT_AVAILABLE') {
              throw error;
            }
          }
        };

        if (projData.id) {
          // Atualiza um projeto existente
          await api.update(projData);
          await syncEarnings(projData.id);

          // Faz upload de novos arquivos, se houver
          if (_filesToUpload?.length) {
            await api.uploadFiles(projData.id, _filesToUpload);
          }
        } else {
          // Cria um novo projeto
          const created = await api.add(projData);
          const newId = created?.id || created?.ID;
          await syncEarnings(newId);
          // Se o projeto foi criado e hÃ¡ arquivos, faz o upload
          if (newId && _filesToUpload?.length) {
            await api.uploadFiles(newId, _filesToUpload);
          }
        }
      }

      setProjectModalOpen(false);
      setEditingProject(null);
      emitDashboardRefresh();

      // Se o modal foi aberto a partir do drilldown, reabre o drilldown
      if (wasDrilldown) {
        setDrillOpen(true);
      }
    } catch (error) {
      console.error('Erro ao salvar projeto', error);
      alert((error?.message || tr('Could not save project.', 'Nao foi possivel salvar o projeto.')));
    }
  }

  function handleRequestDeleteProject(project) {
    if (!isAdmin || !project?.id) return;
    setProjectModalOpen(false);
    setEditingProject(null);
    setDeleteTarget({
      id: String(project.id),
      title: project.title || tr('Untitled project', 'Projeto sem título'),
    });
    setDeleteError('');
    setDeleteSuccess('');
    setDeleteModalOpen(true);
  }

  async function handleConfirmDeleteProject() {
    if (!deleteTarget?.id) return;

    setDeleteLoading(true);
    setDeleteError('');
    setDeleteSuccess('');

    try {
      await api.remove(deleteTarget.id);
      emitDashboardRefresh();
      setDrillRows(prev => prev.filter(row => String(row.id) !== String(deleteTarget.id)));
      setDeleteSuccess(tr('Project deleted successfully.', 'Projeto excluído com sucesso.'));

      setTimeout(() => {
        setDeleteModalOpen(false);
        setDeleteTarget(null);
        setDeleteSuccess('');
      }, 750);
    } catch (error) {
      setDeleteError(error?.message || tr('Could not delete project.', 'Não foi possível excluir o projeto.'));
    } finally {
      setDeleteLoading(false);
    }
  }

  /**
   * Altera o status de um projeto (ex: arrastar e soltar no Kanban).
   */
  const handleProjectStatusChange = useCallback(async (projectId, newStatus) => {
    const project = projects.find(p => p.id === projectId)
    if (project && project.status !== newStatus) {
      await api.update({ ...project, status: newStatus })
      emitDashboardRefresh();
    }
  }, [projects, api, emitDashboardRefresh]);

  /**
   * Manipula a ediÃ§Ã£o de uma cÃ©lula na TableView (ediÃ§Ã£o inline).
   */
  const onCellEdit = useCallback((projectId, key, raw) => {
    const project = projects.find(p => p.id === projectId)
    if (!project) return
    let newValue = String(raw ?? '').trim()
    const numericKeys = ['ganhoEstimado', 'anoConsiderado']
    if (numericKeys.includes(key)) {
      newValue = parseFloat(newValue.replace('R$', '').replace(/\./g, '').replace(',', '.')) || 0
    }
    if (project[key] != newValue) {
      api.update({ ...project, [key]: newValue }).then(() => {
        emitDashboardRefresh();
      });
    }
  }, [projects, api, emitDashboardRefresh]);

  const handleRoadmapTaskClick = useCallback((task) => {
    if (!task?.id) return;
    openProject(task.id);
  }, [openProject]);

  const handleRoadmapDateChange = useCallback(async (task, start, end) => {
    const project = projects.find(x => x.id === task?.id);
    if (!project) return;
    await api.update({
      ...project,
      startDate: toYMD(start),
      dueDate: toYMD(end),
    });
    emitDashboardRefresh();
  }, [projects, api, emitDashboardRefresh]);

  async function handleImportRows(rowsToImport, invalidRowsCount = 0, onProgress, meta = {}) {
    const validationErrors = Array.isArray(meta?.validationErrors) ? meta.validationErrors : [];
    const total = rowsToImport.length;
    const emitProgress = typeof onProgress === 'function' ? onProgress : null;
    const cancelToken = meta?.cancelToken && typeof meta.cancelToken === 'object'
      ? meta.cancelToken
      : null;
    const safeRows = rowsToImport.map(row => ({
      ...(row || {}),
      startDate: toYMD(row?.startDate),
      dueDate: toYMD(row?.dueDate),
    }));
    const isCancelRequested = () => Boolean(cancelToken?.cancelRequested || cancelToken?.canceled);
    const buildCanceledError = () => {
      const error = new Error(
        cancelToken?.reason
        || tr('Import canceled by user.', 'Importação cancelada pelo usuário.'),
      );
      error.code = 'IMPORT_CANCELED';
      return error;
    };

    if (emitProgress) {
      emitProgress({ current: 0, total: Math.max(1, total), imported: 0, failed: 0 });
    }

    if (total >= IMPORT_ASYNC_THRESHOLD) {
      const startedAt = Date.now();
      const createdJob = await apiCreateProjectImportJob({
        rows: safeRows,
        invalidRowsCount,
        externalErrors: validationErrors,
      });

      const jobId = String(createdJob?.id || '').trim();
      if (!jobId) {
        throw new Error(tr('Could not start import job.', 'Não foi possível iniciar o job de importação.'));
      }
      let cancelRequestSent = false;
      const requestCancelJob = async () => {
        if (cancelRequestSent) return;
        cancelRequestSent = true;
        try {
          await apiCancelProjectImportJob(jobId);
        } catch {
          // best effort: polling seguirá e refletirá o estado final do job
        }
      };

      if (isCancelRequested()) {
        await requestCancelJob();
      }

      const pollAfterMs = Math.max(
        500,
        Number(createdJob?.pollAfterMs || IMPORT_JOB_POLL_INTERVAL_MS),
      );

      let lastSnapshot = {
        current: 0,
        total: Math.max(1, total),
        imported: 0,
        failed: 0,
      };

      // Polling do status até o job finalizar.
      // Mantém o modal simples no front e delega o processamento pesado para o backend.
      while (true) {
        if (isCancelRequested()) {
          await requestCancelJob();
        }

        const job = await apiGetProjectImportJob(jobId);
        const progress = job?.progress || {};

        lastSnapshot = {
          current: Number(progress.current ?? lastSnapshot.current ?? 0),
          total: Math.max(1, Number(progress.total ?? lastSnapshot.total ?? total ?? 1)),
          imported: Number(progress.imported ?? lastSnapshot.imported ?? 0),
          failed: Number(progress.failed ?? lastSnapshot.failed ?? 0),
        };

        if (emitProgress) {
          emitProgress(lastSnapshot);
        }

        if (job?.status === 'canceled') {
          return job?.result || {
            canceled: true,
            totalProcessed: total + invalidRowsCount,
            imported: 0,
            failed: lastSnapshot.failed,
            skipped: invalidRowsCount,
            duplicated: Number(progress.duplicated || 0),
            errors: [],
            logs: [
              {
                type: 'warning',
                message: tr('Import canceled by user.', 'Importação cancelada pelo usuário.'),
              },
            ],
          };
        }

        if (job?.status === 'completed') {
          const result = job?.result || {
            totalProcessed: total + invalidRowsCount,
            imported: lastSnapshot.imported,
            failed: lastSnapshot.failed,
            skipped: invalidRowsCount,
            duplicated: Number(progress.duplicated || 0),
            errors: [],
            logs: [],
          };

          if (Number(result.imported || 0) > 0) {
            await api.reload();
            emitDashboardRefresh();
          }
          return result;
        }

        if (job?.status === 'failed') {
          throw new Error(
            job?.error?.message || tr('Import job failed.', 'Falha no job de importação.'),
          );
        }

        if ((Date.now() - startedAt) > IMPORT_JOB_TIMEOUT_MS) {
          throw new Error(
            tr(
              'Import is taking too long. Check job status again in a few seconds.',
              'A importação está demorando muito. Verifique o status novamente em alguns segundos.',
            ),
          );
        }

        await new Promise(resolve => setTimeout(resolve, pollAfterMs));
      }
    }

    if (isCancelRequested()) {
      throw buildCanceledError();
    }

    const dryRunResult = await apiImportProjectsBulk({
      rows: safeRows,
      dryRun: true,
      invalidRowsCount,
      externalErrors: validationErrors,
    });

    const readyRows = Array.isArray(dryRunResult?.readyRows) ? dryRunResult.readyRows : [];
    const preRejected = Math.max(0, total - readyRows.length);

    if (emitProgress) {
      emitProgress({
        current: Math.min(total, Math.max(1, Math.floor(total * 0.4))),
        total,
        imported: 0,
        failed: preRejected,
      });
    }

    if (readyRows.length === 0) {
      return {
        totalProcessed: total + invalidRowsCount,
        imported: 0,
        failed: preRejected,
        skipped: invalidRowsCount,
        duplicated: dryRunResult?.duplicated || 0,
        errors: Array.isArray(dryRunResult?.errors) ? dryRunResult.errors : validationErrors,
        logs: Array.isArray(dryRunResult?.logs) ? dryRunResult.logs : [],
      };
    }

    if (isCancelRequested()) {
      throw buildCanceledError();
    }

    const commitResult = await apiImportProjectsBulk({
      rows: readyRows,
      dryRun: false,
    });

    const commitErrors = Array.isArray(commitResult?.errors) ? commitResult.errors : [];
    const dryRunErrors = Array.isArray(dryRunResult?.errors) ? dryRunResult.errors : [];
    const commitLogs = Array.isArray(commitResult?.logs) ? commitResult.logs : [];
    const dryRunLogs = Array.isArray(dryRunResult?.logs) ? dryRunResult.logs : [];

    const imported = Number(commitResult?.imported || 0);
    const failed = preRejected + Number(commitResult?.failed || 0);

    if (emitProgress) {
      emitProgress({
        current: total,
        total,
        imported,
        failed,
      });
    }

    if (imported > 0) {
      await api.reload();
      emitDashboardRefresh();
    }

    return {
      totalProcessed: total + invalidRowsCount,
      imported,
      failed,
      skipped: invalidRowsCount,
      duplicated: Number(dryRunResult?.duplicated || 0) + Number(commitResult?.duplicated || 0),
      errors: [...dryRunErrors, ...commitErrors],
      logs: [...dryRunLogs, ...commitLogs],
    };
  }

  async function handleImportEarningsRows(earningsRows) {
    try {
      const result = await apiImportEarningsBulk(earningsRows);
      if (Number(result?.imported || 0) > 0) {
        await api.reload();
        emitDashboardRefresh();
      }
      return result;
    } catch (error) {
      console.error('Erro ao importar earnings', error);
      throw error;
    }
  }

  function onExport() {
    if (projects.length === 0) {
      alert(tr('No projects to export.', 'Sem projetos para exportar.'))
      return
    }
    const headers = ['ID', 'Title', 'Description', 'Status', 'Start Date', 'Due Date']
    const rows = projects.map(p => [
      p.id,
      p.title || '',
      p.description || '',
      STATUS_MAP[p.status] || '',
      p.startDate || '',
      p.dueDate || '',
    ])
    const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'kanban_export.csv'
    a.click()
    URL.revokeObjectURL(a.href)
  }

  /**
   * Callback para lidar com cliques nos grÃ¡ficos do Dashboard (drilldown).
   * Filtra os projetos com base no item clicado e abre o modal de lista de projetos.
   * `useCallback` Ã© usado para evitar recriaÃ§Ãµes da funÃ§Ã£o em cada render.
   */
  const onChartClick = useCallback(
    (type, e, els, context = {}) => {
      if (!els || els.length === 0) return;

      const index = els[0].index ?? 0;
      const chart = els[0].element?.$context?.chart;
      const label = context.label ?? (chart?.data?.labels?.[index] ?? '');
      let rows = [];

      switch (type) {
        case 'status': {
          const key = Object.keys(STATUS_MAP).find(
            k => STATUS_MAP[k] === label
          );
          rows = filtered.filter(p => p.status === key);
          break;
        }

        case 'employeeName':
          rows = filtered.filter(
            p => (p.employeeName || 'Unassigned') === label
          );
          break;

        case 'areaGrupo':
          rows = filtered.filter(
            p => (p.areaGrupo || 'N/A') === label
          );
          break;

        case 'impactoComite':
          rows = filtered.filter(p => {
            const val = (p.impactoComite || 'N/A').toLowerCase();
            return val.includes(label.split('/')[0].toLowerCase().trim());
          });
          break;

        case 'categoriaKaizen': {
          const keyword = label.toLowerCase();
          rows = filtered.filter(p =>
            (p.categoriaKaizen || '').toLowerCase().includes(keyword)
          );
          break;
        }

        // Drilldown de custos usando sÃ³ o que jÃ¡ estÃ¡ no front
        case 'costDrilldown': {
          if (!context.year || !context.month) break;

          rows = filtered.filter(p => {
            const d = p.dataInicioGanho || p.startDate;
            if (!d) return false;
            const dt = new Date(d + 'T12:00:00');
            const anoOk = dt.getFullYear() === context.year;
            const mesOk = dt.getMonth() + 1 === context.month;
            const temGanho = (Number(p.ganhoRealizado) || 0) > 0;
            return anoOk && mesOk && temGanho;
          });
          break;
        }

        default:
          break;
      }

      setDrillRows(rows);
      setDrillTitle(
        `Projects: ${label}${context.year ? ` (${context.year})` : ''}`
      );
      setDrillOpen(true);
    },
    [filtered]
  );

  /**
   * Realiza o logout do usuÃ¡rio.
   */
  async function handleLogout() {
    try {
      await logoutUser();
    } catch (error) {
      console.error('Falha ao encerrar sessao no backend', error);
    }
    setUser(null)
    navigateTo('/')
    setUnauthView('auth')
  }

  const loadingHighlights = [
    tr('Secure session validation', 'Validacao segura da sessao'),
    tr('Operational data bootstrap', 'Inicializacao de dados operacionais'),
  ];

  // Renderiza um estado de "loading" enquanto a autenticaÃ§Ã£o inicial estÃ¡ sendo verificada.
  if (!authChecked) {
    return (
      <div className={`${ui.shell.appBackdrop} app-loading-shell app-loading-shell-unified`}>
        <div className="app-loading-stage">
          <section className="app-loading-panel app-loading-panel-unified">
            <div className="app-loading-brand-content">
              <div className="app-loading-logo-wrap">
                <img src={dpWorldLogo} alt="DP World" className="app-loading-logo" />
              </div>
              <p className="app-loading-eyebrow">Operational Excellence</p>
              <h1 className="app-loading-title">Excellence Control</h1>
              <p className="app-loading-description">
                {tr(
                  'Preparing your workspace with governance context and project state.',
                  'Preparando seu workspace com contexto de governanca e estado dos projetos.',
                )}
              </p>
            </div>

            <div className="app-loading-progress-row">
              <div className="app-loading-mark" aria-hidden="true">
                <span className="app-loading-mark-inner" />
              </div>
              <div className="app-loading-copy">
                <p className="app-loading-kicker">{tr('Initialization in progress', 'Inicialização em andamento')}</p>
                <p className="app-loading-text">{tr('Loading...', 'Carregando...')}</p>
                <p className="app-loading-subtext">{tr('This takes only a few seconds.', 'Isso leva apenas alguns segundos.')}</p>
              </div>
            </div>

            <ul className="app-loading-points" aria-hidden="true">
              {loadingHighlights.map(item => (
                <li key={item} className="app-loading-point">
                  <span className="app-loading-point-dot" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    )
  }

  // Se a verificaÃ§Ã£o terminou e nÃ£o hÃ¡ usuÃ¡rio, renderiza a tela de login/registro.
  if (!user) {
    if (routePath === '/verify-email') {
      const verifyToken = new URLSearchParams(window.location.search).get('token') || '';
      return (
        <>
          <VerifyEmailView
            token={verifyToken}
            language={language}
            onOpenSettings={() => setSettingsOpen(true)}
            onGoToLogin={() => {
              navigateTo('/');
              setUnauthView('auth');
            }}
          />
          <Modal open={settingsOpen} onClose={() => setSettingsOpen(false)} tone="workspace">
            <SettingsPanel settings={settings} setSettings={setSettings} language={language} />
          </Modal>
        </>
      );
    }

    if (unauthView === 'landing') {
      return (
        <>
          <Landing
            language={language}
            onOpenSettings={() => setSettingsOpen(true)}
            onLoginClick={() => {
              navigateTo('/');
              setUnauthView('auth');
            }}
          />
          <Modal open={settingsOpen} onClose={() => setSettingsOpen(false)} tone="workspace">
            <SettingsPanel settings={settings} setSettings={setSettings} language={language} />
          </Modal>
        </>
      );
    }

    // tela de login/registro
    return (
      <>
        <AuthView
          language={language}
          onOpenSettings={() => setSettingsOpen(true)}
          onAuthSuccess={async () => {
            const me = await getCurrentUser();
            setUser(mapCurrentUser(me));
            navigateTo('/');
          }}
        />
        <Modal open={settingsOpen} onClose={() => setSettingsOpen(false)} tone="workspace">
          <SettingsPanel settings={settings} setSettings={setSettings} language={language} />
        </Modal>
      </>
    );
  }

  // RenderizaÃ§Ã£o principal da aplicaÃ§Ã£o quando o usuÃ¡rio estÃ¡ logado.
  return (
    <div className={`${ui.shell.appBackdrop} workspace-shell command-workspace-shell`}>
      <div className={`${ui.shell.contentWrap} command-workspace-content`}>
        {isSidebarOpen && (
          <Sidebar
            language={language}
            currentView={view}
            onChangeView={setView}
            onOpenHowTo={() => setHowToOpen(true)}
            onOpenSettings={() => setSettingsOpen(true)}
            settings={settings}
            setSettings={setSettings}
            user={user}
            onLogout={handleLogout}
            theme={settings.theme}
          />
        )}

        <div className={`${ui.shell.main} command-workspace-main`}>
          <div className="sticky top-0 z-30 px-3 pt-3 pb-2 bg-gradient-to-b from-background/70 to-transparent backdrop-blur-sm command-workspace-header">
            <Header
              language={language}
              minimal={isAdminContextView}
              onToggleSidebar={() => setSidebarOpen(v => !v)}
              onOpenProjectModal={() => {
                setEditingProject(null)
                setProjectModalOpen(true)
              }}
              onOpenImportWizard={() => setImportWizardOpen(true)}
              onOpenFilters={openFiltersPopup}
              activeFilterCount={activeFilterCount}
              onExport={onExport}
              search={search}
              setSearch={setSearch}
              settings={settings}
              setSettings={setSettings}
            />
          </div>
          <main
            key={view}
            className={`${ui.shell.pageInner} command-workspace-page page-screen-stage ${view === 'kanban' ? 'kanban-view-locked-scroll' : ''} ${view === 'adminAudit' ? 'audit-view-locked-scroll' : ''}`}
          >
            {view === 'kanban' && (
              <Kanban
                language={language}
                projects={filtered}
                showArchived={showArchived}
                onToggleArchived={() => setShowArchived(v => !v)}
                onOpenProject={openProject}
                onProjectStatusChange={handleProjectStatusChange}
              />
            )}

            {/* O Dashboard recebe os filtros globais para que seus dados sejam consistentes com o resto da UI */}
            {view === 'dashboard' && (
              <Dashboard
                language={language}
                onChartClick={onChartClick}
                theme={settings.theme}
                isInteractionBlocked={isAnyOverlayOpen}
                filters={{
                  search,
                  dateFrom: projectFilters.dateFrom,
                  dateTo: projectFilters.dateTo,
                  statuses: projectFilters.statuses,
                  earningStatuses: projectFilters.earningStatuses,
                  unscheduled: projectFilters.unscheduled,
                  committeeImpacts: projectFilters.committeeImpacts,
                  kaizenCategories: projectFilters.kaizenCategories,
                  priorities: projectFilters.priorities,
                }}
                onOpenProjects={() => setView('kanban')}
                onOpenRoadmap={() => setView('roadmap')}
                onOpenImport={() => setImportWizardOpen(true)}
                onOpenProject={openProject}
              />
            )}

            {view === 'roadmap' && (
              <Roadmap
                language={language}
                tasks={ganttTasks.scheduled}
                unscheduled={ganttTasks.unscheduled}
                onClickTask={handleRoadmapTaskClick}
                onOpenProject={openProject}
                onProjectStatusChange={handleProjectStatusChange}
                onDateChange={handleRoadmapDateChange}
              />
            )}
            {view === 'table' && (
              <TableView
                language={language}
                projects={filtered}
                onCellEdit={onCellEdit}
                onOpenProject={openProject}
              />
            )}
            {view === 'adminUsers' && <AdminUsersView language={language} />}
            {view === 'adminAudit' && <AdminAuditView language={language} />}
          </main>
        </div>
      </div>

      {/* Modal para criar/editar um projeto */}
      <Modal
        open={projectModalOpen}
        onClose={() => {
          setProjectModalOpen(false)
          setEditingProject(null)
        }}
        maxWidth="max-w-4xl"
      >
        <ProjectForm
          language={language}
          initial={editingProject}
          onSubmit={handleSaveProject}
          onRemoveAttachment={handleRemoveAttachment}
          canDelete={isAdmin}
          onRequestDelete={handleRequestDeleteProject}
        />
      </Modal>

      {/* Outros modais da aplicaÃ§Ã£o (ajuda, configuraÃ§Ãµes, etc.) */}
      <Modal open={howToOpen} onClose={() => setHowToOpen(false)}>
        <HowToGuide
          language={language}
          onOpenImport={() => {
            setHowToOpen(false);
            setImportWizardOpen(true);
          }}
          onCreateProject={() => {
            setHowToOpen(false);
            setEditingProject(null);
            setProjectModalOpen(true);
          }}
          onViewProjects={() => {
            setHowToOpen(false);
            setView('kanban');
          }}
        />
      </Modal>

      <Modal open={settingsOpen} onClose={() => setSettingsOpen(false)} tone="workspace">
        <SettingsPanel
          language={language}
          settings={settings}
          setSettings={setSettings}
        />
      </Modal>

      <FiltersPopup
        open={filtersOpen}
        language={language}
        draft={filterDraft}
        setDraft={setFilterDraft}
        options={filterOptions}
        activeCount={activeFilterCount}
        onClose={() => setFiltersOpen(false)}
        onApply={applyFiltersPopup}
        onClear={clearFiltersPopup}
      />

      <Modal
        open={deleteModalOpen}
        onClose={() => {
          if (deleteLoading) return;
          setDeleteModalOpen(false);
          setDeleteTarget(null);
          setDeleteError('');
          setDeleteSuccess('');
        }}
        maxWidth="max-w-lg"
      >
        <div className="p-6 space-y-4">
          <h2 className="text-2xl font-bold text-foreground">{tr('Delete Project', 'Excluir projeto')}</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {tr(
              'Are you sure you want to permanently delete this project? This action cannot be undone.',
              'Tem certeza que deseja excluir este projeto permanentemente? Esta ação não pode ser desfeita.',
            )}
          </p>

          {deleteTarget?.title && (
            <div className="surface-muted px-3 py-2 rounded-lg text-sm">
              <span className="text-muted-foreground">{tr('Project:', 'Projeto:')} </span>
              <span className="font-semibold text-foreground">{deleteTarget.title}</span>
            </div>
          )}

          {deleteError && <div className="text-sm text-destructive">{deleteError}</div>}
          {deleteSuccess && <div className="text-sm text-emerald-500">{deleteSuccess}</div>}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => {
                setDeleteModalOpen(false);
                setDeleteTarget(null);
                setDeleteError('');
                setDeleteSuccess('');
              }}
              disabled={deleteLoading}
              className={`${ui.button.base} ${ui.button.subtle} disabled:opacity-60`}
            >
              {tr('Cancel', 'Cancelar')}
            </button>
            <button
              type="button"
              onClick={handleConfirmDeleteProject}
              disabled={deleteLoading || !!deleteSuccess}
              className={`${ui.button.base} ${ui.button.danger} disabled:opacity-60`}
            >
              {deleteLoading ? tr('Deleting...', 'Excluindo...') : tr('Delete Project', 'Excluir projeto')}
            </button>
          </div>
        </div>
      </Modal>

      <ImportSpreadsheetModal
        open={importWizardOpen}
        onClose={() => setImportWizardOpen(false)}
        onGoToProjects={() => {
          setImportWizardOpen(false);
          setView('kanban');
        }}
        onImportRows={handleImportRows}
        onImportEarningsRows={handleImportEarningsRows}
        language={language}
      />

      {/* Modal para exibir a lista de projetos do drilldown */}
      <ProjectListModal
        open={drillOpen}
        language={language}
        onClose={() => setDrillOpen(false)}
        title={drillTitle}
        rows={drillRows}
        onOpenProject={(id) => openProject(id, true)}
      />

    </div>
  )
}
