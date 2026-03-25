import { Menu, Plus, Upload, Download, Search, Sun, Moon, SlidersHorizontal } from 'lucide-react';
import { ui } from '../ui/visuals';

export default function Header({
  language = 'en',
  minimal = false,
  onToggleSidebar,
  onOpenProjectModal,
  onOpenImportWizard,
  onImport,
  onExport,
  onOpenFilters,
  activeFilterCount = 0,
  search,
  setSearch,
  settings,
  setSettings,
}) {
  const tr = (enText, ptBrText) => (language === 'pt-BR' ? ptBrText : enText);
  const isDark = settings?.theme === 'dark';

  if (minimal) {
    return (
      <header className="header-shell command-header px-4 sm:px-5 py-3">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={onToggleSidebar}
            className={`${ui.button.base} ${ui.button.icon} ${ui.button.ghost}`}
            aria-label="Toggle sidebar"
          >
            <Menu className="w-5 h-5" />
          </button>

          <button
            type="button"
            onClick={() => setSettings(s => ({ ...s, theme: s.theme === 'dark' ? 'light' : 'dark' }))}
            className={`${ui.button.base} ${ui.button.icon} ${ui.button.ghost}`}
            title={tr('Toggle theme', 'Alternar tema')}
          >
            {isDark ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
          </button>
        </div>
      </header>
    );
  }

  return (
    <header className="header-shell command-header px-4 sm:px-5 py-3 space-y-3">
      <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <button
            type="button"
            onClick={onToggleSidebar}
            className={`${ui.button.base} ${ui.button.icon} ${ui.button.ghost}`}
            aria-label="Toggle sidebar"
          >
            <Menu className="w-5 h-5" />
          </button>

          <div className="hidden lg:flex flex-col pr-2 border-r border-border/60 min-w-[13rem]">
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {tr('Ops lane', 'Faixa ops')}
            </span>
            <span className="text-xs text-foreground/90 font-medium">
              {tr('Execution command center', 'Centro de comando da execução')}
            </span>
          </div>

          <div className="relative flex-1 min-w-0 sm:min-w-[250px] md:min-w-[340px] xl:min-w-[480px] max-w-[980px] with-leading-icon">
            <Search className="leading-icon h-5 w-5 text-muted-foreground" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              type="text"
              placeholder={tr('Search title, owner, area or initiative...', 'Buscar titulo, responsavel, area ou iniciativa...')}
              className={`${ui.field.input} with-leading-icon-input pr-4`}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setSettings(s => ({ ...s, theme: s.theme === 'dark' ? 'light' : 'dark' }))}
            className={`${ui.button.base} ${ui.button.icon} ${ui.button.ghost}`}
            title={tr('Toggle theme', 'Alternar tema')}
          >
            {isDark ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
          </button>

          <button
            type="button"
            onClick={onOpenFilters}
            className={`${ui.button.base} ${ui.button.subtle} relative ${activeFilterCount > 0 ? 'has-active-filters' : ''}`}
            title={tr('Open filters', 'Abrir filtros')}
            aria-pressed={activeFilterCount > 0}
          >
            <SlidersHorizontal className="w-4 h-4" />
            <span className="hidden sm:inline">{tr('Filters', 'Filtros')}</span>
            {activeFilterCount > 0 ? (
              <span className="absolute -top-1 -right-1 min-w-[1.1rem] h-[1.1rem] px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold leading-[1.1rem] text-center">
                {activeFilterCount}
              </span>
            ) : null}
          </button>

          <button
            type="button"
            onClick={() => {
              if (typeof onOpenImportWizard === 'function') {
                onOpenImportWizard();
                return;
              }
              document.getElementById('file-input')?.click();
            }}
            className={`${ui.button.base} ${ui.button.subtle}`}
            title={tr('Import Spreadsheet', 'Importar planilha')}
          >
            <Upload className="w-4 h-4" />
            <span className="hidden sm:inline">{tr('Import', 'Importar')}</span>
          </button>
          <input id="file-input" type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={onImport} />

          <button type="button" onClick={onExport} className={`${ui.button.base} ${ui.button.subtle}`}>
            <Download className="w-4 h-4" />
            <span className="hidden sm:inline">{tr('Export', 'Exportar')}</span>
          </button>

          <button type="button" onClick={onOpenProjectModal} className={`${ui.button.base} ${ui.button.primary}`}>
            <Plus className="w-4 h-4" />
            {tr('New Project', 'Novo projeto')}
          </button>
        </div>
      </div>
    </header>
  );
}
