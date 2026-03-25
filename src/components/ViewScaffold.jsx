import { ui } from '../ui/visuals';

function toneClasses(tone) {
  if (tone === 'success') return 'border-border/70 bg-card/80';
  if (tone === 'warning') return 'border-border/70 bg-card/80';
  if (tone === 'danger') return 'border-border/70 bg-card/80';
  return 'border-border/70 bg-card/75';
}

export function ViewScaffold({
  eyebrow,
  title,
  description,
  actions = null,
  metrics = [],
  hero = null,
  contextRail = null,
  actionRail = null,
  className = '',
  children,
}) {
  const rootClass = ['view-shell', 'command-view-shell', 'space-y-4', className].filter(Boolean).join(' ');

  return (
    <div className={rootClass}>
      {hero ? (
        <section className="command-view-hero">
          {hero}
        </section>
      ) : null}

      <section className={`${ui.card.base} command-view-header p-4 sm:p-5 lg:p-6 space-y-4`}>
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="space-y-2 min-w-0">
            {eyebrow ? (
              <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">{eyebrow}</p>
            ) : null}
            <h2 className={ui.text.pageTitle}>{title}</h2>
            {description ? <p className="text-sm text-muted-foreground max-w-4xl">{description}</p> : null}
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </div>

        {metrics.length > 0 ? (
          <div className="command-view-metrics">
            {metrics.map(metric => (
              <article
                key={metric.label}
                className={`command-view-metric rounded-lg border px-3.5 py-3.5 min-h-[5.25rem] ${toneClasses(metric.tone)}`}
              >
                <p className="text-[11px] uppercase tracking-[0.12em] font-semibold text-muted-foreground">{metric.label}</p>
                <p className="text-2xl font-semibold text-foreground mt-1">{metric.value}</p>
                {metric.helper ? <p className="text-xs text-muted-foreground mt-1">{metric.helper}</p> : null}
              </article>
            ))}
          </div>
        ) : null}
      </section>

      {(contextRail || actionRail) ? (
        <section className="command-view-rails">
          <div className="command-view-rails-main">
            {contextRail}
          </div>
          <aside className="command-view-rails-side">
            {actionRail}
          </aside>
        </section>
      ) : null}

      <div className="command-view-content">
        {children}
      </div>
    </div>
  );
}

export function ViewPanel({ title, subtitle, actions = null, className = '', children }) {
  const panelClass = [ui.card.base, 'command-view-panel', 'p-4', 'sm:p-5', 'space-y-4', className]
    .filter(Boolean)
    .join(' ');

  return (
    <section className={panelClass}>
      {(title || subtitle || actions) && (
        <header className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
          <div>
            {title ? <h3 className={ui.text.sectionTitle}>{title}</h3> : null}
            {subtitle ? <p className="text-sm text-muted-foreground mt-1">{subtitle}</p> : null}
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </header>
      )}
      {children}
    </section>
  );
}
