import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { AnalyticsService } from '../../services/analytics.service';
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

  constructor(private analyticsService: AnalyticsService) {}

  ngOnInit() {
    this.loadAnalytics();
  }

  loadAnalytics() {
    this.loading = true;
    this.errorMessage = '';
    let completedRequests = 0;
    const totalRequests = 8; // Reduced by 1 since we removed summary table API call

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
}