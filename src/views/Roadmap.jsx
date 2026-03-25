import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, ClipboardEdit, ListX, RotateCcw, User2 } from 'lucide-react';
import Gantt from '../components/Gantt';
import { getStatusLabel, STATUS_MAP } from '../utils/constants';
import { getStatusMeta, ui } from '../ui/visuals';
import { ViewPanel, ViewScaffold } from '../components/ViewScaffold';

const STATUS_KEYS = ['BACKLOG', 'TODO', 'IN_PROGRESS', 'REVIEW', 'ON_HOLD', 'DONE'];

const PRIORITY_ORDER = {
  CRITICAL: 5,
  HIGH: 4,
  MEDIUM: 3,
  LOW: 2,
  BACKLOG: 1,
};

function getPriorityWeight(priority) {
  const key = String(priority || '').toUpperCase();
  return PRIORITY_ORDER[key] || 0;
}

function priorityBadgeClass(priority) {
  const key = String(priority || '').toUpperCase();
  if (key === 'CRITICAL' || key === 'HIGH') return 'chip chip-danger';
  if (key === 'MEDIUM') return 'chip chip-warning';
  if (key === 'LOW') return 'chip chip-success';
  return 'chip chip-subtle';
}

function priorityLabel(priority, tr) {
  const key = String(priority || '').toUpperCase();
  if (key === 'CRITICAL') return tr('Critical', 'Crítica');
  if (key === 'HIGH') return tr('High', 'Alta');
  if (key === 'MEDIUM') return tr('Medium', 'Média');
  if (key === 'LOW') return tr('Low', 'Baixa');
  return key || 'N/A';
}

function normalizeStatusKey(value) {
  const raw = String(value || '').trim();
  if (!raw) return 'TODO';
  const upper = raw.toUpperCase();
  if (STATUS_MAP[upper]) return upper;

  const normalized = upper.replace(/[\s-]+/g, '_');
  if (STATUS_MAP[normalized]) return normalized;

  const aliases = {
    'TO DO': 'TODO',
    'IN PROGRESS': 'IN_PROGRESS',
    'ON HOLD': 'ON_HOLD',
    COMPLETED: 'DONE',
    'A FAZER': 'TODO',
    'EM PROGRESSO': 'IN_PROGRESS',
    REVISAO: 'REVIEW',
    REVISÃO: 'REVIEW',
    'EM ESPERA': 'ON_HOLD',
    CONCLUIDO: 'DONE',
    CONCLUÍDO: 'DONE',
  };
  return aliases[upper] || aliases[normalized] || 'TODO';
}

export default function Roadmap({
  language = 'en',
  tasks = [],
  onClickTask,
  onDateChange,
  unscheduled = [],
  onOpenProject,
  onProjectStatusChange,
}) {
  const tr = (enText, ptBrText) => (language === 'pt-BR' ? ptBrText : enText);
  const [selectedStatuses, setSelectedStatuses] = useState(() => new Set(STATUS_KEYS));
  const [unscheduledLimit, setUnscheduledLimit] = useState(60);

  const statusOptions = useMemo(
    () => STATUS_KEYS.map(key => ({
      key,
      label: getStatusLabel(key, language),
      color: getStatusMeta(key).color,
    })),
    [language],
  );

  function toggleStatus(key) {
    setSelectedStatuses(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const visibleTasks = useMemo(() => {
    if (!tasks?.length || selectedStatuses.size === 0) return [];
    return tasks.filter(task => selectedStatuses.has(normalizeStatusKey(task.status)));
  }, [tasks, selectedStatuses]);

  const visibleUnscheduled = useMemo(() => {
    if (!unscheduled?.length || selectedStatuses.size === 0) return [];
    return unscheduled.filter(project => selectedStatuses.has(normalizeStatusKey(project.status)));
  }, [unscheduled, selectedStatuses]);

  const sortedUnscheduled = useMemo(() => {
    return [...visibleUnscheduled].sort((a, b) => {
      const byPriority = getPriorityWeight(b.priority) - getPriorityWeight(a.priority);
      if (byPriority !== 0) return byPriority;

      const categoryA = String(a.categoriaKaizen || '').toLowerCase();
      const categoryB = String(b.categoriaKaizen || '').toLowerCase();
      if (categoryA !== categoryB) return categoryA.localeCompare(categoryB);

      return String(a.title || '').localeCompare(String(b.title || ''));
    });
  }, [visibleUnscheduled]);

  useEffect(() => {
    setUnscheduledLimit(60);
  }, [selectedStatuses, tasks, unscheduled]);

  const displayedUnscheduled = useMemo(
    () => sortedUnscheduled.slice(0, unscheduledLimit),
    [sortedUnscheduled, unscheduledLimit],
  );

  const hasMoreUnscheduled = sortedUnscheduled.length > displayedUnscheduled.length;
  const handleGanttClick = useCallback(task => onClickTask?.(task), [onClickTask]);
  const handleGanttDateChange = useCallback(
    (task, start, end) => onDateChange?.(task, start, end),
    [onDateChange],
  );

  const topMetrics = [
    {
      label: tr('Visible timeline items', 'Itens visíveis na timeline'),
      value: visibleTasks.length,
      helper: `${tasks.length} ${tr('total with dates', 'no total com datas')}`,
      tone: 'neutral',
    },
    {
      label: tr('Unscheduled backlog', 'Backlog sem agendamento'),
      value: sortedUnscheduled.length,
      helper: tr('Prioritized by urgency and category', 'Priorizado por urgencia e categoria'),
      tone: sortedUnscheduled.length > 0 ? 'warning' : 'success',
    },
  ];

  return (
    <ViewScaffold
      className="roadmap-view"
      eyebrow={tr('Timeline control', 'Controle de timeline')}
      title={tr('Project Roadmap', 'Roadmap de projetos')}
      description={tr(
        'Track delivery windows, pressure points and unscheduled demand in one operational timeline.',
        'Acompanhe janelas de entrega, pontos de pressão e demanda não agendada em uma timeline operacional.',
      )}
      metrics={topMetrics}
      actions={(
        <button
          type="button"
          onClick={() => setSelectedStatuses(new Set(STATUS_KEYS))}
          className={`${ui.button.base} ${ui.button.subtle}`}
        >
          <RotateCcw className="w-4 h-4" />
          {tr('Reset statuses', 'Resetar status')}
        </button>
      )}
    >
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        <ViewPanel
          className="xl:col-span-12"
          title={tr('Delivery Timeline', 'Timeline de entrega')}
          subtitle={tr(
            'Date-driven projects stay in the gantt flow; drag and date edits continue to work exactly as before.',
            'Projetos com datas ficam no fluxo do gantt; arrastar e edição de datas seguem funcionando como antes.',
          )}
        >
          <div className="mb-1 flex flex-wrap gap-2 text-sm">
            {statusOptions.map(opt => {
              const active = selectedStatuses.has(opt.key);
              return (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => toggleStatus(opt.key)}
                  className={
                    'inline-flex items-center gap-2 px-3 py-1.5 rounded-md border text-xs md:text-sm font-semibold transition ' +
                    (active
                      ? 'bg-primary/15 border-primary/45 text-foreground shadow-sm'
                      : 'border-border text-muted-foreground hover:bg-card hover:text-foreground')
                  }
                >
                  <span
                    className="w-3 h-3 rounded-full"
                    style={{
                      backgroundColor: active ? opt.color : 'transparent',
                      border: `1px solid ${opt.color}`,
                    }}
                  />
                  <span>{opt.label}</span>
                </button>
              );
            })}
          </div>

          <div className="rounded-lg border border-border/70 bg-muted/20 p-3 space-y-3">
            <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-2">
                <span className="w-3 h-3 rounded-sm bg-muted-foreground/55 border border-muted-foreground/45" />
                {tr('Planned remaining (Estimated End Date)', 'Restante planejado (Data fim estimada)')}
              </span>
              <span className="inline-flex items-center gap-2">
                <span className="w-3 h-3 rounded-sm bg-rose-500/65 border border-rose-400/70" />
                {tr('Overdue portion (past estimated end)', 'Trecho atrasado (após fim estimado)')}
              </span>
            </div>

            {visibleTasks.length > 0 ? (
              <Gantt
                language={language}
                tasks={visibleTasks}
                onClick={handleGanttClick}
                onDateChange={handleGanttDateChange}
              />
            ) : (
              <div className="h-32 flex items-center justify-center text-sm text-muted-foreground">
                {tr('No projects in the roadmap for the selected statuses.', 'Sem projetos no roadmap para os status selecionados.')}
              </div>
            )}
          </div>
        </ViewPanel>
      </div>

      <ViewPanel
        title={tr('Unscheduled Projects', 'Projetos sem agendamento')}
        subtitle={tr(
          'Cards without full date windows stay here so planning teams can assign start and estimated end quickly.',
          'Cards sem janela completa de datas ficam aqui para o time de planejamento atribuir início e fim estimado.',
        )}
        actions={<span className="chip chip-subtle">{displayedUnscheduled.length}/{sortedUnscheduled.length} {tr('items', 'itens')}</span>}
      >
        {displayedUnscheduled.length === 0 ? (
          <div className="surface-card p-8 text-center space-y-2">
            <ListX className="w-7 h-7 mx-auto text-muted-foreground" />
            <p className="text-sm font-semibold text-foreground">{tr('No unscheduled projects', 'Sem projetos sem agendamento')}</p>
            <p className="text-xs text-muted-foreground">
              {tr(
                'All visible projects already have timeline start and estimated end dates.',
                'Todos os projetos visíveis já possuem data inicial e data final estimada.',
              )}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {displayedUnscheduled.map(project => (
              <article key={project.id} className="surface-card p-4 flex flex-col gap-3">
                <div className="flex items-start justify-between gap-2">
                  <h4 className="font-semibold text-foreground leading-snug line-clamp-2">{project.title || tr('Untitled project', 'Projeto sem título')}</h4>
                  <span className={priorityBadgeClass(project.priority)}>{priorityLabel(project.priority, tr)}</span>
                </div>

                <div className="flex flex-wrap gap-1.5 text-[11px]">
                  {project.categoriaKaizen && <span className="chip chip-subtle">{project.categoriaKaizen}</span>}
                  {project.impactoComite && <span className="chip chip-subtle">{project.impactoComite}</span>}
                  {project.status && <span className="chip chip-subtle">{getStatusLabel(normalizeStatusKey(project.status), language)}</span>}
                </div>

                <div className="space-y-1 text-xs text-muted-foreground">
                  <p className="inline-flex items-center gap-1.5">
                    <User2 className="w-3.5 h-3.5" />
                    {project.employeeName || tr('Unassigned', 'Não atribuído')}
                  </p>
                  <p className="inline-flex items-center gap-1.5">
                    <CalendarDays className="w-3.5 h-3.5" />
                    {project.startDate || project.chegada
                      ? `${tr('Start', 'Início')}: ${project.startDate || project.chegada}`
                      : tr('Start date missing', 'Sem data de início')}
                  </p>
                  <p className="inline-flex items-center gap-1.5">
                    <CalendarDays className="w-3.5 h-3.5" />
                    {project.dueDate || project.dataFimPrevisto
                      ? `${tr('Estimated end', 'Fim estimado')}: ${project.dueDate || project.dataFimPrevisto}`
                      : tr('Estimated end missing', 'Sem fim estimado')}
                  </p>
                </div>

                <div className="mt-auto pt-2 border-t border-border/70 flex flex-wrap items-center gap-2">
                  <button type="button" onClick={() => onOpenProject?.(project.id)} className={`${ui.button.base} ${ui.button.subtle}`}>
                    <ClipboardEdit className="w-4 h-4" />
                    {tr('Edit', 'Editar')}
                  </button>

                  <button type="button" onClick={() => onOpenProject?.(project.id)} className={`${ui.button.base} ${ui.button.subtle}`}>
                    {tr('Schedule', 'Agendar')}
                  </button>

                  <select
                    value={normalizeStatusKey(project.status)}
                    onChange={e => onProjectStatusChange?.(project.id, e.target.value)}
                    className={`${ui.field.select} h-10 min-w-[8rem] ml-auto`}
                  >
                    {statusOptions.map(option => (
                      <option key={option.key} value={option.key}>{option.label}</option>
                    ))}
                  </select>
                </div>
              </article>
            ))}
          </div>
        )}

        {hasMoreUnscheduled && (
          <div className="mt-4 flex justify-center">
            <button
              type="button"
              className={`${ui.button.base} ${ui.button.subtle}`}
              onClick={() => setUnscheduledLimit(prev => prev + 60)}
            >
              {tr('Load 60 more', 'Carregar mais 60')}
            </button>
          </div>
        )}
      </ViewPanel>
    </ViewScaffold>
  );
}
