export const INVESTMENT_TYPES = [
  'FD',
  'Stock',
  'ETF',
  'Bond',
  'Mutual Fund',
  'Crypto',
  'PPF',
  'EPF',
  'Saving Bank Balance'
];

// Define sub-types and categories for each investment type
export const INVESTMENT_SUB_TYPES: { [key: string]: { subTypes: string[]; categories: string[] } } = {
  'FD': {
    subTypes: ['Bank FD', 'Corporate FD', 'Tax Saving FD'],
    categories: ['Short Term', 'Medium Term', 'Long Term', 'Tax Saving']
  },
  'Stock': {
    subTypes: ['Individual Stock', 'IPO', 'SIP in Stocks'],
    categories: ['Large Cap', 'Mid Cap', 'Small Cap', 'Sectoral', 'Blue Chip', 'Growth', 'Value']
  },
  'ETF': {
    subTypes: ['Index ETF', 'Gold ETF', 'International ETF', 'Sector ETF'],
    categories: ['Nifty 50', 'Sensex', 'Banking', 'Technology', 'Healthcare', 'Gold', 'International']
  },
  'Bond': {
    subTypes: ['Government Bond', 'Corporate Bond', 'Tax-Free Bond'],
    categories: ['Government', 'PSU', 'Corporate', 'Tax-Free', 'Infrastructure']
  },
  'Mutual Fund': {
    subTypes: ['Equity Fund', 'Debt Fund', 'Hybrid Fund', 'Index Fund', 'ELSS'],
    categories: ['Large Cap', 'Mid Cap', 'Small Cap', 'Multi Cap', 'Debt', 'Hybrid', 'Tax Saving']
  },
  'Crypto': {
    subTypes: ['Bitcoin', 'Ethereum', 'Altcoin', 'Stablecoin'],
    categories: ['Major Cryptos', 'Altcoins', 'DeFi Tokens', 'Stablecoins', 'NFT Related']
  },
  'PPF': {
    subTypes: ['Regular PPF', 'PPF Transfer'],
    categories: ['Long Term Savings', 'Tax Saving']
  },
  'EPF': {
    subTypes: ['Employer EPF', 'Voluntary PF', 'EPF Transfer'],
    categories: ['Retirement', 'Tax Saving']
  },
  'Saving Bank Balance': {
    subTypes: ['Savings Account', 'Current Account', 'Recurring Deposit'],
    categories: ['Liquid', 'Emergency Fund', 'Short Term']
  }
};

// Type definitions
export interface InvestmentTypeConfig {
  subTypes: string[];
  categories: string[];
}

export type InvestmentTypeName = keyof typeof INVESTMENT_SUB_TYPES;