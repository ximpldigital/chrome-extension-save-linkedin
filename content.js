class LinkedInSaver {
  constructor() {
    this.isInjected = false;
    this.observer = null;
    this.init();
  }
  
  init() {
    // Wait for page to load
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.startObserving());
    } else {
      this.startObserving();
    }
  }
  
  startObserving() {
    // Initial injection
    this.injectSaveButtons();
    
    // Set up observer for dynamic content
    this.observer = new MutationObserver((mutations) => {
      let shouldInject = false;
      
      mutations.forEach((mutation) => {
        if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
          mutation.addedNodes.forEach((node) => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              // Check if new posts were added
              if (node.querySelector && (
                node.querySelector('[data-urn*="urn:li:activity"]') ||
                node.matches('[data-urn*="urn:li:activity"]')
              )) {
                shouldInject = true;
              }
            }
          });
        }
      });
      
      if (shouldInject) {
        // Debounce injection
        clearTimeout(this.injectionTimeout);
        this.injectionTimeout = setTimeout(() => {
          this.injectSaveButtons();
        }, 500);
      }
    });
    
    this.observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }
  
  injectSaveButtons() {
    // Find all LinkedIn posts that don't already have our button
    const posts = document.querySelectorAll('[data-urn*="urn:li:activity"]:not([data-saver-injected])');
    
    posts.forEach((post) => {
      this.injectSaveButton(post);
      post.setAttribute('data-saver-injected', 'true');
    });
  }
  
  injectSaveButton(post) {
    // Find the social actions bar (like, comment, repost buttons)
    const socialActions = post.querySelector('.social-actions-bar, [data-test-id="social-actions"], .feed-shared-social-action-bar');
    
    if (!socialActions) {
      // Fallback: look for any element containing reaction buttons
      const reactionButtons = post.querySelector('[aria-label*="Like"], [aria-label*="Comment"], [aria-label*="Repost"]');
      if (reactionButtons) {
        const actionsContainer = reactionButtons.closest('.feed-shared-social-action-bar, .social-actions-bar') || 
                               reactionButtons.parentElement;
        if (actionsContainer) {
          this.addSaveButton(actionsContainer, post);
        }
      }
      return;
    }
    
    this.addSaveButton(socialActions, post);
  }
  
  addSaveButton(container, post) {
    // Create save button
    const saveButton = document.createElement('button');
    saveButton.className = 'linkedin-saver-btn';
    saveButton.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <path d="M2 2h12v12H2V2zm1 1v10h10V3H3zm2 2h6v1H5V5zm0 2h6v1H5V7zm0 2h4v1H5V9z"/>
      </svg>
      Save to Sheet
    `;
    
    saveButton.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.savePost(post, saveButton);
    });
    
    // Create wrapper to match LinkedIn's button style
    const buttonWrapper = document.createElement('div');
    buttonWrapper.className = 'linkedin-saver-wrapper';
    buttonWrapper.appendChild(saveButton);
    
    // Insert the button
    container.appendChild(buttonWrapper);
  }
  
  async savePost(post, button) {
    try {
      // Show loading state
      const originalText = button.innerHTML;
      button.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" class="spinning">
          <path d="M8 0C3.58 0 0 3.58 0 8s3.58 8 8 8 8-3.58 8-8-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6s2.69-6 6-6 6 2.69 6 6-2.69 6-6 6z"/>
          <path d="M8 2v4l3 3"/>
        </svg>
        Saving...
      `;
      button.disabled = true;
      
      // Extract post data
      const postData = this.extractPostData(post);
      
      // Send to background script
      const response = await chrome.runtime.sendMessage({
        action: 'saveToSheet',
        data: postData
      });
      
      if (response.success) {
        // Show success state
        button.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M13.854 3.646a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.708 0l-3.5-3.5a.5.5 0 1 1 .708-.708L6.5 10.293l6.646-6.647a.5.5 0 0 1 .708 0z"/>
          </svg>
          Saved!
        `;
        
        // Reset after 2 seconds
        setTimeout(() => {
          button.innerHTML = originalText;
          button.disabled = false;
        }, 2000);
      } else {
        throw new Error(response.error || 'Failed to save post');
      }
    } catch (error) {
      console.error('Error saving post:', error);
      
      // Show error state
      button.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 0C3.58 0 0 3.58 0 8s3.58 8 8 8 8-3.58 8-8S12.42 0 8 0zm3.5 10.5L10.5 11.5 8 9l-2.5 2.5L4.5 10.5 7 8 4.5 5.5 5.5 4.5 8 7l2.5-2.5 1 1L9 8l2.5 2.5z"/>
        </svg>
        Error
      `;
      
      // Reset after 3 seconds
      setTimeout(() => {
        button.innerHTML = originalText;
        button.disabled = false;
      }, 3000);
    }
  }
  
  extractPostData(post) {
    const timestamp = new Date().toISOString();
    
    // Extract post content
    let content = '';
    const contentElement = post.querySelector('.feed-shared-text, .feed-shared-update-v2__description, [data-test-id="main-feed-activity-card"] .break-words');
    if (contentElement) {
      content = contentElement.textContent.trim();
    }
    
    // Extract engagement metrics
    let likes = 0;
    let comments = 0;
    let reposts = 0;
    
    // Try to find reaction counts
    const reactionButton = post.querySelector('[aria-label*="reaction"], .social-counts-reactions');
    if (reactionButton) {
      const reactionText = reactionButton.textContent || reactionButton.getAttribute('aria-label') || '';
      const reactionMatch = reactionText.match(/(\d+)/);
      if (reactionMatch) {
        likes = parseInt(reactionMatch[1], 10);
      }
    }
    
    // Try to find comment count
    const commentButton = post.querySelector('[aria-label*="comment"]');
    if (commentButton) {
      const commentText = commentButton.textContent || commentButton.getAttribute('aria-label') || '';
      const commentMatch = commentText.match(/(\d+)/);
      if (commentMatch) {
        comments = parseInt(commentMatch[1], 10);
      }
    }
    
    // Try to find repost count
    const repostButton = post.querySelector('[aria-label*="repost"], [aria-label*="share"]');
    if (repostButton) {
      const repostText = repostButton.textContent || repostButton.getAttribute('aria-label') || '';
      const repostMatch = repostText.match(/(\d+)/);
      if (repostMatch) {
        reposts = parseInt(repostMatch[1], 10);
      }
    }
    
    // Try to get post URL
    let url = '';
    const postLink = post.querySelector('a[href*="/feed/update/"]');
    if (postLink) {
      url = postLink.href;
    }
    
    return {
      timestamp,
      content: content.substring(0, 1000), // Limit content length
      likes,
      comments,
      reposts,
      url
    };
  }
  
  destroy() {
    if (this.observer) {
      this.observer.disconnect();
    }
    
    // Remove all injected buttons
    const buttons = document.querySelectorAll('.linkedin-saver-wrapper');
    buttons.forEach(button => button.remove());
  }
}

// Initialize the LinkedIn saver
let linkedInSaver;

// Handle page navigation (LinkedIn is a SPA)
let currentUrl = location.href;
const urlObserver = new MutationObserver(() => {
  if (location.href !== currentUrl) {
    currentUrl = location.href;
    
    // Destroy old instance and create new one
    if (linkedInSaver) {
      linkedInSaver.destroy();
    }
    
    // Wait a bit for the new page to load
    setTimeout(() => {
      linkedInSaver = new LinkedInSaver();
    }, 1000);
  }
});

urlObserver.observe(document, { subtree: true, childList: true });

// Initial load
linkedInSaver = new LinkedInSaver();