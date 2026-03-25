import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getStatusLabel, STATUS_MAP } from '../utils/constants';
import { formatDate } from '../utils/helpers';
import { getStatusMeta } from '../ui/visuals';
import { ViewPanel, ViewScaffold } from '../components/ViewScaffold';

const ORIGEM_OPTIONS = [
  '',
  'Kaizen',
  'Ex Op & Innovation',
  'Committee',
  'Greenbelt',
  'LeanProgram',
];

const IMPACTO_OPTIONS = [
  '',
  'Productivity',
  'Regulation',
  'Safety',
  'Revenue/Savings',
];

const KAIZEN_OPTIONS = [
  '',
  'Waste Elimination',
  'Safety Improvement',
  'Increase Performance',
  '5S Excellence',
];

const ORIGEM_LABELS_PT = {
  Kaizen: 'Kaizen',
  'Ex Op & Innovation': 'Ex Op e Inovação',
  Committee: 'Comitê',
  Greenbelt: 'Greenbelt',
  LeanProgram: 'LeanProgram',
};

const IMPACTO_LABELS_PT = {
  Productivity: 'Produtividade',
  Regulation: 'Regulação',
  Safety: 'Segurança',
  'Revenue/Savings': 'Receita/Economia',
};

const KAIZEN_LABELS_PT = {
  'Waste Elimination': 'Eliminação de desperdício',
  'Safety Improvement': 'Melhoria de segurança',
  'Increase Performance': 'Aumento de performance',
  '5S Excellence': 'Excelência 5S',
};

const TABLE_COLUMNS = Object.freeze({
  title: 'Title',
  status: 'Status',
  employeeName: 'Employee',
  startDate: 'Start Date',
  dataFimPrevisto: 'Due Date (Est.)',
  ganhoEstimado: 'Est. Earnings (R$)',
  ganhoRealizado: 'Realized Earnings (R$)',
  origem: 'Origin',
  areaGrupo: 'Area',
  impactoComite: 'Committee Impact',
  categoriaKaizen: 'Kaizen Category',
  reNo: 'RE No.',
  validador: 'Validator',
  champion: 'Champion',
  it: 'IT',
  registroInterno: 'Internal Reg.',
  codigoILean: 'iLean Code',
});

const TABLE_COLUMNS_PT = Object.freeze({
  title: 'Título',
  status: 'Status',
  employeeName: 'Responsável',
  startDate: 'Data de início',
  dataFimPrevisto: 'Data fim (est.)',
  ganhoEstimado: 'Ganho est. (R$)',
  ganhoRealizado: 'Ganho realizado (R$)',
  origem: 'Origem',
  areaGrupo: 'Área',
  impactoComite: 'Impacto no comitê',
  categoriaKaizen: 'Categoria kaizen',
  reNo: 'Número RE',
  validador: 'Validador',
  champion: 'Champion',
  it: 'TI',
  registroInterno: 'Registro interno',
  codigoILean: 'Código iLean',
});

const COLUMN_WIDTHS = Object.freeze({
  title: '30rem',
  status: '12rem',
  employeeName: '18rem',
  startDate: '11rem',
  dataFimPrevisto: '12rem',
  ganhoEstimado: '12rem',
  ganhoRealizado: '13rem',
  origem: '12rem',
  areaGrupo: '12rem',
  impactoComite: '14rem',
  categoriaKaizen: '14rem',
  reNo: '10rem',
  validador: '12rem',
  champion: '12rem',
  it: '8rem',
  registroInterno: '11rem',
  codigoILean: '11rem',
});

const COLUMN_KEYS = Object.keys(TABLE_COLUMNS);
const LOCKED_WIDTH_COLUMNS = new Set(['title', 'employeeName']);
const EDITABLE_TEXT_COLUMNS = new Set([
  'title',
  'employeeName',
  'areaGrupo',
  'reNo',
  'validador',
  'champion',
  'it',
  'registroInterno',
  'codigoILean',
]);
const EDITABLE_NUMBER_COLUMNS = new Set(['ganhoEstimado', 'anoConsiderado']);
const DATE_SORT_COLUMNS = new Set(['startDate', 'dataFimPrevisto']);
const NUMBER_SORT_COLUMNS = new Set(['ganhoEstimado', 'ganhoRealizado']);

const VIRTUAL_ROW_HEIGHT = 34;
const VIRTUAL_OVERSCAN = 12;

function optionLabel(value, tr, ptMap) {
  if (!value) return tr('Select...', 'Selecionar...');
  return tr(value, ptMap[value] || value);
}

function normalizeSortText(value) {
  return String(value ?? '').trim().toLowerCase();
}

function getProjectSortValue(project, columnKey, language) {
  if (columnKey === 'status') {
    const statusKey = project.status || project.STATUS || '';
    return normalizeSortText(getStatusLabel(statusKey, language) || statusKey);
  }

  const value = project[columnKey];

  if (DATE_SORT_COLUMNS.has(columnKey)) {
    if (!value) return null;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  if (NUMBER_SORT_COLUMNS.has(columnKey)) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return normalizeSortText(value);
}

function compareSortValues(leftValue, rightValue, direction, locale) {
  const isLeftEmpty = leftValue === null || leftValue === undefined || leftValue === '';
  const isRightEmpty = rightValue === null || rightValue === undefined || rightValue === '';

  if (isLeftEmpty && isRightEmpty) return 0;
  if (isLeftEmpty) return 1;
  if (isRightEmpty) return -1;

  let baseComparison = 0;

  if (typeof leftValue === 'number' && typeof rightValue === 'number') {
    baseComparison = leftValue - rightValue;
  } else {
    baseComparison = String(leftValue).localeCompare(String(rightValue), locale, {
      numeric: true,
      sensitivity: 'base',
    });
  }

  if (baseComparison === 0) return 0;
  return direction === 'asc' ? (baseComparison > 0 ? 1 : -1) : (baseComparison > 0 ? -1 : 1);
}

export default function TableView({ language = 'en', projects, onCellEdit, onOpenProject }) {
  const tr = (enText, ptBrText) => (language === 'pt-BR' ? ptBrText : enText);
  const locale = language === 'pt-BR' ? 'pt-BR' : 'en-US';
  const containerRef = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(640);
  const [sortState, setSortState] = useState({ key: '', direction: '' });
  const statusKeys = useMemo(() => Object.keys(STATUS_MAP || {}), []);

  const columnDefs = useMemo(
    () =>
      COLUMN_KEYS.map(key => ({
        key,
        title: tr(TABLE_COLUMNS[key], TABLE_COLUMNS_PT[key] || TABLE_COLUMNS[key]),
        width: COLUMN_WIDTHS[key] || '12rem',
        lockWidth: LOCKED_WIDTH_COLUMNS.has(key),
      })),
    [language],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const syncHeight = () => {
      setViewportHeight(container.clientHeight || 640);
    };
    syncHeight();

    let rafId = null;
    const onResize = () => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(syncHeight);
    };
    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('resize', onResize);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, []);

  const onTableScroll = useCallback(event => {
    setScrollTop(event.currentTarget.scrollTop || 0);
  }, []);

  const sortedProjects = useMemo(() => {
    const source = Array.isArray(projects) ? projects : [];
    if (!sortState.key || !sortState.direction) return source;

    return source
      .map((project, index) => ({ project, index }))
      .sort((left, right) => {
        const leftValue = getProjectSortValue(left.project, sortState.key, language);
        const rightValue = getProjectSortValue(right.project, sortState.key, language);
        const compared = compareSortValues(leftValue, rightValue, sortState.direction, locale);
        if (compared !== 0) return compared;
        return left.index - right.index;
      })
      .map(entry => entry.project);
  }, [projects, sortState, language, locale]);

  const onSortColumn = useCallback((columnKey) => {
    setSortState(previous => {
      if (previous.key !== columnKey) {
        return { key: columnKey, direction: 'asc' };
      }

      if (previous.direction === 'asc') {
        return { key: columnKey, direction: 'desc' };
      }

      return { key: '', direction: '' };
    });
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (container) {
      container.scrollTop = 0;
    }
    setScrollTop(0);
  }, [sortState.key, sortState.direction]);

  const totalRows = sortedProjects.length;
  const visibleWindow = Math.max(
    1,
    Math.ceil(viewportHeight / VIRTUAL_ROW_HEIGHT) + (VIRTUAL_OVERSCAN * 2),
  );
  const startIndex = Math.max(0, Math.floor(scrollTop / VIRTUAL_ROW_HEIGHT) - VIRTUAL_OVERSCAN);
  const endIndex = Math.min(totalRows, startIndex + visibleWindow);
  const visibleProjects = useMemo(
    () => sortedProjects.slice(startIndex, endIndex),
    [sortedProjects, startIndex, endIndex],
  );
  const topSpacerHeight = startIndex * VIRTUAL_ROW_HEIGHT;
  const bottomSpacerHeight = Math.max(0, (totalRows - endIndex) * VIRTUAL_ROW_HEIGHT);

  const topMetrics = [
    {
      label: tr('Rows loaded', 'Linhas carregadas'),
      value: totalRows,
      helper: totalRows > 0 ? tr('Virtualized rendering enabled', 'Renderização virtualizada ativa') : tr('No rows available', 'Sem linhas disponíveis'),
      tone: totalRows > 0 ? 'neutral' : 'warning',
    },
    {
      label: tr('Rows in viewport', 'Linhas na janela'),
      value: Math.max(0, endIndex - startIndex),
      helper: totalRows > 0 ? `${tr('Window', 'Janela')} ${startIndex + 1}-${endIndex}` : `${tr('Window', 'Janela')} 0-0`,
      tone: 'neutral',
    },
  ];

  return (
    <ViewScaffold
      className="table-view-fit"
      eyebrow={tr('Bulk operations', 'Operações em massa')}
      title={tr('Projects Table', 'Tabela de projetos')}
      description={tr(
        'Use spreadsheet-style editing for high-throughput updates while preserving structured controls and detail access.',
        'Use edição estilo planilha para atualizações em alto volume mantendo controles e acesso aos detalhes.',
      )}
      metrics={topMetrics}
    >
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        <ViewPanel
          className="xl:col-span-12 p-0 overflow-hidden"
          title={tr('Project data grid', 'Grade de dados dos projetos')}
          subtitle={tr('High-density table with virtual scrolling and inline controls.', 'Tabela de alta densidade com rolagem virtual e controles inline.')}
        >
          <div
            ref={containerRef}
            onScroll={onTableScroll}
            className="table-view-shell w-full overflow-auto scroll-container border-t border-border/65"
            style={{ height: '76vh' }}
          >
            <table className="excel-table table-view-grid">
              <colgroup>
                {columnDefs.map(column => (
                  <col
                    key={column.key}
                    style={{
                      width: column.width,
                      minWidth: column.lockWidth ? column.width : undefined,
                      maxWidth: column.lockWidth ? column.width : undefined,
                    }}
                  />
                ))}
              </colgroup>
              <thead>
                <tr>
                  {columnDefs.map(column => (
                    <th
                      key={column.key}
                      scope="col"
                      aria-sort={
                        sortState.key === column.key
                          ? sortState.direction === 'asc'
                            ? 'ascending'
                            : 'descending'
                          : 'none'
                      }
                    >
                      <button
                        type="button"
                        className={`table-sort-trigger ${sortState.key === column.key ? `is-${sortState.direction}` : ''}`}
                        onClick={() => onSortColumn(column.key)}
                      >
                        <span>{column.title}</span>
                        <span className="table-sort-indicator" aria-hidden="true">
                          {sortState.key === column.key
                            ? (sortState.direction === 'asc' ? '↑' : '↓')
                            : '↕'}
                        </span>
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {totalRows === 0 ? (
                  <tr>
                    <td
                      colSpan={COLUMN_KEYS.length}
                      className="text-center p-8 text-muted-foreground"
                    >
                      {tr('No projects to display.', 'Sem projetos para exibir.')}
                    </td>
                  </tr>
                ) : (
                  <>
                    {topSpacerHeight > 0 && (
                      <tr aria-hidden="true" className="pointer-events-none">
                        <td
                          colSpan={COLUMN_KEYS.length}
                          style={{ height: `${topSpacerHeight}px`, padding: 0, border: 'none' }}
                        />
                      </tr>
                    )}

                    {visibleProjects.map(project => {
                      const tds = COLUMN_KEYS.map((key) => {
                        const value = project[key] ?? '';
                        let content = value;
                        let editable = false;

                        const isStatus = key === 'status';
                        const isDate = key === 'startDate' || key === 'dataFimPrevisto';
                        const isOrigem = key === 'origem';
                        const isImpact = key === 'impactoComite';
                        const isKaizen = key === 'categoriaKaizen';

                        if (isStatus) {
                          const currentKey = project.status || project.STATUS || '';
                          const color = getStatusMeta(currentKey || 'BACKLOG').color;
                          content = (
                            <div className="flex items-center gap-2">
                              <span
                                className="w-2 h-2 rounded-full"
                                style={{ backgroundColor: color }}
                              />
                              <div className="relative w-full">
                                <select
                                  value={currentKey}
                                  onChange={(event) => onCellEdit(project.id, 'status', event.target.value)}
                                  className="select-control-plain text-xs"
                                >
                                  <option value="">{tr('Select...', 'Selecionar...')}</option>
                                  {statusKeys.map((statusKey) => (
                                    <option key={statusKey} value={statusKey}>
                                      {getStatusLabel(statusKey, language)}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            </div>
                          );
                        } else if (isDate) {
                          content = (
                            <input
                              type="date"
                              value={project[key] || ''}
                              onChange={(event) => onCellEdit(project.id, key, event.target.value)}
                              className="input-control-plain text-xs"
                            />
                          );
                        } else if (isOrigem) {
                          content = (
                            <div className="relative">
                              <select
                                value={project.origem || ''}
                                onChange={(event) => onCellEdit(project.id, 'origem', event.target.value)}
                                className="select-control-plain text-xs"
                              >
                                {ORIGEM_OPTIONS.map((option) => (
                                  <option key={option || 'empty'} value={option}>
                                    {optionLabel(option, tr, ORIGEM_LABELS_PT)}
                                  </option>
                                ))}
                              </select>
                            </div>
                          );
                        } else if (isImpact) {
                          content = (
                            <div className="relative">
                              <select
                                value={project.impactoComite || ''}
                                onChange={(event) => onCellEdit(project.id, 'impactoComite', event.target.value)}
                                className="select-control-plain text-xs"
                              >
                                {IMPACTO_OPTIONS.map((option) => (
                                  <option key={option || 'empty'} value={option}>
                                    {optionLabel(option, tr, IMPACTO_LABELS_PT)}
                                  </option>
                                ))}
                              </select>
                            </div>
                          );
                        } else if (isKaizen) {
                          content = (
                            <div className="relative">
                              <select
                                value={project.categoriaKaizen || ''}
                                onChange={(event) => onCellEdit(project.id, 'categoriaKaizen', event.target.value)}
                                className="select-control-plain text-xs"
                              >
                                {KAIZEN_OPTIONS.map((option) => (
                                  <option key={option || 'empty'} value={option}>
                                    {optionLabel(option, tr, KAIZEN_LABELS_PT)}
                                  </option>
                                ))}
                              </select>
                            </div>
                          );
                        } else {
                          if (['startDate', 'dataFimPrevisto', 'chegada', 'dueDate', 'dataInicioGanho'].includes(key)) {
                            content = formatDate(value) || '---';
                          } else if (['ganhoEstimado', 'ganhoRealizado'].includes(key)) {
                            content = `R$ ${(Number(value || 0)).toFixed(2)}`;
                          }

                          if (EDITABLE_TEXT_COLUMNS.has(key) || EDITABLE_NUMBER_COLUMNS.has(key)) {
                            editable = true;
                          }
                        }

                        const isSpecialInteractive = isStatus || isDate || isOrigem || isImpact || isKaizen;

                        return (
                          <td
                            key={key}
                            className={!editable && !isSpecialInteractive ? 'cell-clickable' : ''}
                            contentEditable={editable}
                            suppressContentEditableWarning
                            onBlur={(event) => {
                              if (!editable) return;
                              onCellEdit(project.id, key, event.currentTarget.textContent || '');
                            }}
                            onKeyDown={(event) => {
                              if (!editable) return;
                              if (event.key === 'Enter') {
                                event.preventDefault();
                                event.currentTarget.blur();
                              }
                              if (event.key === 'Escape') {
                                event.currentTarget.textContent = value ?? '';
                                event.currentTarget.blur();
                              }
                            }}
                            onClick={() => {
                              if (editable || isSpecialInteractive) return;
                              onOpenProject(project.id);
                            }}
                          >
                            {content}
                          </td>
                        );
                      });

                      return (
                        <tr key={project.id} style={{ height: `${VIRTUAL_ROW_HEIGHT}px` }}>
                          {tds}
                        </tr>
                      );
                    })}

                    {bottomSpacerHeight > 0 && (
                      <tr aria-hidden="true" className="pointer-events-none">
                        <td
                          colSpan={COLUMN_KEYS.length}
                          style={{ height: `${bottomSpacerHeight}px`, padding: 0, border: 'none' }}
                        />
                      </tr>
                    )}
                  </>
                )}
              </tbody>
            </table>
          </div>
        </ViewPanel>
      </div>
    </ViewScaffold>
  );
}

