# Portfolio Financial Management System

A full-stack application for managing and analyzing your financial portfolio investments.

Docker Image : `docker pull djamol/portofilio-asset-managment:1.0.0;`

Run Image : `docker run -p 8080:3000 djamol/portofilio-asset-managment`

Run http://localhost:8080

username :amol password:admin 
## Features

- ✅ Add, edit, and delete investment records
- ✅ Track investments by platform/website/app name
- ✅ Support for multiple investment types (FD, Stock, ETF, Bond, Mutual Fund, Crypto, PPF, Saving Bank Balance)
- ✅ Sub-type tracking (e.g., MF house name, MF category like Nifty 50)
- ✅ Advanced analytics dashboard
- ✅ Monthly and yearly investment analysis
- ✅ Investment changes tracking
- ✅ Portfolio growth visualization

## Tech Stack

- **Frontend**: Angular 17
- **Backend**: Node.js with Express
- **Database**: MySQL/MariaDB
- **Charts**: Chart.js with ng2-charts

## Prerequisites

- Node.js (v18 or higher)
- MySQL or MariaDB
- npm or yarn

## Setup Instructions

### 1. Database Setup

1. Install MySQL/MariaDB if not already installed
2. Create a database user (or use root)
3. Update the database credentials in `backend/.env`:

```env
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=portfolio_db
PORT=3000
```

### 2. Backend Setup

```bash
cd backend
npm install
npm start
```

The backend will automatically create the database and tables on first run.

The backend API will be available at `http://localhost:3000`

### 3. Frontend Setup

```bash
cd frontend
npm install
npm start
```

The frontend will be available at `http://localhost:4200`

## API Endpoints

### Investments
- `GET /api/investments` - Get all investments
- `GET /api/investments/:id` - Get investment by ID
- `POST /api/investments` - Create new investment
- `PUT /api/investments/:id` - Update investment
- `DELETE /api/investments/:id` - Delete investment

### Analytics
- `GET /api/analytics/total` - Get total portfolio value
- `GET /api/analytics/by-type` - Get investments grouped by type
- `GET /api/analytics/by-month` - Get investments grouped by month
- `GET /api/analytics/by-year` - Get investments grouped by year
- `GET /api/analytics/monthly-changes` - Get monthly changes
- `GET /api/analytics/yearly-changes` - Get yearly changes
- `GET /api/analytics/by-platform` - Get investments by platform
- `GET /api/analytics/growth` - Get portfolio growth over time
- `GET /api/analytics/value-series` - Portfolio value time series from history snapshots
- `GET /api/analytics/allocation-latest` - Latest allocation grouped by investment type
- `GET /api/analytics/delta?from=YYYY-MM-DD&to=YYYY-MM-DD` - Per-investment value change between two snapshot dates
- `GET /api/analytics/cashflows-by-month` - Net inflow/outflow per month from transactions

## Database Schema

### investments
- `id` - Primary key
- `website_app_name` - Platform name
- `investment_type` - Type of investment (FD, Stock, ETF, etc.)
- `sub_type_name` - Sub-type (e.g., MF house name)
- `sub_type_category` - Category (e.g., Nifty 50)
- `amount` - Investment amount
- `investment_date` - Date of investment
- `created_at` - Record creation timestamp
- `updated_at` - Record update timestamp

### investment_history
- `id` - Primary key
- `investment_id` - Foreign key to investments
- `amount` - Amount at time of change
- `change_date` - Date of change
- `change_type` - Type of change (added, removed, updated)
- `notes` - Optional notes
- `created_at` - Record creation timestamp

### investment_transactions
- `id` - Primary key
- `investment_id` - Foreign key to investments
- `txn_date` - Transaction date
- `txn_type` - buy/sell/dividend/interest/fee/etc.
- `units` - Optional units (stocks/ETFs/MFs)
- `price` - Optional price
- `cashflow_amount` - Cashflow convention: **negative = outflow** (buy/fee), **positive = inflow** (sell/dividend/interest)
- `notes` - Optional notes
- `created_at` - Record creation timestamp

## Usage

1. Start the backend server
2. Start the frontend development server
3. Navigate to `http://localhost:4200`
4. Click "Add Investment" to create your first investment record
5. View analytics by clicking "View Analytics"

## Development

### Backend Development
```bash
cd backend
npm run dev  # Uses nodemon for auto-reload
```

### Frontend Development
```bash
cd frontend
npm start  # Angular dev server with hot reload
```

## Project Structure

```
.
├── backend/
│   ├── config/
│   │   └── database.js       # Database configuration
│   ├── routes/
│   │   ├── investments.js    # Investment CRUD routes
│   │   └── analytics.js      # Analytics routes
│   ├── server.js             # Express server
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── app/
│   │   │   ├── components/
│   │   │   │   ├── investment-list/  # Investment management
│   │   │   │   └── analytics/         # Analytics dashboard
│   │   │   ├── services/
│   │   │   │   ├── investment.service.ts
│   │   │   │   └── analytics.service.ts
│   │   │   ├── app.component.ts
│   │   │   └── app.routes.ts
│   │   ├── styles.css
│   │   └── main.ts
│   └── package.json
└── README.md

```

## License

ISC
