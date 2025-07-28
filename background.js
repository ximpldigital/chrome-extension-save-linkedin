class BackgroundService {
  constructor() {
    this.CLIENT_ID = '326390162333-qf1jbs6v4hdcqsv4er8j09erl53diqcd.apps.googleusercontent.com';
    this.setupMessageListener();
  }
  
  setupMessageListener() {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      this.handleMessage(request, sender, sendResponse);
      return true; // Keep message channel open for async response
    });
  }
  
  async handleMessage(request, sender, sendResponse) {
    try {
      console.log('Background script received message:', request.action);
      
      switch (request.action) {
        case 'authenticate':
          const authResult = await this.authenticate();
          console.log('Authentication result:', authResult.success);
          sendResponse(authResult);
          break;
          
        case 'getSheets':
          const sheetsResult = await this.getSheets();
          console.log('Get sheets result:', sheetsResult.success);
          sendResponse(sheetsResult);
          break;
          
        case 'saveToSheet':
          console.log('Saving to sheet with data:', request.data);
          const saveResult = await this.saveToSheet(request.data);
          console.log('Save result:', saveResult.success);
          sendResponse(saveResult);
          break;
          
        default:
          console.error('Unknown action:', request.action);
          sendResponse({ success: false, error: 'Unknown action' });
      }
    } catch (error) {
      console.error('Background script error:', error);
      sendResponse({ success: false, error: error.message });
    }
  }
  
  async authenticate() {
    try {
      // Use Chrome's automatic redirect URL
      const redirectUrl = chrome.identity.getRedirectURL();
      
      const oauth2Url =
        'https://accounts.google.com/o/oauth2/auth' +
        '?client_id=' + this.CLIENT_ID +
        '&redirect_uri=' + encodeURIComponent(redirectUrl) +
        '&response_type=token' +
        '&scope=' +
        encodeURIComponent('https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive') +
        '&prompt=consent';
      
      console.log('Redirect URL:', redirectUrl);
      console.log('OAuth2 URL:', oauth2Url);

      const token = await new Promise((resolve, reject) => {
        chrome.identity.launchWebAuthFlow(
          {
            url: oauth2Url,
            interactive: true
          },
          function (redirectUrl) {
            if (chrome.runtime.lastError) {
              console.error('Auth error:', chrome.runtime.lastError.message);
              reject(new Error(chrome.runtime.lastError.message));
              return;
            }

            if (!redirectUrl) {
              reject(new Error('No redirect URL received'));
              return;
            }

            console.log('Redirect URL:', redirectUrl);

            // Extract access token from redirect URL
            const tokenMatch = redirectUrl.match(/access_token=([^&]+)/);
            const accessToken = tokenMatch ? tokenMatch[1] : null;

            if (!accessToken) {
              reject(new Error('No access token found in redirect URL'));
              return;
            }

            console.log('Access Token extracted successfully');
            resolve(accessToken);
          }
        );
      });
      
      // Store the token
      await chrome.storage.local.set({ accessToken: token });
      
      return { success: true, token };
    } catch (error) {
      console.error('Authentication error:', error);
      return { success: false, error: error.message };
    }
  }
  
  async getSheets() {
    try {
      const { accessToken } = await chrome.storage.local.get(['accessToken']);
      
      if (!accessToken) {
        throw new Error('No access token found');
      }
      
      const response = await fetch('https://www.googleapis.com/drive/v3/files?q=mimeType="application/vnd.google-apps.spreadsheet"&pageSize=50', {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) {
        if (response.status === 401) {
          // Token expired or invalid, clear it
          await chrome.storage.local.remove(['accessToken']);
          throw new Error('Authentication expired. Please reconnect.');
        }
        throw new Error(`Failed to fetch sheets: ${response.statusText}`);
      }
      
      const data = await response.json();
      const sheets = data.files.map(file => ({
        id: file.id,
        name: file.name
      }));
      
      return { success: true, sheets };
    } catch (error) {
      console.error('Error getting sheets:', error);
      return { success: false, error: error.message };
    }
  }
  
  async saveToSheet(postData) {
    try {
      const { accessToken, selectedSheet } = await chrome.storage.local.get(['accessToken', 'selectedSheet']);
      
      if (!accessToken) {
        throw new Error('No access token found');
      }
      
      if (!selectedSheet) {
        throw new Error('No sheet selected');
      }
      
      // First, ensure the sheet has headers
      await this.ensureHeaders(accessToken, selectedSheet.id);
      
      // Prepare the row data
      const rowData = [
        postData.timestamp,
        postData.content,
        postData.likes,
        postData.comments,
        postData.reposts,
        postData.url || ''
      ];
      
      // Append the data to the sheet
      const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${selectedSheet.id}/values/Sheet1:append?valueInputOption=RAW`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          values: [rowData]
        })
      });
      
      if (!response.ok) {
        if (response.status === 401) {
          // Token expired or invalid, clear it
          await chrome.storage.local.remove(['accessToken']);
          throw new Error('Authentication expired. Please reconnect.');
        }
        if (response.status === 403) {
          const errorData = await response.json().catch(() => ({}));
          if (errorData.error && errorData.error.message && errorData.error.message.includes('rate limit')) {
            throw new Error('Rate limit exceeded. Please wait a moment and try again.');
          }
          throw new Error('Permission denied. Please check your Google Sheets permissions.');
        }
        throw new Error(`Failed to save to sheet: ${response.statusText}`);
      }
      
      return { success: true };
    } catch (error) {
      console.error('Error saving to sheet:', error);
      return { success: false, error: error.message };
    }
  }
  
  async ensureHeaders(accessToken, sheetId) {
    try {
      // Check if the first row has headers
      const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Sheet1!A1:F1`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) {
        if (response.status === 401) {
          await chrome.storage.local.remove(['accessToken']);
          throw new Error('Authentication expired. Please reconnect.');
        }
        throw new Error('Failed to check headers');
      }
      
      const data = await response.json();
      
      // If no values or first row doesn't have our headers, add them
      if (!data.values || data.values.length === 0 || data.values[0][0] !== 'Timestamp') {
        const headers = ['Timestamp', 'Content', 'Likes', 'Comments', 'Reposts', 'URL'];
        
        const headerResponse = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Sheet1!A1:F1?valueInputOption=RAW`, {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            values: [headers]
          })
        });
        
        if (!headerResponse.ok) {
          if (headerResponse.status === 401) {
            await chrome.storage.local.remove(['accessToken']);
            throw new Error('Authentication expired. Please reconnect.');
          }
        }
      }
    } catch (error) {
      console.error('Error ensuring headers:', error);
      // Don't throw here, as this is not critical
    }
  }
}

// Initialize background service
new BackgroundService();