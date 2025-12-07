// Initialize Turndown for HTML to Markdown conversion
let turndownService;
if (typeof TurndownService !== 'undefined') {
  turndownService = new TurndownService();
} else {
  console.error('Turndown library not loaded');
}

// State management
let chatHistory = [];
let currentStreamingMessage = null;
let settings = {
  baseUrl: 'http://localhost:11434',
  modelName: 'granite4:3b',
  apiKey: ''
};

// UI Elements
const baseUrlInput = document.getElementById('baseUrl');
const modelNameInput = document.getElementById('modelName');
const apiKeyInput = document.getElementById('apiKey');
const saveConfigButton = document.getElementById('saveConfig');
const messageInput = document.getElementById('messageInput');
const sendButton = document.getElementById('sendButton');
const retryButton = document.getElementById('retryButton');
const includePageButton = document.getElementById('includePageButton');
const sendOnEnterButton = document.getElementById('sendOnEnterButton');
const clearChatButton = document.getElementById('clearChatButton');
const chatMessages = document.getElementById('chatMessages');

// Initialize settings from storage
chrome.storage.local.get(['llmSettings', 'chatHistory'], (result) => {
  if (result.llmSettings) {
    settings = { ...settings, ...result.llmSettings };
    baseUrlInput.value = settings.baseUrl;
    modelNameInput.value = settings.modelName;
    apiKeyInput.value = settings.apiKey || '';
  }

  if (result.chatHistory) {
    chatHistory = result.chatHistory;
    renderChatHistory();
  }
});

// Save configuration
saveConfigButton.addEventListener('click', () => {
  settings.baseUrl = baseUrlInput.value.trim();
  settings.modelName = modelNameInput.value.trim();
  settings.apiKey = apiKeyInput.value.trim();

  chrome.storage.local.set({ llmSettings: settings }, () => {
    showNotification('Configuration saved!');
  });
});

// Toggle buttons
let includePageEnabled = true; // Enabled by default
let sendOnEnterEnabled = true;

// Set initial state for include page button
includePageButton.classList.add('active');

includePageButton.addEventListener('click', () => {
  includePageEnabled = !includePageEnabled;
  includePageButton.classList.toggle('active', includePageEnabled);
});

sendOnEnterButton.addEventListener('click', () => {
  sendOnEnterEnabled = !sendOnEnterEnabled;
  sendOnEnterButton.classList.toggle('active', sendOnEnterEnabled);
});

// Enter key handling
messageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && sendOnEnterEnabled) {
    e.preventDefault();
    sendMessage();
  }
});

// Send message
sendButton.addEventListener('click', sendMessage);

async function sendMessage() {
  const userMessage = messageInput.value.trim();
  if (!userMessage) return;

  // Clear input
  messageInput.value = '';

  // Add user message to chat
  addMessage('user', userMessage);

  // Get page content if enabled
  let fullMessage = userMessage;
  if (includePageEnabled) {
    try {
      const pageContent = await getPageContent();
      if (pageContent) {
        const markdown = convertHtmlToMarkdown(pageContent);
        fullMessage = `${userMessage}\n\nUse information from the web page in the section titled "Page" to answer the question. To not abridge or stop your answer early, answer with complete information.\n\n# Page\n\n${markdown}`;
        console.log(fullMessage);
      }
    } catch (error) {
      console.error('Error getting page content:', error, JSON.stringify(error));
    }
  }

  // Add to history
  chatHistory.push({ role: 'user', content: fullMessage });

  // Send to LLM
  await streamLLMResponse(fullMessage);

  // Save chat history
  saveChatHistory();
}

// Retry last message
retryButton.addEventListener('click', async () => {
  if (chatHistory.length === 0) return;

  // Find last user message
  let lastUserMessage = null;
  for (let i = chatHistory.length - 1; i >= 0; i--) {
    if (chatHistory[i].role === 'user') {
      lastUserMessage = chatHistory[i].content;
      break;
    }
  }

  if (!lastUserMessage) return;

  // Remove last assistant response if exists
  if (chatHistory.length > 0 && chatHistory[chatHistory.length - 1].role === 'assistant') {
    chatHistory.pop();
    // Remove from UI
    const lastMessage = chatMessages.lastElementChild;
    if (lastMessage && lastMessage.classList.contains('assistant')) {
      lastMessage.remove();
    }
  }

  // Resend
  await streamLLMResponse(lastUserMessage);
  saveChatHistory();
});

// Clear chat
clearChatButton.addEventListener('click', () => {
  if (confirm('Clear all chat messages?')) {
    chatHistory = [];
    chatMessages.innerHTML = '';
    chrome.storage.local.remove('chatHistory');
  }
});

// Get page content from active tab
async function getPageContent() {
/*
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs.length === 0) {
        reject(new Error('No active tab'));
        return;
      }

      chrome.tabs.sendMessage(tabs[0].id, { action: 'getDOM' }, (response) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(response?.html || null);
        }
      });
    });
  });¸
  */
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      return document.documentElement.outerHTML;
    }
  });

  console.log(results[0].result); // The DOM HTML
  return results[0].result;
}

// Convert HTML to Markdown
function convertHtmlToMarkdown(html) {
  if (!turndownService) {
    console.error('Turndown service not available');
    return html;
  }

  try {
    return turndownService.turndown(html);
  } catch (error) {
    console.error('Error converting HTML to Markdown:', error);
    return html;
  }
}

// Stream LLM response
async function streamLLMResponse(userMessage) {
  // Prepare messages for API
  const messages = chatHistory
    .filter(msg => msg.role === 'user' || msg.role === 'assistant')
    .map(msg => ({ role: msg.role, content: msg.content }));

  // Add current user message if not already in history
  if (messages.length === 0 || messages[messages.length - 1].content !== userMessage) {
    messages.push({ role: 'user', content: userMessage });
  }

  // Create assistant message placeholder
  const assistantMessageDiv = addMessage('assistant', '');
  assistantMessageDiv.classList.add('streaming');
  currentStreamingMessage = assistantMessageDiv;

  let fullResponse = '';

  try {
    // Send request to background service worker
    chrome.runtime.sendMessage({
      action: 'streamLLM',
      url: settings.baseUrl,
      model: settings.modelName,
      apiKey: settings.apiKey,
      messages: messages
    }, (response) => {
      if (chrome.runtime.lastError) {
        throw new Error(chrome.runtime.lastError.message);
      }
    });

    // Listen for streaming chunks
    const messageListener = (message, sender, sendResponse) => {
      if (message.action === 'streamChunk') {
        fullResponse += message.chunk;
        updateStreamingMessage(assistantMessageDiv, fullResponse);
      } else if (message.action === 'streamComplete') {
        fullResponse = message.fullResponse || fullResponse;
        assistantMessageDiv.classList.remove('streaming');
        chatHistory.push({ role: 'assistant', content: fullResponse });
        saveChatHistory();
        chrome.runtime.onMessage.removeListener(messageListener);
      } else if (message.action === 'streamError') {
        assistantMessageDiv.classList.remove('streaming');
        updateStreamingMessage(assistantMessageDiv, `Error: ${message.error}`);
        chrome.runtime.onMessage.removeListener(messageListener);
      }
    };

    chrome.runtime.onMessage.addListener(messageListener);

  } catch (error) {
    console.error('Error streaming LLM response:', error);
    assistantMessageDiv.classList.remove('streaming');
    updateStreamingMessage(assistantMessageDiv, `Error: ${error.message}`);
  }
}

// Escape HTML and convert newlines to <br> tags
function formatMessageText(text) {
  if (!text) return '';
  // Escape HTML to prevent XSS attacks
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
  // Convert newlines to <br> tags
  return escaped.replace(/\n/g, '<br>');
}

// Update streaming message
function updateStreamingMessage(element, text) {
  element.innerHTML = formatMessageText(text);
  // Auto-scroll to bottom
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Add message to chat
function addMessage(role, content) {
  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${role}`;
  messageDiv.innerHTML = formatMessageText(content);
  chatMessages.appendChild(messageDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return messageDiv;
}

// Render chat history
function renderChatHistory() {
  chatMessages.innerHTML = '';
  chatHistory.forEach(msg => {
    if (msg.role === 'user' || msg.role === 'assistant') {
      addMessage(msg.role, msg.content);
    }
  });
}

// Save chat history
function saveChatHistory() {
  chrome.storage.local.set({ chatHistory: chatHistory });
}

// Show notification
function showNotification(message) {
  // Simple notification - could be enhanced with a toast
  console.log(message);
}
