import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { InvestmentService } from '../../services/investment.service';
import { CategoryService, SubTypeName, Category } from '../../services/category.service';

@Component({
  selector: 'app-import-data',
  templateUrl: './import-data.component.html',
  styleUrls: ['./import-data.component.css'],
  standalone: false
})
export class ImportDataComponent implements OnInit {
  platform = '';
  investmentType = '';
  selectedFile: File | null = null;
  uploadProgress = 0;
  isUploading = false;
  message = '';
  messageType: 'success' | 'error' | 'info' = 'info';
  parsedData: any[] = [];
  originalRecordCount = 0; // Track original count
  showPreview = false;
  previewData: any[] = [];
  existingAMCs: Set<string> = new Set();
  existingSchemeCategories: Set<string> = new Set();
  hasNewAMC = false; // Flag to indicate if there are new AMCs
  hasNewScheme = false; // Flag to indicate if there are new schemes
  
  // Optional date selection
  useCustomDate = false;
  customDate: string = new Date().toISOString().split('T')[0]; // Default to today's date
  csvPortfolioDate: string | null = null;

  get supportsCsvImport(): boolean {
    return this.investmentType === 'Mutual Fund' || this.investmentType === 'ETF';
  }
  
  // Method to reset custom date to today when checkbox is toggled
  resetCustomDate() {
    this.customDate = new Date().toISOString().split('T')[0];
  }

  // Comprehensive list of AMC names - Order matters: longer names first
  private amcs = [
    // Longest names first
    'Aditya Birla Sun Life', 
    'Bandhan Mutual Fund',
    'Bank of India', 
    'ICICI Prudential',
    'ICICI Pru',
    'Kotak Mahindra', 
    'Mirae Asset', 
    'Nippon India', 
    'Franklin Templeton', 
    'Canara Robeco',
    'JM Financial', 
    'Motilal Oswal', 
    'Parag Parikh',
    'BOI AXA', 
    'BNP Paribas', 
    'SBI Life',
    'Jio BlackRock',
    'JioBlackRock',
    'DSP BlackRock',
    
    // Medium length names
    'Aditya Birla',
    'Axis',
    'DSP',
    'Edelweiss',
    'HDFC', 
    'SBI', 
    'Tata',
    'UTI',
    'Quant',
    'Baroda', 
    'Navi', 
    'PGIM India', 
    'Invesco', 
    'ITI',
    'Sundaram',
    'IIFL', 
    'L&T',
    'WhiteOak Capital',
    'Bandhan MF',
    'Bandhan',
    'HSBC', 
    'ICICI', 
    'Nippon', 
    'Shriram',
    'IDFC', 
    'Mirae', 
    'LIC',
    'Kotak', 
    'Aditya', 
    'Birla', 
    'Sun Life', 
    'AXA', 
    'Bajaj',
    'Mahindra',
    'BlackRock', 
    'Templeton', 
    
    // Short names - these should be last to avoid false positives
    'Taurus', 
    'Principal', 
    'Union',
    'Quantum', 
    'Quantified',
    'Motilal', // This is kept but will only match if "Motilal Oswal" doesn't match first
    'JM' // This is kept but will only match if "JM Financial" doesn't match first
  ];

  constructor(
    private investmentService: InvestmentService,
    private categoryService: CategoryService
  ) {}

  async ngOnInit() {
    await this.loadExistingData();
  }

  async loadExistingData() {
    try {
      const existingInvestments = await this.investmentService.getAll().toPromise();
      if (existingInvestments) {
        // Populate existing AMCs and scheme categories
        existingInvestments.forEach(investment => {
          if (investment.sub_type_name) {
            this.existingAMCs.add(investment.sub_type_name);
          }
          if (investment.sub_type_category) {
            this.existingSchemeCategories.add(investment.sub_type_category);
          }
        });
      }
    } catch (error) {
      console.error('Error loading existing data:', error);
      // Continue without existing data if there's an error
    }
  }

  onFileSelected(event: any) {
    const file = event.target.files[0];
    if (file) {
      this.selectedFile = file;
      this.message = `Selected file: ${file.name}`;
      this.messageType = 'info';
      this.showPreview = false; // Reset preview when new file is selected
      this.previewData = []; // Clear preview data
    }
  }

  async previewDataImport() {
    if (!this.selectedFile) {
      this.showMessage('Please select a file to import.', 'error');
      return;
    }

    if (!this.platform.trim()) {
      this.showMessage('Please enter a platform/website/app name.', 'error');
      return;
    }

    if (!this.supportsCsvImport) {
      this.showMessage('Currently only Mutual Fund and ETF imports are supported.', 'error');
      return;
    }

    this.message = 'Processing file for preview...';
    this.messageType = 'info';

    try {
      const text = await this.readFileAsText(this.selectedFile);
      this.parseCSV(text);
      
      // Store original count before aggregation
      this.originalRecordCount = this.parsedData.length;
      
      // Aggregate duplicate records (same platform, AMC, and scheme name)
      this.parsedData = this.aggregateDuplicateRecords(this.parsedData);
      
      if (this.parsedData.length > 0) {
        const existingInvestments = await this.investmentService.getAll().toPromise();
        const typeAmcs = new Set<string>();
        const typeSchemes = new Set<string>();
        existingInvestments
          ?.filter(inv => inv.investment_type === this.investmentType)
          .forEach(inv => {
            if (inv.sub_type_name) typeAmcs.add(inv.sub_type_name);
            if (inv.sub_type_category) typeSchemes.add(inv.sub_type_category);
          });

        // Prepare preview data
        this.previewData = this.parsedData.map(record => ({
          folioNo: record.folioNo,
          originalSchemeName: record.originalSchemeName || record.schemeName,
          extractedAMC: record.subTypeName,
          extractedScheme: record.subTypeCategory,
          presentValue: record.presentValue,
          isNewAMC: !typeAmcs.has(record.subTypeName),
          isNewScheme: !typeSchemes.has(record.subTypeCategory)
        }));
        
        // Set flags for new indicators in headers
        this.hasNewAMC = this.previewData.some(record => record.isNewAMC);
        this.hasNewScheme = this.previewData.some(record => record.isNewScheme);
        
        this.showPreview = true;
        this.message = `Preview ready. ${this.parsedData.length} unique records found (${this.originalRecordCount} total entries in file).`;
        this.messageType = 'info';
      } else {
        this.showMessage('No valid investment records found in the file.', 'error');
      }
    } catch (error) {
      console.error('Error processing file for preview:', error);
      this.showMessage('Error processing file: ' + (error as Error).message, 'error');
    }
  }

  // Aggregate duplicate records by combining their present values
  private aggregateDuplicateRecords(records: any[]): any[] {
    const aggregatedMap = new Map<string, any>();
    
    for (const record of records) {
      // Create a key based on platform, AMC, and scheme name (what makes it a "duplicate")
      const key = `${this.platform}_${record.subTypeName}_${record.subTypeCategory}`;
      
      if (aggregatedMap.has(key)) {
        // If key exists, aggregate the present value
        const existingRecord = aggregatedMap.get(key);
        existingRecord.presentValue += record.presentValue;
        // Update folio no to show multiple folios if needed
        if (record.folioNo && existingRecord.folioNo !== record.folioNo) {
          existingRecord.folioNo = `${existingRecord.folioNo},${record.folioNo}`;
        }
        // Keep track of how many records were combined
        existingRecord.count = (existingRecord.count || 1) + 1;
      } else {
        // If key doesn't exist, add the record as-is
        aggregatedMap.set(key, { ...record, count: 1 });
      }
    }
    
    // Convert map back to array
    return Array.from(aggregatedMap.values());
  }

  async importData() {
    if (!this.selectedFile) {
      this.showMessage('Please select a file to import.', 'error');
      return;
    }

    if (!this.platform.trim()) {
      this.showMessage('Please select a platform/website/app name.', 'error');
      return;
    }

    if (!this.supportsCsvImport) {
      this.showMessage('Currently only Mutual Fund and ETF imports are supported.', 'error');
      return;
    }

    if (this.parsedData.length === 0) {
      this.showMessage('No data to import. Please process the file first.', 'error');
      return;
    }

    this.isUploading = true;
    this.uploadProgress = 0;

    try {
      await this.processParsedData();
      // Refresh existing data after import
      await this.loadExistingData();
      this.showMessage(`${this.parsedData.length} unique records processed successfully (${this.originalRecordCount} total entries in file).`, 'success');
      // Reset after successful import
      this.resetForm();
    } catch (error) {
      console.error('Error importing data:', error);
      this.showMessage('Error importing data: ' + (error as Error).message, 'error');
    } finally {
      this.isUploading = false;
    }
  }

  private resetForm() {
    this.platform = '';
    this.selectedFile = null;
    this.parsedData = [];
    this.originalRecordCount = 0;
    this.previewData = [];
    this.showPreview = false;
    this.uploadProgress = 0;
    this.isUploading = false;
    this.message = '';
    this.hasNewAMC = false;
    this.hasNewScheme = false;
    this.csvPortfolioDate = null;
  }

  private getInvestmentDate(): string {
    if (this.useCustomDate) {
      return this.customDate;
    }
    return this.csvPortfolioDate || new Date().toISOString().split('T')[0];
  }

  private readFileAsText(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve((e.target?.result as string) || '');
      reader.onerror = (e) => reject(new Error('Error reading file'));
      reader.readAsText(file);
    });
  }

  private parseCSV(csvText: string) {
    const lines = csvText.split('\n');
    this.parsedData = [];
    this.csvPortfolioDate = null;

    const isDhanEtfFormat = lines[0]?.trim().toLowerCase().startsWith('etf,') ||
      (csvText.toLowerCase().includes('scrip name') && csvText.toLowerCase().includes('avg. buy rate'));

    if (this.investmentType === 'ETF') {
      if (isDhanEtfFormat) {
        this.parseDhanEtfFormat(lines);
      } else {
        this.showMessage('Unsupported ETF CSV format. Please upload a Dhan ETF portfolio export.', 'error');
      }
      return;
    }

    const isMfPortfolioFormat = csvText.toLowerCase().includes('fund') &&
      csvText.toLowerCase().includes('scheme') &&
      csvText.toLowerCase().includes('value at cost');

    const isDhanAppFormat = !isDhanEtfFormat &&
      csvText.toLowerCase().includes('name') &&
      csvText.toLowerCase().includes('current value') &&
      csvText.toLowerCase().includes('nav') &&
      !csvText.toLowerCase().includes('folio no');

    if (isDhanAppFormat) {
      this.parseDhanAppFormat(lines);
    } else if (isMfPortfolioFormat) {
      this.parseMfPortfolioFormat(lines);
    } else {
      this.parseOriginalFormat(lines);
    }
  }

  private extractDhanPortfolioDate(lines: string[]): string | null {
    const firstLine = lines[0]?.trim();
    if (!firstLine) return null;

    const match = firstLine.match(/For\s+(\d{2})-(\d{2})-(\d{4})/i);
    if (match) {
      return `${match[3]}-${match[2]}-${match[1]}`;
    }
    return null;
  }

  private parseDhanEtfFormat(lines: string[]) {
    this.csvPortfolioDate = this.extractDhanPortfolioDate(lines);

    let headerIndex = -1;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.toLowerCase().includes('scrip name') && line.toLowerCase().includes('current value')) {
        headerIndex = i;
        break;
      }
    }

    if (headerIndex === -1) {
      this.showMessage('Could not find the expected ETF header row in the CSV.', 'error');
      return;
    }

    const headers = this.parseCSVLine(lines[headerIndex]);
    const scripNameColIndex = headers.findIndex(h => h.toLowerCase().includes('scrip name'));
    const currentValueColIndex = headers.findIndex(h => h.toLowerCase().includes('current value'));

    for (let i = headerIndex + 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      if (line.toLowerCase().startsWith('investment,') || line.toLowerCase().startsWith('note')) continue;

      const fields = this.parseCSVLine(line);
      if (fields.length <= Math.max(scripNameColIndex, currentValueColIndex)) continue;

      const scripName = fields[scripNameColIndex]?.trim();
      const currentValue = fields[currentValueColIndex]?.trim();
      if (!scripName || !currentValue) continue;

      const currentValueNum = parseFloat(currentValue.replace(/,/g, ''));
      if (isNaN(currentValueNum) || currentValueNum <= 0) continue;

      const { amcName, schemeNameWithoutAMC } = this.extractAMCAndScheme(scripName, true);

      this.parsedData.push({
        folioNo: '',
        originalSchemeName: scripName,
        schemeName: scripName,
        presentValue: currentValueNum,
        subTypeName: amcName || 'Unknown Issuer',
        subTypeCategory: schemeNameWithoutAMC || scripName
      });
    }
  }

  private parseDhanAppFormat(lines: string[]) {
    // Find the header line (first line typically contains the headers)
    const headerLine = lines[0];
    const headers = this.parseCSVLine(headerLine);
    
    // Identify column indices
    const nameColIndex = headers.findIndex(h => h.toLowerCase().includes('name'));
    const currentValueColIndex = headers.findIndex(h => h.toLowerCase().includes('current value'));
    const navColIndex = headers.findIndex(h => h.toLowerCase().includes('nav'));
    const investmentColIndex = headers.findIndex(h => h.toLowerCase().includes('investment'));
    const plColIndex = headers.findIndex(h => h.toLowerCase().includes('p&l'));
    
    // Parse data rows starting from line 1 (skip header)
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const fields = this.parseCSVLine(line);
      
      // Check if we have enough fields and the required fields exist
      if (fields.length > Math.max(nameColIndex, currentValueColIndex) &&
          fields[nameColIndex] && 
          fields[currentValueColIndex]) {
        
        const schemeName = fields[nameColIndex]?.trim();
        const currentValue = fields[currentValueColIndex]?.trim();
        const navValue = navColIndex >= 0 ? fields[navColIndex]?.trim() : '';
        const investmentValue = investmentColIndex >= 0 ? fields[investmentColIndex]?.trim() : '';
        const plValue = plColIndex >= 0 ? fields[plColIndex]?.trim() : '';

        // Skip if current value is not a number or if scheme name is empty
        if (!schemeName || !currentValue) {
          continue;
        }

        // Remove commas and convert to number for currentValue
        const currentValueNum = parseFloat(currentValue.replace(/,/g, ''));
        
        // Skip if current value is not a valid number
        if (isNaN(currentValueNum) || currentValueNum <= 0) {
          continue;
        }

        // Clean up the scheme name to extract AMC and actual scheme name
        const { amcName, schemeNameWithoutAMC } = this.extractAMCAndScheme(schemeName);

        this.parsedData.push({
          folioNo: '', // No folio number in this format
          originalSchemeName: schemeName,
          schemeName: schemeName,
          presentValue: currentValueNum,
          subTypeName: amcName || 'Unknown AMC', // Use extracted AMC or default
          subTypeCategory: schemeNameWithoutAMC || 'Uncategorized' // Use extracted scheme name or default
        });
      }
    }
  }

  private parseMfPortfolioFormat(lines: string[]) {
    // Find the header line (first line typically contains the headers)
    const headerLine = lines[0];
    const headers = this.parseCSVLine(headerLine);
    
    // Identify column indices
    const fundColIndex = headers.findIndex(h => h.toLowerCase().includes('fund'));
    const schemeColIndex = headers.findIndex(h => h.toLowerCase().includes('scheme'));
    const valueAtCostColIndex = headers.findIndex(h => h.toLowerCase().includes('value at cost'));
    const profitLossColIndex = headers.findIndex(h => h.toLowerCase().includes('profit/ loss'));
    const categoryColIndex = headers.findIndex(h => h.toLowerCase().includes('category'));
    const subCategoryColIndex = headers.findIndex(h => h.toLowerCase().includes('sub category'));
    
    // Parse data rows starting from line 1 (skip header)
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const fields = this.parseCSVLine(line);
      
      // Check if we have enough fields and the required fields exist
      if (fields.length > Math.max(fundColIndex, schemeColIndex, valueAtCostColIndex) &&
          fields[schemeColIndex] && 
          (fields[valueAtCostColIndex] || fields[profitLossColIndex])) {
        
        const schemeName = fields[schemeColIndex]?.trim();
        const valueAtCost = fields[valueAtCostColIndex]?.trim();
        const profitLoss = profitLossColIndex >= 0 ? fields[profitLossColIndex]?.trim() : '0';
        const fundHouse = fundColIndex >= 0 ? fields[fundColIndex]?.trim() : '';
        const category = categoryColIndex >= 0 ? fields[categoryColIndex]?.trim() : '';
        const subCategory = subCategoryColIndex >= 0 ? fields[subCategoryColIndex]?.trim() : '';

        // Skip if scheme name is empty
        if (!schemeName) {
          continue;
        }

        // Calculate present value as sum of value at cost and profit/loss
        let valueAtCostNum = 0;
        let profitLossNum = 0;
        
        if (valueAtCost) {
          // Remove commas and convert to number
          valueAtCostNum = parseFloat(valueAtCost.replace(/,/g, ''));
        }
        
        if (profitLoss) {
          // Remove commas and convert to number
          profitLossNum = parseFloat(profitLoss.replace(/,/g, ''));
        }
        
        // Calculate present value as sum of value at cost and profit/loss
        const presentValue = valueAtCostNum + profitLossNum;

        // Skip if present value calculation results in NaN or zero
        if (isNaN(presentValue) || presentValue <= 0) {
          continue;
        }

        // Clean up the scheme name to extract AMC and actual scheme name
        const { amcName, schemeNameWithoutAMC } = this.extractAMCAndScheme(schemeName);

        this.parsedData.push({
          folioNo: '', // No folio number in this format
          originalSchemeName: schemeName,
          schemeName: schemeName,
          presentValue: presentValue,
          subTypeName: amcName || fundHouse || 'Unknown AMC', // Use fund house if AMC not found
          subTypeCategory: schemeNameWithoutAMC || subCategory || category || 'Uncategorized' // Prioritize extracted scheme name
        });
      }
    }
  }

  private parseOriginalFormat(lines: string[]) {
    // Find the header line containing "Folio No", "Scheme Name", "Invested Amt.", "Present Value"
    let headerIndex = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('Folio No') && lines[i].includes('Scheme Name')) {
        headerIndex = i;
        break;
      }
    }

    if (headerIndex === -1) {
      this.showMessage('Could not find the expected header row in the CSV.', 'error');
      return;
    }

    // Parse data starting from the header row
    for (let i = headerIndex + 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // Split by comma and handle quoted fields
      const fields = this.parseCSVLine(line);
      
      // Check if we have enough fields (at least Folio No, Scheme Name, Present Value)
      if (fields.length >= 4) {
        const folioNo = fields[0]?.trim();
        const schemeName = fields[1]?.trim();
        const presentValue = fields[3]?.trim();

        // Skip if present value is not a number or if scheme name is empty
        if (!schemeName || !presentValue || isNaN(parseFloat(presentValue))) {
          continue;
        }

        // Clean up the scheme name to extract AMC and actual scheme name
        const { amcName, schemeNameWithoutAMC } = this.extractAMCAndScheme(schemeName);

        this.parsedData.push({
          folioNo,
          originalSchemeName: schemeName, // Store original for reference
          schemeName: schemeName,
          presentValue: parseFloat(presentValue),
          subTypeName: amcName,
          subTypeCategory: schemeNameWithoutAMC
        });
      }
    }
  }

  private parseCSVLine(line: string): string[] {
    const fields: string[] = [];
    let currentField = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        fields.push(currentField.trim());
        currentField = '';
      } else {
        currentField += char;
      }
    }
    
    fields.push(currentField.trim());
    return fields;
  }

  private cleanSchemeName(schemeName: string): string {
    // Remove common suffixes like "Growth", "Direct", "Regular", etc.
    let cleaned = schemeName.replace(/[-]?[\s]*Growth\s*$/i, '');
    cleaned = cleaned.replace(/\s*Growth\s*[-]?/i, ' ');
    cleaned = cleaned.replace(/\s*Direct\s*$/i, '');
    cleaned = cleaned.replace(/\s*Regular\s*$/i, '');
    cleaned = cleaned.trim();
    return cleaned;
  }

  private extractAMCAndScheme(fullSchemeName: string, skipNormalization = false) {
    let cleanedSchemeName = skipNormalization
      ? fullSchemeName.trim()
      : this.cleanSchemeName(fullSchemeName);
    
    // Look for the longest matching AMC name in the scheme name
    let foundAMC = '';
    let maxLength = 0;

    for (const amc of this.amcs) {
      // Case-insensitive search
      const lowerSchemeName = cleanedSchemeName.toLowerCase();
      const lowerAMC = amc.toLowerCase();
      
      // Check if the scheme name contains the AMC name as a whole word
      // We use word boundaries to prevent partial matches like matching "JM" in "JMO"
      const regex = new RegExp('\\b' + lowerAMC.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
      
      if (regex.test(lowerSchemeName)) {
        if (amc.length > maxLength) {
          maxLength = amc.length;
          foundAMC = amc;
        }
      }
    }

    if (foundAMC) {
      // Remove the AMC name from the scheme name to get the actual scheme name
      const regex = new RegExp(foundAMC, 'gi');
      let schemeWithoutAMC = cleanedSchemeName.replace(regex, '').trim();
      
      // Clean up any extra spaces or separators
      schemeWithoutAMC = schemeWithoutAMC.replace(/^\s*[-–—]\s*/, '').trim(); // Remove leading dash
      schemeWithoutAMC = schemeWithoutAMC.replace(/^\s*[,\.\s]\s*/, '').trim(); // Remove leading comma/dot/space
      schemeWithoutAMC = schemeWithoutAMC.replace(/\s+[-–—]\s*$/, '').trim(); // Remove trailing dash with spaces
      schemeWithoutAMC = schemeWithoutAMC.replace(/\s+[-–—]\s+[-–—]\s*$/, '').trim(); // Remove double trailing dashes
      schemeWithoutAMC = schemeWithoutAMC.replace(/\s+[-–—]+$/, '').trim(); // Remove any trailing dashes
      schemeWithoutAMC = schemeWithoutAMC.replace(/\s+$/, '').trim(); // Remove trailing spaces
      
      const schemeName = skipNormalization
        ? schemeWithoutAMC
        : this.normalizeFundCategory(schemeWithoutAMC);

      return {
        amcName: foundAMC,
        schemeNameWithoutAMC: schemeName
      };
    } else {
      const parts = cleanedSchemeName.split(' ');
      if (parts.length >= 2) {
        const potentialAMC = parts.slice(0, 2).join(' ');
        const remainingScheme = parts.slice(2).join(' ');
        const schemeName = skipNormalization
          ? remainingScheme.trim()
          : this.normalizeFundCategory(remainingScheme.trim());
        return {
          amcName: potentialAMC,
          schemeNameWithoutAMC: schemeName
        };
      } else {
        const schemeName = skipNormalization
          ? cleanedSchemeName
          : this.normalizeFundCategory(cleanedSchemeName);
        return {
          amcName: skipNormalization ? 'Unknown Issuer' : 'Unknown AMC',
          schemeNameWithoutAMC: schemeName
        };
      }
    }
  }
  
  /**
   * Normalize fund categories to group similar fund types
   * This helps in consolidating similar funds like "Mid Cap Fund", "Midcap Fund", "Mid Cap Fund - Regular Plan", etc.
   */
  private normalizeFundCategory(schemeName: string): string {
    if (!schemeName) return schemeName;
    
    // Convert to lowercase for comparison
    const lowerSchemeName = schemeName.toLowerCase().trim();
    
    // Define patterns and their normalized equivalents
    const normalizationPatterns: { [key: string]: string } = {
      // Mid Cap variations
      'mid cap fund': 'Mid Cap Fund',
      'midcap fund': 'Mid Cap Fund',
      'mid cap fund - regular plan': 'Mid Cap Fund',
      'midcap fund - regular plan': 'Mid Cap Fund',
      'mid cap fund - growth': 'Mid Cap Fund',
      'midcap fund - growth': 'Mid Cap Fund',
      
      // Large Cap variations
      'large cap fund': 'Large Cap Fund',
      'largecap fund': 'Large Cap Fund',
      'large cap fund - regular plan': 'Large Cap Fund',
      'largecap fund - regular plan': 'Large Cap Fund',
      'large cap fund - growth': 'Large Cap Fund',
      'largecap fund - growth': 'Large Cap Fund',
      
      // Small Cap variations
      'small cap fund': 'Small Cap Fund',
      'smallcap fund': 'Small Cap Fund',
      'small cap fund - regular plan': 'Small Cap Fund',
      'smallcap fund - regular plan': 'Small Cap Fund',
      'small cap fund - growth': 'Small Cap Fund',
      'smallcap fund - growth': 'Small Cap Fund',
      
      // Nifty 50 variations
      'nifty 50 index fund': 'Nifty 50 Index Fund',
      'nifty50 index fund': 'Nifty 50 Index Fund',
      'nifty fifty index fund': 'Nifty 50 Index Fund',
      
      // Flexi Cap variations
      'flexi cap fund': 'Flexi Cap Fund',
      'flexicap fund': 'Flexi Cap Fund',
      'flexi cap fund - regular plan': 'Flexi Cap Fund',
      'flexicap fund - regular plan': 'Flexi Cap Fund',
      
      // Multi Cap variations
      'multi cap fund': 'Multi Cap Fund',
      'multicap fund': 'Multi Cap Fund',
      'multi cap fund - regular plan': 'Multi Cap Fund',
      'multicap fund - regular plan': 'Multi Cap Fund',
      
      // Aggressive Hybrid variations
      'aggressive hybrid fund': 'Aggressive Hybrid Fund',
      'aggressive hybrid fund - growth': 'Aggressive Hybrid Fund',
      
      // Dividend Yield variations
      'dividend yield fund': 'Dividend Yield Fund',
      
      // Focused Fund variations
      'focused fund': 'Focused Fund',
      'focused fund - growth': 'Focused Fund',
      
      // Power & Infrastructure variations
      'power & infra fund': 'Power & Infrastructure Fund',
      'power & infrastructure fund': 'Power & Infrastructure Fund',
      'power and infra fund': 'Power & Infrastructure Fund',
      'power infrastructure fund': 'Power & Infrastructure Fund',
      
      // Next 50 variations
      'nifty next 50 index fund': 'Nifty Next 50 Index Fund',
      'nifty next50 index fund': 'Nifty Next 50 Index Fund',
      
      // Sectoral variations
      'banking fund': 'Banking Fund',
      'technology fund': 'Technology Fund',
      'healthcare fund': 'Healthcare Fund',
      
      // Tax Saving / ELSS variations - NEW
      'elss tax saver fund': 'Tax Saving Fund',
      'elss tax saver fund regular plan': 'Tax Saving Fund',
      'elss tax saver fund direct plan': 'Tax Saving Fund',
      'elss tax saver fund growth': 'Tax Saving Fund',
      'elss tax saving fund': 'Tax Saving Fund',
      'elss tax saving fund regular plan': 'Tax Saving Fund',
      'elss tax saving fund direct plan': 'Tax Saving Fund',
      'elss tax saving fund growth': 'Tax Saving Fund',
      'elss fund': 'Tax Saving Fund',
      'elss fund regular plan': 'Tax Saving Fund',
      'elss fund direct plan': 'Tax Saving Fund',
      'elss fund growth': 'Tax Saving Fund',
      'tax saving fund': 'Tax Saving Fund',
      'tax saving fund regular plan': 'Tax Saving Fund',
      'tax saving fund direct plan': 'Tax Saving Fund',
      'tax saving fund growth': 'Tax Saving Fund',
      'tax saver fund': 'Tax Saving Fund',
      'tax saver fund regular plan': 'Tax Saving Fund',
      'tax saver fund direct plan': 'Tax Saving Fund',
      'tax saver fund growth': 'Tax Saving Fund',
      'tax saving elss fund': 'Tax Saving Fund',
      'elss tax saver': 'Tax Saving Fund',
      'elss tax saving': 'Tax Saving Fund',
      'tax saving elss': 'Tax Saving Fund',
      'tax saver elss': 'Tax Saving Fund',
      'elss': 'Tax Saving Fund',
      'tax saver': 'Tax Saving Fund',
      'tax saving': 'Tax Saving Fund',
      
      // Liquid variations
      'liquid fund': 'Liquid Fund',
      'liquid fund - regular plan': 'Liquid Fund',
      
      // Equity variations
      'equity fund': 'Equity Fund',
      'equity fund - regular plan': 'Equity Fund',
      
      // Debt variations
      'debt fund': 'Debt Fund',
      'debt fund - regular plan': 'Debt Fund',
      
      // Balanced/Hybrid variations
      'balanced fund': 'Balanced Fund',
      'balanced advantage fund': 'Balanced Advantage Fund',
      'hybrid fund': 'Hybrid Fund',
      
      // Index variations
      'index fund': 'Index Fund',
      
      // International variations
      'international fund': 'International Fund',
      'global fund': 'International Fund',
      'world fund': 'International Fund',
      
      // Commodity variations
      'gold fund': 'Commodity Fund',
      'commodity fund': 'Commodity Fund',
      'metal fund': 'Commodity Fund',
      'silver fund': 'Commodity Fund',
    };
    
    // Check for exact matches first
    if (normalizationPatterns[lowerSchemeName]) {
      return normalizationPatterns[lowerSchemeName];
    }
    
    // Check for partial matches within the scheme name
    for (const [pattern, normalized] of Object.entries(normalizationPatterns)) {
      if (lowerSchemeName.includes(pattern)) {
        // Return the normalized version of the matched pattern
        return normalized;
      }
    }
    
    // If no specific pattern matched, try to normalize based on common endings
    if (lowerSchemeName.endsWith(' - regular plan') || lowerSchemeName.endsWith(' - direct plan') ||
        lowerSchemeName.endsWith(' - growth') || lowerSchemeName.endsWith(' - dividend')) {
      // Remove common endings that don't affect the fund category
      const cleaned = lowerSchemeName
        .replace(/\s*-\s*regular\s*plan\s*$/i, '')
        .replace(/\s*-\s*direct\s*plan\s*$/i, '')
        .replace(/\s*-\s*growth\s*$/i, '')
        .replace(/\s*-\s*dividend\s*$/i, '')
        .replace(/\s*-\s*income\s*option\s*$/i, '')
        .replace(/\s*-\s*wealth\s*option\s*$/i, '')
        .trim();
      
      // Recursively normalize the cleaned version
      return this.normalizeFundCategory(cleaned);
    }
    
    // If still no match, return the original name capitalized appropriately
    return schemeName.charAt(0).toUpperCase() + schemeName.slice(1);
  }

  private async processParsedData() {
    // First, collect all unique sub-type names and categories
    const uniqueSubTypeNames = new Map<string, string>(); // name -> investment_type
    const uniqueCategories = new Map<string, {category: string, investment_type: string}>(); // category -> {category, investment_type}
    
    // Collect unique values from parsed data
    for (const record of this.parsedData) {
      if (record.subTypeName && !uniqueSubTypeNames.has(record.subTypeName)) {
        uniqueSubTypeNames.set(record.subTypeName, this.investmentType);
      }
      if (record.subTypeCategory && !uniqueCategories.has(record.subTypeCategory)) {
        uniqueCategories.set(record.subTypeCategory, {
          category: record.subTypeCategory,
          investment_type: this.investmentType
        });
      }
    }
    
    // Create sub-type names in database
    for (const [name, investmentType] of uniqueSubTypeNames.entries()) {
      try {
        const subTypeName: SubTypeName = {
          name: name,
          investment_type: investmentType
        };
        await this.categoryService.createSubTypeName(subTypeName).toPromise();
        console.log(`Created sub-type name: ${name}`);
      } catch (error: any) {
        // Handle duplicate entry error gracefully
        if (error.status !== 409) { // 409 is conflict/duplicate
          console.error(`Error creating sub-type name ${name}:`, error);
        }
      }
    }
    
    // Create categories in database
    for (const categoryData of uniqueCategories.values()) {
      try {
        const category: Category = {
          category: categoryData.category,
          investment_type: categoryData.investment_type,
          sub_type_name_id: null
        };
        await this.categoryService.createCategory(category).toPromise();
        console.log(`Created category: ${categoryData.category}`);
      } catch (error: any) {
        // Handle duplicate entry error gracefully
        if (error.status !== 409) { // 409 is conflict/duplicate
          console.error(`Error creating category ${categoryData.category}:`, error);
        }
      }
    }
    
    // Process investments
    for (let i = 0; i < this.parsedData.length; i++) {
      const record = this.parsedData[i];
      this.uploadProgress = Math.floor(((i + 1) / this.parsedData.length) * 100);

      try {
        // Check if investment already exists based on platform, sub-type name, and sub-type category
        const existingInvestments = await this.investmentService.getByCriteria(
          this.platform,
          record.subTypeName,
          record.subTypeCategory
        ).toPromise();

        const matchingInvestments = existingInvestments?.filter(
          inv => inv.investment_type === this.investmentType
        ) || [];

        if (matchingInvestments.length > 0) {
          await this.updateExistingInvestment(matchingInvestments[0], record.presentValue);
        } else {
          // Create new investment with the aggregated value
          await this.createInvestment(record);
        }
      } catch (error) {
        console.error(`Error processing record ${record.schemeName}:`, error);
      }
    }
  }

  private async updateExistingInvestment(investment: any, newValue: number) {
    const updatedInvestment = {
      ...investment,
      amount: newValue,
      investment_date: this.getInvestmentDate(),
      notes: investment.notes || `Updated via import on ${new Date().toLocaleDateString()} - Total aggregated value from CSV`
    };

    try {
      await this.investmentService.update(investment.id, updatedInvestment).toPromise();
    } catch (error) {
      console.error('Error updating investment:', error);
      throw error;
    }
  }

  private async createInvestment(record: any) {
    const newInvestment = {
      website_app_name: this.platform,
      investment_type: this.investmentType,
      sub_type_name: record.subTypeName,
      sub_type_category: record.subTypeCategory,
      amount: record.presentValue,
      investment_date: this.getInvestmentDate(),
      notes: this.investmentType === 'ETF'
        ? `Imported from Dhan ETF CSV on ${new Date().toLocaleDateString()}`
        : `Imported from CSV on ${new Date().toLocaleDateString()} - Aggregated value from ${record.count || 1} folio${(record.count || 1) > 1 ? 's' : ''}: ${record.folioNo}`
    };

    try {
      await this.investmentService.create(newInvestment).toPromise();
    } catch (error) {
      console.error('Error creating investment:', error);
      throw error;
    }
  }

  private showMessage(msg: string, type: 'success' | 'error' | 'info') {
    this.message = msg;
    this.messageType = type;
    setTimeout(() => {
      if (this.message === msg) {
        this.message = '';
      }
    }, 5000);
  }
}