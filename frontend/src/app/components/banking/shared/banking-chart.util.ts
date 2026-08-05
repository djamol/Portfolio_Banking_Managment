import { ChartOptions } from 'chart.js';

export const BANK_CHART_COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#06b6d4', '#ec4899', '#22c55e', '#a855f7', '#64748b'
];

export const doughnutOptions: ChartOptions<'doughnut'> = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { position: 'right' },
    tooltip: {
      callbacks: {
        label: (ctx) => {
          const value = Number(ctx.parsed) || 0;
          return `${ctx.label}: ₹${value.toLocaleString('en-IN')}`;
        }
      }
    }
  }
};

export const barOptions: ChartOptions<'bar'> = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { position: 'top' } },
  scales: {
    y: {
      ticks: { callback: (v) => '₹' + Number(v).toLocaleString('en-IN') }
    }
  }
};

export const lineOptions: ChartOptions<'line'> = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { display: false } },
  scales: {
    y: {
      ticks: { callback: (v) => '₹' + Number(v).toLocaleString('en-IN') }
    }
  }
};

export const netLineOptions: ChartOptions<'line'> = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { display: true, position: 'top' } },
  scales: {
    y: {
      ticks: { callback: (v) => '₹' + Number(v).toLocaleString('en-IN') }
    }
  }
};

export const countLineOptions: ChartOptions<'line'> = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { display: true, position: 'top' } },
  scales: {
    y: {
      beginAtZero: true,
      ticks: { precision: 0, callback: (v) => Number(v).toLocaleString('en-IN') }
    }
  }
};

export const horizontalBarOptions: ChartOptions<'bar'> = {
  responsive: true,
  maintainAspectRatio: false,
  indexAxis: 'y',
  plugins: { legend: { display: false } },
  scales: {
    x: {
      ticks: { callback: (v) => '₹' + Number(v).toLocaleString('en-IN') }
    }
  }
};
