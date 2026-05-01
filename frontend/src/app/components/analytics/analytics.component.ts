import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { AnalyticsService, DeltaRow, InsightsResponse } from '../../services/analytics.service';
import { ChartConfiguration, ChartOptions, ChartType } from 'chart.js';
import { BaseChartDirective } from 'ng2-charts';

@Component({
  selector: 'app-analytics',
  templateUrl: './analytics.component.html',
  styleUrls: ['./analytics.component.css'],
  standalone: false
})
export class AnalyticsComponent implements OnInit {
  totalAmount = 0;
  totalInvestments = 0;
  loading = false;
  errorMessage = '';
  advanceErrorMessage = '';

  // Chart options
  barChartOptions: ChartOptions<'bar'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: true,
        position: 'top'
      },
      tooltip: {
        callbacks: {
          label: function(context) {
            const value = context.parsed.y;
                        return '₹' + (value !== null ? value : 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          }
        }
      }
    },
    scales: {
      y: {
        beginAtZero: true,
        ticks: {
          callback: function(value) {
            return '₹' + Number(value).toLocaleString('en-IN');
          }
        }
      }
    }
  };

  lineChartOptions: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: true,
        position: 'top'
      },
      tooltip: {
        callbacks: {
          label: function(context) {
            const value = context.parsed.y;
                        return '₹' + (value !== null ? value : 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          }
        }
      }
    },
    scales: {
      y: {
        beginAtZero: true,
        ticks: {
          callback: function(value) {
            return '₹' + Number(value).toLocaleString('en-IN');
          }
        }
      }
    }
  };

  pieChartOptions: ChartOptions<'pie'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: true,
        position: 'right'
      },
      tooltip: {
        callbacks: {
          label: function(context) {
            const label = context.label || '';
            const value = context.parsed || 0;
            const total = context.dataset.data.reduce((a: number, b: number) => a + b, 0);
            const percentage = ((value / total) * 100).toFixed(1);
            return label + ': ₹' + value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' (' + percentage + '%)';
          }
        }
      }
    }
  };

  doughnutChartOptions: ChartOptions<'doughnut'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: true,
        position: 'right'
      },
      tooltip: {
        callbacks: {
          label: function(context) {
            const label = context.label || '';
            const value = context.parsed || 0;
            const total = context.dataset.data.reduce((a: number, b: number) => a + b, 0);
            const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : '0.0';
            return label + ': ₹' + value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' (' + percentage + '%)';
          }
        }
      }
    }
  };

  // Original chart data
  byTypeChartData: ChartConfiguration<'bar'>['data'] = {
    labels: [],
    datasets: [{
      label: 'Amount (₹)',
      data: [],
      backgroundColor: [
        'rgba(102, 126, 234, 0.6)',
        'rgba(118, 75, 162, 0.6)',
        'rgba(239, 68, 68, 0.6)',
        'rgba(16, 185, 129, 0.6)',
        'rgba(245, 158, 11, 0.6)',
        'rgba(59, 130, 246, 0.6)',
        'rgba(139, 92, 246, 0.6)',
        'rgba(236, 72, 153, 0.6)'
      ],
      borderColor: [
        'rgba(102, 126, 234, 1)',
        'rgba(118, 75, 162, 1)',
        'rgba(239, 68, 68, 1)',
        'rgba(16, 185, 129, 1)',
        'rgba(245, 158, 11, 1)',
        'rgba(59, 130, 246, 1)',
        'rgba(139, 92, 246, 1)',
        'rgba(236, 72, 153, 1)'
      ],
      borderWidth: 2
    }]
  };

  byMonthChartData: ChartConfiguration<'line'>['data'] = {
    labels: [],
    datasets: [{
      label: 'Amount (₹)',
      data: [],
      borderColor: 'rgba(102, 126, 234, 1)',
      backgroundColor: 'rgba(102, 126, 234, 0.1)',
      tension: 0.4,
      fill: true,
      pointRadius: 4,
      pointHoverRadius: 6
    }]
  };

  byYearChartData: ChartConfiguration<'bar'>['data'] = {
    labels: [],
    datasets: [{
      label: 'Amount (₹)',
      data: [],
      backgroundColor: [
        'rgba(118, 75, 162, 0.6)',
        'rgba(102, 126, 234, 0.6)',
        'rgba(239, 68, 68, 0.6)',
        'rgba(16, 185, 129, 0.6)',
        'rgba(245, 158, 11, 0.6)'
      ],
      borderColor: [
        'rgba(118, 75, 162, 1)',
        'rgba(102, 126, 234, 1)',
        'rgba(239, 68, 68, 1)',
        'rgba(16, 185, 129, 1)',
        'rgba(245, 158, 11, 1)'
      ],
      borderWidth: 2
    }]
  };

  byPlatformChartData: ChartConfiguration<'pie'>['data'] = {
    labels: [],
    datasets: [{
      data: [],
      backgroundColor: [
        'rgba(102, 126, 234, 0.8)',
        'rgba(118, 75, 162, 0.8)',
        'rgba(239, 68, 68, 0.8)',
        'rgba(16, 185, 129, 0.8)',
        'rgba(245, 158, 11, 0.8)',
        'rgba(59, 130, 246, 0.8)',
        'rgba(139, 92, 246, 0.8)',
        'rgba(236, 72, 153, 0.8)',
        'rgba(14, 165, 233, 0.8)',
        'rgba(34, 197, 94, 0.8)'
      ]
    }]
  };

  monthlyChangesChartData: ChartConfiguration<'line'>['data'] = {
    labels: [],
    datasets: [
      {
        label: 'Added',
        data: [],
        borderColor: 'rgba(16, 185, 129, 1)',
        backgroundColor: 'rgba(16, 185, 129, 0.1)',
        tension: 0.4,
        fill: true,
        pointRadius: 4,
        pointHoverRadius: 6
      },
      {
        label: 'Removed',
        data: [],
        borderColor: 'rgba(239, 68, 68, 1)',
        backgroundColor: 'rgba(239, 68, 68, 0.1)',
        tension: 0.4,
        fill: true,
        pointRadius: 4,
        pointHoverRadius: 6
      },
      {
        label: 'Updated',
        data: [],
        borderColor: 'rgba(59, 130, 246, 1)',
        backgroundColor: 'rgba(59, 130, 246, 0.1)',
        tension: 0.4,
        fill: true,
        pointRadius: 4,
        pointHoverRadius: 6
      }
    ]
  };

  // New properties for dynamic charts
  selectedTimeChartOption: 'month' | 'year' = 'month';
  timeChartData: ChartConfiguration<'line'>['data'] = {
    labels: [],
    datasets: [{
      label: 'Amount (₹)',
      data: [],
      borderColor: 'rgba(102, 126, 234, 1)',
      backgroundColor: 'rgba(102, 126, 234, 0.1)',
      tension: 0.4,
      fill: true,
      pointRadius: 4,
      pointHoverRadius: 6
    }]
  };

  selectedPieChartOption: 'platform' | 'type' | 'subcategory' | 'category' = 'platform';
  pieChartData: ChartConfiguration<'pie'>['data'] = {
    labels: [],
    datasets: [{
      data: [],
      backgroundColor: [
        'rgba(102, 126, 234, 0.8)',
        'rgba(118, 75, 162, 0.8)',
        'rgba(239, 68, 68, 0.8)',
        'rgba(16, 185, 129, 0.8)',
        'rgba(245, 158, 11, 0.8)',
        'rgba(59, 130, 246, 0.8)',
        'rgba(139, 92, 246, 0.8)',
        'rgba(236, 72, 153, 0.8)',
        'rgba(14, 165, 233, 0.8)',
        'rgba(34, 197, 94, 0.8)'
      ]
    }]
  };

  // Advance analytics charts + state
  valueSeriesChartData: ChartConfiguration<'line'>['data'] = {
    labels: [],
    datasets: [{
      label: 'Total Value (₹)',
      data: [],
      borderColor: 'rgba(34, 197, 94, 1)',
      backgroundColor: 'rgba(34, 197, 94, 0.12)',
      tension: 0.35,
      fill: true,
      pointRadius: 2,
      pointHoverRadius: 5
    }]
  };

  allocationLatestChartData: ChartConfiguration<'doughnut'>['data'] = {
    labels: [],
    datasets: [{
      data: [],
      backgroundColor: [
        'rgba(102, 126, 234, 0.85)',
        'rgba(16, 185, 129, 0.85)',
        'rgba(245, 158, 11, 0.85)',
        'rgba(239, 68, 68, 0.85)',
        'rgba(118, 75, 162, 0.85)',
        'rgba(59, 130, 246, 0.85)',
        'rgba(236, 72, 153, 0.85)',
        'rgba(14, 165, 233, 0.85)'
      ]
    }]
  };

  deltaFrom = '';
  deltaTo = '';
  deltaLoading = false;
  deltaRows: DeltaRow[] = [];
  topGainers: DeltaRow[] = [];
  topLosers: DeltaRow[] = [];

  // Filters (UX)
  filterPlatform = '';
  filterType = '';
  filterFrom = '';
  filterTo = '';
  applyingFilters = false;

  // Insights + Planning
  insightsLoading = false;
  insights: InsightsResponse | null = null;

  targetAllocationPct: Record<string, number> = {};
  rebalanceRows: Array<{ investment_type: string; currentValue: number; currentPct: number; targetPct: number; targetValue: number; suggestion: number }> = [];

  constructor(private analyticsService: AnalyticsService) {}

  ngOnInit() {
    this.loadAnalytics();
  }

  loadAnalytics() {
    this.loading = true;
    this.errorMessage = '';
    this.advanceErrorMessage = '';
    let completedRequests = 0;
    const totalRequests = 10;

    const checkComplete = () => {
      completedRequests++;
      if (completedRequests >= totalRequests) {
        this.loading = false;
        // Initialize the dynamic charts with default selections after all data is loaded
        setTimeout(() => {
          this.initializeDynamicCharts();
        }, 100);
      }
    };

    // Load total
    this.analyticsService.getTotal().subscribe({
      next: (response) => {
        this.totalAmount = typeof response.data.total_amount === 'string' ? parseFloat(response.data.total_amount) : Number(response.data.total_amount) || 0;
        this.totalInvestments = typeof response.data.total_investments === 'string' ? parseInt(response.data.total_investments, 10) : Number(response.data.total_investments) || 0;
        checkComplete();
      },
      error: (error) => {
        console.error('Error loading total:', error);
        this.errorMessage = 'Failed to load analytics data. ' + (error.message || 'Please check if backend is running.');
        checkComplete();
      }
    });

    // Load by type
    this.analyticsService.getByType().subscribe({
      next: (response) => {
        if (response.data && response.data.length > 0) {
          // Sort by amount in descending order
          const sortedData = [...response.data].sort((a, b) => parseFloat(b.total_amount) - parseFloat(a.total_amount));
          
          this.byTypeChartData = {
            labels: sortedData.map((item: any) => item.investment_type),
            datasets: [{
              label: 'Amount (₹)',
              data: sortedData.map((item: any) => parseFloat(item.total_amount || 0)),
              backgroundColor: [
                'rgba(102, 126, 234, 0.6)',
                'rgba(118, 75, 162, 0.6)',
                'rgba(239, 68, 68, 0.6)',
                'rgba(16, 185, 129, 0.6)',
                'rgba(245, 158, 11, 0.6)',
                'rgba(59, 130, 246, 0.6)',
                'rgba(139, 92, 246, 0.6)',
                'rgba(236, 72, 153, 0.6)'
              ],
              borderColor: [
                'rgba(102, 126, 234, 1)',
                'rgba(118, 75, 162, 1)',
                'rgba(239, 68, 68, 1)',
                'rgba(16, 185, 129, 1)',
                'rgba(245, 158, 11, 1)',
                'rgba(59, 130, 246, 1)',
                'rgba(139, 92, 246, 1)',
                'rgba(236, 72, 153, 1)'
              ],
              borderWidth: 2
            }]
          };
        }
        checkComplete();
      },
      error: (error) => {
        console.error('Error loading by type:', error);
        checkComplete();
      }
    });

    // Load by month
    this.analyticsService.getByMonth().subscribe({
      next: (response) => {
        if (response.data && response.data.length > 0) {
          // Sort by amount in descending order
          const sortedData = [...response.data].sort((a, b) => parseFloat(b.total_amount) - parseFloat(a.total_amount));
          
          this.byMonthChartData = {
            labels: sortedData.map((item: any) => item.month),
            datasets: [{
              label: 'Amount (₹)',
              data: sortedData.map((item: any) => parseFloat(item.total_amount || 0)),
              borderColor: 'rgba(102, 126, 234, 1)',
              backgroundColor: 'rgba(102, 126, 234, 0.1)',
              tension: 0.4,
              fill: true,
              pointRadius: 4,
              pointHoverRadius: 6
            }]
          };
        }
        checkComplete();
      },
      error: (error) => {
        console.error('Error loading by month:', error);
        checkComplete();
      }
    });

    // Load by year
    this.analyticsService.getByYear().subscribe({
      next: (response) => {
        if (response.data && response.data.length > 0) {
          // Sort by amount in descending order
          const sortedData = [...response.data].sort((a, b) => parseFloat(b.total_amount) - parseFloat(a.total_amount));
          
          this.byYearChartData = {
            labels: sortedData.map((item: any) => item.year.toString()),
            datasets: [{
              label: 'Amount (₹)',
              data: sortedData.map((item: any) => parseFloat(item.total_amount || 0)),
              backgroundColor: [
                'rgba(118, 75, 162, 0.6)',
                'rgba(102, 126, 234, 0.6)',
                'rgba(239, 68, 68, 0.6)',
                'rgba(16, 185, 129, 0.6)',
                'rgba(245, 158, 11, 0.6)'
              ],
              borderColor: [
                'rgba(118, 75, 162, 1)',
                'rgba(102, 126, 234, 1)',
                'rgba(239, 68, 68, 1)',
                'rgba(16, 185, 129, 1)',
                'rgba(245, 158, 11, 1)'
              ],
              borderWidth: 2
            }]
          };
        }
        checkComplete();
      },
      error: (error) => {
        console.error('Error loading by year:', error);
        checkComplete();
      }
    });

    // Load by platform
    this.analyticsService.getByPlatform().subscribe({
      next: (response) => {
        if (response.data && response.data.length > 0) {
          // Sort by amount in descending order
          const sortedData = [...response.data].sort((a, b) => parseFloat(b.total_amount) - parseFloat(a.total_amount));
          
          const colors = [
            'rgba(102, 126, 234, 0.8)',
            'rgba(118, 75, 162, 0.8)',
            'rgba(239, 68, 68, 0.8)',
            'rgba(16, 185, 129, 0.8)',
            'rgba(245, 158, 11, 0.8)',
            'rgba(59, 130, 246, 0.8)',
            'rgba(139, 92, 246, 0.8)',
            'rgba(236, 72, 153, 0.8)',
            'rgba(14, 165, 233, 0.8)',
            'rgba(34, 197, 94, 0.8)'
          ];
          
          this.byPlatformChartData = {
            labels: sortedData.map((item: any) => item.website_app_name),
            datasets: [{
              data: sortedData.map((item: any) => parseFloat(item.total_amount || 0)),
              backgroundColor: colors.slice(0, sortedData.length)
            }]
          };
        }
        checkComplete();
      },
      error: (error) => {
        console.error('Error loading by platform:', error);
        checkComplete();
      }
    });

    // Load monthly changes
    this.analyticsService.getMonthlyChanges().subscribe({
      next: (response) => {
        if (response.data && response.data.length > 0) {
          this.monthlyChangesChartData = {
            labels: response.data.map((item: any) => item.month),
            datasets: [
              {
                label: 'Added',
                data: response.data.map((item: any) => parseFloat(item.added || 0)),
                borderColor: 'rgba(16, 185, 129, 1)',
                backgroundColor: 'rgba(16, 185, 129, 0.1)',
                tension: 0.4,
                fill: true,
                pointRadius: 4,
                pointHoverRadius: 6
              },
              {
                label: 'Removed',
                data: response.data.map((item: any) => parseFloat(item.removed || 0)),
                borderColor: 'rgba(239, 68, 68, 1)',
                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                tension: 0.4,
                fill: true,
                pointRadius: 4,
                pointHoverRadius: 6
              },
              {
                label: 'Updated',
                data: response.data.map((item: any) => parseFloat(item.updated || 0)),
                borderColor: 'rgba(59, 130, 246, 1)',
                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                tension: 0.4,
                fill: true,
                pointRadius: 4,
                pointHoverRadius: 6
              }
            ]
          };
        }
        checkComplete();
      },
      error: (error) => {
        console.error('Error loading monthly changes:', error);
        checkComplete();
      }
    });

    // Load by sub type name
    this.analyticsService.getBySubTypeName().subscribe({
      next: (response) => {
        if (response.data && response.data.length > 0) {
          // Sort by amount in descending order
          const sortedData = [...response.data].sort((a, b) => parseFloat(b.total_amount) - parseFloat(a.total_amount));
          
          const colors = [
            'rgba(102, 126, 234, 0.8)',
            'rgba(118, 75, 162, 0.8)',
            'rgba(239, 68, 68, 0.8)',
            'rgba(16, 185, 129, 0.8)',
            'rgba(245, 158, 11, 0.8)',
            'rgba(59, 130, 246, 0.8)',
            'rgba(139, 92, 246, 0.8)',
            'rgba(236, 72, 153, 0.8)',
            'rgba(14, 165, 233, 0.8)',
            'rgba(34, 197, 94, 0.8)'
          ];
          
          if (this.selectedPieChartOption === 'subcategory') {
            this.pieChartData = {
              labels: sortedData.map((item: any) => item.sub_type_name),
              datasets: [{
                data: sortedData.map((item: any) => parseFloat(item.total_amount || 0)),
                backgroundColor: colors.slice(0, sortedData.length)
              }]
            };
          }
        }
        checkComplete();
      },
      error: (error) => {
        console.error('Error loading by sub type name:', error);
        checkComplete();
      }
    });

    // Load by sub type category
    this.analyticsService.getBySubTypeCategory().subscribe({
      next: (response) => {
        if (response.data && response.data.length > 0) {
          // Sort by amount in descending order
          const sortedData = [...response.data].sort((a, b) => parseFloat(b.total_amount) - parseFloat(a.total_amount));
          
          const colors = [
            'rgba(102, 126, 234, 0.8)',
            'rgba(118, 75, 162, 0.8)',
            'rgba(239, 68, 68, 0.8)',
            'rgba(16, 185, 129, 0.8)',
            'rgba(245, 158, 11, 0.8)',
            'rgba(59, 130, 246, 0.8)',
            'rgba(139, 92, 246, 0.8)',
            'rgba(236, 72, 153, 0.8)',
            'rgba(14, 165, 233, 0.8)',
            'rgba(34, 197, 94, 0.8)'
          ];
          
          if (this.selectedPieChartOption === 'category') {
            this.pieChartData = {
              labels: sortedData.map((item: any) => item.sub_type_category),
              datasets: [{
                data: sortedData.map((item: any) => parseFloat(item.total_amount || 0)),
                backgroundColor: colors.slice(0, sortedData.length)
              }]
            };
          }
        }
        checkComplete();
      },
      error: (error) => {
        console.error('Error loading by sub type category:', error);
        checkComplete();
      }
    });

    // Advance: Portfolio value series from snapshots (line chart)
    this.analyticsService.getValueSeriesFiltered({ from: this.filterFrom || undefined, to: this.filterTo || undefined, platform: this.filterPlatform || undefined, type: this.filterType || undefined }).subscribe({
      next: (response) => {
        if (response.data && response.data.length > 0) {
          this.valueSeriesChartData = {
            labels: response.data.map((p) => p.change_date),
            datasets: [{
              ...this.valueSeriesChartData.datasets[0],
              data: response.data.map((p) => typeof p.total_value === 'string' ? parseFloat(p.total_value) : Number(p.total_value) || 0)
            }]
          };

          // Auto-fill delta dates (last 2 snapshots)
          if (!this.deltaFrom || !this.deltaTo) {
            const dates = response.data.map((p) => p.change_date);
            if (dates.length >= 2) {
              this.deltaFrom = dates[dates.length - 2];
              this.deltaTo = dates[dates.length - 1];
            } else {
              this.deltaFrom = dates[0];
              this.deltaTo = dates[0];
            }
          }
        }
        checkComplete();
      },
      error: (error) => {
        console.error('Error loading value series:', error);
        this.advanceErrorMessage = 'Advance analytics: failed to load portfolio value series.';
        checkComplete();
      }
    });

    // Advance: Latest allocation by type (doughnut chart)
    this.analyticsService.getAllocationLatestFiltered({ platform: this.filterPlatform || undefined }).subscribe({
      next: (response) => {
        if (response.data && response.data.length > 0) {
          const sortedData = [...response.data].sort((a, b) => parseFloat(String(b.value)) - parseFloat(String(a.value)));
          this.allocationLatestChartData = {
            labels: sortedData.map((r) => r.investment_type),
            datasets: [{
              ...this.allocationLatestChartData.datasets[0],
              data: sortedData.map((r) => typeof r.value === 'string' ? parseFloat(r.value) : Number(r.value) || 0)
            }]
          };

          // refresh rebalance planner from latest allocation
          this.ensureTargetsInitialized();
          this.computeRebalanceRows();
        }
        checkComplete();
      },
      error: (error) => {
        console.error('Error loading allocation latest:', error);
        this.advanceErrorMessage = this.advanceErrorMessage || 'Advance analytics: failed to load latest allocation.';
        checkComplete();
      }
    });

    // Insights panel (hygiene + risk)
    this.insightsLoading = true;
    this.analyticsService.getInsights().subscribe({
      next: (response) => {
        this.insights = response.data;
        this.insightsLoading = false;
        checkComplete();
      },
      error: (error) => {
        console.error('Error loading insights:', error);
        this.insightsLoading = false;
        // Don't fail whole page; show in advanceErrorMessage
        this.advanceErrorMessage = this.advanceErrorMessage || 'Insights: failed to load.';
        checkComplete();
      }
    });
  }

  // Initialize the dynamic charts with default selections
  initializeDynamicCharts() {
    // Set the time chart based on the default selection
    if (this.selectedTimeChartOption === 'month') {
      this.timeChartData = this.byMonthChartData;
    } else {
      // Create new data array to avoid type conflicts
      const newData: number[] = [];
      if (this.byYearChartData.datasets[0].data) {
        newData.push(...this.byYearChartData.datasets[0].data as number[]);
      }
      
      this.timeChartData = {
        labels: this.byYearChartData.labels,
        datasets: [{
          label: this.byYearChartData.datasets[0].label,
          data: newData,
          borderColor: 'rgba(118, 75, 162, 1)',
          backgroundColor: 'rgba(118, 75, 162, 0.1)',
          tension: 0.4,
          fill: true,
          pointRadius: 4,
          pointHoverRadius: 6
        }]
      };
    }

    // Set the pie chart based on the default selection
    switch (this.selectedPieChartOption) {
      case 'platform':
        this.pieChartData = this.byPlatformChartData;
        break;
      case 'type':
        // Create new data array to avoid type conflicts
        const newData: number[] = [];
        if (this.byTypeChartData.datasets[0].data) {
          newData.push(...this.byTypeChartData.datasets[0].data as number[]);
        }
        
        this.pieChartData = {
          labels: this.byTypeChartData.labels,
          datasets: [{
            data: newData,
            backgroundColor: [
              'rgba(102, 126, 234, 0.8)',
              'rgba(118, 75, 162, 0.8)',
              'rgba(239, 68, 68, 0.8)',
              'rgba(16, 185, 129, 0.8)',
              'rgba(245, 158, 11, 0.8)',
              'rgba(59, 130, 246, 0.8)',
              'rgba(139, 92, 246, 0.8)',
              'rgba(236, 72, 153, 0.8)'
            ]
          }]
        };
        break;
      case 'subcategory':
        // Load subcategory data if not already loaded
        this.analyticsService.getBySubTypeName().subscribe({
          next: (response) => {
            if (response.data && response.data.length > 0) {
              // Sort by amount in descending order
              const sortedData = [...response.data].sort((a, b) => parseFloat(b.total_amount) - parseFloat(a.total_amount));
              
              const colors = [
                'rgba(102, 126, 234, 0.8)',
                'rgba(118, 75, 162, 0.8)',
                'rgba(239, 68, 68, 0.8)',
                'rgba(16, 185, 129, 0.8)',
                'rgba(245, 158, 11, 0.8)',
                'rgba(59, 130, 246, 0.8)',
                'rgba(139, 92, 246, 0.8)',
                'rgba(236, 72, 153, 0.8)',
                'rgba(14, 165, 233, 0.8)',
                'rgba(34, 197, 94, 0.8)'
              ];
              
              this.pieChartData = {
                labels: sortedData.map((item: any) => item.sub_type_name),
                datasets: [{
                  data: sortedData.map((item: any) => parseFloat(item.total_amount || 0)),
                  backgroundColor: colors.slice(0, sortedData.length)
                }]
              };
            }
          },
          error: (error) => {
            console.error('Error loading by sub type name:', error);
          }
        });
        break;
      case 'category':
        // Load category data if not already loaded
        this.analyticsService.getBySubTypeCategory().subscribe({
          next: (response) => {
            if (response.data && response.data.length > 0) {
              // Sort by amount in descending order
              const sortedData = [...response.data].sort((a, b) => parseFloat(b.total_amount) - parseFloat(a.total_amount));
              
              const colors = [
                'rgba(102, 126, 234, 0.8)',
                'rgba(118, 75, 162, 0.8)',
                'rgba(239, 68, 68, 0.8)',
                'rgba(16, 185, 129, 0.8)',
                'rgba(245, 158, 11, 0.8)',
                'rgba(59, 130, 246, 0.8)',
                'rgba(139, 92, 246, 0.8)',
                'rgba(236, 72, 153, 0.8)',
                'rgba(14, 165, 233, 0.8)',
                'rgba(34, 197, 94, 0.8)'
              ];
              
              this.pieChartData = {
                labels: sortedData.map((item: any) => item.sub_type_category),
                datasets: [{
                  data: sortedData.map((item: any) => parseFloat(item.total_amount || 0)),
                  backgroundColor: colors.slice(0, sortedData.length)
                }]
              };
            }
          },
          error: (error) => {
            console.error('Error loading by sub type category:', error);
          }
        });
        break;
    }
  }

  onTimeChartOptionChange() {
    if (this.selectedTimeChartOption === 'month') {
      this.timeChartData = this.byMonthChartData;
    } else {
      // Create new data array to avoid type conflicts
      const newData: number[] = [];
      if (this.byYearChartData.datasets[0].data) {
        newData.push(...this.byYearChartData.datasets[0].data as number[]);
      }
      
      this.timeChartData = {
        labels: this.byYearChartData.labels,
        datasets: [{
          label: this.byYearChartData.datasets[0].label,
          data: newData,
          borderColor: 'rgba(118, 75, 162, 1)',
          backgroundColor: 'rgba(118, 75, 162, 0.1)',
          tension: 0.4,
          fill: true,
          pointRadius: 4,
          pointHoverRadius: 6
        }]
      };
    }
  }

  onPieChartOptionChange() {
    switch (this.selectedPieChartOption) {
      case 'platform':
        this.pieChartData = this.byPlatformChartData;
        break;
      case 'type':
        // Create new data array to avoid type conflicts
        const newData: number[] = [];
        if (this.byTypeChartData.datasets[0].data) {
          newData.push(...this.byTypeChartData.datasets[0].data as number[]);
        }
        
        this.pieChartData = {
          labels: this.byTypeChartData.labels,
          datasets: [{
            data: newData,
            backgroundColor: [
              'rgba(102, 126, 234, 0.8)',
              'rgba(118, 75, 162, 0.8)',
              'rgba(239, 68, 68, 0.8)',
              'rgba(16, 185, 129, 0.8)',
              'rgba(245, 158, 11, 0.8)',
              'rgba(59, 130, 246, 0.8)',
              'rgba(139, 92, 246, 0.8)',
              'rgba(236, 72, 153, 0.8)'
            ]
          }]
        };
        break;
      case 'subcategory':
        // Load subcategory data if not already loaded
        this.analyticsService.getBySubTypeName().subscribe({
          next: (response) => {
            if (response.data && response.data.length > 0) {
              // Sort by amount in descending order
              const sortedData = [...response.data].sort((a, b) => parseFloat(b.total_amount) - parseFloat(a.total_amount));
              
              const colors = [
                'rgba(102, 126, 234, 0.8)',
                'rgba(118, 75, 162, 0.8)',
                'rgba(239, 68, 68, 0.8)',
                'rgba(16, 185, 129, 0.8)',
                'rgba(245, 158, 11, 0.8)',
                'rgba(59, 130, 246, 0.8)',
                'rgba(139, 92, 246, 0.8)',
                'rgba(236, 72, 153, 0.8)',
                'rgba(14, 165, 233, 0.8)',
                'rgba(34, 197, 94, 0.8)'
              ];
              
              this.pieChartData = {
                labels: sortedData.map((item: any) => item.sub_type_name),
                datasets: [{
                  data: sortedData.map((item: any) => parseFloat(item.total_amount || 0)),
                  backgroundColor: colors.slice(0, sortedData.length)
                }]
              };
            }
          },
          error: (error) => {
            console.error('Error loading by sub type name:', error);
          }
        });
        break;
      case 'category':
        // Load category data if not already loaded
        this.analyticsService.getBySubTypeCategory().subscribe({
          next: (response) => {
            if (response.data && response.data.length > 0) {
              // Sort by amount in descending order
              const sortedData = [...response.data].sort((a, b) => parseFloat(b.total_amount) - parseFloat(a.total_amount));
              
              const colors = [
                'rgba(102, 126, 234, 0.8)',
                'rgba(118, 75, 162, 0.8)',
                'rgba(239, 68, 68, 0.8)',
                'rgba(16, 185, 129, 0.8)',
                'rgba(245, 158, 11, 0.8)',
                'rgba(59, 130, 246, 0.8)',
                'rgba(139, 92, 246, 0.8)',
                'rgba(236, 72, 153, 0.8)',
                'rgba(14, 165, 233, 0.8)',
                'rgba(34, 197, 94, 0.8)'
              ];
              
              this.pieChartData = {
                labels: sortedData.map((item: any) => item.sub_type_category),
                datasets: [{
                  data: sortedData.map((item: any) => parseFloat(item.total_amount || 0)),
                  backgroundColor: colors.slice(0, sortedData.length)
                }]
              };
            }
          },
          error: (error) => {
            console.error('Error loading by sub type category:', error);
          }
        });
        break;
    }
  }

  loadDelta() {
    if (!this.deltaFrom || !this.deltaTo) return;

    this.deltaLoading = true;
    this.advanceErrorMessage = '';

    this.analyticsService.getDelta(this.deltaFrom, this.deltaTo).subscribe({
      next: (response) => {
        this.deltaRows = response.data || [];
        const gainers = [...this.deltaRows].sort((a, b) => Number(b.delta) - Number(a.delta));
        const losers = [...this.deltaRows].sort((a, b) => Number(a.delta) - Number(b.delta));
        this.topGainers = gainers.slice(0, 10);
        this.topLosers = losers.slice(0, 10);
        this.deltaLoading = false;
      },
      error: (error) => {
        console.error('Error loading delta:', error);
        this.advanceErrorMessage = 'Advance analytics: failed to load delta. Make sure both dates exist in investment history.';
        this.deltaLoading = false;
      }
    });
  }

  toNumber(value: unknown): number {
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
      const n = parseFloat(value);
      return Number.isFinite(n) ? n : 0;
    }
    return 0;
  }

  applyFilters() {
    this.applyingFilters = true;
    // Reload all analytics using the same method (keeps existing behavior consistent)
    this.loadAnalytics();
    setTimeout(() => {
      this.applyingFilters = false;
    }, 300);
  }

  private ensureTargetsInitialized() {
    // Initialize targets from localStorage or defaults (equal-weight)
    const saved = localStorage.getItem('targetAllocationPct');
    if (saved) {
      try {
        this.targetAllocationPct = JSON.parse(saved) || {};
      } catch {
        this.targetAllocationPct = {};
      }
    }

    const labels = (this.allocationLatestChartData.labels || []) as string[];
    if (labels.length === 0) return;

    const missing = labels.filter((t) => typeof this.targetAllocationPct[t] !== 'number');
    if (missing.length) {
      const even = Math.floor((100 / labels.length) * 10) / 10;
      for (const t of missing) this.targetAllocationPct[t] = even;
    }
    this.persistTargets();
  }

  persistTargets() {
    localStorage.setItem('targetAllocationPct', JSON.stringify(this.targetAllocationPct));
    this.computeRebalanceRows();
  }

  computeRebalanceRows() {
    const labels = (this.allocationLatestChartData.labels || []) as string[];
    const values = (this.allocationLatestChartData.datasets?.[0]?.data || []) as number[];
    const total = values.reduce((a, b) => a + (Number(b) || 0), 0) || 0;

    this.rebalanceRows = labels.map((t, idx) => {
      const currentValue = Number(values[idx]) || 0;
      const currentPct = total > 0 ? (currentValue / total) * 100 : 0;
      const targetPct = Number(this.targetAllocationPct[t]) || 0;
      const targetValue = (targetPct / 100) * total;
      const suggestion = targetValue - currentValue;
      return { investment_type: t, currentValue, currentPct, targetPct, targetValue, suggestion };
    }).sort((a, b) => Math.abs(b.suggestion) - Math.abs(a.suggestion));
  }
}