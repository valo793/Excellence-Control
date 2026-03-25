const DAY_MS = 24 * 60 * 60 * 1000;

export function parseYmd(value) {
  if (!value) return null;
  const dt = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

export function toYmd(value) {
  if (!value) return '';
  if (typeof value === 'string') return String(value).slice(0, 10);

  const dt = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(dt.getTime())) return '';

  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function clampTaskWindow(startValue, endValue) {
  const start = parseYmd(startValue);
  const end = parseYmd(endValue);
  if (!(start && end)) return null;

  if (end < start) {
    return { start: toYmd(start), end: toYmd(start) };
  }

  return { start: toYmd(start), end: toYmd(end) };
}

function safeClassName(status) {
  return String(status || 'TODO')
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, '_');
}

export function sanitizeGanttTasks(inputTasks = []) {
  if (!Array.isArray(inputTasks)) return [];

  const cleaned = [];
  for (const rawTask of inputTasks) {
    if (!rawTask || typeof rawTask !== 'object') continue;

    const id = rawTask.id ?? rawTask.ID;
    const name = String(rawTask.name || rawTask.title || '').trim();
    const status = String(rawTask.status || 'TODO').toUpperCase();
    const plannedEnd = toYmd(rawTask.plannedEnd || rawTask.dueDate || rawTask.end);
    const window = clampTaskWindow(rawTask.start, rawTask.end);

    if (!id || !name || !window) continue;

    const progressRaw = Number(rawTask.progress);
    const progress = Number.isFinite(progressRaw)
      ? Math.max(0, Math.min(100, progressRaw))
      : 0;

    cleaned.push({
      ...rawTask,
      id: String(id),
      name,
      status,
      start: window.start,
      end: window.end,
      plannedEnd,
      timelinePoint: toYmd(rawTask.timelinePoint || window.end),
      progress,
      custom_class: rawTask.custom_class || `bar-status-${safeClassName(status)}`,
    });
  }

  return cleaned;
}

export function getTaskWindow(tasks = []) {
  if (!Array.isArray(tasks) || tasks.length === 0) return null;

  const starts = [];
  const ends = [];
  for (const task of tasks) {
    const start = parseYmd(task?.start);
    const end = parseYmd(task?.end);
    if (start) starts.push(start.getTime());
    if (end) ends.push(end.getTime());
  }

  if (!starts.length || !ends.length) return null;

  const minStart = new Date(Math.min(...starts));
  const maxEnd = new Date(Math.max(...ends));
  const paddedEnd = new Date(maxEnd.getTime() + (7 * DAY_MS));

  return {
    start: new Date(minStart.getFullYear(), minStart.getMonth(), 1),
    end: new Date(paddedEnd.getFullYear(), paddedEnd.getMonth(), 1),
  };
}

export function pickViewMode(tasks = []) {
  const window = getTaskWindow(tasks);
  if (!window) return 'Month';

  const spanDays = Math.max(1, Math.ceil((window.end.getTime() - window.start.getTime()) / DAY_MS));
  if (spanDays > (365 * 6)) return 'Year';
  return 'Month';
}
