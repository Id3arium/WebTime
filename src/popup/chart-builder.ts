import { CONFIG, COLORS } from './config.js';
import { formatDateForDisplay, formatDateWithDayOfWeek, formatTime } from './popup-utils.js';
import { AppState } from './state.js';
import type { GeneralViewData, DetailViewData, MovingAverageData } from './data-processor.js';

// Use any for Chart.js types since we're loading it via script tag
/* eslint-disable @typescript-eslint/no-explicit-any */
type ChartConfiguration = any;
type ChartDatasetType = any;
/* eslint-enable @typescript-eslint/no-explicit-any */

// Forward declaration for UIManager to avoid circular dependency
declare const UIManager: {
  updateDailyBreakdown(totalTimeData: GeneralViewData, dataIndex: number): void;
  updatePieChart(totalTimeData: GeneralViewData, dataIndex: number): void;
  renderDetailView(domain: string): void;
  showDetailView(): void;
};

export interface DomainPieData {
  domain: string;
  seconds: number;
  percentage: number;
  color: string;
}

interface ExtendedDataset {
  type?: 'bar' | 'line';
  label?: string;
  data: number[];
  formattedTimes?: string[];
  originalData?: number[];
  domainNames?: (string | null)[];
  backgroundColor?: string | string[];
  borderColor?: string | string[];
  borderWidth?: number | number[];
  fill?: boolean;
  tension?: number;
  pointRadius?: number;
  order?: number;
  _originalBackgroundColor?: string | string[];
  _originalBorderColor?: string | string[];
  _originalBorderWidth?: number | number[];
}

interface ExtendedChart {
  totalTimeData?: GeneralViewData;
  _deadZoneHitbox?: HTMLDivElement;
  data: {
    datasets: ExtendedDataset[];
    labels?: string[];
  };
  options?: {
    scales?: {
      x?: Record<string, unknown>;
      y?: Record<string, unknown>;
    };
  };
  update(mode?: string): void;
  chartArea?: {
    left: number;
    right: number;
    bottom: number;
  };
}

export function getGridColor(): string {
  return getComputedStyle(document.documentElement)
    .getPropertyValue('--dark-bg').trim();
}

export function createMovingAverageDataset(
  movingAverageData: MovingAverageData[],
  label: string = 'Average'
): ExtendedDataset {
  return {
    type: 'line',
    label: label,
    data: movingAverageData.map(day => day.averageHours),
    formattedTimes: movingAverageData.map(day => day.formattedTime),
    backgroundColor: COLORS.movingAverage.background,
    borderColor: COLORS.movingAverage.border,
    borderWidth: COLORS.movingAverage.width,
    fill: false,
    tension: 0.2,
    pointRadius: 3,
    order: -1
  };
}

export function createSingleDomainDataset(
  dailyData: { domainHours: number; domainFormattedTime: string }[],
  label: string = 'This Day'
): ExtendedDataset {
  return {
    type: 'bar',
    label: label,
    data: dailyData.map(day => day.domainHours),
    backgroundColor: COLORS.currentDomain.background,
    borderColor: COLORS.currentDomain.border,
    borderWidth: 1,
    formattedTimes: dailyData.map(day => day.domainFormattedTime),
    order: 1
  };
}

export function getBaseChartOptions(_isGeneralView: boolean = false): Record<string, unknown> {
  return {
    animation: { duration: CONFIG.initAnimationDuration },
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      y: {
        grid: { color: getGridColor() },
        beginAtZero: true,
        ticks: {
          color: '#aaa',
          font: {
            size: 11,
            weight: '500'
          }
        },
        title: {
          display: true,
          text: 'Hours',
          color: '#ccc',
          font: {
            size: 12,
            weight: '600'
          }
        }
      },
      x: {
        ticks: {
          color: '#888',
          font: {
            size: 10
          }
        }
      }
    },
    interaction: { intersect: false, mode: 'index' },
    elements: {
      bar: { barPercentage: 0.8, categoryPercentage: 0.9 }
    }
  };
}

export function buildGeneralViewChart(totalTimeData: GeneralViewData): ChartConfiguration {
  const datasets: ExtendedDataset[] = [];

  const totalBarsDataset: ExtendedDataset = {
    type: 'bar',
    label: 'Total Time',
    data: totalTimeData.dailyData.map(day => Math.sqrt(day.totalHours)),
    originalData: totalTimeData.dailyData.map(day => day.totalHours),
    formattedTimes: totalTimeData.dailyData.map(day => day.formattedTime),
    backgroundColor: COLORS.currentDomain.background,
    borderColor: COLORS.currentDomain.border,
    borderWidth: 1,
    order: 1
  };
  datasets.push(totalBarsDataset);

  if (totalTimeData.movingAverageData) {
    const avgDataset = createMovingAverageDataset(
      totalTimeData.movingAverageData,
      `${CONFIG.movingAverageDays}-Day Average`
    );
    avgDataset.data = avgDataset.data.map(val => Math.sqrt(val));
    avgDataset.originalData = totalTimeData.movingAverageData.map(day => day.averageHours);
    datasets.push(avgDataset);
  }

  const totalDays = totalTimeData.dailyData.length;
  const windowSize = CONFIG.daysToDisplay;

  const maxIndex = totalDays - 1;
  const minIndex = Math.max(0, totalDays - windowSize);

  const allTotalHours = totalTimeData.dailyData.map(day => day.totalHours);
  const allSqrtHours = allTotalHours.map(h => Math.sqrt(h));
  const maxSqrt = Math.max(...allSqrtHours);
  const yAxisMax = Math.ceil(maxSqrt * 2) / 2;

  const baseOptions = getBaseChartOptions(true) as Record<string, unknown>;
  const baseScales = baseOptions.scales as Record<string, unknown>;
  const baseY = baseScales.y as Record<string, unknown>;
  const baseTicks = baseY.ticks as Record<string, unknown>;

  const options = {
    ...baseOptions,
    scales: {
      ...baseScales,
      x: {
        min: minIndex,
        max: maxIndex,
        display: true
      },
      y: {
        ...baseY,
        max: yAxisMax,
        ticks: {
          ...baseTicks,
          callback: function(value: number): string {
            const realHours = Math.pow(value, 2);
            return realHours.toFixed(1);
          }
        },
        title: {
          display: true,
          text: 'Hours (√ scale)',
          color: '#ccc',
          font: {
            size: 12,
            weight: '600'
          }
        }
      }
    },
    plugins: {
      legend: { display: false },
      tooltip: getGeneralViewTooltipConfig(totalTimeData)
    },
    onHover: (_event: unknown, elements: { index: number }[], chart: ExtendedChart) => {
      if (elements.length > 0) {
        const dataIndex = elements[0].index;

        if (!AppState.isLocked()) {
          UIManager.updateDailyBreakdown(chart.totalTimeData!, dataIndex);
          UIManager.updatePieChart(chart.totalTimeData!, dataIndex);
          showHoverPreview(chart, dataIndex);
        }
      } else {
        if (!AppState.isLocked()) {
          const todayIndex = chart.totalTimeData!.dailyData.length - 1;
          highlightBar(chart, todayIndex);
          UIManager.updateDailyBreakdown(chart.totalTimeData!, todayIndex);
          UIManager.updatePieChart(chart.totalTimeData!, todayIndex);
        }
      }
    },
    onClick: (_event: unknown, elements: { index: number }[], chart: ExtendedChart) => {
      if (elements.length > 0) {
        const clickedIndex = elements[0].index;

        if (AppState.lockedDayIndex === clickedIndex) {
          AppState.unlockDay();
          removeBarHighlight(chart);
        } else {
          AppState.lockDay(clickedIndex);
          UIManager.updateDailyBreakdown(chart.totalTimeData!, clickedIndex);
          UIManager.updatePieChart(chart.totalTimeData!, clickedIndex);
          highlightBar(chart, clickedIndex);
        }
      } else {
        AppState.unlockDay();
        removeBarHighlight(chart);
      }
    }
  };

  return {
    type: 'bar',
    data: {
      labels: totalTimeData.dailyData.map(day => formatDateForDisplay(day.date)),
      datasets: datasets as ChartDatasetType[]
    },
    options: options
  };
}

export function buildDetailViewChart(processedData: DetailViewData): ChartConfiguration {
  const datasets: ExtendedDataset[] = [];

  const domainDataset = createSingleDomainDataset(processedData.dailyData);
  domainDataset.data = domainDataset.data.map(val => Math.sqrt(val));
  domainDataset.originalData = processedData.dailyData.map(day => day.domainHours);
  datasets.push(domainDataset);

  if (processedData.movingAverageData) {
    const avgDataset = createMovingAverageDataset(
      processedData.movingAverageData,
      `${CONFIG.movingAverageDays}-Day Average`
    );
    avgDataset.data = avgDataset.data.map(val => Math.sqrt(val));
    avgDataset.originalData = processedData.movingAverageData.map(day => day.averageHours);
    datasets.push(avgDataset);
  }

  const totalDays = processedData.dailyData.length;
  const windowSize = CONFIG.daysToDisplay;

  const maxIndex = totalDays - 1;
  const minIndex = Math.max(0, totalDays - windowSize);

  const allDomainHours = processedData.dailyData.map(day => day.domainHours);
  const allSqrtHours = allDomainHours.map(h => Math.sqrt(h));
  const maxSqrt = Math.max(...allSqrtHours);
  const yAxisMax = Math.ceil(maxSqrt * 2) / 2;

  const baseOptions = getBaseChartOptions() as Record<string, unknown>;
  const baseScales = baseOptions.scales as Record<string, unknown>;
  const baseY = baseScales.y as Record<string, unknown>;
  const baseTicks = baseY.ticks as Record<string, unknown>;

  const options = {
    ...baseOptions,
    scales: {
      ...baseScales,
      x: {
        min: minIndex,
        max: maxIndex,
        display: true
      },
      y: {
        ...baseY,
        max: yAxisMax,
        ticks: {
          ...baseTicks,
          callback: function(value: number): string {
            const realHours = Math.pow(value, 2);
            return realHours.toFixed(1);
          }
        },
        title: {
          display: true,
          text: 'Hours (√ scale)',
          color: '#ccc',
          font: {
            size: 12,
            weight: '600'
          }
        }
      }
    },
    plugins: { tooltip: getDetailViewTooltipConfig(processedData) }
  };

  return {
    type: 'bar',
    data: {
      labels: processedData.dailyData.map(day => formatDateForDisplay(day.date)),
      datasets: datasets as ChartDatasetType[]
    },
    options: options
  };
}

export function getGeneralViewTooltipConfig(totalTimeData: GeneralViewData): Record<string, unknown> {
  return {
    animation: { duration: 200 },
    backgroundColor: COLORS.tooltipBackground,
    itemSort: (a: { datasetIndex: number }, b: { datasetIndex: number }) => {
      return a.datasetIndex - b.datasetIndex;
    },
    callbacks: {
      title: (context: { dataIndex: number }[]) => {
        const dateString = totalTimeData.dailyData[context[0].dataIndex].date;
        return formatDateWithDayOfWeek(dateString);
      },
      label: (context: { dataIndex: number; dataset: ExtendedDataset }) => {
        const dataIndex = context.dataIndex;
        const dataset = context.dataset;

        if (dataset.type === 'bar') {
          const dayData = totalTimeData.dailyData[dataIndex];
          return `Total: ${dayData.formattedTime}`;
        }

        if (dataset.label && dataset.label.includes('Average')) {
          const time = dataset.formattedTimes?.[dataIndex];
          return `${dataset.label}: ${time}`;
        }

        return null;
      }
    }
  };
}

export function getDetailViewTooltipConfig(processedData: DetailViewData): Record<string, unknown> {
  return {
    animation: { duration: 200 },
    backgroundColor: COLORS.tooltipBackground,
    itemSort: (a: { datasetIndex: number }, b: { datasetIndex: number }) => {
      return a.datasetIndex - b.datasetIndex;
    },
    callbacks: {
      title: (context: { dataIndex: number }[]) => {
        const dateString = processedData.dailyData[context[0].dataIndex].date;
        return formatDateWithDayOfWeek(dateString);
      },
      label: (context: { dataIndex: number; datasetIndex: number; chart: { data: { datasets: ExtendedDataset[] } } }) => {
        const dataset = context.chart.data.datasets[context.datasetIndex];
        const dataIndex = context.dataIndex;
        const dayData = processedData.dailyData[dataIndex];
        const time = dataset.formattedTimes?.[dataIndex];

        if (dataset.type === 'bar' && processedData._yAxisMax && dayData.domainHours > processedData._yAxisMax) {
          const actualTime = dayData.domainFormattedTime;
          const cappedTime = formatTime(processedData._yAxisMax * 3600);
          return `${dataset.label}: ${actualTime} (capped at ${cappedTime} for scale)`;
        }

        return `${dataset.label}: ${time}`;
      }
    }
  };
}

export function highlightBar(chart: ExtendedChart, barIndex: number): void {
  chart.data.datasets.forEach((dataset: ExtendedDataset) => {
    if (dataset.type === 'bar') {
      if (!dataset._originalBackgroundColor) {
        dataset._originalBackgroundColor = Array.isArray(dataset.backgroundColor)
          ? [...dataset.backgroundColor]
          : dataset.backgroundColor;
        dataset._originalBorderColor = Array.isArray(dataset.borderColor)
          ? [...(dataset.borderColor as string[])]
          : dataset.borderColor;
        dataset._originalBorderWidth = Array.isArray(dataset.borderWidth)
          ? [...(dataset.borderWidth as number[])]
          : dataset.borderWidth;
      }

      const numBars = dataset.data.length;
      if (!Array.isArray(dataset.backgroundColor)) {
        dataset.backgroundColor = Array(numBars).fill(dataset.backgroundColor);
      }
      if (!Array.isArray(dataset.borderColor)) {
        dataset.borderColor = Array(numBars).fill(dataset.borderColor);
      }
      if (!Array.isArray(dataset.borderWidth)) {
        dataset.borderWidth = Array(numBars).fill(dataset.borderWidth);
      }

      const origBg = dataset._originalBackgroundColor;
      const origBorder = dataset._originalBorderColor;
      const origWidth = dataset._originalBorderWidth;

      dataset.backgroundColor = Array.isArray(origBg) ? [...origBg] : Array(numBars).fill(origBg);
      dataset.borderColor = Array.isArray(origBorder) ? [...origBorder] : Array(numBars).fill(origBorder);
      dataset.borderWidth = Array.isArray(origWidth) ? [...origWidth] : Array(numBars).fill(origWidth);

      (dataset.borderColor as string[])[barIndex] = 'white';
      (dataset.borderWidth as number[])[barIndex] = 2;
    }
  });

  chart.update('none');
}

export function removeBarHighlight(chart: ExtendedChart): void {
  chart.data.datasets.forEach((dataset: ExtendedDataset) => {
    if (dataset.type === 'bar' && dataset._originalBackgroundColor) {
      const numBars = dataset.data.length;
      const origBg = dataset._originalBackgroundColor;
      const origBorder = dataset._originalBorderColor;
      const origWidth = dataset._originalBorderWidth;

      dataset.backgroundColor = Array.isArray(origBg) ? [...origBg] : Array(numBars).fill(origBg);
      dataset.borderColor = Array.isArray(origBorder) ? [...origBorder] : Array(numBars).fill(origBorder);
      dataset.borderWidth = Array.isArray(origWidth) ? [...origWidth] : Array(numBars).fill(origWidth);
    }
  });

  chart.update('none');
}

export function showHoverPreview(chart: ExtendedChart, barIndex: number): void {
  chart.data.datasets.forEach((dataset: ExtendedDataset) => {
    if (dataset.type === 'bar') {
      if (!dataset._originalBackgroundColor) {
        dataset._originalBackgroundColor = Array.isArray(dataset.backgroundColor)
          ? [...dataset.backgroundColor]
          : dataset.backgroundColor;
        dataset._originalBorderColor = Array.isArray(dataset.borderColor)
          ? [...(dataset.borderColor as string[])]
          : dataset.borderColor;
        dataset._originalBorderWidth = Array.isArray(dataset.borderWidth)
          ? [...(dataset.borderWidth as number[])]
          : dataset.borderWidth;
      }

      const numBars = dataset.data.length;
      if (!Array.isArray(dataset.backgroundColor)) {
        dataset.backgroundColor = Array(numBars).fill(dataset.backgroundColor);
      }
      if (!Array.isArray(dataset.borderColor)) {
        dataset.borderColor = Array(numBars).fill(dataset.borderColor);
      }
      if (!Array.isArray(dataset.borderWidth)) {
        dataset.borderWidth = Array(numBars).fill(dataset.borderWidth);
      }

      const origBg = dataset._originalBackgroundColor;
      const origBorder = dataset._originalBorderColor;
      const origWidth = dataset._originalBorderWidth;

      dataset.backgroundColor = Array.isArray(origBg) ? [...origBg] : Array(numBars).fill(origBg);
      dataset.borderColor = Array.isArray(origBorder) ? [...origBorder] : Array(numBars).fill(origBorder);
      dataset.borderWidth = Array.isArray(origWidth) ? [...origWidth] : Array(numBars).fill(origWidth);

      if (AppState.isLocked() && AppState.lockedDayIndex !== null) {
        (dataset.borderColor as string[])[AppState.lockedDayIndex] = 'white';
        (dataset.borderWidth as number[])[AppState.lockedDayIndex] = 2;
      }

      if (barIndex !== AppState.lockedDayIndex) {
        (dataset.borderColor as string[])[barIndex] = 'rgba(255, 255, 255, 0.8)';
        (dataset.borderWidth as number[])[barIndex] = 2;
      }
    }
  });

  chart.update('none');
}

export function buildPieChart(domainData: DomainPieData[]): ChartConfiguration {
  const labels = domainData.map(item => item.domain);
  const data = domainData.map(item => item.seconds / 3600);
  const colors = domainData.map(item => item.color);

  return {
    type: 'pie',
    data: {
      labels: labels,
      datasets: [{
        data: data,
        backgroundColor: colors,
        borderColor: colors.map(c => c.replace('0.7', '1')),
        borderWidth: 1
      }]
    },
    options: {
      responsive: false,
      maintainAspectRatio: true,
      animation: false,
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          backgroundColor: COLORS.tooltipBackground,
          callbacks: {
            label: (context: { label: string; dataIndex: number }) => {
              const domain = context.label;
              const seconds = domainData[context.dataIndex].seconds;
              const percentage = domainData[context.dataIndex].percentage;
              const formattedTimeStr = formatTime(seconds);
              return `${domain}: ${formattedTimeStr} (${percentage}%)`;
            }
          }
        }
      },
      onClick: (_event: unknown, elements: { index: number }[], chart: ExtendedChart) => {
        if (elements.length > 0) {
          const index = elements[0].index;
          const domain = chart.data.labels?.[index] as string;
          AppState.setSelectedDomain(domain);
          UIManager.renderDetailView(domain);
          UIManager.showDetailView();
        }
      }
    }
  };
}

export const ChartBuilder = {
  getGridColor,
  createMovingAverageDataset,
  createSingleDomainDataset,
  getBaseChartOptions,
  buildGeneralViewChart,
  buildDetailViewChart,
  getGeneralViewTooltipConfig,
  getDetailViewTooltipConfig,
  highlightBar,
  removeBarHighlight,
  showHoverPreview,
  buildPieChart
};

export default ChartBuilder;
