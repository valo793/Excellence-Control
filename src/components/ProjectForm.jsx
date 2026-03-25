import { useEffect, useState } from 'react';
import { Calendar, DollarSign, Users, Tag, FileText, CheckCircle2, X, Save, ChevronDown, Paperclip, Trash2 } from 'lucide-react';
import { getStatusLabel, STATUS_MAP } from '../utils/constants';
import { getStatusMeta, ui } from '../ui/visuals';

const ORIGEM_OPTIONS = ['', 'Kaizen', 'Ex Op & Innovation', 'Committee', 'Greenbelt', 'LeanProgram'];
const IMPACT_OPTIONS = ['', 'Productivity', 'Regulation', 'Safety', 'Revenue/Savings'];
const KAIZEN_OPTIONS = ['', 'Waste Elimination', 'Safety Improvement', 'Increase Performance', '5S Excellence'];
const MONTH_OPTIONS = Array.from({ length: 12 }, (_, index) => ({
  value: String(index + 1),
  label: String(index + 1).padStart(2, '0'),
}));

const ORIGEM_LABELS_PT = {
  Kaizen: 'Kaizen',
  'Ex Op & Innovation': 'Ex Op e Inovação',
  Committee: 'Comitê',
  Greenbelt: 'Greenbelt',
  LeanProgram: 'LeanProgram',
};

const IMPACT_LABELS_PT = {
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

const PRIORITY_LABELS_PT = {
  LOW: 'Baixa',
  MEDIUM: 'Média',
  HIGH: 'Alta',
};

const handleDownloadAttachment = async (e, att) => {
  e.preventDefault();
  e.stopPropagation();
  if (!att?.url) return;

  try {
    const res = await fetch(att.url);
    if (!res.ok) return;

    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = att.name || 'file';
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  } catch (err) {
    console.error('Error downloading file', err);
  }
};

function Section({ title, icon: Icon, children, isOpen, onToggle }) {
  return (
    <section className="surface-card p-5">
      <button type="button" onClick={onToggle} className="w-full flex items-center justify-between gap-3 pb-3 border-b border-border/70 text-left">
        <div className="flex items-center gap-3">
          <span className="h-9 w-9 rounded-lg border border-border/70 bg-background/70 text-muted-foreground inline-flex items-center justify-center">
            <Icon className="w-4 h-4" />
          </span>
          <h3 className="text-base font-semibold text-foreground">{title}</h3>
        </div>
        <ChevronDown className={`w-5 h-5 text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      <div className={`overflow-hidden transition-all duration-300 ${isOpen ? 'max-h-[2200px] opacity-100 pt-4' : 'max-h-0 opacity-0 pointer-events-none'}`}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">{children}</div>
      </div>
    </section>
  );
}

function InputGroup({ label, children, fullWidth = false }) {
  return (
    <div className={fullWidth ? 'sm:col-span-2 space-y-1.5' : 'space-y-1.5'}>
      <label className="block text-[11px] font-semibold uppercase tracking-[0.13em] text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

function Input({ value, onChange, type = 'text', placeholder, required, step, readOnly = false, disabled = false }) {
  return (
    <input
      type={type}
      value={value || ''}
      onChange={onChange}
      placeholder={placeholder}
      required={required}
      step={step}
      readOnly={readOnly}
      disabled={disabled}
      className={`${ui.field.input} h-11`}
    />
  );
}

function Select({ value, onChange, children }) {
  return (
    <div className="relative">
      <select
        value={value || ''}
        onChange={onChange}
        className={`${ui.field.select} h-11 pr-8`}
      >
        {children}
      </select>
      <span className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground">v</span>
    </div>
  );
}

function TextArea({ value, onChange, rows = 3 }) {
  return (
    <textarea
      value={value || ''}
      onChange={onChange}
      rows={rows}
      className={ui.field.textarea}
    />
  );
}

function translatedOption(option, tr, labelsPt) {
  if (!option) return tr('Select...', 'Selecionar...');
  return tr(option, labelsPt[option] || option);
}

function priorityLabel(option, tr) {
  return tr(option.charAt(0) + option.slice(1).toLowerCase(), PRIORITY_LABELS_PT[option] || option);
}

function normalizeComite(value) {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return 'nao';
  if (['sim', 's', 'yes', 'y', 'true', '1'].includes(raw)) return 'sim';
  if (['nao', 'não', 'n', 'no', 'false', '0'].includes(raw)) return 'nao';
  return raw.startsWith('s') ? 'sim' : 'nao';
}

function parseEarningNumber(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const text = String(value).trim();
  if (/^-?\d+(\.\d+)?$/.test(text)) {
    return Number.parseFloat(text);
  }
  const normalized = text.replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, '');
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeEarningStatus(value) {
  const normalized = String(value || '').trim().toUpperCase();
  return normalized === 'REALIZADO' ? 'REALIZADO' : 'PREVISTO';
}

function normalizeEarningsMonthly(items) {
  if (!Array.isArray(items)) return [];
  const normalized = [];
  const seen = new Set();
  items.forEach(item => {
    const year = Number.parseInt(item?.year, 10);
    const month = Number.parseInt(item?.month, 10);
    const value = parseEarningNumber(item?.value);
    if (!Number.isInteger(year) || year < 1900 || year > 9999) return;
    if (!Number.isInteger(month) || month < 1 || month > 12) return;
    const key = `${year}-${month}`;
    if (seen.has(key)) return;
    seen.add(key);
    normalized.push({
      year,
      month,
      value,
      tipo: item?.tipo || null,
      dolarValue: item?.dolarValue != null ? parseEarningNumber(item.dolarValue) : null,
      earningStatus: normalizeEarningStatus(item?.earningStatus),
    });
  });
  return normalized.sort((a, b) => (a.year - b.year) || (a.month - b.month));
}

export default function ProjectForm({ language = 'en', initial, onSubmit, onRemoveAttachment, canDelete = false, onRequestDelete }) {
  const tr = (enText, ptBrText) => (language === 'pt-BR' ? ptBrText : enText);

  const [data, setData] = useState({});
  const [sectionsOpen, setSectionsOpen] = useState({
    general: true,
    classification: false,
    cronogram: false,
    financial: false,
    team: false,
    attachments: false,
  });

  useEffect(() => {
    const base = initial || {};
    setData({
      ...base,
      comite: normalizeComite(base.comite),
      members: Array.isArray(base.members) ? base.members : [],
      earningsMonthly: normalizeEarningsMonthly(base.earningsMonthly || []),
    });
  }, [initial]);

  const set = (k, v) => setData(d => ({ ...d, [k]: v }));

  const ensureMembersArray = () => (Array.isArray(data.members) ? data.members : []);

  const addMember = () => {
    setData(d => {
      const current = Array.isArray(d.members) ? d.members : [];
      return { ...d, members: [...current, { name: '', role: '' }] };
    });
  };

  const updateMember = (index, field, value) => {
    setData(d => {
      const current = Array.isArray(d.members) ? d.members : [];
      const clone = [...current];
      clone[index] = { ...clone[index], [field]: value };
      return { ...d, members: clone };
    });
  };

  const removeMember = index => {
    setData(d => {
      const current = Array.isArray(d.members) ? d.members : [];
      return { ...d, members: current.filter((_, i) => i !== index) };
    });
  };

  const ensureEarningsArray = () => (Array.isArray(data.earningsMonthly) ? data.earningsMonthly : []);

  const addEarningRow = () => {
    const now = new Date();
    setData(d => {
      const current = Array.isArray(d.earningsMonthly) ? d.earningsMonthly : [];
      return {
        ...d,
        earningsMonthly: [...current, { year: now.getFullYear(), month: now.getMonth() + 1, value: 0, tipo: 'REVENUE', dolarValue: null, earningStatus: 'PREVISTO' }],
      };
    });
  };

  const updateEarningRow = (index, field, rawValue) => {
    setData(d => {
      const current = Array.isArray(d.earningsMonthly) ? [...d.earningsMonthly] : [];
      const target = { ...(current[index] || {}) };
      if (field === 'year' || field === 'month') {
        target[field] = Number.parseInt(rawValue, 10) || '';
      } else if (field === 'earningStatus') {
        target[field] = normalizeEarningStatus(rawValue);
      } else if (field === 'tipo') {
        target[field] = rawValue;
      } else if (field === 'dolarValue') {
        target[field] = rawValue === '' ? null : parseEarningNumber(rawValue);
      } else {
        target[field] = parseEarningNumber(rawValue);
      }
      current[index] = target;
      return { ...d, earningsMonthly: current };
    });
  };

  const removeEarningRow = index => {
    setData(d => {
      const current = Array.isArray(d.earningsMonthly) ? d.earningsMonthly : [];
      return { ...d, earningsMonthly: current.filter((_, i) => i !== index) };
    });
  };

  const currentStatusKey = data.status || 'TODO';
  const currentStatusLabel = getStatusLabel(currentStatusKey, language);
  const accentColor = getStatusMeta(currentStatusKey).color;
  const committeeValue = normalizeComite(data.comite);

  const realizedTotal = normalizeEarningsMonthly(ensureEarningsArray()).reduce((sum, item) => (
    item.earningStatus === 'REALIZADO'
      ? sum + parseEarningNumber(item.value)
      : sum
  ), 0);

  const handleSubmit = e => {
    e.preventDefault();
    const normalizedEarnings = normalizeEarningsMonthly(ensureEarningsArray());
    onSubmit({
      ...data,
      comite: normalizeComite(data.comite),
      earningsMonthly: normalizedEarnings,
      ganhoRealizado: normalizedEarnings.reduce((sum, item) => (
        item.earningStatus === 'REALIZADO'
          ? sum + parseEarningNumber(item.value)
          : sum
      ), 0),
    });
  };

  const handleDeleteRequest = () => {
    if (!canDelete || !data?.id || typeof onRequestDelete !== 'function') return;
    onRequestDelete(data);
  };

  const toggleSection = key => {
    setSectionsOpen(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const toAttachmentMeta = file => ({
    name: file.name,
    size: file.size,
    type: file.type,
  });

  const handleFileChange = e => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    setData(d => ({
      ...d,
      _filesToUpload: [...(d._filesToUpload || []), ...files],
      attachments: [...(d.attachments || []), ...files.map(toAttachmentMeta)],
    }));
    e.target.value = '';
  };

  const handleRemoveAttachment = index => {
    const att = data.attachments?.[index];
    const isExisting = !!att?.id;

    setData(prev => {
      const nextAttachments = (prev.attachments || []).filter((_, i) => i !== index);
      let nextFiles = prev._filesToUpload || [];
      if (!isExisting && att) {
        nextFiles = nextFiles.filter(f => !(f.name === att.name && f.size === att.size));
      }
      return { ...prev, attachments: nextAttachments, _filesToUpload: nextFiles };
    });

    if (isExisting && typeof onRemoveAttachment === 'function' && data?.id) {
      onRemoveAttachment(data.id, att);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="w-full p-1">
      <div className="sticky top-0 z-20 surface-glass border-b border-border/70 px-6 py-5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="border-l-4 pl-4" style={{ borderColor: accentColor }}>
          <h2 className="text-2xl font-semibold text-foreground">{data?.id ? tr('Edit Project', 'Editar projeto') : tr('New Project', 'Novo projeto')}</h2>
          <p className="text-sm text-muted-foreground">{tr('Fill in the details below.', 'Preencha os detalhes abaixo.')}</p>
        </div>

        <div className="flex items-center gap-3 bg-background px-4 py-2 rounded-xl border border-border/70">
          <CheckCircle2 className="w-5 h-5" style={{ color: accentColor }} />
          <div>
            <div className="text-[10px] uppercase font-bold text-muted-foreground leading-none">{tr('Status', 'Status')}</div>
            <div className="font-bold text-sm leading-tight" style={{ color: accentColor }}>
              {currentStatusLabel}
            </div>
          </div>
        </div>
      </div>

      <div className="p-6 space-y-6">
        <Section title={tr('General Information', 'Informações gerais')} icon={FileText} isOpen={sectionsOpen.general} onToggle={() => toggleSection('general')}>
          <InputGroup label={tr('Project Title', 'Título do projeto')} fullWidth>
            <Input value={data.title} onChange={e => set('title', e.target.value)} required placeholder={tr('Ex: Line A Optimization', 'Ex: Otimizacao da Linha A')} />
          </InputGroup>

          <InputGroup label={tr('Status', 'Status')}>
            <Select value={data.status} onChange={e => set('status', e.target.value)}>
              {Object.keys(STATUS_MAP).map(k => (
                <option key={k} value={k}>
                  {getStatusLabel(k, language)}
                </option>
              ))}
            </Select>
          </InputGroup>

          <InputGroup label={tr('Priority', 'Prioridade')}>
            <Select value={data.priority || 'MEDIUM'} onChange={e => set('priority', e.target.value)}>
              <option value="LOW">{priorityLabel('LOW', tr)}</option>
              <option value="MEDIUM">{priorityLabel('MEDIUM', tr)}</option>
              <option value="HIGH">{priorityLabel('HIGH', tr)}</option>
            </Select>
          </InputGroup>

          <InputGroup label={tr('Detailed Description', 'Descricao detalhada')} fullWidth>
            <TextArea value={data.description} onChange={e => set('description', e.target.value)} />
          </InputGroup>

          <InputGroup label={tr('Origin', 'Origem')}>
            <Select value={data.origem} onChange={e => set('origem', e.target.value)}>
              {ORIGEM_OPTIONS.map(opt => (
                <option key={opt || 'empty'} value={opt}>
                  {translatedOption(opt, tr, ORIGEM_LABELS_PT)}
                </option>
              ))}
            </Select>
          </InputGroup>

          <InputGroup label={tr('Committee', 'Comitê')}>
            <div className="field-shell h-11 px-2.5 flex items-center gap-2">
              <label className="choice-hit flex items-center gap-2 text-sm text-foreground">
                <input type="radio" checked={committeeValue === 'sim'} onChange={() => set('comite', 'sim')} className="choice-control" />
                {tr('Yes', 'Sim')}
              </label>
              <label className="choice-hit flex items-center gap-2 text-sm text-foreground">
                <input type="radio" checked={committeeValue === 'nao'} onChange={() => set('comite', 'nao')} className="choice-control" />
                {tr('No', 'Não')}
              </label>
            </div>
          </InputGroup>
        </Section>

        <Section title={tr('Classification and Impact', 'Classificação e impacto')} icon={Tag} isOpen={sectionsOpen.classification} onToggle={() => toggleSection('classification')}>
          <InputGroup label={tr('Committee Impact', 'Impacto no comitê')}>
            <Select value={data.impactoComite} onChange={e => set('impactoComite', e.target.value)}>
              {IMPACT_OPTIONS.map(opt => (
                <option key={opt || 'empty'} value={opt}>
                  {translatedOption(opt, tr, IMPACT_LABELS_PT)}
                </option>
              ))}
            </Select>
          </InputGroup>

          <InputGroup label={tr('Kaizen Category', 'Categoria kaizen')}>
            <Select value={data.categoriaKaizen} onChange={e => set('categoriaKaizen', e.target.value)}>
              {KAIZEN_OPTIONS.map(opt => (
                <option key={opt || 'empty'} value={opt}>
                  {translatedOption(opt, tr, KAIZEN_LABELS_PT)}
                </option>
              ))}
            </Select>
          </InputGroup>

          <InputGroup label={tr('Area Group', 'Grupo da area')}>
            <Input value={data.areaGrupo} onChange={e => set('areaGrupo', e.target.value)} />
          </InputGroup>

          <InputGroup label={tr('Boletim ExOp Category', 'Categoria Boletim ExOp')}>
            <Select value={data.categoriaBoletimExop} onChange={e => set('categoriaBoletimExop', e.target.value)}>
              {IMPACT_OPTIONS.map(opt => (
                <option key={`boletim-${opt || 'empty'}`} value={opt}>
                  {translatedOption(opt, tr, IMPACT_LABELS_PT)}
                </option>
              ))}
            </Select>
          </InputGroup>

          <InputGroup label={tr('Project Link ID', 'ID projeto de origem')}>
            <Input
              type="number"
              value={data.projectLinkId}
              onChange={e => set('projectLinkId', e.target.value)}
              placeholder={tr('Ex: 1024', 'Ex: 1024')}
            />
          </InputGroup>
        </Section>

        <Section title={tr('Timeline', 'Cronograma')} icon={Calendar} isOpen={sectionsOpen.cronogram} onToggle={() => toggleSection('cronogram')}>
          <InputGroup label={tr('Arrival Date', 'Data de chegada')}>
            <Input type="date" value={data.chegada} onChange={e => set('chegada', e.target.value)} />
          </InputGroup>
          <InputGroup label={tr('Start Date', 'Data de início')}>
            <Input type="date" value={data.startDate} onChange={e => set('startDate', e.target.value)} />
          </InputGroup>
          <InputGroup label={tr('Gain Start Date', 'Data de início do ganho')}>
            <Input type="date" value={data.dataInicioGanho} onChange={e => set('dataInicioGanho', e.target.value)} />
          </InputGroup>
          <InputGroup label={tr('Due Date', 'Data de prazo')}>
            <Input type="date" value={data.dueDate} onChange={e => set('dueDate', e.target.value)} />
          </InputGroup>
          <InputGroup label={tr('Estimated End Date', 'Data final estimada')}>
            <Input type="date" value={data.dataFimPrevisto} onChange={e => set('dataFimPrevisto', e.target.value)} />
          </InputGroup>
          <InputGroup label={tr('Target Year', 'Ano de referencia')}>
            <Input type="number" value={data.anoConsiderado} onChange={e => set('anoConsiderado', e.target.value)} />
          </InputGroup>
        </Section>

        <Section title={tr('Financial and KPIs', 'Financeiro e KPIs')} icon={DollarSign} isOpen={sectionsOpen.financial} onToggle={() => toggleSection('financial')}>
          <InputGroup label={tr('Estimated Gain (R$)', 'Ganho estimado (R$)')} fullWidth>
            <Input type="number" step="0.01" value={data.ganhoEstimado} onChange={e => set('ganhoEstimado', e.target.value)} placeholder="0.00" />
          </InputGroup>
          <InputGroup label={tr('Realized Gain (R$)', 'Ganho realizado (R$)')} fullWidth>
            <Input value={realizedTotal.toFixed(2)} readOnly disabled />
          </InputGroup>

          <InputGroup label={tr('GOE Kaizen Award', 'GOE Kaizen Award')}>
            <Input value={data.goeKaizenAward} onChange={e => set('goeKaizenAward', e.target.value)} />
          </InputGroup>

          <InputGroup label={tr('Premio Kaizen', 'Premio Kaizen')}>
            <Input value={data.premioKaizen} onChange={e => set('premioKaizen', e.target.value)} />
          </InputGroup>

          <InputGroup label={tr('Metrics Methodology', 'Metodologia das metricas')} fullWidth>
            <TextArea
              value={data.metrics}
              onChange={e => set('metrics', e.target.value)}
              rows={4}
            />
          </InputGroup>

          <InputGroup label={tr('Monthly Earnings', 'Ganhos mensais')} fullWidth>
            <div className="space-y-3">
              {ensureEarningsArray().length === 0 && (
                <p className="text-xs text-muted-foreground">
                  {tr('No monthly records yet. Add values per month and set if each one is Projected or Realized.', 'Sem registros mensais. Adicione valores por mês e defina se cada um é Previsto ou Realizado.')}
                </p>
              )}
              {ensureEarningsArray().map((item, index) => (
                <div key={`${item.year || 'y'}-${item.month || 'm'}-${index}`} className="grid grid-cols-1 md:grid-cols-[minmax(0,0.7fr)_minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,0.9fr)_minmax(0,0.8fr)_minmax(0,0.8fr)_auto] gap-3 items-center">
                  <Input
                    type="number"
                    value={item.year}
                    onChange={e => updateEarningRow(index, 'year', e.target.value)}
                    placeholder={tr('Year', 'Ano')}
                  />
                  <Select
                    value={String(item.month || '')}
                    onChange={e => updateEarningRow(index, 'month', e.target.value)}
                  >
                    <option value="">{tr('Select month', 'Selecionar mes')}</option>
                    {MONTH_OPTIONS.map(option => (
                      <option key={`month-${option.value}`} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                  <Input
                    type="number"
                    step="0.01"
                    value={item.value}
                    onChange={e => updateEarningRow(index, 'value', e.target.value)}
                    placeholder="0.00"
                  />
                  <Select
                    value={item.earningStatus || 'PREVISTO'}
                    onChange={e => updateEarningRow(index, 'earningStatus', e.target.value)}
                  >
                    <option value="PREVISTO">{tr('Projected', 'Previsto')}</option>
                    <option value="REALIZADO">{tr('Realized', 'Realizado')}</option>
                  </Select>
                  <Select
                    value={item.tipo || 'REVENUE'}
                    onChange={e => updateEarningRow(index, 'tipo', e.target.value)}
                  >
                    <option value="REVENUE">{tr('Revenue', 'Receita')}</option>
                    <option value="SAVING">{tr('Saving', 'Saving')}</option>
                  </Select>
                  <Input
                    type="number"
                    step="0.01"
                    value={item.dolarValue ?? ''}
                    onChange={e => updateEarningRow(index, 'dolarValue', e.target.value)}
                    placeholder={tr('USD Rate', 'Cotação')}
                  />
                  <button type="button" onClick={() => removeEarningRow(index)} className={`${ui.button.base} ${ui.button.danger} text-xs`}>
                    {tr('Remove', 'Remover')}
                  </button>
                </div>
              ))}
              <button type="button" onClick={addEarningRow} className={`${ui.button.base} ${ui.button.subtle} text-xs`}>
                + {tr('Add month', 'Adicionar mes')}
              </button>
            </div>
          </InputGroup>
        </Section>

        <Section title={tr('Traceability and Team', 'Rastreabilidade e time')} icon={Users} isOpen={sectionsOpen.team} onToggle={() => toggleSection('team')}>
          <InputGroup label={tr('IT', 'TI')}>
            <Input value={data.it} onChange={e => set('it', e.target.value)} />
          </InputGroup>
          <InputGroup label={tr('Internal Record', 'Registro interno')}>
            <Input value={data.registroInterno} onChange={e => set('registroInterno', e.target.value)} />
          </InputGroup>
          <InputGroup label={tr('Link', 'Vinculo')}>
            <Input value={data.vinculoProjeto} onChange={e => set('vinculoProjeto', e.target.value)} />
          </InputGroup>
          <InputGroup label={tr('Cod. iLean', 'Cod. iLean')}>
            <Input value={data.codigoILean} onChange={e => set('codigoILean', e.target.value)} />
          </InputGroup>
          <InputGroup label={tr('Owner / Employee Name', 'Responsável / Nome do colaborador')}>
            <Input value={data.employeeName} onChange={e => set('employeeName', e.target.value)} />
          </InputGroup>
          <InputGroup label={tr('RE Number', 'Número RE')}>
            <Input value={data.reNo} onChange={e => set('reNo', e.target.value)} />
          </InputGroup>
          <InputGroup label={tr('Champion', 'Champion')}>
            <Input value={data.champion} onChange={e => set('champion', e.target.value)} />
          </InputGroup>
          <InputGroup label={tr('Validator', 'Validador')}>
            <Input value={data.validador} onChange={e => set('validador', e.target.value)} />
          </InputGroup>

          <InputGroup label={tr('Participants', 'Participantes')} fullWidth>
            <div className="space-y-3">
              {ensureMembersArray().length === 0 && <p className="text-xs text-muted-foreground">{tr('No extra participants added yet.', 'Nenhum participante extra adicionado ainda.')}</p>}
              {ensureMembersArray().map((m, idx) => (
                <div key={idx} className="grid grid-cols-1 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_auto] gap-3 items-center">
                  <Input value={m.name} onChange={e => updateMember(idx, 'name', e.target.value)} placeholder={`${tr('Participant', 'Participante')} ${idx + 1} - ${tr('Name', 'Nome')}`} />
                  <Input value={m.role} onChange={e => updateMember(idx, 'role', e.target.value)} placeholder={tr('Role', 'Papel')} />
                  <button type="button" onClick={() => removeMember(idx)} className={`${ui.button.base} ${ui.button.danger} text-xs`}>
                    {tr('Remove', 'Remover')}
                  </button>
                </div>
              ))}
              <button type="button" onClick={addMember} className={`${ui.button.base} ${ui.button.subtle} text-xs`}>
                + {tr('Add participant', 'Adicionar participante')}
              </button>
            </div>
          </InputGroup>
        </Section>

        <Section title={tr('Attachments', 'Anexos')} icon={Paperclip} isOpen={sectionsOpen.attachments} onToggle={() => toggleSection('attachments')}>
          <InputGroup label={tr('Add files', 'Adicionar arquivos')} fullWidth>
            <div className="flex flex-col gap-2">
              <input
                type="file"
                multiple
                onChange={handleFileChange}
                className="block w-full text-sm text-muted-foreground file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border file:border-border file:text-sm file:font-semibold file:bg-background file:text-foreground hover:file:bg-muted"
              />
              <p className="text-xs text-muted-foreground">{tr('Files are listed in the project. To persist on the server, adjust the upload API endpoint as needed.', 'Os arquivos são listados no projeto. Para persistir no servidor, ajuste o endpoint de upload da API.')}</p>
            </div>
          </InputGroup>

          {Array.isArray(data.attachments) && data.attachments.length > 0 && (
            <InputGroup label={tr('Attached files', 'Arquivos anexados')} fullWidth>
              <ul className="space-y-2">
                {data.attachments.map((att, idx) => (
                  <li key={idx} className="flex items-center justify-between bg-background border border-border/70 rounded-lg px-3 py-2 text-xs">
                    <div className="flex items-center gap-2 min-w-0">
                      <Paperclip className="w-4 h-4 text-muted-foreground" />
                      <div className="min-w-0">
                        <div className="font-medium text-foreground truncate">
                          {att.url ? (
                            <a href={att.url} className="hover:underline text-primary" onClick={e => handleDownloadAttachment(e, att)}>
                              {att.name}
                            </a>
                          ) : (
                            <span>{att.name}</span>
                          )}
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          {att.type || tr('unknown type', 'tipo desconhecido')} - {(att.size / 1024).toFixed(1)} KB
                        </div>
                      </div>
                    </div>
                    <button type="button" onClick={() => handleRemoveAttachment(idx)} className={`${ui.button.base} ${ui.button.danger} text-[10px] uppercase`}>
                      {tr('Remove', 'Remover')}
                    </button>
                  </li>
                ))}
              </ul>
            </InputGroup>
          )}
        </Section>
      </div>

      <div className="sticky bottom-0 z-20 surface-glass border-t border-border/70 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          {canDelete && data?.id && (
            <button type="button" onClick={handleDeleteRequest} className={`${ui.button.base} ${ui.button.danger} px-4 py-2.5`}>
              <Trash2 className="w-4 h-4" /> {tr('Delete Project', 'Excluir projeto')}
            </button>
          )}
        </div>
        <div className="flex justify-end gap-3">
          <button type="button" onClick={() => onSubmit(null)} className={`${ui.button.base} ${ui.button.subtle} px-6 py-2.5`}>
            <X className="w-4 h-4" /> {tr('Cancel', 'Cancelar')}
          </button>
          <button type="submit" className={`${ui.button.base} ${ui.button.primary} px-6 py-2.5`}>
            <Save className="w-4 h-4" /> {tr('Save', 'Salvar')}
          </button>
        </div>
      </div>
    </form>
  );
}
