import { memo } from 'react';
import { Mail, User, CheckCircle2, XCircle, Archive } from 'lucide-react';

const ROLE_OPTIONS = ['ADMIN', 'VIEWER'];

function StatusBadge({ status }) {
  const s = (status || '').toUpperCase();
  const cfg =
    {
      ACTIVE: 'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-semibold border-emerald-400/40 bg-emerald-500/16 text-emerald-200',
      INACTIVE: 'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-semibold border-amber-400/40 bg-amber-500/16 text-amber-200',
      ARCHIVED: 'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-semibold border-border bg-muted/60 text-muted-foreground',
    }[s] || 'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-semibold border-border bg-muted/60 text-muted-foreground';

  return (
    <span className={cfg}>
      {s === 'ACTIVE' && <CheckCircle2 className="w-3 h-3" />}
      {s === 'INACTIVE' && <XCircle className="w-3 h-3" />}
      {s === 'ARCHIVED' && <Archive className="w-3 h-3" />}
      {s || '-'}
    </span>
  );
}

function roleLabel(role, tr) {
  const key = String(role || '').toUpperCase();
  if (key === 'ADMIN') return tr('Admin', 'Admin');
  if (key === 'VIEWER') return tr('Viewer', 'Leitor');
  return key;
}

function statusLabel(status, tr) {
  const key = String(status || '').toUpperCase();
  if (key === 'ACTIVE') return tr('Active', 'Ativo');
  if (key === 'INACTIVE') return tr('Inactive', 'Inativo');
  if (key === 'ARCHIVED') return tr('Archived', 'Arquivado');
  return key;
}

const UserRowComponent = ({ user, onUpdateField, onToggleRole, language = 'en' }) => {
  const tr = (enText, ptBrText) => (language === 'pt-BR' ? ptBrText : enText);
  const isArchived = (user.status || '').toUpperCase() === 'ARCHIVED';

  return (
    <tr className={`border-t border-border/60 ${isArchived ? 'opacity-60 bg-muted/20' : ''}`}>
      <td className="px-3 py-2 align-top text-xs text-muted-foreground">{user.id}</td>

      <td className="px-3 py-2 align-top">
        <input
          type="text"
          value={user.displayName || ''}
          onChange={e => onUpdateField(user.id, 'displayName', e.target.value)}
          className="input-control-plain"
          placeholder={tr('Display name', 'Nome de exibição')}
        />
      </td>

      <td className="px-3 py-2 align-top text-xs">
        <div className="flex flex-col gap-0.5">
          <span className="inline-flex items-center gap-1 text-foreground">
            <User className="w-3 h-3 text-muted-foreground" />
            {user.username}
          </span>
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <Mail className="w-3 h-3" />
            {user.email}
          </span>
        </div>
      </td>

      <td className="px-3 py-2 align-top">
        <div className="flex flex-wrap gap-1.5">
          {ROLE_OPTIONS.map(role => {
            const active = user.roles.includes(role);
            return (
              <button
                key={role}
                type="button"
                onClick={() => onToggleRole(user.id, role)}
                className={`px-2 py-0.5 rounded-md text-[11px] border font-semibold transition ${
                  active
                    ? 'bg-primary/20 text-foreground border-primary/45'
                    : 'bg-muted/55 text-muted-foreground border-border hover:border-primary/45 hover:text-foreground'
                }`}
              >
                {roleLabel(role, tr)}
              </button>
            );
          })}
          {user.roles
            .filter(r => !ROLE_OPTIONS.includes(r))
            .map(r => (
              <span key={r} className="px-2 py-0.5 rounded-md text-[11px] bg-muted text-foreground/80 border border-border">
                {roleLabel(r, tr)}
              </span>
            ))}
        </div>
      </td>

      <td className="px-3 py-2 align-top">
        <div className="flex flex-col gap-1">
          <select value={user.status || 'ACTIVE'} onChange={e => onUpdateField(user.id, 'status', e.target.value)} className="select-control-plain">
            <option value="ACTIVE">{statusLabel('ACTIVE', tr)}</option>
            <option value="INACTIVE">{statusLabel('INACTIVE', tr)}</option>
            <option value="ARCHIVED">{statusLabel('ARCHIVED', tr)}</option>
          </select>
          <StatusBadge status={user.status} />
        </div>
      </td>

      <td className="px-3 py-2 align-top text-xs">
        {user.isVerified ? (
          <span className="inline-flex items-center gap-1 text-emerald-300">
            <CheckCircle2 className="w-3 h-3" />
            {tr('Yes', 'Sim')}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-amber-300">
            <XCircle className="w-3 h-3" />
            {tr('No', 'Não')}
          </span>
        )}
      </td>
    </tr>
  );
};

export const UserRow = memo(UserRowComponent);

