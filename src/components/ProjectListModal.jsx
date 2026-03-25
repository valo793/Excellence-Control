import Modal from './Modal';
import { getStatusLabel } from '../utils/constants';
import { getStatusMeta, ui } from '../ui/visuals';

export default function ProjectListModal({ language = 'en', open, onClose, title, rows, onOpenProject }) {
  const tr = (enText, ptBrText) => (language === 'pt-BR' ? ptBrText : enText);

  return (
    <Modal open={open} onClose={onClose} maxWidth="max-w-5xl">
      <div className="sticky top-0 z-10 px-6 py-5 border-b border-border/70 bg-background/92 backdrop-blur-md flex items-start justify-between gap-4">
        <div>
          <h2 className={ui.text.sectionTitle}>{title}</h2>
          <p className={`${ui.text.muted} mt-1`}>{rows.length} {tr('projects found for this segment.', 'projetos encontrados para este segmento.')}</p>
        </div>
        <span className={`${ui.badge.base} ${ui.badge.subtle}`}>{tr('Detailed list', 'Lista detalhada')}</span>
      </div>

      <div className="p-6 space-y-4 min-h-[320px]">
        {rows.length > 0 ? (
          rows.map(p => {
            const meta = getStatusMeta(p.status);
            const statusText = p.status ? getStatusLabel(p.status, language) : tr('No status', 'Sem status');
            return (
              <article
                key={p.id}
                onClick={() => {
                  onClose();
                  onOpenProject(p.id);
                }}
                className={`${ui.card.interactive} p-5 cursor-pointer relative overflow-hidden`}
              >
                <div className="absolute left-0 top-0 bottom-0 w-1.5" style={{ backgroundColor: meta.color }} />
                <div className="pl-3 flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <h3 className="text-lg font-semibold text-foreground truncate">{p.title}</h3>
                      <span className={`chip ${meta.badgeClass}`}>{statusText}</span>
                    </div>
                    <p className="text-sm text-muted-foreground leading-relaxed">{p.description || tr('No description provided.', 'Sem descricao cadastrada.')}</p>
                    <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                      {p.employeeName && (
                        <div>
                          <strong className="text-foreground/80">{tr('Owner:', 'Responsável:')}</strong> {p.employeeName}
                        </div>
                      )}
                      {p.dueDate && (
                        <div>
                          <strong className="text-foreground/80">{tr('Due:', 'Prazo:')}</strong> {p.dueDate}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="text-muted-foreground text-sm font-semibold">{tr('Open', 'Abrir')}</div>
                </div>
              </article>
            );
          })
        ) : (
          <div className="surface-muted h-[220px] flex items-center justify-center text-muted-foreground text-sm">{tr('No projects found for this filter.', 'Nenhum projeto encontrado para este filtro.')}</div>
        )}
      </div>
    </Modal>
  );
}
