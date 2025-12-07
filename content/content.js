// Content script to extract page HTML
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getPageContent') {
    try {
      // Get the body element's innerHTML
      const bodyHTML = document.body ? document.body.innerHTML : '';
      sendResponse({ html: bodyHTML });
    } catch (error) {
      console.error('Error extracting page content:', error);
      sendResponse({ html: null, error: error.message });
    }
    return true; // Keep the message channel open for async response
  }
});
