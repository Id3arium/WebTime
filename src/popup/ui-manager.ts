import { CONFIG, COLORS, ViewState } from './config.js';
import { AppState } from './state.js';
import {
  processGeneralViewData,
  processDetailViewData,
  calculateTodaysTotals,
  type GeneralViewData,
  type DetailViewData
} from './data-processor.js';
import {
  buildGeneralViewChart,
  buildDetailViewChart,
  buildPieChart,
  highlightBar,
  type DomainPieData
} from './chart-builder.js';
import { formatDuration, formatDurationHM, getLocalDateStr, formatDateWithDayOfWeek } from '../shared/utils.js';
import { renderSessionCard, renderSessionSettingsCard } from './session-card.js';
import type { ChartInstance } from '../types.js';

declare const browser: typeof chrome;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const Chart: new (ctx: CanvasRenderingContext2D, config: any) => ChartInstance;

interface ExtendedChart {
  totalTimeData?: GeneralViewData;
  _deadZoneHitbox?: HTMLDivElement;
  data?: { labels?: string[]; datasets?: unknown[] };
  options?: { scales?: { x?: Record<string, unknown> } };
  update(mode?: string): void;
  destroy(): void;
  chartArea?: { left: number; right: number; bottom: number };
}

/** Wire a click-to-capture keyboard shortcut input. */
function setupShortcutCapture(input: HTMLInputElement): void {
  if (input.dataset.captureSetup === 'true') return;
  input.dataset.captureSetup = 'true';

  let capturing = false;

  const stopCapture = (): void => {
    capturing = false;
    input.style.background = '';
    input.blur();
  };

  input.addEventListener('focus', () => {
    capturing = true;
    input.style.background = '#3a3a5a';
    input.value = 'Press a key combo…';
  });

  input.addEventListener('blur', () => {
    if (capturing) {
      // Aborted without pressing anything — restore previous
      capturing = false;
      input.style.background = '';
      // Leave the placeholder; if user blurred without pressing, fall back
      if (input.value === 'Press a key combo…') {
        input.value = 'Ctrl+E';
      }
    }
  });

  input.addEventListener('keydown', (e) => {
    if (!capturing) return;
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    const parts: string[] = [];
    if (e.ctrlKey) parts.push('Ctrl');
    if (e.metaKey) parts.push('Cmd');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');
    // Use e.code for letter/digit keys so Alt+E doesn't become Alt+´ on Mac
    let k: string;
    if (/^Key[A-Z]$/.test(e.code)) {
      k = e.code.slice(3); // "KeyE" -> "E"
    } else if (/^Digit\d$/.test(e.code)) {
      k = e.code.slice(5); // "Digit1" -> "1"
    } else {
      k = e.key.length === 1 ? e.key.toUpperCase() : e.key;
    }
    parts.push(k);
    input.value = parts.join('+');
    delete input.dataset.disabled;
    stopCapture();
  });
}

/** Open the right-half settings overlay (slides in from the right edge). */
export function openSettings(): void {
  const overlay = document.getElementById('settings-overlay');
  if (overlay) overlay.classList.add('open');
  document.getElementById('settings-toggle-btn')?.classList.add('is-open');
  document.getElementById('settings-toggle-btn')?.setAttribute('aria-expanded', 'true');
  // Reflect the detail-view domain into the per-site limits header.
  const settingsDomainInline = document.getElementById('settings-domain-inline');
  if (settingsDomainInline) {
    settingsDomainInline.textContent = AppState.selectedDomain || '—';
  }
  loadSettings();
}

/** Close the settings overlay. */
export function closeSettings(): void {
  const overlay = document.getElementById('settings-overlay');
  if (overlay) overlay.classList.remove('open');
  document.getElementById('settings-toggle-btn')?.classList.remove('is-open');
  document.getElementById('settings-toggle-btn')?.setAttribute('aria-expanded', 'false');
}

/** Toggle the settings overlay — the topbar menu button both opens and closes
 *  it (hamburger morphs to ✕), so there's no separate close control to reach. */
export function toggleSettings(): void {
  const overlay = document.getElementById('settings-overlay');
  if (overlay?.classList.contains('open')) closeSettings();
  else openSettings();
}

/** Update the merged topbar's nav label, site context, and hero numbers
 *  for the current view. The nav button toggles to the *other* view. */
function updateTopbar(): void {
  const isDetail = AppState.currentView === ViewState.DETAIL;

  const navBtn = document.getElementById('nav-toggle-btn');
  if (navBtn) navBtn.textContent = isDetail ? '◂  All sites' : 'This site  ▸';

  // Left context: site identity (detail) vs. "All sites" (general).
  const siteId = document.getElementById('topbar-site');
  const allId = document.getElementById('topbar-all');
  if (siteId) siteId.hidden = !isDetail;
  if (allId) allId.hidden = isDetail;

  if (isDetail && AppState.selectedDomain) {
    const nameEl = document.getElementById('topbar-site-name');
    if (nameEl) nameEl.textContent = AppState.selectedDomain;
  }
}

/** A "NN% below/above your avg" delta phrase, colored by direction. Green when
 *  at/under the average (a win), grey — not red — when over (forgiving). Returns
 *  null when there's no average yet (first day of data). */
function deltaPhrase(delta: number | null): HTMLElement | null {
  if (delta === null) return null;
  const below = delta <= 0;
  const el = document.createElement('span');
  el.className = `usage-delta ${below ? 'good' : 'dim'}`;
  // Arrow carries direction (↓ under = good, ↑ over), so the words drop out.
  el.textContent = `${below ? '↓' : '↑'} ${Math.abs(delta)}% from avg`;
  return el;
}

/** A stat column: big value over a quiet caption, both left-aligned in the
 *  column so the caption sits directly under its number. */
function usageStat(value: string, caption: string): HTMLElement {
  const stat = document.createElement('div');
  stat.className = 'usage-stat';
  const val = document.createElement('span');
  val.className = 'usage-val';
  val.textContent = value;
  const cap = document.createElement('span');
  cap.className = 'usage-cap';
  cap.textContent = caption;
  stat.append(val, cap);
  return stat;
}

/** A headline row holding one or more stat columns. */
function usageHeadline(...stats: HTMLElement[]): HTMLElement {
  const row = document.createElement('div');
  row.className = 'usage-headline';
  row.append(...stats);
  return row;
}

/** A slash separator between two stat columns, aligned to the value row. */
function usageSlash(): HTMLElement {
  const s = document.createElement('span');
  s.className = 'usage-slash';
  s.textContent = '/';
  return s;
}

/** Detail page Usage card: this-site / all-sites side by side (value over its
 *  own caption), then how this site compares to THIS domain's 7-day average. */
function updateDetailUsageCard(): void {
  const host = document.getElementById('detail-usage-card');
  if (!host || !AppState.allTimeHistory) return;

  const today = getLocalDateStr(AppState.dayResetTime);
  const domain = AppState.selectedDomain || '';
  const totals = calculateTodaysTotals(AppState.allTimeHistory, today, domain);

  const head = usageHeadline(
    usageStat(formatDurationHM(totals.domain), 'this site'),
    usageSlash(),
    usageStat(formatDurationHM(totals.total), 'all sites')
  );

  const out: HTMLElement[] = [eyebrow('Usage'), head];
  const delta = deltaPhrase(domainDayVsAverage(domain, today)?.delta ?? null);
  if (delta) {
    const sub = document.createElement('div');
    sub.className = 'usage-deltaline';
    const ctx = document.createElement('span');
    ctx.className = 'usage-deltactx';
    ctx.textContent = ' on this site';
    sub.append(delta, ctx);
    out.push(sub);
  }
  host.replaceChildren(...out);
}

/** General page Usage-breakdown headline: all-sites total for the selected day +
 *  how it compares to the all-sites 7-day average. Sits atop the breakdown bars. */
function updateGeneralUsageHead(selectedDate?: string): void {
  const host = document.getElementById('usage-breakdown-head');
  if (!host || !AppState.allTimeHistory) return;

  const today = getLocalDateStr(AppState.dayResetTime);
  const day = selectedDate || today;
  const stats = dayVsAverage(day);
  const totals = calculateTodaysTotals(AppState.allTimeHistory, day, '');

  const head = usageHeadline(usageStat(formatDurationHM(totals.total), 'all sites'));
  const delta = deltaPhrase(stats?.delta ?? null);
  if (delta) { head.append(document.createTextNode(' · ')); head.append(delta); }

  host.replaceChildren(eyebrow('Usage breakdown'), head);
}

/** A small uppercase section eyebrow (the shared .usage-eyebrow title style). */
function eyebrow(text: string): HTMLElement {
  const e = document.createElement('div');
  e.className = 'usage-eyebrow';
  e.textContent = text;
  return e;
}

/** The 7-day average (seconds) for a day and that day's % vs the average.
 *  `delta` is null when there's no average yet (e.g. the first day of data). */
function dayVsAverage(dateString: string): { avgSec: number | null; delta: number | null } | null {
  if (!AppState.allTimeHistory) return null;
  const data = processGeneralViewData(AppState.allTimeHistory);
  const idx = data.dailyData.findIndex(d => d.date === dateString);
  if (idx < 0) return null;
  const avg = data.movingAverageData[idx]?.averageSeconds || 0;
  if (avg <= 0) return { avgSec: null, delta: null };
  const daySec = data.dailyData[idx].totalSeconds;
  return { avgSec: avg, delta: Math.round(((daySec - avg) / avg) * 100) };
}

/** As dayVsAverage, but for a single domain: today's time on `domain` vs that
 *  domain's own 7-day moving average. */
function domainDayVsAverage(domain: string, dateString: string): { avgSec: number | null; delta: number | null } | null {
  if (!AppState.allTimeHistory || !domain) return null;
  const data = processDetailViewData(AppState.allTimeHistory, domain);
  const idx = data.dailyData.findIndex(d => d.date === dateString);
  if (idx < 0) return null;
  const avg = data.movingAverageData[idx]?.averageSeconds || 0;
  if (avg <= 0) return { avgSec: null, delta: null };
  const daySec = data.dailyData[idx].domainSeconds;
  return { avgSec: avg, delta: Math.round(((daySec - avg) / avg) * 100) };
}

export function showGeneralView(): void {
  AppState.setView(ViewState.GENERAL);
  const container = document.querySelector('.pages-container');
  if (container) {
    container.className = 'pages-container show-general';
  }

  updateTopbar();
  updateGeneralUsageHead();

  if (!AppState.generalChartCreated) {
    renderGeneralView();
    AppState.markGeneralChartCreated();
  }
}

export function showDetailView(): void {
  AppState.setView(ViewState.DETAIL);
  const container = document.querySelector('.pages-container');
  if (container) {
    container.className = 'pages-container show-detail';
  }

  updateTopbar();
  updateDetailUsageCard();
}

export async function loadSettings(): Promise<void> {
  try {
    const data = await browser.storage.local.get('webTimeSettings');
    const settings = data.webTimeSettings || { global: {}, domains: {} };

    const global = settings.global || {};
    const dayResetTimeEl = document.getElementById('day-reset-time') as HTMLInputElement | null;

    if (dayResetTimeEl) dayResetTimeEl.value = String(global.dayResetTime || 0);

    const inactivityEl = document.getElementById('inactivity-timeout') as HTMLInputElement | null;
    const chartScalingEl = document.getElementById('chart-scaling') as HTMLInputElement | null;
    if (inactivityEl) inactivityEl.value = String(global.inactivityTimeoutS ?? 30);
    if (chartScalingEl) chartScalingEl.value = String(global.scalingPower ?? 0.8);

    // End-session shortcut: undefined = default Ctrl+E, null = disabled, string = custom
    const endSessionShortcutEl = document.getElementById('end-session-shortcut') as HTMLInputElement | null;
    if (endSessionShortcutEl) {
      const sc = global.endSessionShortcut;
      endSessionShortcutEl.value = sc === null ? '(disabled)' : (sc || 'Ctrl+E');
      setupShortcutCapture(endSessionShortcutEl);
    }
    const endSessionShortcutClearEl = document.getElementById('end-session-shortcut-clear');
    if (endSessionShortcutClearEl && endSessionShortcutEl) {
      endSessionShortcutClearEl.addEventListener('click', () => {
        endSessionShortcutEl.value = '(disabled)';
        endSessionShortcutEl.dataset.disabled = 'true';
      });
    }
    // Per-site session limits moved to the in-panel "Session rules" card
    // (session-card.ts). The settings overlay is now global-only.

  } catch (error) {
    console.error('Error loading settings:', error);
  }
}

export async function saveSettings(): Promise<void> {
  try {
    const data = await browser.storage.local.get('webTimeSettings');
    const settings = data.webTimeSettings || { global: {}, domains: {} };

    const dayResetTimeEl = document.getElementById('day-reset-time') as HTMLInputElement | null;
    const inactivityTimeoutEl = document.getElementById('inactivity-timeout') as HTMLInputElement | null;
    const chartScalingEl = document.getElementById('chart-scaling') as HTMLInputElement | null;

    const scalingPower = parseFloat(chartScalingEl?.value || '0.8') || 0.8;

    const endSessionShortcutEl = document.getElementById('end-session-shortcut') as HTMLInputElement | null;
    let endSessionShortcut: string | null | undefined;
    if (endSessionShortcutEl?.dataset.disabled === 'true') {
      endSessionShortcut = null;
    } else if (endSessionShortcutEl?.value && endSessionShortcutEl.value !== '(disabled)') {
      endSessionShortcut = endSessionShortcutEl.value;
    } else {
      endSessionShortcut = undefined; // use default
    }

    settings.global = {
      dayResetTime: parseInt(dayResetTimeEl?.value || '0'),
      inactivityTimeoutS: parseInt(inactivityTimeoutEl?.value || '30') || 30,
      scalingPower: Math.max(0.3, Math.min(1.0, scalingPower)),
      endSessionShortcut
    };
    // Per-site limits are persisted by the in-panel "Session rules" card
    // (session-card.ts) on each change, so saveSettings only writes globals
    // and preserves whatever domains map already exists.
    if (!settings.domains) settings.domains = {};

    await browser.storage.local.set({ webTimeSettings: settings });
    browser.runtime.sendMessage({ type: 'SETTINGS_UPDATED' });
    // No success flash — the panel closing (see the save handler) is the
    // confirmation that the save went through.
  } catch (error) {
    console.error('Error saving settings:', error);
  }
}

export function renderGeneralView(): void {
  try {
    if (!AppState.allTimeHistory) return;

    const totalTimeData = processGeneralViewData(AppState.allTimeHistory);

    if (totalTimeData.dailyData.length === 0) {
      displayMessage('#general-page .page-content', 'No time data available.');
      return;
    }

    const chartConfig = buildGeneralViewChart(totalTimeData);
    const canvasElement = document.getElementById('total-time-chart') as HTMLCanvasElement | null;

    if (!canvasElement) {
      console.error('Canvas element not found!');
      return;
    }

    const ctx = canvasElement.getContext('2d');
    if (!ctx) return;

    const chart = new Chart(ctx, chartConfig) as ExtendedChart;
    chart.totalTimeData = totalTimeData;

    AppState.setChartInstance(chart);

    const todayIndex = totalTimeData.dailyData.length - 1;
    AppState.lockDay(todayIndex);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    highlightBar(chart as any, todayIndex);
    updateDailyBreakdown(totalTimeData, todayIndex);
    updatePieChart(totalTimeData, todayIndex);

    setupScrollHandling(canvasElement, totalTimeData);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    createDeadZoneHitbox(canvasElement, chart as any);

    canvasElement.addEventListener('mouseleave', () => {
      // When locked, do nothing on mouse leave
    });

  } catch (error) {
    console.error('Error creating general view chart:', error);
    displayMessage('#general-page .page-content',
      `Error creating chart: ${(error as Error).message}`, 'error');
  }
}

export function renderDetailView(domain: string | null): void {
  if (!domain) {
    displayMessage('#detail-page .left-panel',
      "Cannot detect current domain. Make sure you're on a web page.", 'error');
    return;
  }

  updateDetailHeader(domain);

  // Render the per-site limits card + the live session card in the detail
  // right panel (fire-and-forget; both read their own state from storage).
  renderSessionSettingsCard(domain, AppState.dayResetTime).catch(err =>
    console.error('Error rendering session settings card:', err));
  renderSessionCard(domain, AppState.dayResetTime).catch(err =>
    console.error('Error rendering session card:', err));

  const leftPanel = document.querySelector('#detail-page .left-panel');
  if (leftPanel) {
    const canvas = document.createElement('canvas');
    canvas.id = 'time-chart';
    leftPanel.replaceChildren(canvas);
  }

  if (!AppState.allTimeHistory) return;

  const processedData = processDetailViewData(AppState.allTimeHistory, domain);
  const chartConfig = buildDetailViewChart(processedData);

  const canvasElement = document.getElementById('time-chart') as HTMLCanvasElement | null;
  if (!canvasElement) return;

  const ctx = canvasElement.getContext('2d');
  if (!ctx) return;

  const chart = new Chart(ctx, chartConfig);

  if (processedData.dailyData.length > CONFIG.daysToDisplay) {
    setupDetailViewScrolling(canvasElement, chart, processedData);
  }
}

export function updateDetailHeader(_domain: string): void {
  if (!AppState.allTimeHistory) return;
  // The detail view's site name + today's numbers now live in the merged
  // topbar; refresh those instead of the old per-page .header-text/.time-summary.
  if (AppState.currentView === ViewState.DETAIL) {
    updateTopbar();
    updateDetailUsageCard();
    // Detail view always reflects today; show the same "<date> · Today" label.
    setTopbarDate(getLocalDateStr(AppState.dayResetTime));
  }
}

/** The shared "No data for this day" empty-state element. */
function noDataMessage(): HTMLElement {
  const div = document.createElement('div');
  div.style.cssText = 'color: #888; font-style: italic;';
  div.textContent = 'No data for this day';
  return div;
}

export function displayMessage(selector: string, message: string, type: string = ''): void {
  const element = document.querySelector(selector);
  if (!element) return;

  const cssClass = type ? `message ${type}` : 'message';
  const p = document.createElement('p');
  p.className = cssClass;
  p.textContent = message; // text node — can't inject markup
  element.replaceChildren(p);
}

export function updatePieChart(totalTimeData: GeneralViewData, dataIndex: number): void {
  const dayData = totalTimeData.dailyData[dataIndex];
  const pieCanvas = document.getElementById('breakdown-pie-chart') as HTMLCanvasElement | null;

  if (!pieCanvas || !AppState.allTimeHistory) return;

  const dateString = dayData.date;
  const rawDayData = AppState.allTimeHistory[dateString];

  if (!rawDayData) {
    if (AppState.pieChartInstance) {
      AppState.pieChartInstance.destroy();
      AppState.pieChartInstance = null;
    }
    return;
  }

  const domainData = calculateDomainBreakdown(rawDayData);

  if (AppState.pieChartInstance) {
    const pieConfig = buildPieChart(domainData);
    AppState.pieChartInstance.data = pieConfig.data!;
    AppState.pieChartInstance.options = pieConfig.options!;
    AppState.pieChartInstance.update('none');
  } else {
    const ctx = pieCanvas.getContext('2d');
    if (!ctx) return;

    const pieConfig = buildPieChart(domainData);
    AppState.pieChartInstance = new Chart(ctx, pieConfig);
  }
}

export function updateDailyBreakdown(totalTimeData: GeneralViewData, dataIndex: number): void {
  const dayData = totalTimeData.dailyData[dataIndex];
  const breakdownTitle = document.querySelector('.breakdown-title');
  const breakdownBars = document.querySelector('.breakdown-bars');

  if (!breakdownTitle || !breakdownBars || !AppState.allTimeHistory) return;

  (breakdownTitle as HTMLElement).style.display = 'none';

  const dateString = dayData.date;
  const rawDayData = AppState.allTimeHistory[dateString];

  if (!rawDayData) {
    breakdownBars.replaceChildren(noDataMessage());
    return;
  }

  const domainData = calculateDomainBreakdown(rawDayData);
  renderBreakdownBars(breakdownBars as HTMLElement, domainData);

  updateGeneralViewHeader(dateString);
  updateGeneralUsageHead(dateString);   // delta + total track the selected day
}

export function updateGeneralViewHeader(dateString: string): void {
  setTopbarDate(dateString);
}

/** Shared topbar date label for both views: "<date> · Today" when it's today,
 *  otherwise just the date. (Date first, "Today" suffix — same in both views.) */
function setTopbarDate(dateString: string): void {
  const dateLabel = document.getElementById('topbar-date-label');
  if (!dateLabel) return;
  const today = getLocalDateStr(AppState.dayResetTime);
  const formattedDate = formatDateWithDayOfWeek(dateString);
  dateLabel.textContent = dateString === today ? `${formattedDate} · Today` : formattedDate;
}

export function calculateDomainBreakdown(rawDayData: Record<string, number>): DomainPieData[] {
  const domainData: DomainPieData[] = [];
  let totalSeconds = 0;

  Object.keys(rawDayData).forEach(domain => {
    totalSeconds += rawDayData[domain] || 0;
  });

  Object.keys(rawDayData).forEach(domain => {
    const seconds = rawDayData[domain] || 0;

    if (seconds > 0) {
      domainData.push({
        domain,
        seconds,
        percentage: Math.round((seconds / totalSeconds) * 100),
        color: ''
      });
    }
  });

  const sorted = domainData.sort((a, b) => b.seconds - a.seconds);

  sorted.forEach((item, index) => {
    if (index < CONFIG.topDomainsLimit) {
      item.color = COLORS.domains[index % COLORS.domains.length];
    } else {
      item.color = COLORS.others;
    }
  });

  return sorted;
}

export function renderBreakdownBars(container: HTMLElement, domainData: DomainPieData[]): void {
  if (domainData.length === 0) {
    container.replaceChildren(noDataMessage());
    return;
  }

  const maxSeconds = domainData[0].seconds;

  // Built with the DOM API (not innerHTML): domain names are untrusted, and
  // textContent makes markup injection impossible without manual escaping.
  const rows = domainData.map(item => {
    const widthPercent = Math.max((item.seconds / maxSeconds) * 100, 2);

    const bar = document.createElement('div');
    bar.className = 'breakdown-bar';
    bar.dataset.domain = item.domain;

    const color = document.createElement('div');
    color.className = 'breakdown-color';
    color.style.background = item.color;
    // Monogram: the domain's first alphanumeric char (per the design's tiles).
    const initial = (item.domain.match(/[a-z0-9]/i)?.[0] || '?').toUpperCase();
    color.textContent = item.domain === 'Others' ? '⋯' : initial;

    const label = document.createElement('div');
    label.className = 'breakdown-label';
    label.title = item.domain;
    label.textContent = item.domain;

    const fill = document.createElement('div');
    fill.className = 'breakdown-fill';
    const fillInner = document.createElement('div');
    fillInner.className = 'breakdown-fill-inner';
    fillInner.style.background = item.color;
    fillInner.style.width = `${widthPercent}%`;
    fill.appendChild(fillInner);

    const time = document.createElement('div');
    time.className = 'breakdown-time';
    time.textContent = `${formatDuration(item.seconds)} (${item.percentage}%)`;

    bar.append(color, label, fill, time);
    return bar;
  });
  container.replaceChildren(...rows);

  container.onclick = (e: MouseEvent) => {
    const bar = (e.target as HTMLElement).closest('.breakdown-bar') as HTMLElement | null;
    if (bar) {
      const domain = bar.dataset.domain;
      if (domain) {
        AppState.setSelectedDomain(domain);
        renderDetailView(domain);
        showDetailView();
      }
    }
  };
}

export function setupScrollHandling(canvasElement: HTMLCanvasElement, totalTimeData: GeneralViewData): void {
  const totalDays = totalTimeData.dailyData.length;
  const windowSize = CONFIG.daysToDisplay;

  if (totalDays <= windowSize) {
    return;
  }

  canvasElement.addEventListener('wheel', (event: WheelEvent) => {
    event.preventDefault();

    const scrollDelta = Math.sign(event.deltaY) * -3;
    const newPosition = AppState.updateScrollPosition(scrollDelta);
    updateChartViewport(totalDays, windowSize, newPosition);
  });

  canvasElement.addEventListener('keydown', (event: KeyboardEvent) => {
    let scrollDelta = 0;

    switch (event.key) {
      case 'ArrowLeft':
        scrollDelta = 5;
        break;
      case 'ArrowRight':
        scrollDelta = -5;
        break;
      default:
        return;
    }

    event.preventDefault();
    const newPosition = AppState.updateScrollPosition(scrollDelta);
    updateChartViewport(totalDays, windowSize, newPosition);
  });

  canvasElement.tabIndex = 0;
}

export function updateChartViewport(totalDays: number, windowSize: number, scrollPosition: number): void {
  const chart = AppState.chartInstance as ExtendedChart | null;
  if (!chart) return;

  const maxIndex = totalDays - 1 - scrollPosition;
  const minIndex = Math.max(0, maxIndex - windowSize + 1);

  if (chart.options?.scales?.x) {
    (chart.options.scales.x as Record<string, unknown>).min = minIndex;
    (chart.options.scales.x as Record<string, unknown>).max = maxIndex;
  }

  chart.update('none');

  if (AppState.isLocked() && AppState.lockedDayIndex !== null &&
      AppState.lockedDayIndex >= minIndex && AppState.lockedDayIndex <= maxIndex) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    highlightBar(chart as any, AppState.lockedDayIndex);
  }

  const visibleIndex = AppState.isLocked() && AppState.lockedDayIndex !== null
    ? AppState.lockedDayIndex
    : maxIndex;

  if (chart.totalTimeData) {
    updateDailyBreakdown(chart.totalTimeData, visibleIndex);
    updatePieChart(chart.totalTimeData, visibleIndex);
  }
}

export function createDeadZoneHitbox(canvasElement: HTMLCanvasElement, chart: ExtendedChart): void {
  const hitbox = document.createElement('div');
  hitbox.style.position = 'absolute';
  hitbox.style.pointerEvents = 'auto';
  hitbox.style.backgroundColor = 'transparent';
  hitbox.style.zIndex = '10';

  const updateHitboxPosition = (): void => {
    const chartArea = (chart as unknown as { chartArea: { left: number; right: number; bottom: number } }).chartArea;
    const rect = canvasElement.getBoundingClientRect();

    hitbox.style.left = `${chartArea.left}px`;
    hitbox.style.top = `${chartArea.bottom}px`;
    hitbox.style.width = `${chartArea.right - chartArea.left}px`;
    hitbox.style.height = `${rect.height - chartArea.bottom}px`;
  };

  hitbox.addEventListener('mouseenter', () => {
    // When locked, do nothing
  });

  updateHitboxPosition();

  const container = canvasElement.parentElement;
  if (container) {
    container.style.position = 'relative';
    container.appendChild(hitbox);
  }

  chart._deadZoneHitbox = hitbox;
}

export function setupDetailViewScrolling(
  canvasElement: HTMLCanvasElement,
  chart: ExtendedChart,
  processedData: DetailViewData
): void {
  const totalDays = processedData.dailyData.length;
  const windowSize = CONFIG.daysToDisplay;

  let detailScrollPosition = 0;

  canvasElement.addEventListener('wheel', (event: WheelEvent) => {
    event.preventDefault();

    const scrollDelta = Math.sign(event.deltaY) * -3;
    const maxScroll = Math.max(0, totalDays - windowSize);
    detailScrollPosition = Math.max(0, Math.min(maxScroll, detailScrollPosition + scrollDelta));

    const maxIndex = totalDays - 1 - detailScrollPosition;
    const minIndex = Math.max(0, maxIndex - windowSize + 1);

    if (chart.options?.scales?.x) {
      (chart.options.scales.x as Record<string, unknown>).min = minIndex;
      (chart.options.scales.x as Record<string, unknown>).max = maxIndex;
    }
    chart.update('none');
  });

  canvasElement.addEventListener('keydown', (event: KeyboardEvent) => {
    let scrollDelta = 0;

    switch (event.key) {
      case 'ArrowLeft':
        scrollDelta = 5;
        break;
      case 'ArrowRight':
        scrollDelta = -5;
        break;
      default:
        return;
    }

    event.preventDefault();
    const maxScroll = Math.max(0, totalDays - windowSize);
    detailScrollPosition = Math.max(0, Math.min(maxScroll, detailScrollPosition + scrollDelta));

    const maxIndex = totalDays - 1 - detailScrollPosition;
    const minIndex = Math.max(0, maxIndex - windowSize + 1);

    if (chart.options?.scales?.x) {
      (chart.options.scales.x as Record<string, unknown>).min = minIndex;
      (chart.options.scales.x as Record<string, unknown>).max = maxIndex;
    }
    chart.update('none');
  });

  canvasElement.tabIndex = 0;
}

export const UIManager = {
  showGeneralView,
  showDetailView,
  openSettings,
  closeSettings,
  toggleSettings,
  loadSettings,
  saveSettings,
  renderGeneralView,
  renderDetailView,
  updateDetailHeader,
  displayMessage,
  updatePieChart,
  updateDailyBreakdown,
  updateGeneralViewHeader,
  calculateDomainBreakdown,
  renderBreakdownBars,
  setupScrollHandling,
  updateChartViewport,
  createDeadZoneHitbox,
  setupDetailViewScrolling
};

export default UIManager;
