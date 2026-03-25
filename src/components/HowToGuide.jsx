import {
  ArrowRight,
  CalendarClock,
  CircleHelp,
  FileSpreadsheet,
  Gauge,
  KanbanSquare,
  Lightbulb,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react';
import { ui } from '../ui/visuals';

export default function HowToGuide({ language = 'en', onOpenImport, onCreateProject, onViewProjects }) {
  const tr = (enText, ptBrText) => (language === 'pt-BR' ? ptBrText : enText);

  const playbookPhases = [
    {
      step: '01',
      title: tr('Intake and normalize', 'Captura e normalizacao'),
      description: tr(
        'Import your spreadsheet and validate required fields before sending items into operations.',
        'Importe sua planilha e valide campos obrigatorios antes de enviar itens para operacao.',
      ),
      icon: FileSpreadsheet,
    },
    {
      step: '02',
      title: tr('Sequence execution', 'Sequenciar execução'),
      description: tr(
        'Move projects through lane statuses and keep roadmap dates realistic.',
        'Mova projetos pelas esteiras de status e mantenha datas do cronograma realistas.',
      ),
      icon: KanbanSquare,
    },
    {
      step: '03',
      title: tr('Steer by signal', 'Conduzir por sinal'),
      description: tr(
        'Use dashboard deltas and alerts to prioritize unblock actions every week.',
        'Use deltas e alertas do dashboard para priorizar desbloqueios toda semana.',
      ),
      icon: Gauge,
    },
    {
      step: '04',
      title: tr('Close governance loop', 'Fechar ciclo de governanca'),
      description: tr(
        'Document outcomes, value and owner accountability in one historical trace.',
        'Documente resultado, valor e accountability do dono em uma trilha historica unica.',
      ),
      icon: ShieldCheck,
    },
  ];

  const useCases = [
    tr(
      'Weekly operating review: compare backlog pressure vs completed output and assign unblock owners.',
      'Revisao semanal: comparar pressao de backlog vs output concluido e designar donos para desbloqueio.',
    ),
    tr(
      'Financial steering: update realized gains and inspect trend drops by period.',
      'Steering financeiro: atualizar ganho realizado e inspecionar quedas de tendência por periodo.',
    ),
    tr(
      'Roadmap triage: isolate unscheduled items and assign start/estimated end in batch.',
      'Triagem de cronograma: isolar itens sem agendamento e definir inicio/fim estimado em lote.',
    ),
  ];

  const frequentIssues = [
    tr('Title column missing in spreadsheet import.', 'Coluna de titulo ausente na importacao da planilha.'),
    tr('Dates in mixed formats causing invalid timeline bars.', 'Datas em formatos mistos causando barras invalidas na timeline.'),
    tr('Custom status labels outside platform status map.', 'Rotulos de status fora do mapa padrão da plataforma.'),
  ];

  return (
    <div className="playbook-shell p-6 sm:p-7 space-y-6">
      <header className="playbook-hero surface-card p-5 sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-2">
            <h2 className="text-2xl font-semibold text-foreground flex items-center gap-2">
              <CircleHelp className="w-5 h-5 text-primary" />
              {tr('Operations Playbook', 'Playbook operacional')}
            </h2>
            <p className="text-sm text-muted-foreground max-w-3xl">
              {tr(
                'A practical runbook to move from imported data to reliable portfolio execution.',
                'Um runbook pratico para sair dos dados importados e chegar em execução confiável de portfólio.',
              )}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={onOpenImport} className={`${ui.button.base} ${ui.button.primary}`}>
              <FileSpreadsheet className="w-4 h-4" />
              {tr('Import Spreadsheet', 'Importar planilha')}
            </button>
            <button type="button" onClick={onCreateProject} className={`${ui.button.base} ${ui.button.subtle}`}>
              {tr('Create Project', 'Criar projeto')}
              <ArrowRight className="w-4 h-4" />
            </button>
            <button type="button" onClick={onViewProjects} className={`${ui.button.base} ${ui.button.subtle}`}>
              <KanbanSquare className="w-4 h-4" />
              {tr('Open Board', 'Abrir board')}
            </button>
          </div>
        </div>
      </header>

      <section className="playbook-phase-grid">
        {playbookPhases.map(phase => {
          const Icon = phase.icon;
          return (
            <article key={phase.step} className="playbook-phase-card surface-card p-4">
              <div className="flex items-center justify-between">
                <span className="chip chip-subtle">{phase.step}</span>
                <Icon className="w-4 h-4 text-primary" />
              </div>
              <h3 className="text-lg font-semibold text-foreground mt-3">{phase.title}</h3>
              <p className="text-sm text-muted-foreground mt-2 leading-relaxed">{phase.description}</p>
            </article>
          );
        })}
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        <article className="surface-card p-5 xl:col-span-7 space-y-3">
          <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground flex items-center gap-2">
            <Lightbulb className="w-4 h-4 text-primary" />
            {tr('Operational Use Cases', 'Casos de uso operacionais')}
          </h3>
          <div className="space-y-3 text-sm text-muted-foreground">
            {useCases.map(item => (
              <p key={item} className="leading-relaxed">
                - {item}
              </p>
            ))}
          </div>
        </article>

        <article className="surface-card p-5 xl:col-span-5 space-y-3">
          <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground flex items-center gap-2">
            <CalendarClock className="w-4 h-4 text-primary" />
            {tr('Weekly Ritual', 'Ritual semanal')}
          </h3>
          <ol className="space-y-2 text-sm text-muted-foreground list-decimal pl-5">
            <li>{tr('Refresh imports and data quality checks.', 'Atualizar importacoes e checagens de qualidade.')}</li>
            <li>{tr('Review WIP breaches and overdue roadmap cards.', 'Revisar quebras de WIP e cards atrasados no cronograma.')}</li>
            <li>{tr('Commit owners and deadlines for unblock actions.', 'Definir donos e prazos para desbloqueios.')}</li>
            <li>{tr('Capture deltas in dashboard for leadership readout.', 'Registrar deltas no dashboard para leitura executiva.')}</li>
          </ol>
        </article>
      </section>

      <section className="surface-card p-5 space-y-3">
        <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground flex items-center gap-2">
          <TriangleAlert className="w-4 h-4 text-amber-500" />
          {tr('Frequent Failure Modes', 'Falhas recorrentes')}
        </h3>
        <div className="space-y-2 text-sm text-muted-foreground">
          {frequentIssues.map(item => (
            <p key={item}>- {item}</p>
          ))}
        </div>
      </section>
    </div>
  );
}
