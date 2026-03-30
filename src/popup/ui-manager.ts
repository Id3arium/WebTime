import { CONFIG, COLORS, ViewState } from './config.js';
import { formatTime, getLocalDateStr, formatDateWithDayOfWeek } from './popup-utils.js';
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
import { Constants } from '../shared/constants.js';
import { escapeHtml } from '../shared/utils.js';
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

export function updateNudgeIntervalVisibility(): void {
  const reminderEnabledEl = document.getElementById('reminder-enabled') as HTMLInputElement | null;
  const nudgeIntervalOption = document.getElementById('nudge-interval-option');

  if (!reminderEnabledEl || !nudgeIntervalOption) return;

  nudgeIntervalOption.style.display = reminderEnabledEl.checked ? 'block' : 'none';
}

export async function loadSettings(): Promise<void> {
  try {
    const data = await browser.storage.local.get('webTimeSettings');
    const settings = data.webTimeSettings || { global: {}, domains: {} };

    const global = settings.global || {};
    const dayResetTimeEl = document.getElementById('day-reset-time') as HTMLInputElement | null;
    const customMessageEl = document.getElementById('custom-message') as HTMLInputElement | null;

    if (dayResetTimeEl) dayResetTimeEl.value = String(global.dayResetTime || 0);
    if (customMessageEl) customMessageEl.value = global.customMessage || '';

    const inactivityEl = document.getElementById('inactivity-timeout') as HTMLInputElement | null;
    const popupDurationEl = document.getElementById('popup-duration') as HTMLInputElement | null;
    const chartScalingEl = document.getElementById('chart-scaling') as HTMLInputElement | null;
    if (inactivityEl) inactivityEl.value = String(global.inactivityTimeoutS ?? 30);
    if (popupDurationEl) popupDurationEl.value = String(global.popupDurationS ?? 10);
    if (chartScalingEl) chartScalingEl.value = String(global.scalingPower ?? 0.8);

    const domainSettings = settings.domains?.[AppState.selectedDomain || ''] || {};

    const reminderEnabled = domainSettings.reminderEnabled || false;
    const reminderThreshold = domainSettings.reminderThreshold || 180;
    const reminderInterval = domainSettings.reminderInterval || 15;
    const nudgeIntervalMinutes = domainSettings.nudgeIntervalMinutes ?? Constants.DEFAULT_NUDGE_INTERVAL_MINUTES;

    const reminderEnabledEl = document.getElementById('reminder-enabled') as HTMLInputElement | null;
    const reminderHoursEl = document.getElementById('reminder-hours') as HTMLInputElement | null;
    const reminderMinutesEl = document.getElementById('reminder-minutes') as HTMLInputElement | null;
    const reminderIntervalEl = document.getElementById('reminder-interval') as HTMLInputElement | null;
    const nudgeIntervalEl = document.getElementById('nudge-interval-minutes') as HTMLInputElement | null;

    if (reminderEnabledEl) reminderEnabledEl.checked = reminderEnabled;
    if (reminderHoursEl) reminderHoursEl.value = String(Math.floor(reminderThreshold / 60));
    if (reminderMinutesEl) reminderMinutesEl.value = String(reminderThreshold % 60);
    if (reminderIntervalEl) reminderIntervalEl.value = String(reminderInterval);
    if (nudgeIntervalEl) nudgeIntervalEl.value = String(nudgeIntervalMinutes);

    updateNudgeIntervalVisibility();

    if (reminderMinutesEl && reminderHoursEl) {
      reminderMinutesEl.addEventListener('input', () => {
        let mins = parseInt(reminderMinutesEl.value) || 0;
        let hrs = parseInt(reminderHoursEl.value) || 0;

        if (mins >= 60) {
          reminderHoursEl.value = String(hrs + Math.floor(mins / 60));
          reminderMinutesEl.value = String(mins % 60);
        } else if (mins < 0 && hrs > 0) {
          reminderHoursEl.value = String(hrs - 1);
          reminderMinutesEl.value = String(60 + mins);
        }
      });
    }

    const reminderEnabledElForListener = document.getElementById('reminder-enabled');
    if (reminderEnabledElForListener) {
      reminderEnabledElForListener.addEventListener('change', () => updateNudgeIntervalVisibility());
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
    const customMessageEl = document.getElementById('custom-message') as HTMLInputElement | null;
    const inactivityTimeoutEl = document.getElementById('inactivity-timeout') as HTMLInputElement | null;
    const popupDurationEl = document.getElementById('popup-duration') as HTMLInputElement | null;
    const chartScalingEl = document.getElementById('chart-scaling') as HTMLInputElement | null;

    const scalingPower = parseFloat(chartScalingEl?.value || '0.8') || 0.8;

    settings.global = {
      dayResetTime: parseInt(dayResetTimeEl?.value || '0'),
      customMessage: customMessageEl?.value || '',
      inactivityTimeoutS: parseInt(inactivityTimeoutEl?.value || '30') || 30,
      popupDurationS: parseInt(popupDurationEl?.value || '10') || 10,
      scalingPower: Math.max(0.3, Math.min(1.0, scalingPower))
    };

    if (!settings.domains) settings.domains = {};

    const reminderEnabledEl = document.getElementById('reminder-enabled') as HTMLInputElement | null;
    const reminderHoursEl = document.getElementById('reminder-hours') as HTMLInputElement | null;
    const reminderMinutesEl = document.getElementById('reminder-minutes') as HTMLInputElement | null;
    const reminderIntervalEl = document.getElementById('reminder-interval') as HTMLInputElement | null;
    const nudgeIntervalEl = document.getElementById('nudge-interval-minutes') as HTMLInputElement | null;

    const reminderEnabled = reminderEnabledEl?.checked || false;
    const reminderHours = parseInt(reminderHoursEl?.value || '0') || 0;
    const reminderMinutes = parseInt(reminderMinutesEl?.value || '0') || 0;
    const reminderThreshold = (reminderHours * 60) + reminderMinutes;
    const reminderInterval = parseInt(reminderIntervalEl?.value || '15') || 15;
    const nudgeIntervalMinutes = parseInt(nudgeIntervalEl?.value || String(Constants.DEFAULT_NUDGE_INTERVAL_MINUTES)) || Constants.DEFAULT_NUDGE_INTERVAL_MINUTES;

    if (reminderEnabled && AppState.selectedDomain) {
      settings.domains[AppState.selectedDomain] = {
        reminderEnabled: true,
        reminderThreshold,
        reminderInterval,
        nudgeIntervalMinutes
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

  const currentDate = getLocalDateStr();
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

  const today = getLocalDateStr();

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
  updateNudgeIntervalVisibility,
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
