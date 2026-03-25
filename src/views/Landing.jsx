import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  BarChart3,
  LayoutGrid,
  Map,
  Settings,
  Table,
} from 'lucide-react';
import { ui } from '../ui/visuals';
import dpWorldLogo from '../assets/DPWorldLogo.png';
import dpLogoTwo from '../assets/branco.png';
import heroPortoSantos from '../assets/porto_santos.png';
import heroCargoLoading from '../assets/Cargo being loaded on vessel.jpg';
import heroContainerTerminal from '../assets/Container terminal.jpg';
import heroEmployeeWorking from '../assets/Employee working in crane.jpg';
import heroLoadingCargo from '../assets/Loading cargo on vessel.jpg';

const HERO_IMAGES = [
  heroPortoSantos,
  heroCargoLoading,
  heroContainerTerminal,
  heroLoadingCargo
];
const HERO_AUTOPLAY_MS = 8000;
const CONTACT_IMAGE = heroEmployeeWorking;

function useAnimatedNumber(
  targetValue,
  { duration = 720, decimals = 0 } = {},
) {
  const safeTarget = Number.isFinite(Number(targetValue)) ? Number(targetValue) : 0;
  const [value, setValue] = useState(0);

  useEffect(() => {
    let frameId = 0;
    const startAt = window.performance.now();
    const factor = decimals > 0 ? 10 ** decimals : 1;

    setValue(0);

    const tick = (now) => {
      const progress = Math.min(1, (now - startAt) / duration);
      const eased = 1 - ((1 - progress) ** 3);
      const nextValue = safeTarget * eased;
      setValue(Math.round(nextValue * factor) / factor);

      if (progress < 1) {
        frameId = window.requestAnimationFrame(tick);
      } else {
        setValue(safeTarget);
      }
    };

    frameId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frameId);
  }, [safeTarget, duration, decimals]);

  return value;
}

function AnimatedHeroKpi({ index = 0, target, decimals = 0, formatValue, label }) {
  const animatedValue = useAnimatedNumber(target, {
    duration: 640 + (index * 120),
    decimals,
  });

  return (
    <article className="landing-corp-hero-kpi" style={{ '--landing-kpi-delay': `${index * 90}ms` }}>
      <strong>{formatValue(animatedValue)}</strong>
      <span>{label}</span>
    </article>
  );
}

export default function Landing({ onLoginClick, onOpenSettings, language = 'en' }) {
  const isPtBr = language === 'pt-BR';
  const locale = isPtBr ? 'pt-BR' : 'en-US';
  const tr = (enText, ptBrText) => (isPtBr ? ptBrText : enText);
  const [activeHeroIndex, setActiveHeroIndex] = useState(0);
  const [overviewGradientProgress, setOverviewGradientProgress] = useState(0);
  const heroImages = useMemo(() => HERO_IMAGES.filter(Boolean), []);

  useEffect(() => {
    if (heroImages.length <= 1) return undefined;
    const intervalId = window.setInterval(() => {
      setActiveHeroIndex(prev => (prev + 1) % heroImages.length);
    }, HERO_AUTOPLAY_MS);
    return () => window.clearInterval(intervalId);
  }, [heroImages.length]);

  useEffect(() => {
    let frameId = 0;

    const updateProgress = () => {
      const section = document.querySelector('.landing-corp-overview');
      if (!section) return;

      const rect = section.getBoundingClientRect();
      const viewportHeight = Math.max(window.innerHeight || 0, 1);
      const start = viewportHeight * 0.95;
      const end = viewportHeight * 0.28;
      const rawProgress = (start - rect.top) / Math.max(start - end, 1);
      const nextProgress = Math.min(1, Math.max(0, rawProgress));

      setOverviewGradientProgress(prev => (Math.abs(prev - nextProgress) > 0.01 ? nextProgress : prev));
    };

    const scheduleProgressUpdate = () => {
      if (frameId) return;
      frameId = window.requestAnimationFrame(() => {
        frameId = 0;
        updateProgress();
      });
    };

    updateProgress();
    window.addEventListener('scroll', scheduleProgressUpdate, { passive: true });
    window.addEventListener('resize', scheduleProgressUpdate);

    return () => {
      if (frameId) window.cancelAnimationFrame(frameId);
      window.removeEventListener('scroll', scheduleProgressUpdate);
      window.removeEventListener('resize', scheduleProgressUpdate);
    };
  }, []);

  const overviewHeadline = tr('SMART PROJECT CONTROL PORTAL FOR BRAZIL', 'PORTAL INTELIGENTE DE CONTROLE DE PROJETOS DO BRASIL');
  const topBarPhrase = tr(
    'Enterprise command center for project governance and delivery',
    'Central corporativa para governança e execução de projetos',
  );
  const formatCompact = (value) => new Intl.NumberFormat(locale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(Number(value || 0));
  const formatInteger = (value) => new Intl.NumberFormat(locale).format(Math.round(Number(value || 0)));

  const heroKpis = useMemo(
    () => [
      {
        key: 'active-projects',
        target: 32,
        decimals: 0,
        label: tr('Active projects', 'Projetos ativos'),
        formatValue: value => `${formatInteger(value)}+`,
      },
      {
        key: 'estimated-value',
        target: 2.4,
        decimals: 1,
        label: tr('Estimated value', 'Valor estimado'),
        formatValue: value => `R$ ${formatCompact(value)}M`,
      },
      {
        key: 'data-completeness',
        target: 97,
        decimals: 0,
        label: tr('Data completeness', 'Completude de dados'),
        formatValue: value => `${formatInteger(value)}%`,
      },
    ],
    [formatCompact, formatInteger, tr],
  );

  const selfServiceTools = [
    {
      icon: LayoutGrid,
      title: tr('Projects board command center', 'Central de comando do board de projetos'),
      region: tr('Brazil', 'Brasil'),
    },
    {
      icon: Map,
      title: tr('Roadmap and timeline orchestration', 'Orquestração de roadmap e timeline'),
      region: tr('Brazil', 'Brasil'),
    },
    {
      icon: Table,
      title: tr('Structured data editing portal', 'Portal de edição estruturada de dados'),
      region: tr('Brazil', 'Brasil'),
    },
    {
      icon: BarChart3,
      title: tr('Executive analytics and KPI view', 'Visão executiva de analytics e KPIs'),
      region: tr('Brazil', 'Brasil'),
    },
  ];

  const overviewPillars = [
    {
      title: tr('Unified Project Board', 'Board Unificado de Projetos'),
      description: tr(
        'Single visual lane for prioritization, ownership and delivery flow.',
        'Esteira visual unica para priorização, ownership e fluxo de entrega.',
      ),
    },
    {
      title: tr('Timeline and Planning', 'Timeline e Planejamento'),
      description: tr(
        'Roadmap synchronization with dependencies and date accountability.',
        'Sincronização de roadmap com dependencias e accountability de datas.',
      ),
    },
    {
      title: tr('Governance and Traceability', 'governança e Rastreabilidade'),
      description: tr(
        'Audit trail, standardized controls and transparent decision context.',
        'Trilha de auditoria, controles padronizados e contexto transparente de decisão.',
      ),
    },
  ];

  const footerColumns = [
    {
      title: tr('Platform', 'Plataforma'),
      items: [
        tr('Projects board', 'Board de projetos'),
        tr('Roadmap timeline', 'Timeline de roadmap'),
        tr('Operational table', 'Tabela operacional'),
        tr('Executive dashboard', 'Dashboard executivo'),
      ],
    },
    {
      title: tr('Methodology', 'Metodologia'),
      items: [
        tr('Kaizen routines', 'Rotinas Kaizen'),
        tr('Lean waste tracking', 'Rastreio de desperdicios Lean'),
        tr('Green Belt initiatives', 'Iniciativas Green Belt'),
        tr('Black Belt governance', 'governança Black Belt'),
      ],
    },
    {
      title: tr('Governance', 'governança'),
      items: [
        tr('Committee impact registry', 'Registro de impacto de comite'),
        tr('Audit trail', 'Trilha de auditoria'),
        tr('Status accountability', 'Accountability de status'),
        tr('Portfolio visibility', 'Visibilidade de portfólio'),
      ],
    },
    {
      title: tr('Support', 'Suporte'),
      items: [
        tr('Operations support desk', 'Central de suporte operacional'),
        tr('Playbook and guides', 'Playbook e guias'),
        tr('Data quality standards', 'Padrões de qualidade de dados'),
        tr('Continuous improvement office', 'Escritorio de melhoria continua'),
      ],
    },
  ];

  return (
    <div className={`${ui.shell.appBackdrop} landing-shell landing-corp-shell page-screen-stage`}>
      <header className="landing-corp-topbar">
        <div className="landing-corp-topbar-inner">
          <div className="landing-corp-brand">
            <img src={dpWorldLogo} alt="DP World" className="landing-corp-logo" />
          </div>

          <p className="landing-corp-nav-text">{topBarPhrase}</p>

          <div className="landing-corp-actions">
            <button
              type="button"
              onClick={onOpenSettings}
              className={`${ui.button.base} ${ui.button.icon} ${ui.button.ghost}`}
              title={tr('Settings', 'Configuracões')}
            >
              <Settings className="w-4 h-4" />
            </button>
            <button type="button" onClick={onLoginClick} className={`${ui.button.base} ${ui.button.primary}`}>
              {tr('Open Workspace', 'Abrir Workspace')}
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      <section className="landing-corp-hero">
        <div className="landing-corp-hero-slides" aria-hidden="true">
          {heroImages.map((imageUrl, index) => (
            <div
              key={imageUrl}
              className={`landing-corp-hero-slide ${index === activeHeroIndex ? 'is-active' : ''}`}
              style={{ backgroundImage: `url(${imageUrl})` }}
            />
          ))}
        </div>
        <div className="landing-corp-hero-overlay" />
        <div className="landing-corp-hero-content">
          <p className="landing-corp-breadcrumb">
            {tr('Operational Excellence', 'Excelencia Operacional')} / {tr('Project Control Layer', 'Camada de Controle de Projetos')}
          </p>
          <h1>{tr('Excellence Control', 'Excellence Control')}</h1>
          <p>
            {tr(
              'A project management command center for planning, execution and governance. Keep teams aligned with board, roadmap, table and analytics in one place.',
              'Um command center de gestão de projetos para planejamento, execução e governança. Mantenha os times alinhados com board, roadmap, tabela e analytics em um unico lugar.',
            )}
          </p>
          <div className="landing-corp-hero-kpis">
            {heroKpis.map((item, index) => (
              <AnimatedHeroKpi
                key={item.key}
                index={index}
                target={item.target}
                decimals={item.decimals}
                label={item.label}
                formatValue={item.formatValue}
              />
            ))}
          </div>
          <p className="kpi-disclaimer">
            {tr(
              '* KPI values shown here are illustrative only.',
              '* Os valores de KPI mostrados aqui são meramente ilustrativos.',
            )}
          </p>
          <div className="landing-corp-hero-dots" role="tablist" aria-label={tr('Hero images', 'Imagens do destaque')}>
            {heroImages.map((_, index) => (
              <button
                key={index}
                type="button"
                className={`landing-corp-hero-dot ${index === activeHeroIndex ? 'is-active' : ''}`}
                aria-label={tr(`Show image ${index + 1}`, `Mostrar imagem ${index + 1}`)}
                aria-selected={index === activeHeroIndex}
                onClick={() => setActiveHeroIndex(index)}
              />
            ))}
          </div>
        </div>
      </section>

      <main className="landing-corp-main">
        <section className="landing-corp-toolkit">
          <h2>{tr('SELF-SERVICE TOOLS', 'FERRAMENTAS DE AUTOATENDIMENTO')}</h2>
          <div className="landing-corp-toolkit-grid">
            {selfServiceTools.map(item => {
              const Icon = item.icon;
              return (
                <article key={item.title} className="landing-corp-toolkit-card">
                  <h3>
                    <Icon className="w-4 h-4" />
                    <span>{item.title}</span>
                  </h3>
                  <p>{item.region}</p>
                </article>
              );
            })}
          </div>
        </section>

        <section className="landing-corp-overview">
          <p className="landing-corp-overview-kicker">{tr('Overview', 'Visão Geral')}</p>
          <h2
            className="landing-corp-overview-title"
            data-title={overviewHeadline}
            style={{ '--landing-overview-gradient-progress': overviewGradientProgress }}
          >
            {overviewHeadline}
          </h2>
          <p className="landing-corp-overview-description">
            {tr(
              'Your single command portal for project planning, execution and governance. Operational teams coordinate delivery lanes with reliable visibility, standardized ownership and auditable decision flow.',
              'Seu portal unico de comando para planejamento, execução e governança de projetos. Times operacionais coordenam as esteiras de entrega com visibilidade confiável, ownership padronizado e fluxo auditavel de decisão.',
            )}
          </p>
          <div className="landing-corp-overview-pillars">
            {overviewPillars.map(item => (
              <article key={item.title} className="landing-corp-overview-pillar">
                <h3>{item.title}</h3>
                <p>{item.description}</p>
              </article>
            ))}
          </div>
        </section>
      </main>

      <section className="landing-corp-contact" style={{ backgroundImage: `url(${CONTACT_IMAGE})` }}>
        <div className="landing-corp-contact-overlay" />
        <div className="landing-corp-contact-inner">
          <p className="landing-corp-contact-kicker">
            {tr('Execution Support', 'Suporte a execução')}
          </p>
          <h2>{tr('Talk to a Project Specialist', 'Fale com um Especialista de Projetos')}</h2>
          <p>
            {tr(
              'Our team supports portfolio structuring, governance standards and delivery follow-up for critical initiatives.',
              'Nosso time apoia estruturação de portfólio, padrões de governança e acompanhamento de entrega para iniciativas críticas.',
            )}
          </p>
          <a
            href="mailto:excelenciaoperacional.service@dpworld.com"
            className={`${ui.button.base} ${ui.button.primary} landing-corp-contact-cta`}
          >
            {tr('Contact Team', 'Contatar equipe')}
            <ArrowRight className="w-4 h-4" />
          </a>
        </div>
      </section>

      <footer className="landing-corp-footer">
        <div className="landing-corp-footer-inner">
          <div className="landing-corp-footer-brand">
            <img src={dpLogoTwo} alt="DP World" className="landing-corp-footer-logo"/>
            <p>
              {tr(
                'Enterprise project control for operational excellence, portfolio visibility and delivery discipline.',
                'Controle corporativo de projetos para excelencia operacional, visibilidade de portfólio e disciplina de entrega.',
              )}
            </p>
          </div>

          <div className="landing-corp-footer-columns">
            {footerColumns.map(column => (
              <section key={column.title} className="landing-corp-footer-column">
                <h3>{column.title}</h3>
                <ul>
                  {column.items.map(item => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </div>

        <div className="landing-corp-footer-bottom">
          <p>© {new Date().getFullYear()} DP World - Excellence Control</p>
          <p>{tr('Internal use only', 'Uso interno')}</p>
        </div>
      </footer>
    </div>
  );
}
