class PopupManager {
  constructor() {
    this.authBtn = document.getElementById('auth-btn');
    this.disconnectBtn = document.getElementById('disconnect-btn');
    this.refreshSheetsBtn = document.getElementById('refresh-sheets');
    this.sheetSelect = document.getElementById('sheet-select');
    this.statusMessage = document.getElementById('status-message');
    this.authSection = document.getElementById('auth-section');
    this.sheetSection = document.getElementById('sheet-section');
    this.loading = document.getElementById('loading');
    
    this.init();
  }
  
  async init() {
    this.setupEventListeners();
    await this.checkAuthStatus();
  }
  
  setupEventListeners() {
    this.authBtn.addEventListener('click', () => this.authenticate());
    this.disconnectBtn.addEventListener('click', () => this.disconnect());
    this.refreshSheetsBtn.addEventListener('click', () => this.loadSheets());
    this.sheetSelect.addEventListener('change', () => this.saveSelectedSheet());
  }
  
  showLoading(show = true) {
    this.loading.style.display = show ? 'block' : 'none';
    this.authSection.style.display = show ? 'none' : 'block';
    this.sheetSection.style.display = show ? 'none' : 'none';
  }
  
  showStatus(message, type = 'success') {
    this.statusMessage.innerHTML = `<div class="status ${type}">${message}</div>`;
    setTimeout(() => {
      this.statusMessage.innerHTML = '';
    }, 5000);
  }
  
  async checkAuthStatus() {
    try {
      const result = await chrome.storage.local.get(['accessToken', 'selectedSheet']);
      
      if (result.accessToken) {
        this.authSection.style.display = 'none';
        this.sheetSection.style.display = 'block';
        await this.loadSheets();
        
        if (result.selectedSheet) {
          this.sheetSelect.value = result.selectedSheet.id;
          this.showStatus(`Connected to: ${result.selectedSheet.name}`, 'success');
        }
      } else {
        this.authSection.style.display = 'block';
        this.sheetSection.style.display = 'none';
      }
    } catch (error) {
      console.error('Error checking auth status:', error);
      this.showStatus('Error checking authentication status', 'error');
    }
  }
  
  async authenticate() {
    try {
      this.showLoading(true);
      this.authBtn.disabled = true;
      
      const response = await chrome.runtime.sendMessage({
        action: 'authenticate'
      });
      
      if (response.success) {
        this.showLoading(false);
        this.authSection.style.display = 'none';
        this.sheetSection.style.display = 'block';
        await this.loadSheets();
        this.showStatus('Successfully connected to Google!', 'success');
      } else {
        throw new Error(response.error || 'Authentication failed');
      }
    } catch (error) {
      console.error('Authentication error:', error);
      this.showLoading(false);
      this.showStatus(`Authentication failed: ${error.message}`, 'error');
    } finally {
      this.authBtn.disabled = false;
    }
  }
  
  async loadSheets() {
    try {
      this.refreshSheetsBtn.disabled = true;
      this.refreshSheetsBtn.textContent = 'Loading...';
      
      const response = await chrome.runtime.sendMessage({
        action: 'getSheets'
      });
      
      if (response.success) {
        this.populateSheetSelect(response.sheets);
      } else {
        throw new Error(response.error || 'Failed to load sheets');
      }
    } catch (error) {
      console.error('Error loading sheets:', error);
      this.showStatus(`Failed to load sheets: ${error.message}`, 'error');
    } finally {
      this.refreshSheetsBtn.disabled = false;
      this.refreshSheetsBtn.textContent = 'Refresh Sheets';
    }
  }
  
  populateSheetSelect(sheets) {
    this.sheetSelect.innerHTML = '<option value="">Choose a sheet...</option>';
    
    sheets.forEach(sheet => {
      const option = document.createElement('option');
      option.value = sheet.id;
      option.textContent = sheet.name;
      this.sheetSelect.appendChild(option);
    });
  }
  
  async saveSelectedSheet() {
    const selectedId = this.sheetSelect.value;
    if (!selectedId) return;
    
    const selectedText = this.sheetSelect.options[this.sheetSelect.selectedIndex].text;
    
    try {
      await chrome.storage.local.set({
        selectedSheet: {
          id: selectedId,
          name: selectedText
        }
      });
      
      this.showStatus(`Sheet selected: ${selectedText}`, 'success');
    } catch (error) {
      console.error('Error saving selected sheet:', error);
      this.showStatus('Failed to save sheet selection', 'error');
    }
  }
  
  async disconnect() {
    try {
      await chrome.storage.local.clear();
      this.authSection.style.display = 'block';
      this.sheetSection.style.display = 'none';
      this.showStatus('Disconnected successfully', 'success');
    } catch (error) {
      console.error('Error disconnecting:', error);
      this.showStatus('Error disconnecting', 'error');
    }
  }
}

// Initialize popup when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new PopupManager();
});