import {
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  DoughnutController,
  Filler,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PieController,
  PointElement,
  Tooltip
} from 'chart.js';

let registered = false;

/** Register only the Chart.js pieces this app uses (line/bar/doughnut/pie). */
export function registerAppCharts() {
  if (registered) return;
  Chart.register(
    LineController,
    BarController,
    DoughnutController,
    PieController,
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    BarElement,
    ArcElement,
    Legend,
    Tooltip,
    Filler
  );
  registered = true;
}
