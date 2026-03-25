import { useEffect, useMemo, useState, useCallback } from 'react';
import { adminGetUsers, adminUpdateUser } from '../config/oracle';
import { Eye, EyeOff, Loader2, Mail, RotateCcw, Save, Search, Shield } from 'lucide-react';
import { ui } from '../ui/visuals';
import { ViewPanel, ViewScaffold } from '../components/ViewScaffold';

const ROLE_OPTIONS = ['ADMIN', 'VIEWER'];

function roleLabel(role, tr) {
  const key = String(role || '').toUpperCase();
  if (key === 'ADMIN') return tr('Admin', 'Admin');
  if (key === 'MANAGER') return tr('Manager', 'Gestor');
  if (key === 'MEMBER') return tr('Member', 'Membro');
  if (key === 'VIEWER') return tr('Viewer', 'Leitor');
  return key || '-';
}

function statusLabel(status, tr) {
  const key = String(status || '').toUpperCase();
  if (key === 'ACTIVE') return tr('Active', 'Ativo');
  if (key === 'INACTIVE') return tr('Inactive', 'Inativo');
  if (key === 'ARCHIVED') return tr('Archived', 'Arquivado');
  return key || '-';
}

function normalizeRoles(roles) {
  if (!Array.isArray(roles)) return [];
  return [...new Set(roles.map(role => String(role || '').trim().toUpperCase()).filter(Boolean))];
}

function resolvePrimaryRole(user) {
  const roles = normalizeRoles(user?.roles);
  if (roles.includes('ADMIN')) return 'ADMIN';
  if (roles.includes('MANAGER')) return 'MANAGER';
  if (roles.includes('MEMBER')) return 'MEMBER';
  if (roles.includes('VIEWER')) return 'VIEWER';
  return roles[0] || 'MEMBER';
}

function getInitials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'U';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase();
}

function formatDate(value, locale = 'en-US') {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString(locale, { month: 'short', day: 'numeric' });
}

export default function AdminUsersView({ language = 'en' }) {
  const tr = (enText, ptBrText) => (language === 'pt-BR' ? ptBrText : enText);
  const locale = language === 'pt-BR' ? 'pt-BR' : 'en-US';

  const [users, setUsers] = useState([]);
  const [original, setOriginal] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError('');
      try {
        const raw = await adminGetUsers();
        const normalized = (raw || []).map(u => ({
          id: u.ID,
          email: u.EMAIL,
          username: u.USERNAME,
          displayName: u.DISPLAY_NAME,
          status: u.STATUS || 'ACTIVE',
          isVerified: u.IS_VERIFIED === 'Y',
          createdAt: u.CREATED_AT,
          roles: (u.ROLES || '')
            .split(',')
            .map(r => r.trim())
            .filter(Boolean),
        }));
        setUsers(normalized);
        setOriginal(normalized);
      } catch (err) {
        setError(err.message || tr('Failed to load users.', 'Erro ao carregar usuarios.'));
      } finally {
        setLoading(false);
      }
    })();
  }, [language]);

  const hasChanges = useMemo(() => JSON.stringify(users) !== JSON.stringify(original), [users, original]);

  const visibleUsers = useMemo(() => {
    if (showArchived) return users;
    return users.filter(u => (u.status || '').toUpperCase() !== 'ARCHIVED');
  }, [users, showArchived]);

  const filteredUsers = useMemo(() => {
    const term = String(searchTerm || '').trim().toLowerCase();
    if (!term) return visibleUsers;
    return visibleUsers.filter(user => {
      const name = String(user.displayName || '').toLowerCase();
      const username = String(user.username || '').toLowerCase();
      const email = String(user.email || '').toLowerCase();
      const roles = normalizeRoles(user.roles).join(' ').toLowerCase();
      return name.includes(term) || username.includes(term) || email.includes(term) || roles.includes(term);
    });
  }, [searchTerm, visibleUsers]);

  const roleCards = useMemo(() => {
    const base = [
      { key: 'ADMIN', label: tr('Admin', 'Admin') },
      { key: 'MANAGER', label: tr('Manager', 'Gestor') },
      { key: 'MEMBER', label: tr('Member', 'Membro') },
      { key: 'VIEWER', label: tr('Viewer', 'Leitor') },
    ];

    return base.map(card => ({
      ...card,
      count: users.filter(user => resolvePrimaryRole(user) === card.key).length,
    }));
  }, [users, language]);

  const activeUsersCount = useMemo(
    () => users.filter(user => String(user.status || '').toUpperCase() === 'ACTIVE').length,
    [users],
  );
  const archivedUsersCount = useMemo(
    () => users.filter(user => String(user.status || '').toUpperCase() === 'ARCHIVED').length,
    [users],
  );
  const verifiedUsersCount = useMemo(
    () => users.filter(user => Boolean(user.isVerified)).length,
    [users],
  );
  const updateField = useCallback((id, field, value) => {
    setUsers(prev => prev.map(user => (user.id === id ? { ...user, [field]: value } : user)));
  }, []);

  const toggleRole = useCallback((id, role) => {
    setUsers(prev =>
      prev.map(user => {
        if (user.id !== id) return user;
        const currentRoles = normalizeRoles(user.roles);
        const hasRole = currentRoles.includes(role);
        return {
          ...user,
          roles: hasRole ? currentRoles.filter(r => r !== role) : [...currentRoles, role],
        };
      }),
    );
  }, []);

  function handleReset() {
    setUsers(original);
    setError('');
  }

  async function handleSaveAll() {
    setSaving(true);
    setError('');

    const changed = users.filter(user => {
      const orig = original.find(item => item.id === user.id);
      if (!orig) return true;
      return (
        orig.displayName !== user.displayName
        || (orig.status || '').toUpperCase() !== (user.status || '').toUpperCase()
        || JSON.stringify(normalizeRoles(orig.roles).sort()) !== JSON.stringify(normalizeRoles(user.roles).sort())
      );
    });

    if (!changed.length) {
      setSaving(false);
      return;
    }

    try {
      for (const user of changed) {
        await adminUpdateUser(user.id, {
          status: user.status,
          displayName: user.displayName,
          roles: normalizeRoles(user.roles),
        });
      }
      setOriginal(users);
    } catch (err) {
      setError(err.message || tr('Failed to save changes.', 'Erro ao salvar alteracoes.'));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="view-loading-shell">
        <div className="view-loading-panel">
          <div className="app-loading-mark" aria-hidden="true">
            <span className="app-loading-mark-inner" />
          </div>
          <div className="view-loading-copy">
            <p className="view-loading-kicker">{tr('User directory', 'Diretorio de usuarios')}</p>
            <p className="view-loading-title">{tr('Loading users...', 'Carregando usuarios...')}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <ViewScaffold
      className="admin-users-market"
      eyebrow={tr('Admin control', 'Controle admin')}
      title={tr('User Management', 'Gestao de usuarios')}
      description={tr(
        'Control user visibility, role assignment and lifecycle status with one governance surface.',
        'Controle visibilidade de usuarios, perfis e ciclo de vida em uma unica superficie de governanca.',
      )}
      metrics={[
        {
          label: tr('Visible users', 'Usuarios visiveis'),
          value: filteredUsers.length,
          helper: `${users.length} ${tr('registered', 'cadastrados')}`,
          tone: 'neutral',
        },
        {
          label: tr('Active users', 'Usuarios ativos'),
          value: activeUsersCount,
          helper: `${archivedUsersCount} ${tr('archived', 'arquivados')}`,
          tone: activeUsersCount > 0 ? 'success' : 'warning',
        },
        {
          label: tr('Verified accounts', 'Contas verificadas'),
          value: verifiedUsersCount,
          helper: `${Math.max(0, users.length - verifiedUsersCount)} ${tr('pending', 'pendentes')}`,
          tone: 'neutral',
        },
      ]}
      actions={(
        <>
          <button
            type="button"
            onClick={() => setShowArchived(v => !v)}
            className={`${ui.button.base} ${showArchived ? ui.button.primary : ui.button.subtle}`}
          >
            {showArchived ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
            {showArchived ? tr('Archived visible', 'Arquivados visiveis') : tr('Archived hidden', 'Arquivados ocultos')}
          </button>
          <button
            type="button"
            onClick={handleReset}
            disabled={!hasChanges || saving}
            className={`${ui.button.base} ${ui.button.subtle} disabled:opacity-50`}
          >
            <RotateCcw className="w-3.5 h-3.5" />
            {tr('Discard', 'Descartar')}
          </button>
          <button
            type="button"
            onClick={handleSaveAll}
            disabled={!hasChanges || saving}
            className={`${ui.button.base} ${ui.button.primary} disabled:opacity-60`}
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            {saving ? tr('Saving...', 'Salvando...') : tr('Save all', 'Salvar tudo')}
          </button>
        </>
      )}
    >
      <ViewPanel
        title={tr('Role distribution and search', 'Distribuicao de perfis e busca')}
        subtitle={tr(
          'Use role cards for quick scanning and text search to narrow the user list.',
          'Use cards de perfil para leitura rapida e busca textual para reduzir a lista de usuarios.',
        )}
      >
        <section className="admin-users-role-cards">
          {roleCards.map(card => (
            <article key={card.key} className="admin-users-role-card">
              <div className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border/70 bg-muted/40 text-muted-foreground">
                <Shield className="w-3.5 h-3.5" />
              </div>
              <p className="mt-3 text-4xl font-semibold leading-none text-foreground">{card.count}</p>
              <p className="mt-2 text-xs uppercase tracking-[0.11em] text-muted-foreground">{card.label}</p>
            </article>
          ))}
        </section>

        <section className={`${ui.card.base} p-3.5`}>
          <label className="admin-users-search with-leading-icon">
            <Search className="leading-icon h-4 w-4 text-muted-foreground" />
            <input
              value={searchTerm}
              onChange={event => setSearchTerm(event.target.value)}
              type="text"
              className={`${ui.field.input} with-leading-icon-input`}
              placeholder={tr('Search by name, email or role...', 'Buscar por nome, email ou perfil...')}
            />
          </label>
        </section>
      </ViewPanel>

      <ViewPanel
        className="admin-users-list-panel"
        title={tr('All Users', 'Todos os usuarios')}
        subtitle={`${filteredUsers.length} ${tr('users found', 'usuarios encontrados')}`}
      >
        {error ? <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive mb-3">{error}</div> : null}

        <div className="admin-users-list">
          {filteredUsers.length === 0 ? (
            <div className="rounded-lg border border-border/65 bg-muted/25 px-4 py-8 text-center text-sm text-muted-foreground">
              {tr('No users available for the current filters.', 'Nenhum usuario para exibir com os filtros atuais.')}
            </div>
          ) : null}

          {filteredUsers.map(user => {
            const primaryRole = resolvePrimaryRole(user);
            const roles = normalizeRoles(user.roles);
            const otherRoles = roles.filter(role => !ROLE_OPTIONS.includes(role));
            const archived = String(user.status || '').toUpperCase() === 'ARCHIVED';

            return (
              <article key={user.id} className={`admin-user-card ${archived ? 'is-archived' : ''}`}>
                <div className="admin-user-main">
                  <div className="admin-user-avatar">{getInitials(user.displayName || user.username || user.email)}</div>
                  <div className="min-w-0 flex-1">
                    <input
                      type="text"
                      value={user.displayName || ''}
                      onChange={event => updateField(user.id, 'displayName', event.target.value)}
                      className="admin-user-name-input input-control-plain"
                      placeholder={tr('Display name', 'Nome de exibicao')}
                    />
                    <p className="admin-user-email">
                      <Mail className="w-3.5 h-3.5" />
                      <span className="truncate">{user.email}</span>
                    </p>
                    <div className="admin-user-meta-row">
                      <span className={`admin-user-role role-${primaryRole.toLowerCase()}`}>{primaryRole}</span>
                      <span>{tr('ID', 'ID')} {user.id}</span>
                      <span>{tr('Created', 'Criado')} {formatDate(user.createdAt, locale)}</span>
                    </div>
                  </div>
                </div>

                <div className="admin-user-controls">
                  <div className="admin-user-role-switches">
                    {ROLE_OPTIONS.map(role => {
                      const active = roles.includes(role);
                      return (
                        <button
                          key={role}
                          type="button"
                          onClick={() => toggleRole(user.id, role)}
                          className={`admin-user-role-btn ${active ? 'is-active' : ''}`}
                        >
                          {roleLabel(role, tr)}
                        </button>
                      );
                    })}
                    {otherRoles.map(role => (
                      <span key={role} className="admin-user-role-passive">{roleLabel(role, tr)}</span>
                    ))}
                  </div>

                  <div className="admin-user-status-row">
                    <select value={user.status || 'ACTIVE'} onChange={event => updateField(user.id, 'status', event.target.value)} className="select-control-plain admin-user-status-select">
                      <option value="ACTIVE">{statusLabel('ACTIVE', tr)}</option>
                      <option value="INACTIVE">{statusLabel('INACTIVE', tr)}</option>
                      <option value="ARCHIVED">{statusLabel('ARCHIVED', tr)}</option>
                    </select>
                    <span className={`admin-user-verified ${user.isVerified ? 'is-yes' : 'is-no'}`}>
                      {user.isVerified ? tr('Verified', 'Verificado') : tr('Not verified', 'Nao verificado')}
                    </span>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </ViewPanel>
    </ViewScaffold>
  );
}
