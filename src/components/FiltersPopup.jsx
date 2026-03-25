import { useEffect } from 'react';
import { X, FilterX, Check } from 'lucide-react';
import { ui } from '../ui/visuals';

function SectionTitle({ children }) {
  return (
    <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground mb-2">
      {children}
    </h3>
  );
}

function MultiSelectChips({ values = [], selected = [], onToggle, emptyLabel }) {
  if (!values.length) {
    return <p className="text-xs text-muted-foreground">{emptyLabel}</p>;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {values.map(value => {
        const active = selected.includes(value);
        return (
            <button
              key={value}
              type="button"
              onClick={() => onToggle(value)}
              className={`filter-chip px-2.5 py-1.5 rounded-md text-xs border transition ${
                active
                  ? 'is-active border-primary/70 bg-primary/20 text-foreground'
                  : 'border-border/70 text-muted-foreground hover:text-foreground hover:border-primary/35'
              }`}
            >
              {active ? <Check className="filter-chip-check w-3 h-3" /> : null}
              <span>{value}</span>
          </button>
        );
      })}
    </div>
  );
}

export default function FiltersPopup({
  open,
  language = 'en',
  draft,
  setDraft,
  options,
  activeCount = 0,
  onClose,
  onApply,
  onClear,
}) {
  const tr = (enText, ptBrText) => (language === 'pt-BR' ? ptBrText : enText);

  useEffect(() => {
    if (!open) return undefined;
    const onEsc = e => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [open, onClose]);

  if (!open) return null;

  const toggleArrayValue = (key, value) => {
    setDraft(prev => {
      const current = Array.isArray(prev?.[key]) ? prev[key] : [];
      const nextValues = current.includes(value)
        ? current.filter(item => item !== value)
        : [...current, value];
      return { ...prev, [key]: nextValues };
    });
  };

  return (
    <div className="overlay-scrim fixed inset-0 z-[70] backdrop-blur-md" onClick={onClose}>
      <div className="absolute inset-x-0 bottom-0 p-3 sm:p-6 sm:inset-0 sm:flex sm:items-center sm:justify-center" onClick={e => e.stopPropagation()}>
        <section className={`frame-elevated-shadow relative w-full sm:max-w-4xl max-h-[90vh] overflow-hidden rounded-t-[0.95rem] sm:rounded-[0.95rem] border border-border/85 ${ui.card.glass}`}>
          <header className="p-4 sm:p-5 border-b border-border/70 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg sm:text-xl font-semibold text-foreground">{tr('Filters', 'Filtros')}</h2>
              <p className="text-xs text-muted-foreground mt-1">
                {activeCount > 0
                  ? tr(`${activeCount} active filters`, `${activeCount} filtros ativos`)
                  : tr('No active filters', 'Nenhum filtro ativo')}
              </p>
            </div>
            <button type="button" onClick={onClose} className={`${ui.button.base} ${ui.button.icon} ${ui.button.ghost}`} aria-label="Close filters">
              <X className="w-4 h-4" />
            </button>
          </header>

          <div className="scroll-container overflow-y-auto max-h-[calc(90vh-9.75rem)] p-4 sm:p-5 space-y-5">
            <section className="surface-card p-4">
              <SectionTitle>{tr('Date Range', 'Período')}</SectionTitle>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="space-y-1.5">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-[0.11em]">{tr('From', 'De')}</span>
                  <input
                    type="date"
                    value={draft?.dateFrom || ''}
                    onChange={e => setDraft(prev => ({ ...prev, dateFrom: e.target.value }))}
                    className={ui.field.date}
                  />
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-[0.11em]">{tr('To', 'Até')}</span>
                  <input
                    type="date"
                    value={draft?.dateTo || ''}
                    onChange={e => setDraft(prev => ({ ...prev, dateTo: e.target.value }))}
                    className={ui.field.date}
                  />
                </label>
              </div>
            </section>

            <section className="surface-card p-4">
              <SectionTitle>{tr('Status', 'Status')}</SectionTitle>
              <MultiSelectChips
                values={options?.statuses || []}
                selected={draft?.statuses || []}
                onToggle={value => toggleArrayValue('statuses', value)}
                emptyLabel={tr('No status options found.', 'Nenhuma opção de status encontrada.')}
              />
            </section>

            <section className="surface-card p-4">
              <SectionTitle>{tr('Earning Status', 'Status do ganho')}</SectionTitle>
              <MultiSelectChips
                values={options?.earningStatuses || []}
                selected={draft?.earningStatuses || []}
                onToggle={value => toggleArrayValue('earningStatuses', value)}
                emptyLabel={tr('No earning status options found.', 'Nenhuma opção de status de ganho encontrada.')}
              />
            </section>

            <section className="surface-card p-4">
              <SectionTitle>{tr('Unscheduled', 'Sem agendamento')}</SectionTitle>
              <label className="choice-hit">
                <input
                  type="checkbox"
                  className="choice-control"
                  checked={!!draft?.unscheduled}
                  onChange={e => setDraft(prev => ({ ...prev, unscheduled: e.target.checked }))}
                />
                <span className="text-sm text-foreground">{tr('Only show unscheduled projects', 'Mostrar apenas projetos sem cronograma')}</span>
              </label>
            </section>

            <section className="surface-card p-4">
              <SectionTitle>{tr('Committee Impact', 'Impacto Comitê')}</SectionTitle>
              <MultiSelectChips
                values={options?.committeeImpacts || []}
                selected={draft?.committeeImpacts || []}
                onToggle={value => toggleArrayValue('committeeImpacts', value)}
                emptyLabel={tr('No committee impact values found.', 'Nenhum valor de impacto de comitê encontrado.')}
              />
            </section>

            <section className="surface-card p-4">
              <SectionTitle>{tr('Categoria Kaizen', 'Categoria Kaizen')}</SectionTitle>
              <MultiSelectChips
                values={options?.kaizenCategories || []}
                selected={draft?.kaizenCategories || []}
                onToggle={value => toggleArrayValue('kaizenCategories', value)}
                emptyLabel={tr('No Kaizen categories found.', 'Nenhuma categoria Kaizen encontrada.')}
              />
            </section>

            <section className="surface-card p-4">
              <SectionTitle>{tr('Other Filters', 'Outros filtros')}</SectionTitle>
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground uppercase tracking-[0.11em]">{tr('Priority', 'Prioridade')}</p>
                <MultiSelectChips
                  values={options?.priorities || []}
                  selected={draft?.priorities || []}
                  onToggle={value => toggleArrayValue('priorities', value)}
                  emptyLabel={tr('No priority values found.', 'Nenhum valor de prioridade encontrado.')}
                />
              </div>
            </section>
          </div>

          <footer className="p-4 sm:p-5 border-t border-border/70 flex flex-wrap items-center justify-end gap-2">
            <button type="button" onClick={onClose} className={`${ui.button.base} ${ui.button.subtle}`}>
              {tr('Cancel', 'Cancelar')}
            </button>
            <button type="button" onClick={onClear} className={`${ui.button.base} ${ui.button.ghost}`}>
              <FilterX className="w-4 h-4" />
              {tr('Clear', 'Limpar')}
            </button>
            <button type="button" onClick={onApply} className={`${ui.button.base} ${ui.button.primary}`}>
              {tr('Apply', 'Aplicar')}
            </button>
          </footer>
        </section>
      </div>
    </div>
  );
}

