import { useMemo } from 'react';
import { LayoutGrid, BarChart3, Map, Table, HelpCircle, Settings, Shield, History, LogOut } from 'lucide-react';
import { ui } from '../ui/visuals';
import dpWorldLogo from '../assets/DPWorldLogo.png';

export default function Sidebar({
  currentView,
  onChangeView,
  onOpenHowTo,
  onOpenSettings,
  user,
  onLogout,
  theme,
  language = 'en',
}) {
  const tr = (enText, ptBrText) => (language === 'pt-BR' ? ptBrText : enText);
  const logoToneClass = theme === 'dark' ? 'brightness-110' : 'brightness-100';
  const roleCandidates = [user?.roles, user?.ROLES, user?.role, user?.ROLE, user?.perfil, user?.PERFIL];
  const normalizedRoles = roleCandidates
    .flatMap(value => (Array.isArray(value) ? value : String(value || '').split(',')))
    .map(value => String(value || '').trim().toUpperCase())
    .filter(Boolean);

  const isAdmin = normalizedRoles.includes('ADMIN');

  const items = useMemo(() => {
    const base = [
      { key: 'kanban', label: tr('Projects', 'Projetos'), icon: LayoutGrid },
      { key: 'dashboard', label: tr('Dashboard', 'Dashboard'), icon: BarChart3 },
      { key: 'roadmap', label: tr('Roadmap', 'Cronograma'), icon: Map },
      { key: 'table', label: tr('Table', 'Tabela'), icon: Table },
    ];

    if (isAdmin) {
      base.push({ key: 'adminUsers', label: tr('Users', 'Usuarios'), icon: Shield });
      base.push({ key: 'adminAudit', label: tr('Audit Log', 'Auditoria'), icon: History });
    }
    return base;
  }, [isAdmin, language]);

  return (
    <aside className={`w-[17rem] flex-shrink-0 flex flex-col ${ui.shell.sidePanel} command-sidebar`}>
      <div className="command-sidebar-head h-28 px-5 border-b border-border/70 flex items-center">
        <div className="flex items-center gap-3 min-w-0">
          <img src={dpWorldLogo} alt="DP World Logo" className={`w-10 h-10 object-contain ${logoToneClass}`} />
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              {tr('Santos Control Grid', 'Grid de controle Santos')}
            </p>
            <h1 className="text-base font-semibold text-foreground truncate leading-tight">Excellence Control</h1>
            {user ? (
              <p className="text-[11px] text-muted-foreground truncate max-w-[11rem]">
                {user.DISPLAY_NAME || user.USERNAME || user.EMAIL}
              </p>
            ) : null}
          </div>
        </div>
      </div>

      <div className="command-sidebar-context px-5 py-3 border-b border-border/70">
        <p className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
          {tr('Managerial lane', 'Faixa gerencial')}
        </p>
        <p className="text-xs text-foreground/90 mt-1">
          {tr('Operational command center', 'Centro operacional de comando')}
        </p>
      </div>

      <nav className="flex-1 p-5 space-y-2 overflow-y-auto">
        <p className="px-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-[0.16em]">
          {tr('Workspace', 'Workspace')}
        </p>
        <div className="flex flex-col gap-1">
          {items.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => onChangeView(key)}
              className={`sidebar-nav-btn ${currentView === key ? 'active' : ''}`}
            >
              <Icon className="w-[18px] h-[18px]" />
              <span>{label}</span>
            </button>
          ))}
        </div>
      </nav>

      <div className="p-5 border-t border-border/70 space-y-1">
        <p className="px-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {tr('System', 'Sistema')}
        </p>
        <button onClick={onOpenHowTo} className="sidebar-nav-btn" aria-label="How to use">
          <HelpCircle className="w-[18px] h-[18px]" />
          <span>{tr('Playbook', 'Sobre o Sistema')}</span>
        </button>
        <button onClick={onOpenSettings} className="sidebar-nav-btn" aria-label="Settings">
          <Settings className="w-[18px] h-[18px]" />
          <span>{tr('Settings', 'Configuracoes')}</span>
        </button>
        {onLogout ? (
          <button onClick={onLogout} className="sidebar-nav-btn" aria-label="Logout">
            <LogOut className="w-[18px] h-[18px]" />
            <span>{tr('Logout', 'Sair')}</span>
          </button>
        ) : null}
      </div>
    </aside>
  );
}
