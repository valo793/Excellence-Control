import { useMemo, useState } from 'react';
import { getStatusLabel, STATUS_MAP } from '../utils/constants';
import { getStatusMeta, ui } from '../ui/visuals';
import { ViewPanel, ViewScaffold } from '../components/ViewScaffold';

const FOUNDATION_V1_ENABLED = /^(1|true|yes|on)$/i.test(
  String(import.meta.env?.VITE_UI_FOUNDATION_V1 || '').trim(),
);

const WIP_TARGETS = Object.freeze({
  BACKLOG: null,
  TODO: 16,
  IN_PROGRESS: 12,
  REVIEW: 8,
  ON_HOLD: 10,
  DONE: null,
  ARCHIVED: null,
});

function toSafeDate(value) {
  if (!value) return null;
  const parsed = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isHighPriority(priority) {
  const value = String(priority || '').toUpperCase();
  return value === 'HIGH' || value === 'CRITICAL';
}

function normalizePriority(priority) {
  const value = String(priority || '').toUpperCase();
  return value || 'N/A';
}

function getPriorityLabel(priority, tr) {
  const value = normalizePriority(priority);
  if (value === 'LOW') return tr('Low', 'Baixa');
  if (value === 'MEDIUM') return tr('Medium', 'Média');
  if (value === 'HIGH') return tr('High', 'Alta');
  if (value === 'CRITICAL') return tr('Critical', 'Crítica');
  return value;
}

function priorityClass(priority) {
  const value = normalizePriority(priority);
  if (value === 'CRITICAL') return 'chip chip-danger';
  if (value === 'HIGH') return 'chip chip-warning';
  if (value === 'MEDIUM') return 'chip chip-subtle';
  if (value === 'LOW') return 'chip chip-success';
  return 'chip chip-subtle';
}

export default function Kanban({
  language = 'en',
  projects,
  showArchived,
  onToggleArchived,
  onOpenProject,
  onProjectStatusChange,
}) {
  const tr = (enText, ptBrText) => (language === 'pt-BR' ? ptBrText : enText);

  const visibleStatuses = showArchived
    ? Object.keys(STATUS_MAP)
    : Object.keys(STATUS_MAP).filter(status => status !== 'ARCHIVED');

  const [draggedOverCol, setDraggedOverCol] = useState(null);

  const groupedByStatus = useMemo(() => {
    const initial = Object.keys(STATUS_MAP).reduce((acc, key) => {
      acc[key] = [];
      return acc;
    }, {});

    projects.forEach(project => {
      const statusKey = project?.status && STATUS_MAP[project.status] ? project.status : 'BACKLOG';
      initial[statusKey].push(project);
    });

    return initial;
  }, [projects]);

  const governanceSnapshot = useMemo(() => {
    const today = new Date();
    today.setHours(12, 0, 0, 0);

    let overdueCount = 0;

    const byProject = new Map();
    const overdueByStatus = {};
    const highPriorityByStatus = {};

    projects.forEach(project => {
      const statusKey = project?.status && STATUS_MAP[project.status] ? project.status : 'BACKLOG';
      const doneLike = statusKey === 'DONE' || statusKey === 'ARCHIVED';
      const dueRaw = project?.dataFimPrevisto || project?.dueDate;
      const dueDate = toSafeDate(dueRaw);
      const overdue = Boolean(dueDate && dueDate < today && !doneLike);
      const highPriority = isHighPriority(project?.priority) && !doneLike;

      if (overdue) overdueCount += 1;

      overdueByStatus[statusKey] = (overdueByStatus[statusKey] || 0) + (overdue ? 1 : 0);
      highPriorityByStatus[statusKey] = (highPriorityByStatus[statusKey] || 0) + (highPriority ? 1 : 0);
      byProject.set(String(project?.id), { overdue, highPriority, dueDate });
    });

    return {
      overdueCount,
      overdueByStatus,
      highPriorityByStatus,
      byProject,
    };
  }, [projects]);

  const wipColumnsWithBreach = useMemo(() => {
    return Object.entries(WIP_TARGETS).reduce((count, [statusKey, target]) => {
      if (!target || statusKey === 'DONE' || statusKey === 'ARCHIVED') return count;
      const current = groupedByStatus[statusKey]?.length || 0;
      return current > target ? count + 1 : count;
    }, 0);
  }, [groupedByStatus]);

  const kpis = useMemo(() => {
    const activeProjects = projects.filter(project => project.status !== 'ARCHIVED');
    const locale = language === 'pt-BR' ? 'pt-BR' : 'en-US';
    const formatCurrency = value =>
      new Intl.NumberFormat(locale, { style: 'currency', currency: 'BRL' }).format(value);
    const totalEstimado = activeProjects.reduce((sum, project) => sum + Number(project.ganhoEstimado || 0), 0);
    const totalRealizado = activeProjects.reduce((sum, project) => sum + Number(project.ganhoRealizado || 0), 0);

    return {
      totalProjects: activeProjects.length,
      totalEstimado: formatCurrency(totalEstimado),
      totalRealizado: formatCurrency(totalRealizado),
      realizedVsTargetPct: totalEstimado > 0
        ? `${Math.min(999, Math.round((totalRealizado / totalEstimado) * 100))}%`
        : '0%',
    };
  }, [language, projects]);

  function handleDragStart(event, projectId) {
    event.dataTransfer.setData('projectId', projectId);
  }

  function handleDragOver(event, statusKey) {
    event.preventDefault();
    setDraggedOverCol(statusKey);
  }

  function handleDrop(event, statusKey) {
    event.preventDefault();
    const projectId = event.dataTransfer.getData('projectId');
    if (projectId) {
      onProjectStatusChange(projectId, statusKey);
    }
    setDraggedOverCol(null);
  }

  const topMetrics = [
    { label: tr('Active Projects', 'Projetos ativos'), value: kpis.totalProjects, tone: 'neutral' },
    {
      label: tr('WIP Breaches', 'Quebras de WIP'),
      value: wipColumnsWithBreach,
      tone: wipColumnsWithBreach > 0 ? 'warning' : 'success',
      helper:
        wipColumnsWithBreach > 0
          ? tr('Columns above target', 'Colunas acima da meta')
          : tr('All WIP columns stable', 'Todas as colunas de WIP estáveis'),
    },
    {
      label: tr('Overdue Items', 'Itens atrasados'),
      value: governanceSnapshot.overdueCount,
      tone: governanceSnapshot.overdueCount > 0 ? 'danger' : 'success',
      helper:
        governanceSnapshot.overdueCount > 0
          ? tr('Needs attention', 'Precisa de atenção')
          : tr('No overdue projects', 'Sem projetos atrasados'),
    },
    {
      label: tr('Realized Value', 'Valor realizado'),
      value: kpis.totalRealizado,
      tone: 'neutral',
      helper: `${tr('Forecast', 'Previsão')} ${kpis.totalEstimado}`,
    },
  ];

  return (
    <ViewScaffold
      className={['projects-view-fit', FOUNDATION_V1_ENABLED ? 'kanban-clarity-v1' : ''].filter(Boolean).join(' ')}
      eyebrow={tr('Execution lanes', 'Esteiras de execução')}
      title={tr('Project Board', 'Quadro de projetos')}
      description={tr(
        'Manage priorities, governance pressure and delivery flow with drag-and-drop lanes.',
        'Gerencie prioridades, pressão de governança e fluxo de entrega com colunas de arrastar e soltar.',
      )}
      actions={(
        <button onClick={onToggleArchived} className={`${ui.button.base} ${ui.button.subtle} ds-focus-ring`}>
          {showArchived ? tr('Hide Archived', 'Ocultar arquivados') : tr('Show Archived', 'Mostrar arquivados')}
        </button>
      )}
      metrics={topMetrics}
    >
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        <ViewPanel
          className="kanban-delivery-panel xl:col-span-12 p-3 sm:p-4"
          title={tr('Delivery Lanes', 'Esteiras de entrega')}
          subtitle={tr(
            'Move cards between statuses to keep ownership and timeline context synchronized.',
            'Mova cards entre status para manter responsabilidade e contexto de prazo sincronizados.',
          )}
          actions={(
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="chip chip-subtle">{tr('Drag and drop', 'Arrastar e soltar')}</span>
              <span className="chip chip-subtle">{tr('Density: Comfortable', 'Densidade: Confortável')}</span>
            </div>
          )}
        >
          <div className="kanban-board-wrap overflow-x-auto scroll-container pb-1 flex justify-start min-h-0">
            <div id="kanban-board" className={`flex ${FOUNDATION_V1_ENABLED ? 'gap-4' : 'space-x-4'} min-w-max h-full`}>
              {visibleStatuses.map(statusKey => {
                const colProjects = groupedByStatus[statusKey] || [];
                const count = colProjects.length;
                const statusColor = getStatusMeta(statusKey).color;
                const wipTarget = WIP_TARGETS[statusKey];
                const isWipBreached = Boolean(wipTarget && count > wipTarget);
                const overdueInColumn = governanceSnapshot.overdueByStatus[statusKey] || 0;
                const highPriorityInColumn = governanceSnapshot.highPriorityByStatus[statusKey] || 0;

                return (
                  <div
                    key={statusKey}
                    className={`kanban-column ${FOUNDATION_V1_ENABLED ? 'kanban-column-v1 w-[22rem]' : 'w-[21rem]'} flex-shrink-0 p-3 surface-card transition-colors duration-300 ${
                      draggedOverCol === statusKey ? 'ring-2 ring-primary/35' : ''
                    }`}
                    onDragOver={event => handleDragOver(event, statusKey)}
                    onDrop={event => handleDrop(event, statusKey)}
                    onDragLeave={() => setDraggedOverCol(null)}
                  >
                    <header className="space-y-2 mb-3">
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="text-[11px] font-semibold uppercase text-muted-foreground tracking-[0.14em] flex items-center gap-2">
                          <span style={{ color: statusColor }}>&bull;</span>
                          {getStatusLabel(statusKey, language)}
                        </h3>
                        <span className="chip chip-subtle">{count}</span>
                      </div>

                      {FOUNDATION_V1_ENABLED && (
                        <div className="flex flex-wrap items-center gap-1">
                          {wipTarget ? (
                            <span className={`chip ${isWipBreached ? 'chip-danger' : 'chip-subtle'}`}>
                              WIP {count}/{wipTarget}
                            </span>
                          ) : null}
                          {overdueInColumn > 0 ? (
                            <span className="chip chip-danger">
                              {tr('Overdue', 'Atrasado')} {overdueInColumn}
                            </span>
                          ) : null}
                          {highPriorityInColumn > 0 ? (
                            <span className="chip chip-warning">
                              {tr('High', 'Alta')} {highPriorityInColumn}
                            </span>
                          ) : null}
                        </div>
                      )}

                      <div className="h-1 rounded-full" style={{ backgroundColor: statusColor }} />
                    </header>

                    <div className="kanban-column-body space-y-3 scroll-container overflow-y-auto pr-1">
                      {colProjects.length > 0 ? (
                        colProjects.map(project => {
                          const projectGovernance = governanceSnapshot.byProject.get(String(project.id)) || {
                            overdue: false,
                            highPriority: false,
                          };

                          return (
                            <div
                              key={project.id}
                              className={`project-card ${FOUNDATION_V1_ENABLED ? 'project-card-v1' : ''} space-y-3 ds-focus-ring`}
                              onClick={() => onOpenProject(project.id)}
                              draggable
                              onDragStart={event => handleDragStart(event, project.id)}
                              role="button"
                              tabIndex={0}
                              onKeyDown={event => {
                                if (event.key === 'Enter' || event.key === ' ') {
                                  event.preventDefault();
                                  onOpenProject(project.id);
                                }
                              }}
                              aria-label={`${tr('Open project', 'Abrir projeto')} ${project.title || project.id}`}
                            >
                              <div className="flex justify-between items-start gap-2">
                                <h4 className={`${FOUNDATION_V1_ENABLED ? 'kanban-card-title' : 'font-semibold'} text-[--card-foreground] pr-2 line-clamp-2`}>
                                  {project.title}
                                </h4>
                                <span className={priorityClass(project.priority)}>{getPriorityLabel(project.priority, tr)}</span>
                              </div>

                              {FOUNDATION_V1_ENABLED && (
                                <div className="kanban-governance-strip">
                                  {projectGovernance.overdue ? (
                                    <span className="chip chip-danger">{tr('Overdue', 'Atrasado')}</span>
                                  ) : null}
                                  {projectGovernance.highPriority ? (
                                    <span className="chip chip-warning">{tr('Priority escalation', 'Prioridade crítica')}</span>
                                  ) : null}
                                </div>
                              )}

                              {project.description ? (
                                <p className="text-xs text-muted-foreground truncate" title={project.description}>
                                  {project.description}
                                </p>
                              ) : null}

                              <div className="flex justify-between items-center text-xs text-muted-foreground pt-2 border-t border-border/70 gap-2">
                                <span className="truncate">{project.employeeName || tr('Unassigned', 'Não atribuído')}</span>
                                <span className="shrink-0">
                                  {project.dataFimPrevisto || project.dueDate || tr('No due date', 'Sem prazo')}
                                </span>
                              </div>
                            </div>
                          );
                        })
                      ) : (
                        <div className="text-center text-sm text-muted-foreground p-6 border-2 border-dashed border-border rounded-xl">
                          {tr('No projects here.', 'Sem projetos nesta coluna.')}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </ViewPanel>
      </div>
    </ViewScaffold>
  );
}
