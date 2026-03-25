import { Sun, Moon, Monitor, Filter, Languages } from 'lucide-react';
import { cx, ui } from '../ui/visuals';

const THEME_OPTIONS = [
  { key: 'light', label: 'Light', labelPt: 'Claro', icon: Sun },
  { key: 'dark', label: 'Dark', labelPt: 'Escuro', icon: Moon },
  { key: 'system', label: 'System', labelPt: 'Sistema', icon: Monitor },
];

const LANGUAGE_OPTIONS = [
  { key: 'en', label: 'English' },
  { key: 'pt-BR', label: 'Portuguese (BR)' },
];

export default function SettingsPanel({ settings, setSettings, language = 'en' }) {
  const tr = (enText, ptBrText) => (language === 'pt-BR' ? ptBrText : enText);
  const changeTheme = theme => setSettings(prev => ({ ...prev, theme }));
  const changeLanguage = selectedLanguage => setSettings(prev => ({ ...prev, language: selectedLanguage }));
  const toggleHideNA = () => setSettings(prev => ({ ...prev, hideNA: !prev.hideNA }));

  return (
    <div className="p-6 sm:p-7 space-y-6">
      <header className="space-y-1">
        <h2 className={ui.text.sectionTitle}>{tr('Application Settings', 'Configurações da aplicação')}</h2>
        <p className={ui.text.muted}>{tr('Personalize appearance, language and chart filtering preferences.', 'Personalize aparência, idioma e preferências de filtro dos gráficos.')}</p>
      </header>

      <section className={`${ui.card.base} p-5 space-y-4`}>
        <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">{tr('Theme', 'Tema')}</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {THEME_OPTIONS.map(option => {
            const Icon = option.icon;
            const active = settings.theme === option.key;
            return (
              <button
                key={option.key}
                type="button"
                onClick={() => changeTheme(option.key)}
                className={cx(
                  ui.button.base,
                  'justify-start px-3.5 py-3 border',
                  active
                    ? 'border-primary/50 bg-primary/10 text-foreground shadow-sm'
                    : 'border-border bg-background/80 text-muted-foreground hover:text-foreground hover:border-primary/35',
                )}
              >
                <Icon className="w-[18px] h-[18px]" />
                <span>{language === 'pt-BR' ? option.labelPt : option.label}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className={`${ui.card.base} p-5 space-y-4`}>
        <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground flex items-center gap-2">
          <Languages className="w-[18px] h-[18px] text-primary" />
          {tr('Language', 'Idioma')}
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {LANGUAGE_OPTIONS.map(option => {
            const active = settings.language === option.key;
            return (
              <button
                key={option.key}
                type="button"
                onClick={() => changeLanguage(option.key)}
                className={cx(
                  ui.button.base,
                  'justify-start px-3.5 py-3 border',
                  active
                    ? 'border-primary/50 bg-primary/10 text-foreground shadow-sm'
                    : 'border-border bg-background/80 text-muted-foreground hover:text-foreground hover:border-primary/35',
                )}
              >
                <span>{option.label}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className={`${ui.card.base} p-5 space-y-4`}>
        <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">{tr('Charts', 'Gráficos')}</h3>
        <label className="choice-hit flex items-start gap-3 cursor-pointer">
          <input type="checkbox" checked={settings.hideNA} onChange={toggleHideNA} className="choice-control mt-1" />
          <div>
            <div className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Filter className="w-[18px] h-[18px] text-primary" />
              {tr('Hide uncategorized items', 'Ocultar itens sem categoria')}
            </div>
            <p className="text-xs text-muted-foreground mt-1">{tr('Exclude "N/A" or uncategorized projects from analytics visualizations.', 'Excluir projetos "N/A" ou sem categorização das visualizações analíticas.')}</p>
          </div>
        </label>
      </section>
    </div>
  );
}
