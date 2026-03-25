import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Chart from 'chart.js/auto';
import { createPortal } from 'react-dom';
import ChartDataLabels from 'chartjs-plugin-datalabels';
import {
  AlertTriangle,
  ArrowRight,
  ChevronDown,
  Clock3,
  DollarSign,
  Loader2,
  Sparkles,
  Target,
} from 'lucide-react';
import Modal from '../components/Modal';
import { STATUS_COLORS } from '../utils/constants';
import {
  getDashboardKpis,
  getDashboardCharts,
  getDashboardCosts,
  getDashboardLeadTime,
  getDashboardCostsMatrix,
} from '../config/oracle';
import { getStatusMeta, ui } from '../ui/visuals';

Chart.register(ChartDataLabels);

const PALETTE = ['#D92365', '#24A676', '#1BBF72', '#6C5BB3', '#D9A13C', '#A889E6', '#BF3C62', '#8A79C8', '#4D3C8A'];
const DAY_MS = 24 * 60 * 60 * 1000;
const USD_BRL_RATE = 5.0;

function toYmd(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(date, days) {
  return new Date(date.getTime() + days * DAY_MS);
}

function toSafeDate(value) {
  if (!value) return null;
  const dt = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function buildQueryString(filters = {}, overrides = {}) {
  const params = new URLSearchParams();
  const search = String(overrides.search ?? filters.search ?? '').trim();
  const dateFrom = String(overrides.dateFrom ?? filters.dateFrom ?? '').trim();
  const dateTo = String(overrides.dateTo ?? filters.dateTo ?? '').trim();
  const statuses = Array.isArray(overrides.statuses ?? filters.statuses)
    ? (overrides.statuses ?? filters.statuses)
    : [];
  const earningStatuses = Array.isArray(overrides.earningStatuses ?? filters.earningStatuses)
    ? (overrides.earningStatuses ?? filters.earningStatuses)
    : [];
  const committeeImpacts = Array.isArray(overrides.committeeImpacts ?? filters.committeeImpacts)
    ? (overrides.committeeImpacts ?? filters.committeeImpacts)
    : [];
  const kaizenCategories = Array.isArray(overrides.kaizenCategories ?? filters.kaizenCategories)
    ? (overrides.kaizenCategories ?? filters.kaizenCategories)
    : [];
  const priorities = Array.isArray(overrides.priorities ?? filters.priorities)
    ? (overrides.priorities ?? filters.priorities)
    : [];
  const unscheduled = Boolean(overrides.unscheduled ?? filters.unscheduled);

  const serializeList = values =>
    [...new Set(values.map(item => String(item || '').trim()).filter(Boolean))].join(',');

  if (search) params.set('search', search);
  if (dateFrom) params.set('dateFrom', dateFrom);
  if (dateTo) params.set('dateTo', dateTo);
  if (statuses.length) params.set('statuses', serializeList(statuses));
  if (earningStatuses.length) params.set('earningStatuses', serializeList(earningStatuses));
  if (committeeImpacts.length) params.set('committeeImpacts', serializeList(committeeImpacts));
  if (kaizenCategories.length) params.set('kaizenCategories', serializeList(kaizenCategories));
  if (priorities.length) params.set('priorities', serializeList(priorities));
  if (unscheduled) params.set('unscheduled', 'true');
  return params.toString();
}

function formatDateLabel(value, locale = 'en-US') {
  const date = value instanceof Date ? value : toSafeDate(value);
  if (!date) return 'N/A';
  return date.toLocaleDateString(locale, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function buildPeriodMeta(
  filters = {},
  { locale = 'en-US', tr = (enText) => enText } = {},
) {
  const fromDate = toSafeDate(filters?.dateFrom);
  const toDate = toSafeDate(filters?.dateTo);
  const search = String(filters?.search || '').trim();

  const base = {
    periodLabel: tr('All available history', 'Todo o histórico disponível'),
    comparisonLabel: tr(
      'Comparison baseline appears when a complete date range is selected.',
      'A linha de comparação aparece quando há um intervalo completo de datas.',
    ),
    quickSummary: search
      ? tr(`Filtered by search: "${search}"`, `Filtrado por busca: "${search}"`)
      : tr(
          'Showing all portfolio records currently available.',
          'Exibindo todos os registros de portfólio disponíveis.',
        ),
    hasComparison: false,
    comparisonQuery: '',
  };

  if (!(fromDate && toDate) || fromDate > toDate) {
    if (fromDate && !toDate) {
      base.periodLabel = tr(
        `From ${formatDateLabel(fromDate, locale)} onward`,
        `A partir de ${formatDateLabel(fromDate, locale)}`,
      );
    } else if (!fromDate && toDate) {
      base.periodLabel = tr(
        `Up to ${formatDateLabel(toDate, locale)}`,
        `Até ${formatDateLabel(toDate, locale)}`,
      );
    }
    return base;
  }

  const dayCount = Math.max(1, Math.floor((toDate - fromDate) / DAY_MS) + 1);
  const prevTo = addDays(fromDate, -1);
  const prevFrom = addDays(prevTo, -(dayCount - 1));

  return {
    periodLabel: `${formatDateLabel(fromDate, locale)} - ${formatDateLabel(toDate, locale)}`,
    comparisonLabel: tr(
      `${dayCount}-day window vs ${formatDateLabel(prevFrom, locale)} - ${formatDateLabel(prevTo, locale)}`,
      `Janela de ${dayCount} dias vs ${formatDateLabel(prevFrom, locale)} - ${formatDateLabel(prevTo, locale)}`,
    ),
    quickSummary: search
      ? tr(
          `Filtered by search: "${search}" during the selected period.`,
          `Filtrado por busca: "${search}" no período selecionado.`,
        )
      : tr(
          'Selected period applied to all KPI blocks.',
          'Período selecionado aplicado a todos os blocos de KPI.',
        ),
    hasComparison: true,
    comparisonQuery: buildQueryString(filters, {
      dateFrom: toYmd(prevFrom),
      dateTo: toYmd(prevTo),
    }),
  };
}

function computeDelta(currentValue, previousValue) {
  const current = Number(currentValue);
  const previous = Number(previousValue);
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;

  const diff = current - previous;
  const type = diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat';
  const sign = diff > 0 ? '+' : diff < 0 ? '-' : '';
  const absDiff = Math.abs(diff);
  const percent = previous === 0 ? null : (absDiff / Math.abs(previous)) * 100;

  return {
    type,
    sign,
    absDiff,
    percent,
    percentLabel: percent === null ? null : `${sign}${percent.toFixed(1)}%`,
  };
}

function buildStackRanking(stackData) {
  const labels = Array.isArray(stackData?.labels) ? stackData.labels : [];
  const done = Array.isArray(stackData?.done) ? stackData.done : [];
  const inProgress = Array.isArray(stackData?.inProgress) ? stackData.inProgress : [];
  const todo = Array.isArray(stackData?.todo) ? stackData.todo : [];

  const rows = labels.map((label, idx) => {
    const doneValue = Number(done[idx] || 0);
    const progressValue = Number(inProgress[idx] || 0);
    const todoValue = Number(todo[idx] || 0);
    const total = doneValue + progressValue + todoValue;
    return { label, done: doneValue, inProgress: progressValue, todo: todoValue, value: total };
  });

  const grandTotal = rows.reduce((sum, row) => sum + row.value, 0);
  return rows
    .filter(row => row.value > 0)
    .sort((a, b) => b.value - a.value)
    .map(row => ({
      ...row,
      percentage: grandTotal > 0 ? `${((row.value / grandTotal) * 100).toFixed(1)}%` : '0.0%',
    }));
}

function toCurrencyAmount(value, { currencyMode = 'BRL', usdRate = USD_BRL_RATE } = {}) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return 0;
  if (String(currencyMode).toUpperCase() === 'USD') {
    const rate = Number(usdRate);
    return numeric / (Number.isFinite(rate) && rate > 0 ? rate : USD_BRL_RATE);
  }
  return numeric;
}

function formatCurrency(value, locale = 'pt-BR', { currencyMode = 'BRL', usdRate = USD_BRL_RATE } = {}) {
  const currency = String(currencyMode).toUpperCase() === 'USD' ? 'USD' : 'BRL';
  const amount = toCurrencyAmount(value, { currencyMode: currency, usdRate });
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount);
}

function formatCurrencyCompact(value, locale = 'pt-BR', { currencyMode = 'BRL', usdRate = USD_BRL_RATE } = {}) {
  const currency = String(currencyMode).toUpperCase() === 'USD' ? 'USD' : 'BRL';
  const numeric = toCurrencyAmount(value, { currencyMode: currency, usdRate });
  if (!Number.isFinite(numeric) || numeric === 0) return '-';
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(numeric);
}

function formatCount(value, locale = 'en-US') {
  return new Intl.NumberFormat(locale).format(Number(value || 0));
}

function normalizeSelectedEarningStatuses(values = []) {
  if (!Array.isArray(values)) return [];
  return [...new Set(
    values
      .map(item => String(item || '').trim().toUpperCase())
      .filter(Boolean),
  )];
}

function getEarningStatusMode(selectedStatuses = []) {
  const selected = normalizeSelectedEarningStatuses(selectedStatuses);
  const onlyProjected = selected.length === 1 && selected[0] === 'PREVISTO';
  const onlyRealized = selected.length === 1 && selected[0] === 'REALIZADO';
  if (onlyProjected) return 'PREVISTO';
  if (onlyRealized) return 'REALIZADO';
  return 'ALL';
}

function sanitizeCostPayloadByEarningStatus(payload, selectedStatuses = []) {
  const mode = getEarningStatusMode(selectedStatuses);
  if (mode === 'ALL' || !payload || typeof payload !== 'object') return payload;

  const labels = Array.isArray(payload.labels) ? payload.labels : [];
  const values = Array.isArray(payload.values) ? payload.values : [];
  const pendingValues = Array.isArray(payload.pendingValues) ? payload.pendingValues : [];
  const counts = Array.isArray(payload.counts) ? payload.counts : [];

  const normalizedValues = labels.map((_, idx) => Number(values[idx] || 0));
  const normalizedPending = labels.map((_, idx) => Number(pendingValues[idx] || 0));
  const nextValues = mode === 'PREVISTO' ? normalizedValues.map(() => 0) : normalizedValues;
  const nextPendingValues = mode === 'REALIZADO' ? normalizedPending.map(() => 0) : normalizedPending;
  const basis = labels.map((_, idx) => Math.abs((nextValues[idx] || 0) + (nextPendingValues[idx] || 0)));
  const nextCounts = labels.map((_, idx) => (basis[idx] > 0 ? Number(counts[idx] || 0) : 0));

  return {
    ...payload,
    labels,
    values: nextValues,
    pendingValues: nextPendingValues,
    counts: nextCounts,
  };
}

function sanitizeCostMatrixByEarningStatus(payload, selectedStatuses = []) {
  const mode = getEarningStatusMode(selectedStatuses);
  if (mode === 'ALL' || !payload || typeof payload !== 'object') return payload;

  const projects = Array.isArray(payload.projects) ? payload.projects : [];
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  if (!rows.length || !projects.length) return payload;

  const keepStatus = mode;
  const projectTotals = Array.from({ length: projects.length }, () => 0);

  const normalizedRows = rows.map(row => {
    const values = Array.isArray(row?.values) ? row.values : [];
    const statuses = Array.isArray(row?.statuses) ? row.statuses : [];
    const nextValues = projects.map((_, idx) => {
      const value = Number(values[idx] || 0);
      const status = String(statuses[idx] || '').trim().toUpperCase();
      if (status !== keepStatus) return 0;
      projectTotals[idx] += value;
      return value;
    });

    return {
      ...row,
      values: nextValues,
      statuses: projects.map((_, idx) => (Number(nextValues[idx] || 0) !== 0 ? keepStatus : null)),
      total: nextValues.reduce((sum, value) => sum + Number(value || 0), 0),
    };
  });

  const keepIndexes = projectTotals
    .map((value, idx) => ({ value: Number(value || 0), idx }))
    .filter(entry => Math.abs(entry.value) > 0)
    .map(entry => entry.idx);

  if (!keepIndexes.length) {
    return {
      ...payload,
      projects: [],
      rows: normalizedRows.map(row => ({
        ...row,
        values: [],
        statuses: [],
        total: 0,
      })),
      maxCellValue: 0,
    };
  }

  const compactProjects = keepIndexes.map(idx => ({
    ...projects[idx],
    total: Number(projectTotals[idx] || 0),
  }));

  const compactRows = normalizedRows.map(row => {
    const compactValues = keepIndexes.map(idx => Number(row.values?.[idx] || 0));
    return {
      ...row,
      values: compactValues,
      statuses: keepIndexes.map(idx => row.statuses?.[idx] || null),
      total: compactValues.reduce((sum, value) => sum + Number(value || 0), 0),
    };
  });

  const maxCellValue = compactRows.reduce((maxValue, row) => (
    Math.max(maxValue, ...row.values.map(value => Math.abs(Number(value || 0))))
  ), 0);

  return {
    ...payload,
    projects: compactProjects,
    rows: compactRows,
    maxCellValue,
  };
}

function parsePercentageNumber(value) {
  const normalized = String(value || '')
    .replace('%', '')
    .replace(',', '.')
    .trim();
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatDurationLabel(value, tr, { decimals = 0, locale = 'en-US' } = {}) {
  const numeric = Number(value || 0);
  const safe = Number.isFinite(numeric) ? numeric : 0;
  const formatter = new Intl.NumberFormat(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return `${formatter.format(safe)} ${tr('days', 'dias')}`;
}

function useAnimatedNumber(
  targetValue,
  { duration = 640, decimals = 0, enabled = true } = {},
) {
  const safeTarget = Number.isFinite(Number(targetValue)) ? Number(targetValue) : 0;
  const [value, setValue] = useState(safeTarget);

  useEffect(() => {
    if (!enabled) {
      setValue(safeTarget);
      return undefined;
    }

    let frameId = 0;
    const factor = decimals > 0 ? 10 ** decimals : 1;
    const startAt = window.performance.now();
    setValue(0);

    const tick = (now) => {
      const progress = Math.min(1, (now - startAt) / duration);
      const eased = 1 - ((1 - progress) ** 3);
      const nextValue = (safeTarget * eased);
      setValue(Math.round(nextValue * factor) / factor);

      if (progress < 1) {
        frameId = window.requestAnimationFrame(tick);
      } else {
        setValue(safeTarget);
      }
    };

    frameId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frameId);
  }, [safeTarget, duration, decimals, enabled]);

  return value;
}

function SectionHeader({ eyebrow, title, subtitle, action }) {
  return (
    <div className="dashboard-section-header flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
      <div>
        {eyebrow ? <p className="text-[11px] uppercase tracking-[0.15em] font-semibold text-muted-foreground">{eyebrow}</p> : null}
        <h3 className="text-xl font-semibold text-foreground">{title}</h3>
        {subtitle ? <p className="text-sm text-muted-foreground mt-1">{subtitle}</p> : null}
      </div>
      {action ? <div className="dashboard-section-action self-start md:self-auto">{action}</div> : null}
    </div>
  );
}

function InfoActionButton({ onClick, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="dashboard-info-icon-btn"
      aria-label={label}
      title={label}
    >
      <span aria-hidden="true">i</span>
    </button>
  );
}

function DashboardInfoFlowRail({ steps = [] }) {
  if (!Array.isArray(steps) || !steps.length) return null;
  return (
    <div className="dashboard-info-flow-rail" aria-hidden="true">
      {steps.map((step, index) => (
        <div key={`dashboard-info-flow-${step.label}-${index}`} className="dashboard-info-flow-step">
          <span className="dashboard-info-flow-tag">{step.label}</span>
          <strong className="dashboard-info-flow-value">{step.value}</strong>
          {index < steps.length - 1 ? <ArrowRight className="dashboard-info-flow-arrow w-4 h-4" /> : null}
        </div>
      ))}
    </div>
  );
}

function DashboardInfoMetricCard({ item, tr }) {
  return (
    <article className={`${ui.card.base} dashboard-info-detail-card p-3`}>
      <h4 className="text-sm font-semibold text-foreground">{item.metric}</h4>
      <dl className="mt-2 space-y-1.5 text-xs">
        <div>
          <dt className="dashboard-info-detail-label">{tr('Source', 'Fonte')}</dt>
          <dd className="dashboard-info-detail-value">{item.source}</dd>
        </div>
        <div>
          <dt className="dashboard-info-detail-label">{tr('Formula', 'Formula')}</dt>
          <dd className="dashboard-info-detail-value">{item.formula}</dd>
        </div>
        <div>
          <dt className="dashboard-info-detail-label">{tr('Rule', 'Regra')}</dt>
          <dd className="dashboard-info-detail-value">{item.rule}</dd>
        </div>
      </dl>
    </article>
  );
}

function KpiStoryCard({
  title,
  value,
  delta,
  indicatorPercent = 0,
  helperText,
  numericValue,
  formatValue,
  animateValue = false,
  valueDecimals = 0,
}) {
  const hasAnimatedMetric = animateValue && Number.isFinite(Number(numericValue)) && typeof formatValue === 'function';
  const secondaryMetric = Number.isFinite(Number(indicatorPercent)) ? Number(indicatorPercent) : undefined;
  const label = delta?.label || '';
  const helper = delta?.helper || helperText || 'Current snapshot';

  return (
    <DashboardUnifiedKpiCard
      scope={title}
      label={label}
      helperText={helper}
      valueNumeric={hasAnimatedMetric ? Number(numericValue || 0) : undefined}
      valueDecimals={valueDecimals}
      valueText={hasAnimatedMetric ? '' : value}
      formatValue={formatValue}
      secondaryNumeric={secondaryMetric}
      secondaryDecimals={1}
      secondarySuffix="%"
      tone="#0f69ca"
    />
  );
}

function LeadTimeRankingCard({
  title,
  subtitle,
  items = [],
  attentionItems = [],
  attentionLabel = '',
  attentionDescription = '',
  emptyText,
  tr,
  locale,
  onOpenProject,
  className = '',
  compact = false,
}) {
  const [showAttentionList, setShowAttentionList] = useState(false);
  const maxDuration = items.reduce(
    (max, item) => Math.max(max, Number(item?.durationDays || 0)),
    1,
  );

  return (
    <article className={`${ui.card.base} dashboard-card p-3 space-y-2 ${className}`}>
      <div className="dashboard-leadtime-card-head">
        <div className="space-y-1 min-w-0">
          <h4 className="text-base font-semibold text-foreground">{title}</h4>
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        </div>
        {attentionItems.length ? (
          <button
            type="button"
            className={`dashboard-leadtime-attention-btn ${showAttentionList ? 'is-open' : ''}`}
            onClick={() => setShowAttentionList(prev => !prev)}
            title={attentionDescription || attentionLabel || ''}
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            <span>{attentionLabel || tr('Missing due date', 'Sem due date')}</span>
            <strong>{attentionItems.length}</strong>
          </button>
        ) : null}
      </div>

      {attentionItems.length && showAttentionList ? (
        <div className="dashboard-leadtime-attention-list">
          {attentionItems.map(item => (
            <button
              key={`leadtime-attention-${item.id}`}
              type="button"
              className={`dashboard-leadtime-attention-row ${onOpenProject ? 'is-clickable' : ''}`}
              onClick={() => onOpenProject?.(String(item.id))}
              title={item?.title || ''}
            >
              <span className="dashboard-leadtime-attention-title">
                {item?.title || tr('Untitled project', 'Projeto sem titulo')}
              </span>
              <span className="dashboard-leadtime-attention-owner">
                {item?.employeeName || tr('Unassigned', 'Sem responsavel')}
              </span>
            </button>
          ))}
        </div>
      ) : null}

      {items.length ? (
        <div className="space-y-2 dashboard-leadtime-list">
          {items.map(item => {
            const duration = Number(item.durationDays || 0);
            const barPercent = Math.max(8, Math.round((duration / maxDuration) * 100));
            const statusMeta = getStatusMeta(item.status || 'TODO');
            const tooltip = tr(
              `Start: ${item.startRef || 'N/A'} | End: ${item.endRef || 'N/A'} | Duration: ${duration} days`,
              `Inicio: ${item.startRef || 'N/A'} | Fim: ${item.endRef || 'N/A'} | Duração: ${duration} dias`,
            );

            return (
              <button
                key={`lead-${title}-${item.id}`}
                type="button"
                title={tooltip}
                onClick={() => onOpenProject?.(String(item.id))}
                className={`dashboard-leadtime-row w-full text-left ${onOpenProject ? 'is-clickable' : ''} ${compact ? 'is-compact' : ''}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-foreground truncate" title={item.title || ''}>
                    {item.title || tr('Untitled project', 'Projeto sem titulo')}
                  </p>
                  <div className="flex items-center gap-2">
                    {compact ? (
                      <span
                        className="dashboard-leadtime-inline-status"
                        style={{ '--dashboard-leadtime-status-color': statusMeta.color }}
                      >
                        {statusMeta.label}
                      </span>
                    ) : null}
                    <span className="text-xs font-semibold text-foreground whitespace-nowrap">
                      {formatDurationLabel(duration, tr, { locale })}
                    </span>
                  </div>
                </div>
                <div className="dashboard-leadtime-track">
                  <span
                    className="dashboard-leadtime-fill"
                    style={{ width: `${barPercent}%`, backgroundColor: statusMeta.color }}
                  />
                </div>
                {!compact ? (
                  <p className="text-[11px] text-muted-foreground mt-1 truncate">
                    {item.employeeName || tr('Unassigned', 'Sem responsavel')} - {statusMeta.label}
                  </p>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{emptyText}</p>
      )}
    </article>
  );
}

function LeadTimeUpcomingTreeCard({
  items = [],
  tr,
  locale,
  onOpenProject,
  className = '',
}) {
  return (
    <article className={`${ui.card.base} dashboard-card dashboard-leadtime-tree-card p-4 ${className}`}>
      <div className="space-y-1">
        <h4 className="dashboard-leadtime-tree-heading text-base font-semibold text-foreground">
          {tr('Upcoming completion tree', 'Árvore de próximas conclusões')}
        </h4>
        <p className="text-xs text-muted-foreground">
          {tr(
            'Planned completion milestones with project and expected gain.',
            'Marcos de conclusão prevista com projeto e ganho esperado.',
          )}
        </p>
      </div>

      {items.length ? (
        <ol className="dashboard-leadtime-tree-list">
          {items.map(item => {
            const isClickable = typeof onOpenProject === 'function';
            const statusMeta = getStatusMeta(item?.status || 'TODO');
            const normalizedStatus = String(item?.status || '')
              .trim()
              .toUpperCase()
              .replace(/\s+/g, '_');
            const statusVariant = normalizedStatus === 'DONE'
              ? 'done'
              : (normalizedStatus === 'IN_PROGRESS' || normalizedStatus === 'REVIEW')
                ? 'in-progress'
                : 'next';
            const timelineLabel = statusVariant === 'done'
              ? 'DONE'
              : statusVariant === 'in-progress'
                ? 'IN PROGRESS'
                : 'NEXT';
            const dateLabel = item?.plannedDate
              ? formatDateLabel(item.plannedDate, locale)
              : tr('Date not set', 'Data não definida');

            return (
              <li
                key={`upcoming-${item.id}-${item.plannedDate || 'na'}`}
                className={`dashboard-leadtime-tree-row-wrap is-${statusVariant}`}
              >
                <button
                  type="button"
                  className={`dashboard-leadtime-tree-row ${isClickable ? 'is-clickable' : ''}`}
                  onClick={() => onOpenProject?.(String(item.id))}
                  title={item?.title || ''}
                >
                  <div className="dashboard-leadtime-tree-head">
                    <span className="dashboard-leadtime-tree-date">{dateLabel}</span>
                    <span
                      className={`dashboard-leadtime-tree-status is-${statusVariant}`}
                      style={{ '--dashboard-leadtime-status-color': statusMeta.color }}
                    >
                      {timelineLabel}
                    </span>
                  </div>

                  <p className="dashboard-leadtime-tree-title" title={item?.title || ''}>
                    {item?.title || tr('Untitled project', 'Projeto sem título')}
                  </p>

                  <div className="dashboard-leadtime-tree-meta">
                    <span className="truncate" title={item?.employeeName || tr('Unassigned', 'Sem responsável')}>
                      {item?.employeeName || tr('Unassigned', 'Sem responsável')}
                    </span>
                  </div>
                </button>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="text-sm text-muted-foreground">
          {tr(
            'No upcoming completion milestones found for current filters.',
            'Nenhum marco de conclusão encontrado para os filtros atuais.',
          )}
        </p>
      )}
    </article>
  );
}

function LeadTimeInProgressTableCard({
  items = [],
  tr,
  locale,
  onOpenProject,
  className = '',
}) {
  return (
    <article className={`${ui.card.base} dashboard-card dashboard-leadtime-open-table-card p-3 ${className}`}>
      <div className="space-y-1">
        <h4 className="text-sm font-semibold text-foreground">
          {tr('In Progress aging', 'Projetos em andamento')}
        </h4>
        <p className="text-xs text-muted-foreground">
          {tr(
            'Projects currently in progress and days open.',
            'Projetos em andamento e dias em aberto.',
          )}
        </p>
      </div>

      {items.length ? (
        <div className="dashboard-leadtime-open-table-wrap">
          <table className="dashboard-leadtime-open-table">
            <thead>
              <tr>
                <th>{tr('Project', 'Projeto')}</th>
                <th>{tr('Open', 'Em aberto')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map(item => {
                const duration = Number(item?.durationDays || 0);
                return (
                  <tr
                    key={`lead-open-${item.id}`}
                    className={onOpenProject ? 'is-clickable' : ''}
                    onClick={() => onOpenProject?.(String(item.id))}
                    title={item?.title || ''}
                  >
                    <td>
                      <span className="dashboard-leadtime-open-title">
                        {item?.title || tr('Untitled project', 'Projeto sem título')}
                      </span>
                    </td>
                    <td>{formatDurationLabel(duration, tr, { locale })}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          {tr(
            'No projects currently in progress for this filter set.',
            'Sem projetos em andamento para os filtros atuais.',
          )}
        </p>
      )}
    </article>
  );
}

function DashboardUnifiedKpiCard({
  scope,
  label,
  valueNumeric,
  valueDecimals = 0,
  valueText = '',
  formatValue,
  secondaryNumeric,
  secondaryDecimals = 1,
  secondaryText = '',
  secondarySuffix = '%',
  helperText = '',
  tone = '#0f69ca',
  locale = 'en-US',
  index = 0,
  className = '',
}) {
  const hasNumericValue = Number.isFinite(Number(valueNumeric));
  const safeValue = hasNumericValue ? Number(valueNumeric) : 0;
  const animatedValue = useAnimatedNumber(safeValue, {
    duration: 560 + (index * 110),
    decimals: valueDecimals,
    enabled: hasNumericValue && typeof formatValue === 'function',
  });

  const hasSecondaryNumeric = Number.isFinite(Number(secondaryNumeric));
  const safeSecondary = hasSecondaryNumeric ? Number(secondaryNumeric) : 0;
  const animatedSecondary = useAnimatedNumber(safeSecondary, {
    duration: 680 + (index * 120),
    decimals: secondaryDecimals,
    enabled: hasSecondaryNumeric,
  });

  const renderedMainValue = hasNumericValue && typeof formatValue === 'function'
    ? formatValue(animatedValue)
    : String(valueText || '');
  const renderedSecondaryValue = hasSecondaryNumeric
    ? `${new Intl.NumberFormat(locale, {
      minimumFractionDigits: secondaryDecimals,
      maximumFractionDigits: secondaryDecimals,
    }).format(animatedSecondary)}${secondarySuffix}`
    : String(secondaryText || '');

  return (
    <article
      className={`${ui.card.base} dashboard-card dashboard-priority-kpi-card ${className}`}
      style={{ '--dashboard-kpi-tone': tone }}
    >
      <div className="dashboard-priority-kpi-copy">
        {scope ? <p className="dashboard-priority-kpi-scope">{scope}</p> : null}
        {label ? <p className="dashboard-priority-kpi-label" title={label}>{label}</p> : null}
        {helperText ? <p className="dashboard-priority-kpi-helper" title={helperText}>{helperText}</p> : null}
      </div>
      <div className="dashboard-priority-kpi-metrics">
        <p className="dashboard-priority-kpi-value">{renderedMainValue}</p>
        {renderedSecondaryValue ? <p className="dashboard-priority-kpi-share">{renderedSecondaryValue}</p> : null}
      </div>
    </article>
  );
}

function DistributionHighlightCard({
  highlight,
  index = 0,
  locale = 'en-US',
  formatCountValue,
}) {
  const numericValue = Number(highlight?.value || 0);
  const percentageValue = parsePercentageNumber(highlight?.percentage);
  return (
    <DashboardUnifiedKpiCard
      scope={highlight.scope}
      label={highlight.label}
      valueNumeric={numericValue}
      valueDecimals={0}
      formatValue={val => formatCountValue(Math.round(val))}
      secondaryNumeric={percentageValue}
      secondaryDecimals={1}
      secondarySuffix="%"
      tone="#0f69ca"
      locale={locale}
      index={index}
    />
  );
}

function DriverPanel({
  title,
  subtitle,
  children,
  details = [],
  open,
  onToggle,
  detailLabel = 'Detailed breakdown',
  className = '',
  compact = false,
}) {
  return (
    <article className={`${ui.card.base} dashboard-card dashboard-driver-panel ${compact ? 'p-3 space-y-2' : 'p-4 space-y-3'} ${className}`}>
      <div className="space-y-1">
        <h4 className="text-base font-semibold text-foreground">{title}</h4>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </div>
      <div className="dashboard-driver-panel-body">
        {children}
      </div>
      {details.length > 0 ? (
        <div className="pt-1 border-t border-border/60">
          <button type="button" onClick={onToggle} className="w-full inline-flex items-center justify-between text-xs font-semibold text-muted-foreground hover:text-foreground transition">
            <span>{detailLabel}</span>
            <ChevronDown className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`} />
          </button>
          {open ? (
            <div className="dashboard-driver-panel-details mt-2 space-y-1.5">
              {details.slice(0, 6).map(item => (
                <div key={`${title}-${item.label}`} className="rounded-lg border border-border/60 bg-muted/35 px-2.5 py-1.5 flex items-center justify-between text-xs">
                  <span className="text-foreground/90 truncate pr-2">{item.label}</span>
                  <span className="font-semibold text-foreground">
                    {item.value} <span className="text-muted-foreground font-medium">({item.percentage})</span>
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function InsightCard({ severity = 'info', severityLabel = 'info', title, description, className = '' }) {
  const toneMap = {
    info: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
    warn: 'border-amber-500/45 bg-amber-500/12 text-amber-300',
    critical: 'border-rose-500/45 bg-rose-500/12 text-rose-300',
  };
  const tone = toneMap[severity] || toneMap.info;

  return (
    <article className={`${ui.card.base} dashboard-card p-4 ${className}`}>
      <div className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] ${tone}`}>
        <AlertTriangle className="w-3.5 h-3.5" />
        {severityLabel}
      </div>
      <h4 className="text-sm font-semibold text-foreground mt-2">{title}</h4>
      <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{description}</p>
    </article>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-4 dashboard-skeleton-shell">
      <div className={`${ui.card.glass} h-24 skeleton-shimmer`} />
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {Array.from({ length: 6 }).map((_, idx) => <div key={idx} className={`${ui.card.base} h-36 skeleton-shimmer`} />)}
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-3">
        <div className={`${ui.card.base} h-72 xl:col-span-4 skeleton-shimmer`} />
        <div className={`${ui.card.base} h-72 xl:col-span-4 skeleton-shimmer`} />
        <div className={`${ui.card.base} h-72 xl:col-span-4 skeleton-shimmer`} />
      </div>
      <div className={`${ui.card.base} h-80 skeleton-shimmer`} />
    </div>
  );
}

export default function Dashboard({
  onChartClick,
  theme,
  language = 'en',
  filters,
  onOpenProjects,
  onOpenRoadmap,
  onOpenImport,
  onOpenProject,
  isInteractionBlocked = false,
}) {
  const isPtBr = language === 'pt-BR';
  const locale = isPtBr ? 'pt-BR' : 'en-US';
  const tr = (enText, ptBrText) => (isPtBr ? ptBrText : enText);
  const [currencyMode, setCurrencyMode] = useState('BRL');
  const isUsdMode = currencyMode === 'USD';
  const formatCurrencyValue = useCallback(
    (value) => formatCurrency(value, locale, { currencyMode, usdRate: USD_BRL_RATE }),
    [currencyMode, locale],
  );
  const formatCurrencyCompactValue = useCallback(
    (value) => formatCurrencyCompact(value, locale, { currencyMode, usdRate: USD_BRL_RATE }),
    [currencyMode, locale],
  );
  const formatCountValue = useCallback((value) => formatCount(value, locale), [locale]);

  const statusRef = useRef(null);
  const impactRef = useRef(null);
  const kaizenRef = useRef(null);
  const areaRef = useRef(null);
  const assigneeRef = useRef(null);
  const costRef = useRef(null);
  const funnelRef = useRef(null);
  const gaugeRef = useRef(null);
  const charts = useRef({});

  const [loading, setLoading] = useState(true);
  const [costLoading, setCostLoading] = useState(true);
  const [error, setError] = useState('');
  const [leadTimeError, setLeadTimeError] = useState('');
  const [kpiData, setKpiData] = useState(null);
  const [comparisonKpiData, setComparisonKpiData] = useState(null);
  const [chartsData, setChartsData] = useState(null);
  const [leadTimeData, setLeadTimeData] = useState(null);
  const [costData, setCostData] = useState(null);
  const [costMatrixData, setCostMatrixData] = useState(null);
  const [costMatrixLoading, setCostMatrixLoading] = useState(true);
  const [costDrilldown, setCostDrilldown] = useState({ level: 'year', year: null });
  const [dashboardView, setDashboardView] = useState('pulse');
  const [isMiniNavCollapsed, setIsMiniNavCollapsed] = useState(false);
  const [isInfoModalOpen, setIsInfoModalOpen] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const dashboardShellRef = useRef(null);
  const [navAnchorRect, setNavAnchorRect] = useState({ left: 0, width: 0 });
  const updateNavAnchor = useCallback(() => {
    const element = dashboardShellRef.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    setNavAnchorRect(prev => {
      const nextLeft = rect.left;
      const nextWidth = rect.width;
      if (Math.abs(prev.left - nextLeft) < 1 && Math.abs(prev.width - nextWidth) < 1) {
        return prev;
      }
      return { left: nextLeft, width: nextWidth };
    });
  }, []);

  const dashboardViews = useMemo(
    () => [
      { key: 'pulse', label: tr('Pulse', 'Pulso'), icon: Sparkles },
      { key: 'leadtime', label: tr('Lead Time', 'Lead Time'), icon: Clock3 },
      { key: 'distribution', label: tr('Distribution', 'Distribuição'), icon: Target },
    ],
    [tr],
  );

  const periodMeta = useMemo(
    () => buildPeriodMeta(filters, { locale, tr }),
    [filters?.search, filters?.dateFrom, filters?.dateTo, locale, language],
  );

  const currentQuery = useMemo(
    () => buildQueryString(filters),
    [
      filters?.search,
      filters?.dateFrom,
      filters?.dateTo,
      (filters?.statuses || []).join('|'),
      (filters?.earningStatuses || []).join('|'),
      Boolean(filters?.unscheduled),
      (filters?.committeeImpacts || []).join('|'),
      (filters?.kaizenCategories || []).join('|'),
      (filters?.priorities || []).join('|'),
    ],
  );

  const normalizedEarningStatuses = useMemo(
    () => normalizeSelectedEarningStatuses(filters?.earningStatuses),
    [(filters?.earningStatuses || []).join('|')],
  );

  const pulseRealizedTotal = useMemo(
    () => (Array.isArray(costData?.values) ? costData.values.reduce((sum, value) => sum + (Number(value) || 0), 0) : 0),
    [costData],
  );

  const pulseProjectedTotal = useMemo(
    () => (Array.isArray(costData?.pendingValues) ? costData.pendingValues.reduce((sum, value) => sum + (Number(value) || 0), 0) : 0),
    [costData],
  );

  const effectiveFinancial = useMemo(() => {
    const base = kpiData?.financial || {};
    if (dashboardView !== 'pulse') return base;

    const estimated = Number(base.estimado || 0);
    const realized = Number(pulseRealizedTotal || 0);
    const diff = realized - estimated;

    return {
      ...base,
      realizado: realized,
      projectedByPeriod: Number(pulseProjectedTotal || 0),
      performanceDiff: Math.abs(diff),
      performanceType: diff >= 0 ? 'up' : 'down',
    };
  }, [dashboardView, kpiData, pulseProjectedTotal, pulseRealizedTotal]);

  const costQuery = useMemo(() => {
    const params = new URLSearchParams(currentQuery);
    if (dashboardView === 'pulse') params.set('dateMode', 'earning');
    else params.delete('dateMode');
    if (normalizedEarningStatuses.length) {
      params.set('earningStatuses', normalizedEarningStatuses.join(','));
    } else {
      params.delete('earningStatuses');
    }
    if (costDrilldown.year) params.set('year', String(costDrilldown.year));
    else params.delete('year');
    return params.toString();
  }, [currentQuery, costDrilldown.year, normalizedEarningStatuses.join('|'), dashboardView]);

  const costMatrixQuery = useMemo(() => {
    const params = new URLSearchParams(currentQuery);
    if (dashboardView === 'pulse') params.set('dateMode', 'earning');
    else params.delete('dateMode');
    if (normalizedEarningStatuses.length) {
      params.set('earningStatuses', normalizedEarningStatuses.join(','));
    } else {
      params.delete('earningStatuses');
    }
    if (costDrilldown.level === 'month' && costDrilldown.year) params.set('year', String(costDrilldown.year));
    else params.delete('year');
    params.set('top', 'all');
    return params.toString();
  }, [currentQuery, costDrilldown.level, costDrilldown.year, normalizedEarningStatuses.join('|'), dashboardView]);

  useEffect(() => {
    setCostDrilldown({ level: 'year', year: null });
  }, [currentQuery]);

  useEffect(() => {
    const onRefresh = () => setRefreshTick(prev => prev + 1);
    window.addEventListener('dashboard:refresh', onRefresh);
    return () => window.removeEventListener('dashboard:refresh', onRefresh);
  }, []);

  useEffect(() => {
    let active = true;

    async function fetchDashboardData() {
      setLoading(true);
      setError('');
      setLeadTimeError('');
      try {
        const leadTimeRequest = getDashboardLeadTime(currentQuery)
          .then(payload => ({ payload, error: '' }))
          .catch(fetchError => {
            console.error('Lead time endpoint failed:', fetchError);
            return {
              payload: null,
              error: fetchError?.message || tr(
                'Lead Time endpoint unavailable. Please update/restart backend.',
                'Endpoint de Lead Time indisponível. Atualize/reinicie o backend.',
              ),
            };
          });

        const requests = [
          getDashboardKpis(currentQuery),
          getDashboardCharts(currentQuery),
          leadTimeRequest,
        ];
        if (periodMeta.hasComparison && periodMeta.comparisonQuery) {
          requests.push(getDashboardKpis(periodMeta.comparisonQuery));
        }

        const [kpis, chartPayload, leadResponse, comparisonPayload] = await Promise.all(requests);
        if (!active) return;
        setKpiData(kpis);
        setChartsData(chartPayload);
        setLeadTimeData(leadResponse?.payload || null);
        setLeadTimeError(leadResponse?.error || '');
        setComparisonKpiData(periodMeta.hasComparison ? comparisonPayload || null : null);
      } catch (fetchError) {
        if (!active) return;
        setError(fetchError?.message || tr('Failed to load KPI dashboard data.', 'Falha ao carregar dados de KPI do dashboard.'));
      } finally {
        if (active) setLoading(false);
      }
    }

    fetchDashboardData();
    return () => {
      active = false;
    };
  }, [currentQuery, periodMeta.hasComparison, periodMeta.comparisonQuery, refreshTick]);

  useEffect(() => {
    let active = true;

    async function fetchCosts() {
      setCostLoading(true);
      setCostMatrixLoading(true);
      try {
        const [costResult, matrixResult] = await Promise.allSettled([
          getDashboardCosts(costQuery),
          getDashboardCostsMatrix(costMatrixQuery),
        ]);
        if (!active) return;
        if (costResult.status === 'fulfilled') {
          const sanitizedCost = sanitizeCostPayloadByEarningStatus(
            costResult.value,
            normalizedEarningStatuses,
          );
          setCostData(sanitizedCost);
        } else {
          throw costResult.reason;
        }

        if (matrixResult.status === 'fulfilled') {
          const sanitizedMatrix = sanitizeCostMatrixByEarningStatus(
            matrixResult.value,
            normalizedEarningStatuses,
          );
          setCostMatrixData(sanitizedMatrix);
        } else {
          console.error('Matrix endpoint failed:', matrixResult.reason);
          setCostMatrixData(null);
        }
      } catch (fetchError) {
        if (!active) return;
        setError(fetchError?.message || tr('Failed to load trend data.', 'Falha ao carregar dados de tendência.'));
      } finally {
        if (active) {
          setCostLoading(false);
          setCostMatrixLoading(false);
        }
      }
    }

    fetchCosts();
    return () => {
      active = false;
    };
  }, [costQuery, costMatrixQuery, refreshTick, normalizedEarningStatuses.join('|')]);

  useLayoutEffect(() => {
    let raf1 = 0;
    let raf2 = 0;
    updateNavAnchor();
    raf1 = window.requestAnimationFrame(() => {
      updateNavAnchor();
      raf2 = window.requestAnimationFrame(updateNavAnchor);
    });
    return () => {
      if (raf1) window.cancelAnimationFrame(raf1);
      if (raf2) window.cancelAnimationFrame(raf2);
    };
  }, [updateNavAnchor, dashboardView, isMiniNavCollapsed, loading]);

  useEffect(() => {
    updateNavAnchor();
    window.addEventListener('resize', updateNavAnchor);
    window.addEventListener('scroll', updateNavAnchor, true);

    let observer;
    if (dashboardShellRef.current && typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(updateNavAnchor);
      observer.observe(dashboardShellRef.current);
    }

    const fontsReady = document?.fonts?.ready;
    if (fontsReady && typeof fontsReady.then === 'function') {
      fontsReady.then(() => updateNavAnchor()).catch(() => {});
    }

    return () => {
      window.removeEventListener('resize', updateNavAnchor);
      window.removeEventListener('scroll', updateNavAnchor, true);
      observer?.disconnect?.();
    };
  }, [updateNavAnchor, dashboardView, isMiniNavCollapsed]);
  useEffect(() => {
    if (!chartsData || !costData) return undefined;

    Object.values(charts.current).forEach(chartInstance => chartInstance?.destroy?.());
    charts.current = {};

    const isDark = theme === 'dark';
    const textColor = isDark ? '#e2e8f0' : '#334155';
    const secondaryTextColor = isDark ? '#94a3b8' : '#6b7280';
    const gridColor = isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.05)';
    const radarGridColor = isDark ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.1)';

    Chart.defaults.font.family = "'Manrope', sans-serif";
    Chart.defaults.font.size = 12;
    Chart.defaults.color = secondaryTextColor;
    Chart.defaults.devicePixelRatio = 2;

    const statusItemsRaw = Array.isArray(chartsData?.status?.items) ? chartsData.status.items : [];
    const impactItemsRaw = Array.isArray(chartsData?.impact?.items) ? chartsData.impact.items : [];
    const financial = effectiveFinancial || {};
    const statusItemsSorted = [...statusItemsRaw].sort((a, b) => Number(b.value || 0) - Number(a.value || 0));
    const impactItemsSorted = [...impactItemsRaw].sort((a, b) => Number(b.value || 0) - Number(a.value || 0));

    if (statusRef.current) {
      charts.current.status = new Chart(statusRef.current, {
        type: 'doughnut',
        data: {
          labels: statusItemsSorted.map(item => getStatusMeta(item.label).label),
          datasets: [
            {
              data: statusItemsSorted.map(item => item.value),
              backgroundColor: statusItemsSorted.map(item => getStatusMeta(item.label).color),
              borderColor: isDark ? '#1e293b' : '#fff',
              borderWidth: 2,
            },
          ],
        },
        options: {
          maintainAspectRatio: false,
          radius: '84%',
          cutout: '74%',
          layout: {
            padding: { top: 6, bottom: 6, left: 6, right: 6 },
          },
          plugins: {
            legend: { display: false },
            datalabels: { display: false },
          },
          onClick: (event, elements) => onChartClick?.('status', event, elements),
        },
      });
    }

    if (impactRef.current) {
      charts.current.impact = new Chart(impactRef.current, {
        type: 'doughnut',
        data: {
          labels: impactItemsSorted.map(item => item.label),
          datasets: [
            {
              data: impactItemsSorted.map(item => item.value),
              backgroundColor: impactItemsSorted.map((_, index) => PALETTE[index % PALETTE.length]),
              borderColor: isDark ? '#1e293b' : '#fff',
              borderWidth: 2,
            },
          ],
        },
        options: {
          maintainAspectRatio: false,
          radius: '84%',
          cutout: '74%',
          layout: {
            padding: { top: 6, bottom: 6, left: 6, right: 6 },
          },
          plugins: {
            legend: { display: false },
            datalabels: { display: false },
          },
          onClick: (event, elements) => onChartClick?.('impactoComite', event, elements),
        },
      });
    }
    if (funnelRef.current) {
      charts.current.funnel = new Chart(funnelRef.current, {
        type: 'bar',
        data: {
          labels: statusItemsSorted.map(item => getStatusMeta(item.label).label),
          datasets: [
            {
              label: tr('Projects by status', 'Projetos por status'),
              data: statusItemsSorted.map(item => Number(item.value || 0)),
              backgroundColor: statusItemsSorted.map(item => getStatusMeta(item.label).color),
              borderRadius: 3,
              borderSkipped: false,
              barPercentage: 0.72,
              categoryPercentage: 0.8,
            },
          ],
        },
        options: {
          maintainAspectRatio: false,
          indexAxis: 'y',
          plugins: {
            legend: { display: false },
            datalabels: {
              anchor: 'end',
              align: 'right',
              color: textColor,
              formatter: value => formatCount(value, locale),
              font: { weight: '700' },
            },
          },
          scales: {
            x: {
              ticks: { color: secondaryTextColor },
              grid: { color: gridColor },
              border: { display: false },
            },
            y: {
              ticks: { color: textColor, font: { weight: '600' } },
              grid: { display: false },
              border: { display: false },
            },
          },
          onClick: (event, elements) => onChartClick?.('status', event, elements),
        },
      });
    }

    if (gaugeRef.current) {
      const estimated = Number(financial.estimado || 0);
      const realized = Number(financial.realizado || 0);
      const ratio = estimated > 0 ? Math.max(0, Math.min((realized / estimated) * 100, 100)) : 0;
      charts.current.gauge = new Chart(gaugeRef.current, {
        type: 'doughnut',
        data: {
          labels: [tr('Realization', 'Realização'), tr('Remaining', 'Restante')],
          datasets: [
            {
              data: [ratio, Math.max(0, 100 - ratio)],
              backgroundColor: [
                STATUS_COLORS.Done || '#24A676',
                isDark ? 'rgba(148, 163, 184, 0.22)' : 'rgba(100, 116, 139, 0.2)',
              ],
              borderWidth: 0,
            },
          ],
        },
        options: {
          maintainAspectRatio: false,
          circumference: 180,
          rotation: -90,
          cutout: '78%',
          plugins: {
            legend: { display: false },
            datalabels: { display: false },
            tooltip: {
              callbacks: {
                label: context => `${context.label}: ${Number(context.raw || 0).toFixed(1)}%`,
              },
            },
          },
        },
      });
    }

    if (kaizenRef.current) {
      const kaizenValues = Array.isArray(chartsData?.kaizen?.data)
        ? chartsData.kaizen.data.map(item => Number(item || 0))
        : [];
      const kaizenMax = Math.max(...kaizenValues, 1);
      charts.current.kaizen = new Chart(kaizenRef.current, {
        type: 'radar',
        data: {
          labels: chartsData?.kaizen?.labels || [],
          datasets: [
            {
              label: tr('Projects', 'Projetos'),
              data: chartsData?.kaizen?.data || [],
              backgroundColor: 'rgba(51, 235, 163, 0.2)',
              borderColor: STATUS_COLORS.Done || '#33EBA3',
              borderWidth: 2,
              pointBackgroundColor: STATUS_COLORS.Done || '#33EBA3',
              pointRadius: 3,
            },
          ],
        },
        options: {
          maintainAspectRatio: false,
          layout: { padding: { top: 4, right: 10, bottom: 4, left: 10 } },
          scales: {
            r: {
              angleLines: { color: radarGridColor },
              grid: { color: radarGridColor },
              ticks: { display: false, backdropColor: 'transparent' },
              pointLabels: { color: textColor, font: { size: 13, weight: '700' } },
              suggestedMin: 0,
              suggestedMax: Math.ceil(kaizenMax * 1.08),
            },
          },
          plugins: {
            legend: { display: false },
            datalabels: {
              display: true,
              color: textColor,
              formatter: value => (Number(value || 0) > 0 ? formatCount(value, locale) : null),
              font: { size: 10, weight: '700' },
              align: 'top',
              anchor: 'end',
              offset: 2,
            },
          },
          onClick: (event, elements) => onChartClick?.('categoriaKaizen', event, elements),
        },
      });
    }

    const areaRows = (chartsData?.area?.labels || [])
      .map((label, index) => ({
        label,
        done: Number(chartsData?.area?.done?.[index] || 0),
        inProgress: Number(chartsData?.area?.inProgress?.[index] || 0),
      }))
      .map(item => ({ ...item, total: item.done + item.inProgress }))
      .filter(item => item.total > 0)
      .sort((a, b) => b.total - a.total)
      .slice(0, 8);

    if (areaRef.current) {
      charts.current.area = new Chart(areaRef.current, {
        type: 'bar',
        data: {
          labels: areaRows.map(item => item.label),
          datasets: [
            {
              label: tr('Done', 'Concluído'),
              data: areaRows.map(item => item.done),
              backgroundColor: `${STATUS_COLORS.Done || '#33EBA3'}D0`,
              borderColor: STATUS_COLORS.Done || '#33EBA3',
              borderWidth: 1,
              borderRadius: 3,
              borderSkipped: false,
              barThickness: 16,
              maxBarThickness: 18,
            },
            {
              label: tr('In Progress', 'Em andamento'),
              data: areaRows.map(item => item.inProgress),
              backgroundColor: `${STATUS_COLORS['In Progress'] || '#7C7AD5'}D0`,
              borderColor: STATUS_COLORS['In Progress'] || '#7C7AD5',
              borderWidth: 1,
              borderRadius: 3,
              borderSkipped: false,
              barThickness: 16,
              maxBarThickness: 18,
            },
          ],
        },
        options: {
          maintainAspectRatio: false,
          plugins: {
            legend: { position: 'bottom', labels: { color: textColor } },
            datalabels: {
              display: true,
              color: textColor,
              anchor: 'end',
              align: 'top',
              formatter: value => (Number(value || 0) > 0 ? formatCount(value, locale) : null),
              font: { size: 10, weight: '700' },
            },
          },
          scales: {
            x: {
              ticks: {
                color: secondaryTextColor,
                maxRotation: 25,
                minRotation: 0,
              },
              grid: { display: false },
              border: { display: false },
            },
            y: {
              beginAtZero: true,
              ticks: { color: secondaryTextColor, precision: 0 },
              grid: { color: gridColor },
              border: { display: false },
            },
          },
          onClick: (event, elements) => onChartClick?.('areaGrupo', event, elements),
        },
      });
    }

    const assigneeRows = (chartsData?.assignee?.labels || [])
      .map((label, index) => ({
        label,
        done: Number(chartsData?.assignee?.done?.[index] || 0),
        inProgress: Number(chartsData?.assignee?.inProgress?.[index] || 0),
        todo: Number(chartsData?.assignee?.todo?.[index] || 0),
      }))
      .map(item => ({ ...item, total: item.done + item.inProgress + item.todo }))
      .filter(item => item.total > 0)
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);

    if (assigneeRef.current) {
      charts.current.assignee = new Chart(assigneeRef.current, {
        type: 'bar',
        data: {
          labels: assigneeRows.map(item => item.label),
          datasets: [
            {
              label: tr('Done', 'Concluído'),
              data: assigneeRows.map(item => item.done),
              backgroundColor: `${STATUS_COLORS.Done || '#33EBA3'}D0`,
              borderColor: STATUS_COLORS.Done || '#33EBA3',
              borderWidth: 1,
              borderRadius: 3,
              borderSkipped: false,
            },
            {
              label: tr('In Progress', 'Em andamento'),
              data: assigneeRows.map(item => item.inProgress),
              backgroundColor: `${STATUS_COLORS['In Progress'] || '#7C7AD5'}D0`,
              borderColor: STATUS_COLORS['In Progress'] || '#7C7AD5',
              borderWidth: 1,
              borderRadius: 3,
              borderSkipped: false,
            },
            {
              label: tr('To Do', 'A fazer'),
              data: assigneeRows.map(item => item.todo),
              backgroundColor: `${STATUS_COLORS['To Do'] || '#f59e0b'}D0`,
              borderColor: STATUS_COLORS['To Do'] || '#f59e0b',
              borderWidth: 1,
              borderRadius: 3,
              borderSkipped: false,
            },
          ],
        },
        options: {
          maintainAspectRatio: false,
          indexAxis: 'y',
          plugins: {
            legend: { position: 'bottom', labels: { color: textColor } },
            datalabels: {
              display: true,
              color: textColor,
              formatter: value => (Number(value || 0) > 0 ? formatCount(value, locale) : null),
              font: { size: 10, weight: '700' },
              anchor: 'center',
              align: 'center',
            },
          },
          scales: {
            x: {
              stacked: true,
              ticks: { color: secondaryTextColor, precision: 0 },
              grid: { color: gridColor },
              border: { display: false },
            },
            y: {
              stacked: true,
              ticks: {
                color: secondaryTextColor,
                autoSkip: false,
                font: { size: 11 },
                callback: (value, index, ticks) => {
                  const raw = String(assigneeRows[index]?.label || '');
                  return raw;
                },
              },
              grid: { display: false },
              border: { display: false },
            },
          },
          onClick: (event, elements) => {
            if (!elements.length) return;
            const row = assigneeRows[elements[0].index];
            onChartClick?.('employeeName', event, elements, { label: row?.label || '' });
          },
        },
      });
    }

    if (costRef.current) {
      charts.current.cost = new Chart(costRef.current, {
        type: 'bar',
        data: {
          labels: costData?.labels || [],
          datasets: [
            {
              type: 'bar',
              label: tr('Realized Earnings', 'Ganhos realizados'),
              data: costData?.values || [],
              backgroundColor: `${STATUS_COLORS.Done || '#33EBA3'}CC`,
              borderColor: STATUS_COLORS.Done || '#33EBA3',
              borderWidth: 1,
              borderRadius: 3,
              borderSkipped: false,
              stack: 'earnings',
              yAxisID: 'yA',
              order: 3,
            },
            {
              type: 'bar',
              label: tr('Projected Earnings', 'Ganhos previstos'),
              data: costData?.pendingValues || [],
              backgroundColor: 'rgba(127, 139, 160, 0.75)',
              borderColor: 'rgba(127, 139, 160, 1)',
              borderWidth: 1,
              borderRadius: 3,
              borderSkipped: false,
              stack: 'earnings',
              yAxisID: 'yA',
              order: 3,
            },
            {
              type: 'line',
              label: tr('Projects Count', 'Quantidade de projetos'),
              data: costData?.counts || [],
              borderColor: PALETTE[0],
              backgroundColor: 'transparent',
              borderWidth: 2,
              pointRadius: 4,
              pointHoverRadius: 6,
              tension: 0.35,
              fill: false,
              yAxisID: 'yB',
              order: 0,
            },
          ],
        },
        options: {
          maintainAspectRatio: false,
          onClick: (event, elements) => {
            if (!elements.length) return;
            const pointIndex = elements[0].index;

            if (costDrilldown.level === 'year') {
              const selectedYear = Number(costData?.labels?.[pointIndex]);
              if (Number.isFinite(selectedYear)) {
                setCostDrilldown({ level: 'month', year: selectedYear });
              }
              return;
            }

            onChartClick?.('costDrilldown', event, elements, {
              year: costDrilldown.year,
              month: pointIndex + 1,
              label: costData?.labels?.[pointIndex],
            });
          },
          plugins: {
            legend: { position: 'bottom', labels: { color: textColor } },
            datalabels: {
              anchor: 'end',
              align: 'top',
              color: textColor,
              font: { weight: 'bold' },
              formatter: (value, context) => {
                if (context.dataset.type === 'line') return null;
                if (!value) return null;
                return formatCurrencyValue(value);
              },
            },
          },
          scales: {
            x: {
              stacked: true,
              ticks: { color: secondaryTextColor },
              grid: { display: false },
              border: { display: false },
            },
            yA: {
              type: 'linear',
              position: 'left',
              stacked: true,
              grace: '16%',
              ticks: {
                color: secondaryTextColor,
                callback: value => formatCurrencyCompactValue(value),
              },
              grid: { color: gridColor },
              border: { display: false },
            },
            yB: {
              type: 'linear',
              position: 'right',
              ticks: { color: secondaryTextColor, stepSize: 1 },
              grid: { display: false },
              border: { display: false },
            },
          },
        },
      });
    }

    return () => {
      Object.values(charts.current).forEach(chartInstance => chartInstance?.destroy?.());
    };
  }, [chartsData, costData, costDrilldown.level, costDrilldown.year, dashboardView, effectiveFinancial, language, locale, onChartClick, theme, formatCurrencyCompactValue, formatCurrencyValue]);
  const statusItems = useMemo(() => {
    const items = Array.isArray(chartsData?.status?.items) ? chartsData.status.items : [];
    return [...items].sort((a, b) => Number(b.value || 0) - Number(a.value || 0));
  }, [chartsData]);

  const impactItems = useMemo(() => {
    const items = Array.isArray(chartsData?.impact?.items) ? chartsData.impact.items : [];
    const total = items.reduce((sum, item) => sum + Number(item.value || 0), 0);
    return items
      .map(item => ({
        ...item,
        percentage: total > 0 ? `${((Number(item.value || 0) / total) * 100).toFixed(1)}%` : '0.0%',
      }))
      .sort((a, b) => Number(b.value || 0) - Number(a.value || 0));
  }, [chartsData]);

  const kaizenItems = useMemo(() => {
    const labels = Array.isArray(chartsData?.kaizen?.labels) ? chartsData.kaizen.labels : [];
    const values = Array.isArray(chartsData?.kaizen?.data) ? chartsData.kaizen.data : [];
    const total = values.reduce((sum, value) => sum + Number(value || 0), 0);
    return labels
      .map((label, idx) => ({ label, value: Number(values[idx] || 0) }))
      .filter(item => item.value > 0)
      .sort((a, b) => b.value - a.value)
      .map(item => ({
        ...item,
        percentage: total > 0 ? `${((item.value / total) * 100).toFixed(1)}%` : '0.0%',
      }));
  }, [chartsData]);

  const areaRanking = useMemo(() => buildStackRanking(chartsData?.area), [chartsData]);
  const assigneeRanking = useMemo(() => buildStackRanking(chartsData?.assignee), [chartsData]);

  const driverHighlights = useMemo(() => {
    const rows = [];
    if (statusItems[0]) rows.push({ scope: tr('Status', 'Status'), ...statusItems[0], value: Number(statusItems[0].value || 0), percentage: statusItems[0].percentage || '0.0%' });
    if (impactItems[0]) rows.push({ scope: tr('Impact', 'Impacto'), ...impactItems[0], value: Number(impactItems[0].value || 0) });
    if (areaRanking[0]) rows.push({ scope: tr('Area', 'Área'), ...areaRanking[0] });
    if (assigneeRanking[0]) rows.push({ scope: tr('Owner', 'Responsável'), ...assigneeRanking[0] });
    if (kaizenItems[0]) rows.push({ scope: tr('Kaizen', 'Kaizen'), ...kaizenItems[0] });
    return rows.filter(row => row.value > 0).sort((a, b) => b.value - a.value);
  }, [areaRanking, assigneeRanking, impactItems, kaizenItems, statusItems, tr]);

  const trendSummary = useMemo(() => {
    const labels = Array.isArray(costData?.labels) ? costData.labels : [];
    const values = Array.isArray(costData?.values) ? costData.values : [];
    const counts = Array.isArray(costData?.counts) ? costData.counts : [];

    const series = labels
      .map((label, idx) => ({ label, value: Number(values[idx] || 0), count: Number(counts[idx] || 0) }))
      .filter(item => item.value !== 0 || item.count !== 0);

    if (!series.length) return null;

    let latest = series[series.length - 1];
    let previous = series.length > 1 ? series[series.length - 2] : null;
    if (costDrilldown.level === 'year') {
      const currentYear = new Date().getFullYear();
      const currentYearIndex = series.findIndex(item => Number.parseInt(String(item.label), 10) === currentYear);
      if (currentYearIndex >= 0) {
        latest = series[currentYearIndex];
        const previousYearIndex = series.findIndex(item => Number.parseInt(String(item.label), 10) === currentYear - 1);
        if (previousYearIndex >= 0) {
          previous = series[previousYearIndex];
        } else {
          previous = currentYearIndex > 0 ? series[currentYearIndex - 1] : null;
        }
      }
    }
    const peak = series.reduce((best, current) => (current.value > best.value ? current : best), series[0]);

    return { latest, previous, peak, delta: previous ? computeDelta(latest.value, previous.value) : null };
  }, [costData, costDrilldown.level]);

  const dashboardInfoContent = useMemo(() => {
    if (dashboardView === 'leadtime') {
      return {
        title: tr('How Lead Time is calculated', 'Como o Lead Time e calculado'),
        intro: tr(
          'Lead Time reads project lifecycle dates and computes duration in days with strict fallback rules.',
          'Lead Time le datas do ciclo de vida e calcula duração em dias com regras de fallback.',
        ),
        items: [
          {
            metric: tr('Duration basis (all lead-time metrics)', 'Base de duração (todas as metricas de lead time)'),
            formula: tr(
              'startRef = START_DATE || CHEGADA || CREATED_AT; endRef (Done) = COMPLETED_AT || DATA_FIM_PREV || DUE_DATE; endRef (In Progress/Review) = today; durationDays = ceil((endRef - startRef)/1 day), minimum 0.',
              'startRef = START_DATE || CHEGADA || CREATED_AT; endRef (Done) = COMPLETED_AT || DATA_FIM_PREV || DUE_DATE; endRef (Em andamento/Revisao) = hoje; durationDays = ceil((endRef - startRef)/1 dia), minimo 0.',
            ),
            source: tr(
              'Source: PROJECTS date columns + status. Filters are applied before aggregation.',
              'Fonte: colunas de data em PROJECTS + status. Filtros aplicados antes da agregação.',
            ),
            rule: tr(
              'Rows without valid startRef are ignored from lead-time math.',
              'Linhas sem startRef valido sao ignoradas no calculo.',
            ),
          },
          {
            metric: tr('Average and median implementation (completed)', 'Media e mediana de implementação (concluidos)'),
            formula: tr(
              'Average = sum(durationDays of DONE) / count(DONE); Median = middle ordered value of DONE durations.',
              'Media = soma(durationDays de DONE) / count(DONE); Mediana = valor central ordenado das duracoes DONE.',
            ),
            source: tr(
              'Source subset: projects in DONE status after current global filters.',
              'Subconjunto fonte: projetos em DONE apos filtros globais atuais.',
            ),
            rule: tr(
              'Median is less sensitive to outliers; average is sensitive to long-tail projects.',
              'Mediana e menos sensivel a outliers; media e sensivel a cauda longa.',
            ),
          },
          {
            metric: tr('Aging metrics (active flow)', 'Metricas de envelhecimento (fluxo ativo)'),
            formula: tr(
              'Average active age = mean(durationDays of IN_PROGRESS + REVIEW); Peak = max(durationDays) in active flow.',
              'Idade media ativa = media(durationDays de IN_PROGRESS + REVIEW); Pico = max(durationDays) no fluxo ativo.',
            ),
            source: tr(
              'Source subset: IN_PROGRESS + REVIEW rows after global filters.',
              'Subconjunto fonte: linhas IN_PROGRESS + REVIEW apos filtros globais.',
            ),
            rule: tr(
              'Only active stages are considered; DONE rows do not enter aging metrics.',
              'Apenas estagios ativos entram; linhas DONE nao entram.',
            ),
          },
          {
            metric: tr('Top 5 longest completed / active', 'Top 5 mais longos concluido / ativo'),
            formula: tr(
              'Rank by durationDays descending; show first 5 rows for each group.',
              'Ordena por durationDays desc; mostra as 5 primeiras linhas de cada grupo.',
            ),
            source: tr(
              'Same filtered dataset used by the KPI cards.',
              'Mesmo dataset filtrado usado nos cards KPI.',
            ),
            rule: tr(
              'Clicking a row opens the project details card.',
              'Clique na linha abre o card de detalhes do projeto.',
            ),
          },
        ],
      };
    }

    if (dashboardView === 'distribution') {
      return {
        title: tr('How Distribution metrics are calculated', 'Como as metricas de Distribuição sao calculadas'),
        intro: tr(
          'Distribution is a composition layer: it groups project volume by status, impact, area, kaizen and owner.',
          'Distribuição e uma camada de composição: agrupa volume de projetos por status, impacto, area, kaizen e responsavel.',
        ),
        items: [
          {
            metric: tr('Status Mix + Delivery Funnel', 'Status Mix + Funil de entrega'),
            formula: tr(
              'count(projects) grouped by STATUS; percentage = statusCount / totalVisibleProjects.',
              'count(projects) agrupado por STATUS; percentual = statusCount / totalVisibleProjects.',
            ),
            source: tr(
              'Source: filtered PROJECTS rows (excluding ARCHIVED in dashboard queries).',
              'Fonte: linhas PROJECTS filtradas (ARCHIVED excluido nas queries de dashboard).',
            ),
            rule: tr(
              'Bars and donut represent the same status distribution in different visual forms.',
              'Barras e rosca representam a mesma distribuição de status em formas visuais diferentes.',
            ),
          },
          {
            metric: tr('Committee Impact', 'Impacto no Comite'),
            formula: tr(
              'count(projects) grouped by IMPACTO_COMITE; percentage per category = categoryCount / totalVisibleProjects.',
              'count(projects) agrupado por IMPACTO_COMITE; percentual por categoria = categoryCount / totalVisibleProjects.',
            ),
            source: tr(
              'Source field: PROJECTS.IMPACTO_COMITE.',
              'Campo fonte: PROJECTS.IMPACTO_COMITE.',
            ),
            rule: tr(
              'Missing/empty values are bucketed as default category in source mapping.',
              'Valores ausentes/vazios entram em categoria padrao do mapeamento.',
            ),
          },
          {
            metric: tr('Area Contribution', 'Contribuição por area'),
            formula: tr(
              'Top 8 areas by total volume; each area split into Done vs In Progress counts.',
              'Top 8 areas por volume total; cada area dividida em contagens Done vs In Progress.',
            ),
            source: tr(
              'Source field: PROJECTS.AREA_GRUPO + PROJECTS.STATUS.',
              'Campos fonte: PROJECTS.AREA_GRUPO + PROJECTS.STATUS.',
            ),
            rule: tr(
              'Objective is to expose concentration and execution bottlenecks by area.',
              'Objetivo e expor concentração e gargalo de execução por area.',
            ),
          },
          {
            metric: tr('Owner Workload (Top 10)', 'Carga por responsavel (Top 10)'),
            formula: tr(
              'Top 10 owners by total projects; stacked composition by Done, In Progress and To Do.',
              'Top 10 responsaveis por volume total; composição empilhada por Done, In Progress e To Do.',
            ),
            source: tr(
              'Source field: PROJECTS.EMPLOYEE_NAME + STATUS.',
              'Campos fonte: PROJECTS.EMPLOYEE_NAME + STATUS.',
            ),
            rule: tr(
              'Designed to show ownership concentration and execution load.',
              'Desenhado para mostrar concentração de ownership e carga de execução.',
            ),
          },
        ],
      };
    }

    return {
      title: tr('How Pulse metrics are calculated', 'Como as metricas de Pulso sao calculadas'),
      intro: tr(
        'Pulse combines stock KPIs (portfolio size/status) with flow KPIs (financial execution over time).',
        'Pulso combina KPIs de estoque (tamanho/status do portfolio) com KPIs de fluxo (execução financeira no tempo).',
      ),
      items: [
        {
          metric: tr('Total/To Do/In Progress/Completed', 'Total/A fazer/Em andamento/Concluido'),
          formula: tr(
            'Simple counts of visible projects by status bucket.',
            'Contagens simples de projetos visiveis por bucket de status.',
          ),
          source: tr(
            'Source: /api/dashboard/kpis -> counts from filtered PROJECTS.',
            'Fonte: /api/dashboard/kpis -> counts de PROJECTS filtrado.',
          ),
          rule: tr(
            'These cards represent current stock, not velocity.',
            'Esses cards representam estoque atual, nao velocidade.',
          ),
        },
        {
          metric: tr('Estimated Earnings', 'Ganhos estimados'),
          formula: tr(
            'sum(GANHO_ESTIMADO) on filtered PROJECTS.',
            'sum(GANHO_ESTIMADO) em PROJECTS filtrado.',
          ),
          source: tr(
            'Source field: PROJECTS.GANHO_ESTIMADO.',
            'Campo fonte: PROJECTS.GANHO_ESTIMADO.',
          ),
          rule: tr(
            'Represents estimate baseline, independent of earning status timeline.',
            'Representa baseline de estimativa, independente da linha temporal de earning status.',
          ),
        },
        {
          metric: tr('Realized Earnings', 'Ganhos realizados'),
          formula: tr(
            'sum(PROJECT_EARNINGS.VALOR where EARNING_STATUS = REALIZADO).',
            'sum(PROJECT_EARNINGS.VALOR onde EARNING_STATUS = REALIZADO).',
          ),
          source: tr(
            'Source table: PROJECT_EARNINGS aggregated by current filters.',
            'Tabela fonte: PROJECT_EARNINGS agregada pelos filtros atuais.',
          ),
          rule: tr(
            'PREVISTO must not enter this KPI total.',
            'PREVISTO nao entra no total deste KPI.',
          ),
        },
        {
          metric: tr('Trend signal (top narrative card)', 'Sinal de tendência (card narrativo)'),
          formula: tr(
            'latest = current year point (if exists); variation = (latest - previous)/|previous|.',
            'latest = ponto do ano atual (se existir); variação = (latest - previous)/|previous|.',
          ),
          source: tr(
            'Source: annual series from /api/dashboard/costs.',
            'Fonte: serie anual de /api/dashboard/costs.',
          ),
          rule: tr(
            'If current year is missing, uses nearest latest available point.',
            'Se ano atual estiver ausente, usa o ponto mais recente disponivel.',
          ),
        },
        {
          metric: tr('Execution Radar chart', 'Grafico Radar de execução'),
          formula: tr(
            'Bars: realized vs projected values by period; line: project count with defined gain in each period.',
            'Barras: valores realizados vs previstos por periodo; linha: count de projetos com ganho definido em cada periodo.',
          ),
          source: tr(
            'Source: /api/dashboard/costs (labels, values, pendingValues, counts).',
            'Fonte: /api/dashboard/costs (labels, values, pendingValues, counts).',
          ),
          rule: tr(
            'When filtering by earning status, chart must show only selected status values.',
            'Quando filtrar por earning status, o grafico deve mostrar apenas valores do status selecionado.',
          ),
        },
        {
          metric: tr('Earnings Matrix', 'Matriz de ganhos'),
          formula: tr(
            'Rows = period, columns = top projects by absolute value; cell value = sum per (period, project).',
            'Linhas = periodo, colunas = top projetos por valor absoluto; valor da celula = soma por (periodo, projeto).',
          ),
          source: tr(
            'Source: /api/dashboard/costs/matrix.',
            'Fonte: /api/dashboard/costs/matrix.',
          ),
          rule: tr(
            'Color rule: green = REALIZADO, gray = PREVISTO.',
            'Regra de cor: verde = REALIZADO, cinza = PREVISTO.',
          ),
        },
      ],
    };
  }, [dashboardView, tr]);

  const infoButtonLabel = tr('How this screen is calculated', 'Como esta tela e calculada');
  const dashboardInfoFlow = useMemo(() => {
    if (dashboardView === 'leadtime') {
      return [
        { label: tr('Input', 'Entrada'), value: 'PROJECTS (dates + status)' },
        { label: tr('Process', 'Processo'), value: tr('duration by fallback dates', 'duração por datas de fallback') },
        { label: tr('Output', 'Saida'), value: tr('avg/median/aging + top 5', 'media/mediana/envelhecimento + top 5') },
      ];
    }

    if (dashboardView === 'distribution') {
      return [
        { label: tr('Input', 'Entrada'), value: 'PROJECTS (status, area, impact, owner)' },
        { label: tr('Process', 'Processo'), value: tr('grouping + share by category', 'agrupamento + participação por categoria') },
        { label: tr('Output', 'Saida'), value: tr('mix, funnel and concentration', 'mix, funil e concentração') },
      ];
    }

    return [
      { label: tr('Input', 'Entrada'), value: 'PROJECTS + PROJECT_EARNINGS' },
      { label: tr('Process', 'Processo'), value: tr('status and earnings aggregation', 'agregação de status e ganhos') },
      { label: tr('Output', 'Saida'), value: tr('kpi cards + trend + matrix', 'cards kpi + tendência + matriz') },
    ];
  }, [dashboardView, tr]);

  const executiveCards = useMemo(() => {
    if (!kpiData) return [];

    const counts = kpiData.counts || {};
    const financial = effectiveFinancial || {};
    const compareCounts = comparisonKpiData?.counts || null;
    const compareFinancial = comparisonKpiData?.financial || null;

    const countMax = Math.max(Number(counts.total || 0), Number(counts.todo || 0), Number(counts.inProgress || 0), Number(counts.done || 0), 1);
    const moneyMax = Math.max(Number(financial.estimado || 0), Number(financial.realizado || 0), 1);

    const countDelta = (current, previous) => {
      const delta = computeDelta(current, previous);
      if (!delta) return null;
      return {
        type: delta.type,
        label: `${delta.sign}${formatCountValue(delta.absDiff)}${delta.percentLabel ? ` (${delta.percentLabel})` : ''}`,
        helper: tr('vs previous period', 'vs período anterior'),
      };
    };

    const moneyDelta = (current, previous) => {
      const delta = computeDelta(current, previous);
      if (!delta) return null;
      return {
        type: delta.type,
        label: `${delta.sign}${formatCurrencyValue(delta.absDiff)}${delta.percentLabel ? ` (${delta.percentLabel})` : ''}`,
        helper: tr('vs previous period', 'vs período anterior'),
      };
    };

    const realizedFallback =
      !compareFinancial && Number(financial.performanceDiff || 0) > 0
        ? {
            type: financial.performanceType === 'up' ? 'up' : 'down',
            label: `${financial.performanceType === 'up' ? '+' : '-'}${formatCurrencyValue(financial.performanceDiff)}`,
            helper: tr('vs estimated earnings', 'vs ganhos estimados'),
          }
        : null;

    return [
      {
        key: 'total',
        title: tr('Total Projects', 'Total de projetos'),
        value: formatCountValue(counts.total),
        numericValue: Number(counts.total || 0),
        formatValue: formatCountValue,
        animateValue: true,
        valueDecimals: 0,
        delta: countDelta(counts.total, compareCounts?.total),
        indicatorPercent: (Number(counts.total || 0) / countMax) * 100,
      },
      {
        key: 'todo',
        title: tr('To Do', 'A fazer'),
        value: formatCountValue(counts.todo),
        numericValue: Number(counts.todo || 0),
        formatValue: formatCountValue,
        animateValue: true,
        valueDecimals: 0,
        delta: countDelta(counts.todo, compareCounts?.todo),
        indicatorPercent: (Number(counts.todo || 0) / countMax) * 100,
      },
      {
        key: 'in-progress',
        title: tr('In Progress', 'Em andamento'),
        value: formatCountValue(counts.inProgress),
        numericValue: Number(counts.inProgress || 0),
        formatValue: formatCountValue,
        animateValue: true,
        valueDecimals: 0,
        delta: countDelta(counts.inProgress, compareCounts?.inProgress),
        indicatorPercent: (Number(counts.inProgress || 0) / countMax) * 100,
      },
      {
        key: 'done',
        title: tr('Completed', 'Concluído'),
        value: formatCountValue(counts.done),
        numericValue: Number(counts.done || 0),
        formatValue: formatCountValue,
        animateValue: true,
        valueDecimals: 0,
        delta: countDelta(counts.done, compareCounts?.done),
        indicatorPercent: (Number(counts.done || 0) / countMax) * 100,
      },
      {
        key: 'estimated',
        title: tr('Estimated Earnings', 'Ganhos estimados'),
        value: formatCurrencyValue(financial.estimado),
        numericValue: Number(financial.estimado || 0),
        formatValue: formatCurrencyValue,
        animateValue: true,
        valueDecimals: 2,
        delta: moneyDelta(financial.estimado, compareFinancial?.estimado),
        indicatorPercent: (Number(financial.estimado || 0) / moneyMax) * 100,
      },
      {
        key: 'realized',
        title: tr('Realized Earnings', 'Ganhos realizados'),
        value: formatCurrencyValue(financial.realizado),
        numericValue: Number(financial.realizado || 0),
        formatValue: formatCurrencyValue,
        animateValue: true,
        valueDecimals: 2,
        delta: moneyDelta(financial.realizado, compareFinancial?.realizado) || realizedFallback,
        indicatorPercent: (Number(financial.realizado || 0) / moneyMax) * 100,
      },
    ];
  }, [comparisonKpiData, effectiveFinancial, formatCountValue, formatCurrencyValue, kpiData, tr]);

  const alerts = useMemo(() => {
    if (!kpiData) return [];

    const rows = [];
    const counts = kpiData.counts || {};
    const financial = effectiveFinancial || {};

    if (Number(counts.todo || 0) > Number(counts.done || 0)) {
      rows.push({
        severity: 'warn',
        title: tr('Backlog pressure is increasing', 'Pressão de backlog em alta'),
        description: tr(
          `To Do (${formatCountValue(counts.todo)}) is above Completed (${formatCountValue(counts.done)}). Investigate blocked flow before adding new intake.`,
          `A fazer (${formatCountValue(counts.todo)}) está acima de concluído (${formatCountValue(counts.done)}). Investigue bloqueios antes de aumentar a entrada.`,
        ),
      });
    }

    if (financial.performanceType === 'down' && Number(financial.performanceDiff || 0) > 0) {
      rows.push({
        severity: 'critical',
        title: tr('Realized earnings below estimate', 'Ganhos realizados abaixo do estimado'),
        description: tr(
          `Current gap is ${formatCurrencyValue(financial.performanceDiff)} for this selection.`,
          `O gap atual é ${formatCurrencyValue(financial.performanceDiff)} para esta seleção.`,
        ),
      });
    }

    if (trendSummary?.delta && trendSummary.delta.type === 'down' && (trendSummary.delta.percent || 0) > 20) {
      rows.push({
        severity: 'warn',
        title: tr('Recent earnings trend dropped sharply', 'Tendência recente de ganhos caiu de forma acentuada'),
        description: tr(
          `${trendSummary.delta.percentLabel} versus the previous point in the historical series.`,
          `${trendSummary.delta.percentLabel} em relação ao ponto anterior da série histórica.`,
        ),
      });
    }

    if (driverHighlights[0] && parseFloat(String(driverHighlights[0].percentage || '0').replace('%', '')) >= 45) {
      rows.push({
        severity: 'info',
        title: tr('High concentration detected', 'Alta concentração detectada'),
        description: tr(
          `${driverHighlights[0].scope} is concentrated on "${driverHighlights[0].label}" (${driverHighlights[0].percentage}).`,
          `${driverHighlights[0].scope} está concentrado em "${driverHighlights[0].label}" (${driverHighlights[0].percentage}).`,
        ),
      });
    }

    if (!rows.length) {
      rows.push({
        severity: 'info',
        title: tr('No critical anomalies detected', 'Nenhuma anomalia crítica detectada'),
        description: tr(
          'Distribution and trend signals are currently within expected bounds.',
          'Os sinais de distribuição e tendência estão, no momento, dentro do esperado.',
        ),
      });
    }

    return rows.slice(0, 4);
  }, [driverHighlights, effectiveFinancial, formatCountValue, formatCurrencyValue, kpiData, tr, trendSummary]);

  const hasData = Number(kpiData?.counts?.total || 0) > 0;
  const financial = effectiveFinancial || {};
  const leadTimeSummary = leadTimeData?.summary || {};
  const leadTimeTopDone = Array.isArray(leadTimeData?.topDone) ? leadTimeData.topDone.slice(0, 5) : [];
  const leadTimeTopOngoing = Array.isArray(leadTimeData?.topOngoing) ? leadTimeData.topOngoing.slice(0, 5) : [];
  const leadTimeDoneMissingDueDate = Array.isArray(leadTimeData?.doneMissingDueDate)
    ? leadTimeData.doneMissingDueDate
    : [];
  const leadTimeInProgressRaw = Array.isArray(leadTimeData?.inProgressOpen) ? leadTimeData.inProgressOpen : [];
  const leadTimeUpcomingRaw = Array.isArray(leadTimeData?.upcoming) ? leadTimeData.upcoming : [];
  const leadTimeUpcoming = useMemo(() => {
    if (leadTimeUpcomingRaw.length) {
      const toDayTimestamp = (value) => {
        const ymd = String(value || '').slice(0, 10);
        if (!ymd) return null;
        const dt = new Date(`${ymd}T12:00:00`);
        return Number.isNaN(dt.getTime()) ? null : dt.getTime();
      };

      return [...leadTimeUpcomingRaw]
        .sort((a, b) => {
          const aTs = toDayTimestamp(a?.plannedDate);
          const bTs = toDayTimestamp(b?.plannedDate);
          if (aTs !== null && bTs !== null && aTs !== bTs) return bTs - aTs; // newest first
          if (aTs === null && bTs !== null) return 1;
          if (aTs !== null && bTs === null) return -1;
          return String(a?.title || '').localeCompare(String(b?.title || ''));
        })
        .slice(0, 5);
    }
    const seen = new Set();
    return [...leadTimeTopOngoing, ...leadTimeTopDone]
      .map(item => ({
        id: item?.id,
        title: item?.title || '',
        status: item?.status || 'TODO',
        employeeName: item?.employeeName || '',
        plannedDate: item?.plannedRef || item?.endRef || '',
        expectedGain: Number(item?.expectedGain || 0),
      }))
      .filter(item => {
        const key = String(item.id || '').trim();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 5);
  }, [leadTimeTopDone, leadTimeTopOngoing, leadTimeUpcomingRaw]);
  const leadTimeInProgressTable = useMemo(() => {
    const normalizeStatus = value => String(value || '').trim().toUpperCase().replace(/\s+/g, '_');
    const isInProgress = item => normalizeStatus(item?.status) === 'IN_PROGRESS';

    if (leadTimeInProgressRaw.length) {
      return leadTimeInProgressRaw.filter(isInProgress);
    }
    return leadTimeTopOngoing.filter(isInProgress);
  }, [leadTimeInProgressRaw, leadTimeTopOngoing]);

  const leadTimeCards = useMemo(
    () => [
      {
        key: 'avg-done',
        scope: tr('Average implementation time', 'Tempo medio de implementação'),
        label: tr('Completed flow', 'Fluxo concluido'),
        helperText: tr(
          `${formatCountValue(leadTimeSummary.doneCount || 0)} completed projects`,
          `${formatCountValue(leadTimeSummary.doneCount || 0)} projetos concluidos`,
        ),
        valueNumeric: Number(leadTimeSummary.avgDoneDays || 0),
        valueDecimals: 1,
        formatValue: value => formatDurationLabel(value, tr, { decimals: 1, locale }),
      },
      {
        key: 'median-done',
        scope: tr('Median implementation time', 'Tempo mediano de implementação'),
        label: tr('Delivery baseline', 'Baseline de entrega'),
        helperText: tr('Resistant to outliers', 'Menos sensivel a outliers'),
        valueNumeric: Number(leadTimeSummary.medianDoneDays || 0),
        valueDecimals: 1,
        formatValue: value => formatDurationLabel(value, tr, { decimals: 1, locale }),
      },
      {
        key: 'avg-ongoing',
        scope: tr('Average active age', 'Idade media em andamento'),
        label: tr('Current active load', 'Carga ativa atual'),
        helperText: tr(
          `${formatCountValue(leadTimeSummary.ongoingCount || 0)} active projects`,
          `${formatCountValue(leadTimeSummary.ongoingCount || 0)} projetos ativos`,
        ),
        valueNumeric: Number(leadTimeSummary.avgOngoingDays || 0),
        valueDecimals: 1,
        formatValue: value => formatDurationLabel(value, tr, { decimals: 1, locale }),
      },
      {
        key: 'max-ongoing',
        scope: tr('Longest active project', 'Maior tempo em andamento'),
        label: tr('Current peak', 'Pico atual'),
        helperText: tr('Current peak in active flow', 'Pico atual no fluxo ativo'),
        valueNumeric: Number(leadTimeSummary.maxOngoingDays || 0),
        valueDecimals: 0,
        formatValue: value => formatDurationLabel(value, tr, { locale }),
      },
    ],
    [leadTimeSummary, tr, formatCountValue, locale],
  );

  const costMatrixProjects = useMemo(
    () => (Array.isArray(costMatrixData?.projects) ? costMatrixData.projects : []),
    [costMatrixData],
  );
  const costMatrixRows = useMemo(
    () => (Array.isArray(costMatrixData?.rows) ? costMatrixData.rows : []),
    [costMatrixData],
  );
  const realizationRate = Number(financial.estimado || 0) > 0
    ? Math.max(0, Math.min(100, (Number(financial.realizado || 0) / Number(financial.estimado || 0)) * 100))
    : 0;

  const dashboardNavStyle = useMemo(() => {
    const width = Number(navAnchorRect.width || 0);
    const center = Number(navAnchorRect.left || 0) + (width / 2);
    if (!Number.isFinite(width) || width < 40 || !Number.isFinite(center) || center <= 0) {
      return undefined;
    }

    const safeWidth = Math.max(300, Math.floor(width - 20));
    return {
      left: `${center}px`,
      maxWidth: `${safeWidth}px`,
    };
  }, [navAnchorRect.left, navAnchorRect.width]);

  if (loading && !kpiData) {
    return <DashboardSkeleton />;
  }

  if (error && !kpiData) {
    return (
      <div className={`${ui.card.base} p-5`}>
        <h3 className="text-lg font-semibold text-foreground">
          {tr('Unable to load dashboard', 'Não foi possível carregar o dashboard')}
        </h3>
        <p className="text-sm text-muted-foreground mt-1">{error}</p>
        <button type="button" onClick={() => window.location.reload()} className={`${ui.button.base} ${ui.button.primary} mt-4`}>
          {tr('Reload page', 'Recarregar página')}
        </button>
      </div>
    );
  }

  if (!loading && !hasData) {
    return (
      <div className={`${ui.card.base} p-6 space-y-3`}>
        <h3 className="text-lg font-semibold text-foreground">
          {tr('No KPI data for this selection', 'Sem dados de KPI para esta seleção')}
        </h3>
        <p className="text-sm text-muted-foreground">
          {tr(
            'Refine filters or import additional projects to populate executive and trend indicators.',
            'Refine os filtros ou importe projetos adicionais para preencher os indicadores executivos e de tendência.',
          )}
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => onOpenProjects?.()} className={`${ui.button.base} ${ui.button.subtle}`}>
            {tr('Open Projects', 'Abrir projetos')}
          </button>
          <button type="button" onClick={() => onOpenImport?.()} className={`${ui.button.base} ${ui.button.primary}`}>
            {tr('Import Spreadsheet', 'Importar planilha')}
          </button>
        </div>
      </div>
    );
  }

  const dashboardNav = (
    <nav
      className={`${ui.card.glass} dashboard-mini-nav ${isMiniNavCollapsed ? 'is-collapsed' : ''} ${isInteractionBlocked ? 'is-muted' : ''}`}
      style={dashboardNavStyle}
      aria-hidden={isInteractionBlocked}
    >
      <div className="dashboard-mini-nav-track">
        <div className="dashboard-mini-nav-head">
          <button
            type="button"
            className={`dashboard-mini-nav-toggle ${isMiniNavCollapsed ? 'is-collapsed' : ''}`}
            onClick={() => setIsMiniNavCollapsed(prev => !prev)}
            aria-expanded={!isMiniNavCollapsed}
            aria-label={
              isMiniNavCollapsed
                ? tr('Expand dashboard tabs', 'Expandir abas do dashboard')
                : tr('Collapse dashboard tabs', 'Recolher abas do dashboard')
            }
            title={
              isMiniNavCollapsed
                ? tr('Expand dashboard tabs', 'Expandir abas do dashboard')
                : tr('Collapse dashboard tabs', 'Recolher abas do dashboard')
            }
            disabled={isInteractionBlocked}
          >
            <ChevronDown className="w-4 h-4" />
          </button>
        </div>
        {!isMiniNavCollapsed ? (
          <div className="dashboard-mini-nav-actions">
            {dashboardViews.map(view => {
              const Icon = view.icon;
              const isActive = view.key === dashboardView;
              return (
                <button
                  key={view.key}
                  type="button"
                  className={`dashboard-mini-nav-btn ${isActive ? 'is-active' : ''}`}
                  onClick={() => setDashboardView(view.key)}
                  aria-pressed={isActive}
                  disabled={isInteractionBlocked}
                >
                  <Icon className="w-4 h-4" />
                  <span>{view.label}</span>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    </nav>
  );

  return (
    <div
      ref={dashboardShellRef}
      className={`dashboard-shell dashboard-market view-shell command-dashboard-shell dashboard-view-${dashboardView} space-y-2 pb-1`}
    >
      {error ? (
        <section className="rounded-xl border border-destructive/45 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </section>
      ) : null}

      {dashboardView === 'pulse' ? (
        <>
          <section className="dashboard-section reveal-up">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-[11px] uppercase tracking-[0.16em] font-semibold text-muted-foreground">
                  {tr('KPI Storyboard', 'Narrativa de KPIs')}
                </p>
                <h2 className="text-2xl font-semibold text-foreground">
                  {tr('Portfolio Performance Dashboard', 'Dashboard de desempenho do portfólio')}
                </h2>
              </div>
              <InfoActionButton
                onClick={() => setIsInfoModalOpen(true)}
                label={tr('How this screen is calculated', 'Como esta tela e calculada')}
              />
            </div>
          </section>

          <section className="dashboard-section reveal-up">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-2 dashboard-strip-grid">
              <article className={`${ui.card.base} dashboard-card p-3 lg:col-span-5 space-y-1.5 dashboard-strip-card`}>
                <p className="text-[11px] uppercase tracking-[0.14em] font-semibold text-muted-foreground">
                  {tr('Control narrative', 'Narrativa de controle')}
                </p>
                <h3 className="text-base font-semibold text-foreground">
                  {driverHighlights[0]
                    ? tr(
                        `Primary pressure in ${driverHighlights[0].scope}: ${driverHighlights[0].label}`,
                        `Maior pressao em ${driverHighlights[0].scope}: ${driverHighlights[0].label}`,
                      )
                    : tr('No pressure driver identified for this filter set.', 'Nenhum driver de pressao identificado para este filtro.')}
                </h3>
                <p className="text-xs text-muted-foreground">
                  {tr(
                    'Quick read for current concentration.',
                    'Leitura rápida da concentração atual.',
                  )}
                </p>
              </article>

              <article className={`${ui.card.base} dashboard-card p-3 lg:col-span-4 space-y-1.5 dashboard-strip-card`}>
                <p className="text-[11px] uppercase tracking-[0.14em] font-semibold text-muted-foreground">
                  {tr('Trend signal', 'Sinal de tendência')}
                </p>
                <div className="dashboard-trend-strip">
                  <span className={`dashboard-trend-variation is-${trendSummary?.delta?.type || 'flat'}`}>
                    {trendSummary?.delta?.percentLabel
                      ? `${tr('Variation', 'Variação')}: ${trendSummary.delta.percentLabel}`
                      : `${tr('Variation', 'Variação')}: -`}
                  </span>
                  <span className="dashboard-trend-latest">
                    {trendSummary?.latest
                      ? `${tr('Latest', 'Ultimo')}: ${trendSummary.latest.label} - ${formatCurrencyValue(trendSummary.latest.value)}`
                      : tr('No trend points in current selection.', 'Sem pontos de tendência na seleção atual.')}
                  </span>
                </div>
              </article>

              <article className={`${ui.card.base} dashboard-card p-3 lg:col-span-3 space-y-1.5 dashboard-strip-card`}>
                <p className="text-[11px] uppercase tracking-[0.14em] font-semibold text-muted-foreground">
                  {tr('Next moves', 'Proximos passos')}
                </p>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => onOpenProjects?.()} className={`${ui.button.base} ${ui.button.subtle}`}>
                    {tr('Open Projects', 'Abrir projetos')}
                  </button>
                  <button type="button" onClick={() => onOpenRoadmap?.()} className={`${ui.button.base} ${ui.button.subtle}`}>
                    {tr('Open Roadmap', 'Abrir roadmap')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setCurrencyMode(prev => (prev === 'BRL' ? 'USD' : 'BRL'))}
                    className={`${ui.button.base} ${ui.button.subtle}`}
                  >
                    <DollarSign className="w-4 h-4" />
                    {isUsdMode ? tr('Show BRL', 'Ver em R$') : tr('Show USD', 'Ver em US$')}
                  </button>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {tr('Display currency', 'Moeda exibida')}: {isUsdMode ? 'USD' : 'BRL'}
                  {isUsdMode ? ` · 1 USD = R$ ${USD_BRL_RATE.toFixed(2)}` : ''}
                </p>
              </article>
            </div>
          </section>

          <section className="dashboard-section reveal-up space-y-2">
            <SectionHeader
              eyebrow={tr('Control Center', 'Central de controle')}
              title={tr('Portfolio Pulse', 'Pulso do portfólio')}
              subtitle={tr(
                'Executive cards plus realization gauge for a one-screen health snapshot.',
                'Cards executivos e monitor de realização em leitura de uma tela.',
              )}
            />

            <div className="grid grid-cols-1 xl:grid-cols-12 gap-3 items-start">
              <div className="xl:col-span-8 xl:self-start content-start grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-3 gap-3">
                {executiveCards.map(card => (
                  <KpiStoryCard
                    key={card.key}
                    title={card.title}
                    value={card.value}
                    numericValue={card.numericValue}
                    formatValue={card.formatValue}
                    animateValue={card.animateValue}
                    valueDecimals={card.valueDecimals}
                    delta={card.delta}
                    indicatorPercent={card.indicatorPercent}
                    helperText={periodMeta.hasComparison
                      ? tr('No relevant variation for this period.', 'Sem variação relevante para este período.')
                      : tr('Set date range to compare periods.', 'Defina um período para comparar.')}
                  />
                ))}
              </div>

              <article className={`${ui.card.base} dashboard-card dashboard-monitor-card xl:col-span-4 p-3`}>
                <div className="space-y-1 dashboard-monitor-copy">
                  <h4 className="text-sm font-semibold text-foreground">
                    {tr('Realization Monitor', 'Monitor de realização')}
                  </h4>
                  <p className="text-xs text-muted-foreground">
                    {tr(
                      'Realization gauge for the current filter scope.',
                      'Gauge de realização para o escopo atual de filtros.',
                    )}
                  </p>
                </div>

                <div className="dashboard-monitor-gauge-wrap">
                  <canvas ref={gaugeRef} />
                </div>

                <div className="dashboard-monitor-metrics">
                  <div
                    className="dashboard-monitor-metric-item"
                    title={formatCurrencyValue(financial.estimado)}
                  >
                    <span>{tr('Target', 'Meta')}</span>
                    <strong>{formatCurrencyCompactValue(financial.estimado)}</strong>
                    <small>{formatCurrencyValue(financial.estimado)}</small>
                  </div>
                  <div
                    className="dashboard-monitor-metric-item"
                    title={formatCurrencyValue(financial.realizado)}
                  >
                    <span>{tr('Realized', 'Realizado')}</span>
                    <strong>{formatCurrencyCompactValue(financial.realizado)}</strong>
                    <small>{formatCurrencyValue(financial.realizado)}</small>
                  </div>
                  <div
                    className="dashboard-monitor-metric-item"
                    title={`${financial.performanceType === 'up' ? '+' : '-'}${formatCurrencyValue(financial.performanceDiff)}`}
                  >
                    <span>{tr('Gap', 'Gap')}</span>
                    <strong>
                      {(financial.performanceType === 'up' ? '+' : '-') + formatCurrencyCompactValue(financial.performanceDiff)}
                    </strong>
                    <small>
                      {(financial.performanceType === 'up' ? '+' : '-') + formatCurrencyValue(financial.performanceDiff)}
                    </small>
                  </div>
                </div>

                <p className="text-xs font-semibold text-muted-foreground dashboard-monitor-rate">
                  {tr('Realization rate', 'Taxa de realização')}: {new Intl.NumberFormat(locale, {
                    minimumFractionDigits: 1,
                    maximumFractionDigits: 1,
                  }).format(realizationRate)}%
                </p>
              </article>
            </div>
          </section>

          <section className="dashboard-section reveal-up">
            <article className={`${ui.card.base} dashboard-card dashboard-radar-card p-2`}>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div className="space-y-1">
                  <p className="text-[11px] uppercase tracking-[0.14em] font-semibold text-muted-foreground">
                    {tr('Execution Radar', 'Radar de execução')}
                  </p>
                  <h4 className="text-sm font-semibold text-foreground">
                    {tr('Trend + Alerts Snapshot', 'Snapshot de tendência + alertas')}
                  </h4>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="chip chip-subtle">
                    {costDrilldown.level === 'year'
                      ? tr('Annual view', 'Visão anual')
                      : tr(`Monthly view - ${costDrilldown.year}`, `Visão mensal - ${costDrilldown.year}`)}
                  </span>
                  {costDrilldown.level === 'month' ? (
                    <button
                      type="button"
                      onClick={() => setCostDrilldown({ level: 'year', year: null })}
                      className={`${ui.button.base} ${ui.button.subtle}`}
                    >
                      {tr('Back to annual', 'Voltar para anual')}
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-12 gap-3">
                <div className="xl:col-span-9">
                  <div className="h-[14rem] xl:h-[15rem] 2xl:h-[16rem]">
                    {costLoading ? (
                      <div className="h-full flex items-center justify-center text-sm text-muted-foreground gap-2">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        {tr('Loading trends...', 'Carregando tendências...')}
                      </div>
                    ) : (
                      <canvas ref={costRef} />
                    )}
                  </div>
                </div>

                <div className="xl:col-span-3 grid gap-2 content-stretch dashboard-pulse-alert-stack">
                  {alerts.slice(0, 2).map(alert => (
                    <InsightCard
                      key={`pulse-${alert.severity}-${alert.title}`}
                      severity={alert.severity}
                      severityLabel={
                        alert.severity === 'critical'
                          ? tr('critical', 'crítico')
                          : alert.severity === 'warn'
                            ? tr('warn', 'aviso')
                            : tr('info', 'info')
                      }
                      title={alert.title}
                      description={alert.description}
                      className="dashboard-pulse-alert-card"
                    />
                  ))}
                </div>
              </div>

              <div className="dashboard-cost-matrix-wrap">
                <div className="dashboard-cost-matrix-head">
                  <h5 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    {tr('Earnings Matrix', 'Matriz de ganhos')}
                  </h5>
                  <div className="inline-flex items-center gap-3 text-[11px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5">
                      <i className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: 'rgba(36, 166, 118, 0.62)' }} />
                      {tr('Realized', 'Realizado')}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <i className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: 'rgba(127, 139, 160, 0.62)' }} />
                      {tr('Projected', 'Previsto')}
                    </span>
                  </div>
                  <span className="chip chip-subtle">
                    {costDrilldown.level === 'year'
                      ? tr('Years x projects', 'Anos x projetos')
                      : tr(`Months in ${costDrilldown.year}`, `Meses de ${costDrilldown.year}`)}
                  </span>
                </div>

                {costMatrixLoading ? (
                  <div className="dashboard-cost-matrix-empty">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>{tr('Loading matrix...', 'Carregando matriz...')}</span>
                  </div>
                ) : (costMatrixRows.length && costMatrixProjects.length) ? (
                  <div className={`dashboard-cost-matrix-table-wrap ${costDrilldown.level === 'month' ? 'is-monthly' : 'is-yearly'}`}>
                    <table className="dashboard-cost-matrix-table">
                      <thead>
                        <tr>
                          <th>{tr('Period', 'Período')}</th>
                          {costMatrixProjects.map(project => (
                            <th key={`matrix-head-${project.id}`} title={project.title}>
                              {project.title}
                            </th>
                          ))}
                          <th>{tr('Total', 'Total')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {costMatrixRows.map(row => (
                          <tr key={`matrix-row-${row.period}`}>
                            <th>
                              {costDrilldown.level === 'year' ? (
                                <button
                                  type="button"
                                  className="dashboard-cost-matrix-period-btn"
                                  onClick={() => {
                                    const selectedYear = Number.parseInt(String(row.label), 10);
                                    if (Number.isInteger(selectedYear)) {
                                      setCostDrilldown({ level: 'month', year: selectedYear });
                                    }
                                  }}
                                  title={tr(
                                    `Expand ${row.label} to monthly view`,
                                    `Expandir ${row.label} para visão mensal`,
                                  )}
                                >
                                  {row.label}
                                </button>
                              ) : row.label}
                            </th>
                            {row.values.map((value, valueIndex) => {
                              const project = costMatrixProjects[valueIndex];
                              const earningStatus = String(row.statuses?.[valueIndex] || '').toUpperCase();
                              const isProjected = earningStatus === 'PREVISTO';
                              const numericValue = Number(value || 0);
                              const hasValue = Number.isFinite(numericValue) && numericValue !== 0;
                              const statusLabel = isProjected
                                ? tr('Projected', 'Previsto')
                                : tr('Realized', 'Realizado');
                              return (
                                <td
                                  key={`matrix-cell-${row.period}-${project?.id || valueIndex}`}
                                  className="dashboard-cost-matrix-cell"
                                  style={{
                                    backgroundColor: hasValue
                                      ? (isProjected
                                        ? 'rgba(127, 139, 160, 0.32)'
                                        : 'rgba(36, 166, 118, 0.30)')
                                      : 'transparent',
                                  }}
                                  title={`${row.label} · ${project?.title || ''}: ${formatCurrencyValue(value)} (${statusLabel})`}
                                >
                                  {formatCurrencyCompactValue(value)}
                                </td>
                              );
                            })}
                            <td className="dashboard-cost-matrix-total">{formatCurrencyCompactValue(row.total)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="dashboard-cost-matrix-empty">
                    {tr('No earnings matrix data for current filters.', 'Sem dados de matriz de ganhos para os filtros atuais.')}
                  </div>
                )}
              </div>
            </article>
          </section>
        </>
      ) : null}

      {dashboardView === 'leadtime' ? (
      <section className="dashboard-section reveal-up space-y-3">
        <SectionHeader
          eyebrow={tr('Lead Time Intelligence', 'Inteligencia de Lead Time')}
          title={tr('Implementation Duration Insights', 'Insights de duração da implementação')}
          subtitle={tr(
            'Real implementation duration for completed projects and aging view for active flow.',
            'Duração real da implementação para concluidos e visao de envelhecimento no fluxo ativo.',
          )}
          action={(
            <InfoActionButton
              onClick={() => setIsInfoModalOpen(true)}
              label={tr('How this screen is calculated', 'Como esta tela e calculada')}
            />
          )}
        />

        {leadTimeError ? (
          <section className="rounded-xl border border-amber-500/45 bg-amber-500/10 px-3 py-2 text-sm text-amber-600 dark:text-amber-300">
            {leadTimeError}
          </section>
        ) : null}

        <div className="grid grid-cols-1 xl:grid-cols-12 gap-3">
          <div className="xl:col-span-9 dashboard-leadtime-stack">
            <div className="dashboard-leadtime-kpi-column">
              {leadTimeCards.slice(0, 2).map((card, index) => (
                <DashboardUnifiedKpiCard
                  key={card.key}
                  scope={card.scope}
                  label={card.label}
                  helperText={card.helperText}
                  valueNumeric={card.valueNumeric}
                  valueDecimals={card.valueDecimals}
                  formatValue={card.formatValue}
                  tone="#24A676"
                  locale={locale}
                  index={index}
                  className="dashboard-leadtime-kpi-card"
                />
              ))}
            </div>

            <LeadTimeRankingCard
              className="dashboard-leadtime-ranking-card"
              compact
              title={tr('Top 5 longest completed', 'Top 5 concluídos mais longos')}
              subtitle={tr(
                'Highest implementation duration among projects marked as completed.',
                'Maior duração de implementação entre projetos marcados como concluídos.',
              )}
              items={leadTimeTopDone}
              attentionItems={leadTimeDoneMissingDueDate}
              attentionLabel={tr('Done without due date', 'DONE sem due date')}
              attentionDescription={tr(
                'Click to list completed projects without due date in this filter.',
                'Clique para listar projetos concluídos sem due date neste filtro.',
              )}
              emptyText={tr('No completed projects found for current filters.', 'Nenhum projeto concluído encontrado para os filtros atuais.')}
              tr={tr}
              locale={locale}
              onOpenProject={onOpenProject}
            />

            <div className="dashboard-leadtime-kpi-column">
              {leadTimeCards.slice(2, 4).map((card, localIndex) => (
                <DashboardUnifiedKpiCard
                  key={card.key}
                  scope={card.scope}
                  label={card.label}
                  helperText={card.helperText}
                  valueNumeric={card.valueNumeric}
                  valueDecimals={card.valueDecimals}
                  formatValue={card.formatValue}
                  tone="#0f69ca"
                  locale={locale}
                  index={localIndex + 2}
                  className="dashboard-leadtime-kpi-card"
                />
              ))}
            </div>

            <LeadTimeRankingCard
              className="dashboard-leadtime-ranking-card"
              compact
              title={tr('Top 5 longest active', 'Top 5 em andamento há mais tempo')}
              subtitle={tr(
                'Aging ranking for active stages (In Progress and Review).',
                'Ranking de envelhecimento para estágios ativos (Em andamento e Revisão).',
              )}
              items={leadTimeTopOngoing}
              emptyText={tr('No active projects found in In Progress/Review.', 'Nenhum projeto ativo em Em andamento/Revisão.')}
              tr={tr}
              locale={locale}
              onOpenProject={onOpenProject}
            />
          </div>

          <div className="xl:col-span-3 dashboard-leadtime-tree-rail">
            <LeadTimeUpcomingTreeCard
              items={leadTimeUpcoming}
              tr={tr}
              locale={locale}
              onOpenProject={onOpenProject}
            />
            <LeadTimeInProgressTableCard
              items={leadTimeInProgressTable}
              tr={tr}
              locale={locale}
              onOpenProject={onOpenProject}
            />
          </div>
        </div>
      </section>
      ) : null}

      {dashboardView === 'distribution' ? (
      <section className="dashboard-section dashboard-distribution-fit reveal-up space-y-3">
        <SectionHeader
          eyebrow={tr('Distribution Hub', 'Hub de distribuição')}
          title={tr('Drivers and Flow Mix', 'Drivers e mix de fluxo')}
          subtitle={tr(
            'Core flow blocks with symmetric composition and direct visibility.',
            'Blocos centrais de fluxo com composição simétrica e visibilidade direta.',
          )}
          action={(
            <InfoActionButton
              onClick={() => setIsInfoModalOpen(true)}
              label={tr('How this screen is calculated', 'Como esta tela e calculada')}
            />
          )}
        />

        <div className="dashboard-distribution-priority-chips grid grid-cols-1 md:grid-cols-3 gap-2">
          {driverHighlights.slice(0, 3).map((highlight, index) => (
            <DistributionHighlightCard
              key={`${highlight.scope}-${highlight.label}`}
              highlight={highlight}
              index={index}
              locale={locale}
              formatCountValue={formatCountValue}
            />
          ))}
        </div>

        <div className="dashboard-equal-height grid grid-cols-1 xl:grid-cols-12 gap-2">
          <div className="xl:col-span-4 h-full">
            <DriverPanel
              title={tr('Status Mix', 'Distribuição por status')}
              subtitle={tr('Read distribution of current delivery stages.', 'Leia a distribuição dos estágios atuais de entrega.')}
              details={[]}
              className="h-full"
              compact
            >
              <div className="dashboard-donut-layout">
                <ul className="dashboard-donut-legend" aria-label={tr('Status legend', 'Legenda de status')}>
                  {statusItems.map(item => {
                    const meta = getStatusMeta(item.label);
                    return (
                      <li key={`status-legend-${item.label}`} className="dashboard-donut-legend-item">
                        <span className="dashboard-donut-legend-label">
                          <span className="dashboard-donut-dot" style={{ backgroundColor: meta.color }} />
                          <span className="truncate">{meta.label}</span>
                        </span>
                        <span className="dashboard-donut-legend-value">
                          {formatCountValue(item.value)} ({item.percentage || '0.0%'})
                        </span>
                      </li>
                    );
                  })}
                </ul>
                <div className="dashboard-donut-wrap dashboard-donut-wrap-side">
                  <canvas ref={statusRef} />
                </div>
              </div>
            </DriverPanel>
          </div>

          <div className="xl:col-span-4 h-full">
            <DriverPanel
              title={tr('Committee Impact', 'Impacto no Comitê')}
              subtitle={tr(
                'Shows categories with highest influence on portfolio outcomes.',
                'Mostra as categorias com maior influência nos resultados do portfólio.',
              )}
              details={[]}
              className="h-full"
              compact
            >
              <div className="dashboard-donut-layout">
                <ul className="dashboard-donut-legend" aria-label={tr('Committee impact legend', 'Legenda de impacto')}>
                  {impactItems.map((item, index) => (
                    <li key={`impact-legend-${item.label}`} className="dashboard-donut-legend-item">
                      <span className="dashboard-donut-legend-label">
                        <span className="dashboard-donut-dot" style={{ backgroundColor: PALETTE[index % PALETTE.length] }} />
                        <span className="truncate">{item.label}</span>
                      </span>
                      <span className="dashboard-donut-legend-value">
                        {formatCountValue(item.value)} ({item.percentage || '0.0%'})
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="dashboard-donut-wrap dashboard-donut-wrap-side">
                  <canvas ref={impactRef} />
                </div>
              </div>
            </DriverPanel>
          </div>

          <article className={`${ui.card.base} dashboard-card dashboard-driver-panel xl:col-span-4 h-full p-3 space-y-2`}>
            <h4 className="text-base font-semibold text-foreground">{tr('Delivery Funnel', 'Funil de entrega')}</h4>
            <p className="text-xs text-muted-foreground">
              {tr(
                'Horizontal ranking of status volume to expose concentration in each stage.',
                'Ranking horizontal do volume por status para evidenciar concentração em cada estágio.',
              )}
            </p>
            <div className="h-32">
              <canvas ref={funnelRef} />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {statusItems.slice(0, 4).map(item => (
                <span key={`status-chip-${item.label}`} className="chip chip-subtle">
                  {getStatusMeta(item.label).label}: {item.percentage || '0.0%'}
                </span>
              ))}
            </div>
          </article>
        </div>

        <DriverPanel
          title={tr('Area Contribution', 'Contribuição por área')}
          subtitle={tr(
            'Top 8 areas by delivery volume (completed vs in progress).',
            'Top 8 áreas por volume de entrega (concluído vs em andamento).',
          )}
          details={[]}
          className="h-full"
          compact
        >
          <div className="h-44">
            <canvas ref={areaRef} />
          </div>
        </DriverPanel>

        <div className="grid grid-cols-1 xl:grid-cols-12 gap-2">
          <div className="xl:col-span-4 h-full">
            <DriverPanel
              title={tr('Kaizen Categories', 'Categorias Kaizen')}
              subtitle={tr(
                'Category concentration in improvement initiatives.',
                'Concentração por categoria nas iniciativas de melhoria.',
              )}
              details={[]}
              className="h-full"
              compact
            >
              <div className="h-72">
                <canvas ref={kaizenRef} />
              </div>
            </DriverPanel>
          </div>
          <div className="xl:col-span-8 h-full">
            <DriverPanel
              title={tr('Owner Workload (Top 10)', 'Carga por responsável (Top 10)')}
              subtitle={tr(
                'Highest execution loads by owner across completion stages.',
                'Maiores cargas de execução por responsável entre os estágios.',
              )}
              details={[]}
              className="h-full"
              compact
            >
              <div className="h-72">
                <canvas ref={assigneeRef} />
              </div>
            </DriverPanel>
          </div>
        </div>
      </section>
      ) : null}

      <Modal
        open={isInfoModalOpen}
        onClose={() => setIsInfoModalOpen(false)}
        maxWidth="max-w-5xl"
        tone="workspace"
      >
        <div className="p-6 space-y-4 dashboard-info-modal">
          <div className="space-y-1">
            <p className="text-[11px] uppercase tracking-[0.14em] font-semibold text-muted-foreground">
              {tr('Dashboard Info', 'Info do Dashboard')}
            </p>
            <h3 className="text-xl font-semibold text-foreground">{dashboardInfoContent.title}</h3>
            <p className="text-xs text-muted-foreground">
              {dashboardInfoContent.intro || infoButtonLabel}
            </p>
          </div>

          <DashboardInfoFlowRail steps={dashboardInfoFlow} />

          <div className="grid gap-2 md:grid-cols-2">
            {dashboardInfoContent.items.map((item, index) => (
              <DashboardInfoMetricCard
                key={`dashboard-info-${dashboardView}-${index}`}
                item={item}
                tr={tr}
              />
            ))}
          </div>
        </div>
      </Modal>

      {typeof document !== 'undefined' ? createPortal(dashboardNav, document.body) : dashboardNav}
    </div>
  );
}
