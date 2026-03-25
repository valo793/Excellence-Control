export function cx(...parts) {
  return parts.filter(Boolean).join(' ');
}

export const STATUS_META = {
  BACKLOG: {
    key: 'BACKLOG',
    label: 'Backlog',
    labelPt: 'Backlog',
    color: '#5f6b7a',
    badgeClass: 'status-badge status-backlog',
  },
  TODO: {
    key: 'TODO',
    label: 'To Do',
    labelPt: 'A Fazer',
    color: '#c68726',
    badgeClass: 'status-badge status-todo',
  },
  IN_PROGRESS: {
    key: 'IN_PROGRESS',
    label: 'In Progress',
    labelPt: 'Em Progresso',
    color: '#0056a6',
    badgeClass: 'status-badge status-in-progress',
  },
  REVIEW: {
    key: 'REVIEW',
    label: 'Review',
    labelPt: 'Revisão',
    color: '#0b7d8a',
    badgeClass: 'status-badge status-review',
  },
  ON_HOLD: {
    key: 'ON_HOLD',
    label: 'On Hold',
    labelPt: 'Em Espera',
    color: '#c62f4f',
    badgeClass: 'status-badge status-on-hold',
  },
  DONE: {
    key: 'DONE',
    label: 'Done',
    labelPt: 'Concluído',
    color: '#1f9d73',
    badgeClass: 'status-badge status-done',
  },
  ARCHIVED: {
    key: 'ARCHIVED',
    label: 'Archived',
    labelPt: 'Arquivado',
    color: '#4b5565',
    badgeClass: 'status-badge status-archived',
  },
};

export const STATUS_MAP = Object.fromEntries(
  Object.entries(STATUS_META).map(([key, meta]) => [key, meta.label]),
);

export const STATUS_COLORS = Object.values(STATUS_META).reduce((acc, meta) => {
  acc[meta.key] = meta.color;
  acc[meta.label] = meta.color;
  return acc;
}, {});

export function getStatusMeta(statusKey) {
  return STATUS_META[statusKey] || STATUS_META.BACKLOG;
}

export function getStatusLabel(statusKey, language = 'en') {
  const meta = getStatusMeta(statusKey);
  if (language === 'pt-BR') return meta.labelPt || meta.label;
  return meta.label;
}

export const ui = {
  shell: {
    page: 'surface-card',
    sidePanel: 'app-sidebar surface-glass overflow-hidden',
    panel: 'surface-card',
    mutedPanel: 'surface-muted',
    appBackdrop: 'app-shell min-h-screen text-foreground',
    contentWrap: 'app-shell__content',
    main: 'app-main',
    pageInner: 'app-main__body scroll-container',
  },
  button: {
    base: 'btn-base',
    icon: 'btn-icon',
    ghost: 'btn-ghost',
    subtle: 'btn-subtle',
    primary: 'btn-primary',
    danger: 'btn-danger',
    pill: 'btn-pill',
  },
  field: {
    input: 'input-control',
    select: 'input-control appearance-none',
    date: 'input-control',
    textarea: 'textarea-control',
  },
  text: {
    pageTitle: 'text-2xl sm:text-[2rem] font-semibold tracking-tight text-foreground',
    sectionTitle: 'text-lg sm:text-xl font-semibold tracking-tight text-foreground',
    muted: 'text-sm text-muted-foreground',
  },
  card: {
    base: 'surface-card',
    muted: 'surface-muted',
    interactive: 'surface-card transition-all duration-200 hover:-translate-y-0.5 hover:shadow-premium-lg hover:border-primary/35',
    glass: 'surface-glass',
  },
  badge: {
    base: 'chip',
    subtle: 'chip chip-subtle',
    success: 'chip chip-success',
    warning: 'chip chip-warning',
    danger: 'chip chip-danger',
  },
};
