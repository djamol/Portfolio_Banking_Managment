import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { InvestmentService } from '../../services/investment.service';

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

  // Comprehensive list of AMC names - Order matters: longer names first
  private amcs = [
    // Longest names first
    'Aditya Birla Sun Life', 
    'Bank of India', 
    'ICICI Prudential', 
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

  constructor(private investmentService: InvestmentService) {}

  ngOnInit() {
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

    if (this.investmentType !== 'Mutual Fund') {
      this.showMessage('Currently only Mutual Fund imports are supported.', 'error');
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
        // Prepare preview data
        this.previewData = this.parsedData.map(record => ({
          folioNo: record.folioNo,
          originalSchemeName: record.originalSchemeName || record.schemeName,
          extractedAMC: record.subTypeName,
          extractedScheme: record.subTypeCategory,
          presentValue: record.presentValue
        }));
        
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
      this.showMessage('Please enter a platform/website/app name.', 'error');
      return;
    }

    if (this.investmentType !== 'Mutual Fund') {
      this.showMessage('Currently only Mutual Fund imports are supported.', 'error');
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
    // Split the text into lines
    const lines = csvText.split('\n');
    this.parsedData = [];

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

  private extractAMCAndScheme(fullSchemeName: string) {
    // Clean the scheme name first
    let cleanedSchemeName = this.cleanSchemeName(fullSchemeName);
    
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
      
      return {
        amcName: foundAMC,
        schemeNameWithoutAMC: schemeWithoutAMC
      };
    } else {
      // If no known AMC found, try to extract the first few words as potential AMC
      const parts = cleanedSchemeName.split(' ');
      if (parts.length >= 2) {
        // Take the first two words as potential AMC name
        const potentialAMC = parts.slice(0, 2).join(' ');
        const remainingScheme = parts.slice(2).join(' ');
        return {
          amcName: potentialAMC,
          schemeNameWithoutAMC: remainingScheme.trim()
        };
      } else {
        // If only one word, treat it as the scheme name and use a generic placeholder for AMC
        return {
          amcName: 'Unknown AMC',
          schemeNameWithoutAMC: cleanedSchemeName
        };
      }
    }
  }

  private async processParsedData() {
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

        if (existingInvestments && existingInvestments.length > 0) {
          // Update existing investment with the aggregated value
          await this.updateExistingInvestment(existingInvestments[0], record.presentValue);
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
      investment_date: new Date().toISOString().split('T')[0],
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
      investment_date: new Date().toISOString().split('T')[0],
      notes: `Imported from CSV on ${new Date().toLocaleDateString()} - Aggregated value from ${record.count || 1} folio${(record.count || 1) > 1 ? 's' : ''}: ${record.folioNo}`
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