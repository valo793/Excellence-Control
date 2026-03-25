import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  History,
  Loader2,
  RefreshCw,
  RotateCcw,
  Search,
  Undo2,
  UserRound,
} from 'lucide-react';
import Modal from '../components/Modal';
import {
  adminGetUserAuditDetail,
  adminGetUserAuditLogs,
  adminRevertUserAuditLog,
} from '../config/oracle';
import { ui } from '../ui/visuals';
import { ViewPanel, ViewScaffold } from '../components/ViewScaffold';

const DEFAULT_FILTERS = Object.freeze({
  dateFrom: '',
  dateTo: '',
  actor: '',
  action: '',
  table: '',
  target: '',
});

function formatAuditTableLabel(value, language = 'en') {
  const table = String(value || '').trim().toUpperCase();
  if (table === 'APP_USERS') return language === 'pt-BR' ? 'Usuarios' : 'Users';
  if (table === 'PROJECTS') return language === 'pt-BR' ? 'Projetos' : 'Projects';
  if (table === 'PROJECT_EARNINGS') return language === 'pt-BR' ? 'Ganhos de projeto' : 'Project earnings';
  return table || '-';
}

function formatDateTime(value) {
  if (!value) return '-';
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return String(value);
  return dt.toLocaleString();
}

function toCompactValue(value) {
  if (value === null || value === undefined || value === '') return '-';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function ActionBadge({ action }) {
  const key = String(action || '').trim().toUpperCase();
  const styles = {
    C: 'border-emerald-500/45 bg-emerald-500/12 text-emerald-500',
    U: 'border-primary/45 bg-primary/12 text-emerald-300',
    D: 'border-rose-500/45 bg-rose-500/12 text-rose-500',
    R: 'border-emerald-300/45 bg-emerald-300/12 text-emerald-200',
  };
  return (
    <span className={`inline-flex items-center justify-center min-w-[1.6rem] rounded-full border px-2 py-0.5 text-[11px] font-semibold ${styles[key] || 'border-border bg-muted/60 text-muted-foreground'}`}>
      {key || '?'}
    </span>
  );
}

function JsonBlock({ title, value, language = 'en' }) {
  const tr = (enText, ptBrText) => (language === 'pt-BR' ? ptBrText : enText);
  return (
    <section className="surface-muted p-3 space-y-2 min-h-[12rem]">
      <h3 className="text-xs uppercase tracking-[0.12em] font-semibold text-muted-foreground">{title}</h3>
      <pre className="text-[11px] leading-relaxed whitespace-pre-wrap break-words text-foreground/90">
        {value ? JSON.stringify(value, null, 2) : tr('No data', 'Sem dados')}
      </pre>
    </section>
  );
}

export default function AdminAuditView({ language = 'en' }) {
  const tr = useCallback(
    (enText, ptBrText) => (language === 'pt-BR' ? ptBrText : enText),
    [language],
  );

  const [filtersDraft, setFiltersDraft] = useState(DEFAULT_FILTERS);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');

  const [revertOpen, setRevertOpen] = useState(false);
  const [revertLoading, setRevertLoading] = useState(false);
  const [revertError, setRevertError] = useState('');
  const [revertSuccess, setRevertSuccess] = useState('');

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil((Number(total) || 0) / pageSize)),
    [total, pageSize],
  );

  const fetchList = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const payload = await adminGetUserAuditLogs({
        ...filters,
        page,
        pageSize,
      });
      const items = Array.isArray(payload?.items) ? payload.items : [];
      setRows(items);
      setTotal(Number(payload?.total || 0));
      setSelectedId(prev => {
        if (prev && items.some(item => Number(item.id) === Number(prev))) return prev;
        return items[0]?.id ?? null;
      });
    } catch (err) {
      console.error(err);
      setRows([]);
      setTotal(0);
      setError(err?.message || tr('Failed to load audit records.', 'Falha ao carregar auditoria.'));
    } finally {
      setLoading(false);
    }
  }, [filters, page, pageSize, tr]);

  const fetchDetail = useCallback(async (id) => {
    if (!id) {
      setDetail(null);
      setDetailError('');
      return;
    }

    setDetailLoading(true);
    setDetailError('');
    try {
      const data = await adminGetUserAuditDetail(id);
      setDetail(data || null);
    } catch (err) {
      console.error(err);
      setDetail(null);
      setDetailError(err?.message || tr('Failed to load log detail.', 'Falha ao carregar detalhes do log.'));
    } finally {
      setDetailLoading(false);
    }
  }, [tr]);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  useEffect(() => {
    fetchDetail(selectedId);
  }, [selectedId, fetchDetail]);

  const selectedSummary = useMemo(
    () => rows.find(item => Number(item.id) === Number(selectedId)) || null,
    [rows, selectedId],
  );

  const canRevert = !!detail?.reversible && String(detail?.tableName || '').toUpperCase() === 'APP_USERS';
  const activeFilterCount = useMemo(() => {
    return ['dateFrom', 'dateTo', 'actor', 'action', 'table', 'target']
      .map(key => String(filters[key] || '').trim())
      .filter(Boolean)
      .length;
  }, [filters]);

  async function handleRevert() {
    if (!detail?.id || !canRevert) return;
    setRevertLoading(true);
    setRevertError('');
    setRevertSuccess('');

    try {
      await adminRevertUserAuditLog(detail.id, {});
      setRevertSuccess(tr('Change reverted successfully.', 'Alteracao revertida com sucesso.'));
      await fetchList();
      await fetchDetail(detail.id);
      setTimeout(() => {
        setRevertOpen(false);
        setRevertSuccess('');
      }, 850);
    } catch (err) {
      console.error(err);
      setRevertError(err?.message || tr('Could not revert this record.', 'Nao foi possivel reverter este registro.'));
    } finally {
      setRevertLoading(false);
    }
  }

  function applyFilters() {
    setFilters({
      dateFrom: filtersDraft.dateFrom || '',
      dateTo: filtersDraft.dateTo || '',
      actor: filtersDraft.actor || '',
      action: filtersDraft.action || '',
      table: filtersDraft.table || '',
      target: filtersDraft.target || '',
    });
    setPage(1);
  }

  function clearFilters() {
    setFiltersDraft(DEFAULT_FILTERS);
    setFilters(DEFAULT_FILTERS);
    setPage(1);
  }

  return (
    <>
      <ViewScaffold
        className="admin-audit-market audit-view-fit"
        eyebrow={tr('Governance trail', 'Trilha de governanca')}
        title={tr('Audit Log', 'Auditoria')}
        description={tr(
          'Track user and project changes with a full inspection timeline.',
          'Acompanhe alteracoes de usuarios e projetos com timeline completa de inspecao.',
        )}
        metrics={[
          {
            label: tr('Total records', 'Total de registros'),
            value: total,
            helper: `${tr('Page', 'Pagina')} ${page}/${totalPages}`,
            tone: 'neutral',
          },
          {
            label: tr('Active filters', 'Filtros ativos'),
            value: activeFilterCount,
            helper: tr('Date, actor, action, entity and target filters', 'Filtros de data, autor, acao, entidade e alvo'),
            tone: activeFilterCount > 0 ? 'warning' : 'neutral',
          },
          {
            label: tr('Selected log', 'Log selecionado'),
            value: selectedId ? `#${selectedId}` : '-',
            helper: selectedSummary?.summary || tr('No row selected', 'Nenhuma linha selecionada'),
            tone: selectedId ? 'success' : 'neutral',
          },
        ]}
        actions={(
          <button
            type="button"
            onClick={fetchList}
            disabled={loading}
            className={`${ui.button.base} ${ui.button.subtle} disabled:opacity-60`}
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            {tr('Refresh list', 'Atualizar lista')}
          </button>
        )}
      >
        <ViewPanel
          title={tr('Audit filters', 'Filtros de auditoria')}
          subtitle={tr(
            'Use date, actor and action controls to narrow the trace quickly.',
            'Use controles de data, autor e acao para reduzir a trilha com rapidez.',
          )}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
            <label className="space-y-1.5">
              <span className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{tr('From', 'De')}</span>
              <input
                type="date"
                value={filtersDraft.dateFrom}
                onChange={event => setFiltersDraft(prev => ({ ...prev, dateFrom: event.target.value }))}
                className={ui.field.date}
              />
            </label>

            <label className="space-y-1.5">
              <span className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{tr('To', 'Ate')}</span>
              <input
                type="date"
                value={filtersDraft.dateTo}
                onChange={event => setFiltersDraft(prev => ({ ...prev, dateTo: event.target.value }))}
                className={ui.field.date}
              />
            </label>

            <label className="space-y-1.5">
              <span className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{tr('Actor', 'Autor')}</span>
              <div className="relative with-leading-icon">
                <UserRound className="leading-icon h-4 w-4 text-muted-foreground" />
                <input
                  type="text"
                  value={filtersDraft.actor}
                  onChange={event => setFiltersDraft(prev => ({ ...prev, actor: event.target.value }))}
                  placeholder={tr('Email or ID', 'Email ou ID')}
                  className={`${ui.field.input} with-leading-icon-input`}
                />
              </div>
            </label>

            <label className="space-y-1.5">
              <span className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{tr('Action', 'Acao')}</span>
              <select
                value={filtersDraft.action}
                onChange={event => setFiltersDraft(prev => ({ ...prev, action: event.target.value }))}
                className={ui.field.select}
              >
                <option value="">{tr('All actions', 'Todas as acoes')}</option>
                <option value="C">C - {tr('Create', 'Criacao')}</option>
                <option value="U">U - {tr('Update', 'Edicao')}</option>
                <option value="D">D - {tr('Delete', 'Exclusao')}</option>
                <option value="R">R - {tr('Revert', 'Reversao')}</option>
              </select>
            </label>

            <label className="space-y-1.5">
              <span className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{tr('Entity', 'Entidade')}</span>
              <select
                value={filtersDraft.table}
                onChange={event => setFiltersDraft(prev => ({ ...prev, table: event.target.value }))}
                className={ui.field.select}
              >
                <option value="">{tr('All entities', 'Todas as entidades')}</option>
                <option value="APP_USERS">{tr('Users', 'Usuarios')}</option>
                <option value="PROJECTS">{tr('Projects', 'Projetos')}</option>
                <option value="PROJECT_EARNINGS">{tr('Project earnings', 'Ganhos de projeto')}</option>
              </select>
            </label>

            <label className="space-y-1.5">
              <span className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{tr('Target', 'Alvo')}</span>
              <div className="relative with-leading-icon">
                <Search className="leading-icon h-4 w-4 text-muted-foreground" />
                <input
                  type="text"
                  value={filtersDraft.target}
                  onChange={event => setFiltersDraft(prev => ({ ...prev, target: event.target.value }))}
                  placeholder={tr('Email, title, name or ID', 'Email, titulo, nome ou ID')}
                  className={`${ui.field.input} with-leading-icon-input`}
                />
              </div>
            </label>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs text-muted-foreground">
              {tr('Total records:', 'Total de registros:')} <span className="font-semibold text-foreground">{total}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-xs text-muted-foreground inline-flex items-center gap-2">
                {tr('Rows', 'Linhas')}
                <select
                  value={pageSize}
                  onChange={event => {
                    setPageSize(Number(event.target.value) || 10);
                    setPage(1);
                  }}
                  className="select-control-plain min-w-[5.25rem]"
                >
                  <option value={10}>10</option>
                </select>
              </label>

              <button type="button" onClick={clearFilters} className={`${ui.button.base} ${ui.button.ghost}`}>
                <RotateCcw className="w-4 h-4" />
                {tr('Clear', 'Limpar')}
              </button>
              <button type="button" onClick={applyFilters} className={`${ui.button.base} ${ui.button.primary}`}>
                {tr('Apply', 'Aplicar')}
              </button>
            </div>
          </div>
        </ViewPanel>

        {error && (
          <div className="rounded-xl border border-destructive/45 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        <div className="audit-main-grid grid grid-cols-1 xl:grid-cols-2 gap-4 min-h-0">
          <section className="audit-records-panel surface-card overflow-hidden flex flex-col">
            <header className="border-b border-border/65 px-4 py-3 text-sm font-semibold text-foreground">
              {tr('Audit Records', 'Registros de auditoria')}
            </header>

            <div className="audit-records-body flex-1">
              {loading ? (
                <div className="h-full min-h-[14rem] flex items-center justify-center text-sm text-muted-foreground gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {tr('Loading logs...', 'Carregando logs...')}
                </div>
              ) : (
                <table className="min-w-full text-sm">
                  <thead className="bg-muted/55">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">ID</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">{tr('Date', 'Data')}</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">{tr('Entity', 'Entidade')}</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">{tr('Action', 'Acao')}</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">{tr('Actor', 'Autor')}</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">{tr('Target', 'Alvo')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-3 py-8 text-center text-xs text-muted-foreground">
                          {tr('No records found with current filters.', 'Nenhum registro encontrado com os filtros atuais.')}
                        </td>
                      </tr>
                    )}

                    {rows.map(row => {
                      const isSelected = Number(row.id) === Number(selectedId);
                      const targetLabel = row.targetLabel || row.targetEmail || row.targetName || row.targetUsername || `#${row.recordId}`;
                      return (
                        <tr
                          key={row.id}
                          onClick={() => setSelectedId(row.id)}
                          className={`border-t border-border/60 cursor-pointer transition ${isSelected ? 'bg-primary/10' : 'hover:bg-muted/35'}`}
                        >
                          <td className="px-3 py-2 align-top text-xs text-muted-foreground">#{row.id}</td>
                          <td className="px-3 py-2 align-top text-xs text-foreground">{formatDateTime(row.changedAt)}</td>
                          <td className="px-3 py-2 align-top text-xs text-muted-foreground">
                            {formatAuditTableLabel(row.tableName, language)}
                          </td>
                          <td className="px-3 py-2 align-top">
                            <ActionBadge action={row.action} />
                          </td>
                          <td className="px-3 py-2 align-top text-xs text-muted-foreground">
                            <div>{row.actorIdent || 'SYSTEM'}</div>
                            {row.actorId ? <div>ID {row.actorId}</div> : null}
                          </td>
                          <td className="px-3 py-2 align-top">
                            <div className="text-xs font-semibold text-foreground">{targetLabel}</div>
                            <div className="text-[11px] text-muted-foreground">{row.summary}</div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            <footer className="border-t border-border/65 px-4 py-3 flex items-center justify-between gap-2 text-xs">
              <span className="text-muted-foreground">
                {tr('Page', 'Pagina')} {page} {tr('of', 'de')} {totalPages}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPage(prev => Math.max(1, prev - 1))}
                  disabled={page <= 1 || loading}
                  className={`${ui.button.base} ${ui.button.subtle} disabled:opacity-60`}
                >
                  {tr('Previous', 'Anterior')}
                </button>
                <button
                  type="button"
                  onClick={() => setPage(prev => Math.min(totalPages, prev + 1))}
                  disabled={page >= totalPages || loading}
                  className={`${ui.button.base} ${ui.button.subtle} disabled:opacity-60`}
                >
                  {tr('Next', 'Proxima')}
                </button>
              </div>
            </footer>
          </section>

          <section className="audit-detail-panel surface-card overflow-hidden flex flex-col">
            <header className="border-b border-border/65 px-4 py-3 flex items-center justify-between gap-3">
              <div className="text-sm font-semibold text-foreground">{tr('Log Details', 'Detalhes do log')}</div>
              {canRevert ? (
                <button
                  type="button"
                  onClick={() => setRevertOpen(true)}
                  disabled={detailLoading}
                  className={`${ui.button.base} ${ui.button.danger} disabled:opacity-60`}
                >
                  <Undo2 className="w-4 h-4" />
                  {tr('Revert', 'Reverter')}
                </button>
              ) : (
                <span className="text-[11px] text-muted-foreground uppercase tracking-[0.12em]">
                  {tr('Read only', 'Somente leitura')}
                </span>
              )}
            </header>

            <div className="audit-detail-body flex-1 scroll-container p-4 space-y-4">
              {!selectedId && !loading && (
                <div className="text-sm text-muted-foreground">
                  {tr('Select an audit record to inspect details.', 'Selecione um registro de auditoria para ver detalhes.')}
                </div>
              )}

              {detailLoading && (
                <div className="text-sm text-muted-foreground inline-flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {tr('Loading details...', 'Carregando detalhes...')}
                </div>
              )}

              {detailError && (
                <div className="rounded-xl border border-destructive/45 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {detailError}
                </div>
              )}

              {detail && !detailLoading && (
                <>
                  <div className="surface-muted p-3 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    <div className="space-y-1">
                      <div className="text-muted-foreground uppercase tracking-[0.1em]">{tr('Log ID', 'ID log')}</div>
                      <div className="font-semibold text-foreground">#{detail.id}</div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-muted-foreground uppercase tracking-[0.1em]">{tr('Action', 'Acao')}</div>
                      <div><ActionBadge action={detail.action} /></div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-muted-foreground uppercase tracking-[0.1em]">{tr('Entity', 'Entidade')}</div>
                      <div className="font-semibold text-foreground">{formatAuditTableLabel(detail.tableName, language)}</div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-muted-foreground uppercase tracking-[0.1em]">{tr('When', 'Quando')}</div>
                      <div className="font-semibold text-foreground inline-flex items-center gap-1">
                        <CalendarClock className="w-3.5 h-3.5 text-muted-foreground" />
                        {formatDateTime(detail.changedAt)}
                      </div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-muted-foreground uppercase tracking-[0.1em]">{tr('Actor', 'Autor')}</div>
                      <div className="font-semibold text-foreground">{detail.actorIdent || 'SYSTEM'}</div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-muted-foreground uppercase tracking-[0.1em]">{tr('Target', 'Alvo')}</div>
                      <div className="font-semibold text-foreground">
                        {detail.targetLabel || detail.targetEmail || detail.targetName || detail.targetUsername || `#${detail.recordId}`}
                      </div>
                    </div>
                  </div>

                  <section className="surface-muted p-3 space-y-2">
                    <h3 className="text-xs uppercase tracking-[0.12em] font-semibold text-muted-foreground">
                      {tr('Changed fields', 'Campos alterados')}
                    </h3>
                    {Array.isArray(detail.diff) && detail.diff.length > 0 ? (
                      <div className="space-y-2">
                        {detail.diff.map(item => (
                          <div key={item.field} className="rounded-lg border border-border/65 bg-background/35 p-2.5">
                            <div className="text-xs font-semibold text-foreground mb-1">{item.field}</div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                              <div className="rounded-md border border-border/60 bg-muted/35 p-2">
                                <div className="text-muted-foreground uppercase tracking-[0.1em] mb-1">{tr('Before', 'Antes')}</div>
                                <div className="break-words text-foreground/90">{toCompactValue(item.before)}</div>
                              </div>
                              <div className="rounded-md border border-border/60 bg-muted/35 p-2">
                                <div className="text-muted-foreground uppercase tracking-[0.1em] mb-1">{tr('After', 'Depois')}</div>
                                <div className="break-words text-foreground/90">{toCompactValue(item.after)}</div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-xs text-muted-foreground">
                        {tr('No field-level differences detected.', 'Nenhuma diferenca de campo detectada.')}
                      </div>
                    )}
                  </section>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <JsonBlock title={tr('Old Row JSON', 'JSON anterior')} value={detail.oldRow} language={language} />
                    <JsonBlock title={tr('New Row JSON', 'JSON novo')} value={detail.newRow} language={language} />
                  </div>
                </>
              )}
            </div>
          </section>
        </div>
      </ViewScaffold>

      <Modal
        open={revertOpen}
        onClose={() => {
          if (revertLoading) return;
          setRevertOpen(false);
          setRevertError('');
          setRevertSuccess('');
        }}
        maxWidth="max-w-lg"
      >
        <div className="p-6 space-y-4">
          <h2 className="text-2xl font-bold text-foreground">{tr('Revert Audit Record', 'Reverter registro')}</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {tr(
              'Confirm rollback for this change. This will apply a new update to the current record state.',
              'Confirme a reversao desta alteracao. Isso aplicara uma nova alteracao no estado atual do registro.',
            )}
          </p>

          <div className="surface-muted px-3 py-2 rounded-lg text-sm space-y-1">
            <div className="font-semibold text-foreground">
              {tr('Log', 'Log')}: #{selectedSummary?.id || detail?.id || '-'}
            </div>
            <div className="text-muted-foreground">
              {tr('Target', 'Alvo')}: {selectedSummary?.targetLabel || detail?.targetLabel || detail?.targetEmail || detail?.targetName || `#${detail?.recordId || '-'}`}
            </div>
          </div>

          {revertError && (
            <div className="rounded-lg border border-destructive/45 bg-destructive/10 px-3 py-2 text-sm text-destructive inline-flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              {revertError}
            </div>
          )}
          {revertSuccess && (
            <div className="rounded-lg border border-emerald-500/45 bg-emerald-500/12 px-3 py-2 text-sm text-emerald-500">
              {revertSuccess}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => {
                setRevertOpen(false);
                setRevertError('');
                setRevertSuccess('');
              }}
              disabled={revertLoading}
              className={`${ui.button.base} ${ui.button.subtle} disabled:opacity-60`}
            >
              {tr('Cancel', 'Cancelar')}
            </button>
            <button
              type="button"
              onClick={handleRevert}
              disabled={revertLoading || !canRevert}
              className={`${ui.button.base} ${ui.button.danger} disabled:opacity-60`}
            >
              {revertLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Undo2 className="w-4 h-4" />}
              {revertLoading ? tr('Reverting...', 'Revertendo...') : tr('Confirm Revert', 'Confirmar reversao')}
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
