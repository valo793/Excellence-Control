import { useEffect, useMemo, useRef } from 'react';
import GanttLib from 'frappe-gantt';
import { getStatusLabel } from '../utils/constants';
import { parseYmd, pickViewMode, sanitizeGanttTasks } from '../utils/gantt';

const SVG_NS = 'http://www.w3.org/2000/svg';

function formatYmd(value) {
  if (!value) return '-';
  return String(value).slice(0, 10);
}

function computeXForDate(gantt, value) {
  const date = parseYmd(value);
  if (!date || !gantt?.gantt_start || !gantt?.options) return null;

  const diffHours = (date.getTime() - gantt.gantt_start.getTime()) / 36e5;
  let x = (diffHours / gantt.options.step) * gantt.options.column_width;

  if (gantt.view_is('Month')) {
    const diffDays = diffHours / 24;
    x = (diffDays * gantt.options.column_width) / 30;
  } else if (gantt.view_is('Year')) {
    const diffDays = diffHours / 24;
    x = (diffDays * gantt.options.column_width) / 365;
  }

  return Number.isFinite(x) ? x : null;
}

function tuneHeader(svg) {
  const headerTexts = svg.querySelectorAll('.grid-header .upper-text, .grid-header .lower-text');
  headerTexts.forEach(text => {
    text.setAttribute('font-size', '12');
    text.setAttribute('font-weight', '600');
  });

  const allHeaderTexts = svg.querySelectorAll('.grid-header text');
  if (!allHeaderTexts.length) return;

  let maxY = -Infinity;
  allHeaderTexts.forEach(text => {
    const y = parseFloat(text.getAttribute('y') || '0');
    if (!Number.isNaN(y) && y > maxY) maxY = y;
  });

  allHeaderTexts.forEach(text => {
    const y = parseFloat(text.getAttribute('y') || '0');
    if (Math.abs(y - maxY) < 0.5) text.remove();
  });
}

function drawPlannedContinuation(svg, gantt, tasks, language) {
  const tr = (enText, ptBrText) => (language === 'pt-BR' ? ptBrText : enText);

  svg.querySelector('.planned-extension-layer')?.remove();

  const layer = document.createElementNS(SVG_NS, 'g');
  layer.setAttribute('class', 'planned-extension-layer');

  const gridWidth = parseFloat(svg.querySelector('.grid-background')?.getAttribute('width') || '0');
  const maxX = Number.isFinite(gridWidth) && gridWidth > 0 ? gridWidth : null;

  for (const task of tasks) {
    if (task?.status !== 'IN_PROGRESS' || !task?.plannedEnd) continue;

    const bar = gantt.get_bar(task.id)?.$bar;
    if (!bar) continue;

    const barX = Number(bar.getAttribute('x') || 0);
    const barWidth = Number(bar.getAttribute('width') || 0);
    const barY = Number(bar.getAttribute('y') || 0);
    const barHeight = Number(bar.getAttribute('height') || 20);
    const barEndX = barX + barWidth;

    let plannedX = computeXForDate(gantt, task.plannedEnd);
    if (plannedX === null) continue;
    if (maxX !== null) plannedX = Math.min(Math.max(plannedX, 0), maxX);

    const startX = Math.min(barEndX, plannedX);
    const endX = Math.max(barEndX, plannedX);
    const width = endX - startX;
    if (width < 1) continue;

    const overdue = plannedX < barEndX;
    const rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('x', String(startX));
    rect.setAttribute('y', String(barY + 4));
    rect.setAttribute('width', String(width));
    rect.setAttribute('height', String(Math.max(barHeight - 8, 6)));
    rect.setAttribute('rx', '3');
    rect.setAttribute('ry', '3');
    rect.setAttribute('class', overdue ? 'planned-extension-overdue' : 'planned-extension-remaining');

    const title = document.createElementNS(SVG_NS, 'title');
    title.textContent = overdue
      ? `${tr('In Progress', 'Em progresso')} - ${tr('overdue to', 'atrasado ate')} ${formatYmd(task.plannedEnd)} (${tr('current point', 'ponto atual')}: ${formatYmd(task.timelinePoint || task.end)})`
      : `${tr('In Progress', 'Em progresso')} - ${tr('planned until', 'planejado ate')} ${formatYmd(task.plannedEnd)} (${tr('current point', 'ponto atual')}: ${formatYmd(task.timelinePoint || task.end)})`;
    rect.appendChild(title);
    layer.appendChild(rect);

    const marker = document.createElementNS(SVG_NS, 'line');
    marker.setAttribute('x1', String(plannedX));
    marker.setAttribute('x2', String(plannedX));
    marker.setAttribute('y1', String(barY + 2));
    marker.setAttribute('y2', String(barY + barHeight - 2));
    marker.setAttribute('class', overdue ? 'planned-extension-marker-overdue' : 'planned-extension-marker-remaining');
    layer.appendChild(marker);
  }

  if (layer.childNodes.length > 0) {
    svg.appendChild(layer);
  }
}

export default function Gantt({ language = 'en', tasks = [], onClick, onDateChange }) {
  const ref = useRef(null);
  const safeTasks = useMemo(() => sanitizeGanttTasks(tasks), [tasks]);

  useEffect(() => {
    if (!ref.current) return undefined;

    const tr = (enText, ptBrText) => (language === 'pt-BR' ? ptBrText : enText);
    ref.current.innerHTML = '';

    if (!safeTasks.length) {
      ref.current.innerHTML = `<div class="p-4 text-sm text-muted-foreground">${tr(
        'No valid timeline items for the selected filters.',
        'Sem itens validos de timeline para os filtros selecionados.',
      )}</div>`;
      return undefined;
    }

    const ganttLocale = language === 'pt-BR' ? 'ptBr' : 'en';
    const viewMode = pickViewMode(safeTasks);
    let gantt;

    try {
      gantt = new GanttLib(ref.current, safeTasks, {
        on_click: onClick,
        on_date_change: onDateChange,
        bar_height: 20,
        bar_corner_radius: 3,
        padding: 18,
        view_mode: viewMode,
        language: ganttLocale,
        custom_popup_html: task => {
          const statusLabel = task.status ? getStatusLabel(task.status, language) : 'N/A';
          return `
            <div class="p-2 text-sm">
              <p class="font-semibold">${task.name || '-'}</p>
              <p>${tr('Start', 'Inicio')}: ${formatYmd(task.start)}</p>
              <p>${tr('Current end', 'Fim atual')}: ${formatYmd(task.timelinePoint || task.end)}</p>
              <p>${tr('Estimated end', 'Fim estimado')}: ${formatYmd(task.plannedEnd || task.end)}</p>
              <p>${tr('Status', 'Status')}: ${statusLabel}</p>
            </div>
          `;
        },
      });
    } catch (error) {
      console.error('Failed to render gantt chart:', error);
      ref.current.innerHTML = `<div class="p-4 text-sm text-muted-foreground">${tr(
        'Timeline could not be rendered.',
        'Nao foi possivel renderizar a timeline.',
      )}</div>`;
      return undefined;
    }

    const rafId = requestAnimationFrame(() => {
      const svg = ref.current?.querySelector('svg.gantt');
      if (!svg) return;
      svg.classList.remove('gantt-enter');
      // force reflow for intro animation reset
      void svg.getBoundingClientRect();
      svg.classList.add('gantt-enter');
      tuneHeader(svg);
      drawPlannedContinuation(svg, gantt, safeTasks, language);
    });

    return () => {
      cancelAnimationFrame(rafId);
    };
  }, [language, safeTasks, onClick, onDateChange]);

  return <div ref={ref} className="relative" />;
}
