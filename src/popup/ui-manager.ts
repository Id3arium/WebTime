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
import { formatTime, getLocalDateStr, formatDateWithDayOfWeek, escapeHtml } from '../shared/utils.js';
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

function updateCooldownRecommendation(sessionLimitMinutes: number, el: HTMLElement | null): void {
  if (!el) return;
  if (sessionLimitMinutes > 0) {
    const rec = Math.max(1, Math.round(sessionLimitMinutes / 3));
    el.textContent = ` (rec: ${rec}m)`;
  } else {
    el.textContent = '';
  }
}

export function showGeneralView(): void {
  AppState.setView(ViewState.GENERAL);
  const container = document.querySelector('.pages-container');
  if (container) {
    container.className = 'pages-container show-general';
  }

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

  if (AppState.selectedDomain) {
    const settingsDomainInline = document.getElementById('settings-domain-inline');
    if (settingsDomainInline) {
      settingsDomainInline.textContent = AppState.selectedDomain;
    }
  }

  loadSettings();
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

    const domainSettings = settings.domains?.[AppState.selectedDomain || ''] || {};

    // Session limit settings — keep stored value even when disabled so the
    // user's numbers are preserved across toggles. Fall back to the HTML
    // default value (30 / 10) only when nothing has ever been stored.
    const sessionLimitEnabledEl = document.getElementById('session-limit-enabled') as HTMLInputElement | null;
    const sessionLimitEl = document.getElementById('session-limit-minutes') as HTMLInputElement | null;
    const cooldownIncrementEl = document.getElementById('cooldown-increment-minutes') as HTMLInputElement | null;
    const cooldownIncrementSecondsEl = document.getElementById('cooldown-increment-seconds') as HTMLInputElement | null;
    const cooldownRecommendedEl = document.getElementById('cooldown-recommended');

    const sessionLimitEnabled = domainSettings.sessionLimitEnabled || false;
    const storedSessionLimit = domainSettings.sessionLimit;
    const storedCooldownIncrement = domainSettings.cooldownIncrement;

    if (sessionLimitEnabledEl) sessionLimitEnabledEl.checked = sessionLimitEnabled;
    if (sessionLimitEl && storedSessionLimit !== undefined && storedSessionLimit > 0) {
      sessionLimitEl.value = String(storedSessionLimit);
    }
    // cooldownIncrement is stored as (possibly fractional) minutes. Decompose
    // into whole minutes + seconds for the two-input UI.
    if (storedCooldownIncrement !== undefined && storedCooldownIncrement > 0) {
      const totalSec = Math.round(storedCooldownIncrement * 60);
      if (cooldownIncrementEl) cooldownIncrementEl.value = String(Math.floor(totalSec / 60));
      if (cooldownIncrementSecondsEl) cooldownIncrementSecondsEl.value = String(totalSec % 60);
    }

    const nudgeCountEl = document.getElementById('nudge-count') as HTMLInputElement | null;
    const nudgeCountAutoEl = document.getElementById('nudge-count-auto');
    if (nudgeCountEl) {
      const storedNudgeCount = domainSettings.nudgeCount;
      if (storedNudgeCount !== undefined) {
        nudgeCountEl.value = String(storedNudgeCount);
      } else {
        const limitMin = parseInt(sessionLimitEl?.value || '0') || 0;
        if (limitMin > 0) {
          const PHI = (1 + Math.sqrt(5)) / 2;
          nudgeCountEl.value = String(Math.round(PHI * Math.sqrt(limitMin / 15)));
        }
      }
    }

    function updateNudgeRecHint(): void {
      if (!nudgeCountAutoEl) return;
      const limitMin = parseInt(sessionLimitEl?.value || '0') || 0;
      if (limitMin > 0) {
        const PHI = (1 + Math.sqrt(5)) / 2;
        const rec = Math.round(PHI * Math.sqrt(limitMin / 15));
        nudgeCountAutoEl.textContent = ` (rec: ${rec})`;
      } else {
        nudgeCountAutoEl.textContent = '';
      }
    }
    updateNudgeRecHint();

    // Show recommended cooldown increment = 1/3 of session limit
    const currentSessionLimitForRec = parseInt(sessionLimitEl?.value || '0') || 0;
    updateCooldownRecommendation(currentSessionLimitForRec, cooldownRecommendedEl);

    // Live-update recommendations as session limit changes
    if (sessionLimitEl) {
      sessionLimitEl.addEventListener('input', () => {
        const val = parseInt(sessionLimitEl.value) || 0;
        updateCooldownRecommendation(val, cooldownRecommendedEl);
        updateNudgeRecHint();
      });
    }

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

    if (!settings.domains) settings.domains = {};

    const sessionLimitEnabledEl = document.getElementById('session-limit-enabled') as HTMLInputElement | null;
    const sessionLimitEl = document.getElementById('session-limit-minutes') as HTMLInputElement | null;
    const cooldownIncrementEl = document.getElementById('cooldown-increment-minutes') as HTMLInputElement | null;
    const cooldownIncrementSecondsEl = document.getElementById('cooldown-increment-seconds') as HTMLInputElement | null;
    const sessionLimitEnabled = sessionLimitEnabledEl?.checked || false;
    // Always persist whatever value is in the inputs, independent of the enabled
    // checkbox, so toggling off then on preserves the user's numbers.
    const sessionLimit = parseInt(sessionLimitEl?.value || '') || 0;
    // Compose minutes + seconds inputs into fractional minutes for storage.
    const cdMin = parseInt(cooldownIncrementEl?.value || '') || 0;
    const cdSec = parseInt(cooldownIncrementSecondsEl?.value || '') || 0;
    const cooldownIncrement = cdMin + cdSec / 60;
    const nudgeCountEl = document.getElementById('nudge-count') as HTMLInputElement | null;
    const nudgeCountRaw = nudgeCountEl?.value;
    const nudgeCount = nudgeCountRaw !== undefined && nudgeCountRaw !== '' ? parseInt(nudgeCountRaw) : undefined;

    const hasAnySettings = sessionLimitEnabled || sessionLimit > 0 || cooldownIncrement > 0;

    if (hasAnySettings && AppState.selectedDomain) {
      settings.domains[AppState.selectedDomain] = {
        sessionLimitEnabled,
        sessionLimit: sessionLimit > 0 ? sessionLimit : undefined,
        cooldownIncrement: cooldownIncrement > 0 ? cooldownIncrement : undefined,
        nudgeCount: nudgeCount !== undefined && !isNaN(nudgeCount) ? nudgeCount : undefined
      };
    } else if (AppState.selectedDomain) {
      if (settings.domains[AppState.selectedDomain]) {
        delete settings.domains[AppState.selectedDomain];
      }
    }

    await browser.storage.local.set({ webTimeSettings: settings });
    browser.runtime.sendMessage({ type: 'SETTINGS_UPDATED' });

    const saveBtn = document.getElementById('save-settings-btn');
    if (saveBtn) {
      const originalText = saveBtn.textContent;
      saveBtn.textContent = 'Saved!';
      (saveBtn as HTMLElement).style.background = '#4ade80';

      setTimeout(() => {
        saveBtn.textContent = originalText;
        (saveBtn as HTMLElement).style.background = '';
      }, 1500);
    }

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

  const leftPanel = document.querySelector('#detail-page .left-panel');
  if (leftPanel) {
    leftPanel.innerHTML = '<canvas id="time-chart"></canvas>';
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

export function updateDetailHeader(domain: string): void {
  if (!AppState.allTimeHistory) return;

  const currentDate = getLocalDateStr(AppState.dayResetTime);
  const todaysTime = calculateTodaysTotals(
    AppState.allTimeHistory, currentDate, domain
  );

  const headerText = document.querySelector('#detail-page .header-text');
  const summary = document.querySelector('#detail-page .time-summary');

  if (headerText) headerText.textContent = domain;
  if (summary) summary.textContent = `${formatTime(todaysTime.domain)} / ${formatTime(todaysTime.total)}`;
}

export function displayMessage(selector: string, message: string, type: string = ''): void {
  const element = document.querySelector(selector);
  if (!element) return;

  const cssClass = type ? `message ${type}` : 'message';
  element.innerHTML = `<p class="${cssClass}">${escapeHtml(message)}</p>`;
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
    breakdownBars.innerHTML = '<div style="color: #888; font-style: italic;">No data for this day</div>';
    return;
  }

  const domainData = calculateDomainBreakdown(rawDayData);
  renderBreakdownBars(breakdownBars as HTMLElement, domainData);

  updateGeneralViewHeader(dateString);
}

export function updateGeneralViewHeader(dateString: string): void {
  const headerSummary = document.querySelector('#general-page .time-summary');
  if (!headerSummary) return;

  const today = getLocalDateStr(AppState.dayResetTime);

  const formattedDate = formatDateWithDayOfWeek(dateString);
  if (dateString === today) {
    headerSummary.textContent = "Today - " + formattedDate;
  } else {
    headerSummary.textContent = formattedDate;
  }
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
    container.innerHTML = '<div style="color: #888; font-style: italic;">No data for this day</div>';
    return;
  }

  const maxSeconds = domainData[0].seconds;

  container.innerHTML = domainData.map(item => {
    const widthPercent = Math.max((item.seconds / maxSeconds) * 100, 2);
    const formattedTimeStr = formatTime(item.seconds);
    const escapedDomain = escapeHtml(item.domain);

    return `
      <div class="breakdown-bar" data-domain="${escapedDomain}">
        <div class="breakdown-color" style="background: ${item.color};"></div>
        <div class="breakdown-label" title="${escapedDomain}">${escapedDomain}</div>
        <div class="breakdown-fill">
          <div class="breakdown-fill-inner" style="background: ${item.color}; width: ${widthPercent}%;"></div>
        </div>
        <div class="breakdown-time">${formattedTimeStr} (${item.percentage}%)</div>
      </div>
    `;
  }).join('');

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
