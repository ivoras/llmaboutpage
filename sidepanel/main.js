// Initialize Turndown for HTML to Markdown conversion
let turndownService;
if (typeof TurndownService !== 'undefined') {
  turndownService = new TurndownService({headingStyle: 'atx', codeBlockStyle: 'fenced'});
} else {
  console.error('Turndown library not loaded');
}

// State management
let chatHistory = [];
let currentStreamingMessage = null;
let currentMessageListener = null;
let isStreaming = false;
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
const stopButton = document.getElementById('stopButton');
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
    alert('Configuration parameters have been applied.');
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
        fullMessage = `${userMessage}\n\nThe content of the web page is provided in the section titled "Page". If the user references a "page", this is the page they are talking about. Use this information to answer the question.\n\n# Page\n\n${markdown}`;
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

// Stop streaming
stopButton.addEventListener('click', () => {
  stopStreaming();
});

// Clear chat
clearChatButton.addEventListener('click', () => {
  chatHistory = [];
  chatMessages.innerHTML = '';
  chrome.storage.local.remove('chatHistory');
});

// Get page content from active tab
async function getPageContent() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      return document.documentElement.outerHTML;
    }
  });

  return results[0].result;
}

// Convert HTML to Markdown
function convertHtmlToMarkdown(html) {
  if (!turndownService) {
    console.error('Turndown service not available');
    return html;
  }

  // Remove script tags, style tags, and inline images (data URLs)
  html = html.replace(/<!--[\s\S]*?-->/gi, '');
  html = html.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '');
  html = html.replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, '');
  html = html.replace(/<img[\s\S]*?>/gi, '');
  console.log(html);

  try {
    var md = turndownService.turndown(html);
    md = md.replace(/\[]\(.+\)/gi, '');
    md = md.replace(/\[.+]\(#?\)/gi, '');
    console.log(md);
    return md;
  } catch (error) {
    console.error('Error converting HTML to Markdown:', error);
    return html;
  }
}

// Stop streaming
function stopStreaming() {
  if (!isStreaming) return;

  // Remove message listener
  if (currentMessageListener) {
    chrome.runtime.onMessage.removeListener(currentMessageListener);
    currentMessageListener = null;
  }

  // Send stop message to background
  chrome.runtime.sendMessage({ action: 'stopStream' });

  // Update UI
  if (currentStreamingMessage) {
    currentStreamingMessage.classList.remove('streaming');
    // Keep the partial response that was already received
    // Get text content by extracting from innerHTML (removing <br> tags and converting back to text)
    const currentText = currentStreamingMessage.textContent || currentStreamingMessage.innerText || '';
    if (currentText && currentText.trim()) {
      chatHistory.push({ role: 'assistant', content: currentText });
      saveChatHistory();
    } else {
      // Remove empty message if nothing was received
      currentStreamingMessage.remove();
    }
    currentStreamingMessage = null;
  }

  // Disable stop button
  isStreaming = false;
  stopButton.disabled = true;
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
  if (includePageEnabled) {
    messages.unshift({ role: 'system', content: 'You are a helpful assistent, answering questions about a web page. You are given a web page and a question. You need to answer the question using the information from the web page. Do not abridge or stop your answer early, answer with complete information. Do not create a summary of the page unless the user asks for one.' });
  }

  // Create assistant message placeholder
  const assistantMessageDiv = addMessage('assistant', '');
  assistantMessageDiv.classList.add('streaming');
  currentStreamingMessage = assistantMessageDiv;

  // Enable stop button
  isStreaming = true;
  stopButton.disabled = false;

  // Track start time for statistics
  const startTime = Date.now();
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
      if (!isStreaming) return; // Ignore messages if streaming was stopped

      if (message.action === 'streamChunk') {
        fullResponse += message.chunk;
        updateStreamingMessage(assistantMessageDiv, fullResponse);
      } else if (message.action === 'streamComplete') {
        fullResponse = message.fullResponse || fullResponse;
        assistantMessageDiv.classList.remove('streaming');
        chatHistory.push({ role: 'assistant', content: fullResponse });

        // Calculate execution time
        const executionTime = ((Date.now() - startTime) / 1000).toFixed(2);

        // Get token statistics from message
        const stats = message.stats || {};
        const promptTokens = stats.promptTokens || 0;
        const completionTokens = stats.completionTokens || 0;
        const totalTokens = stats.totalTokens || (promptTokens + completionTokens);

        // Add statistics message
        addStatisticsMessage(executionTime, promptTokens, completionTokens, totalTokens);

        saveChatHistory();
        chrome.runtime.onMessage.removeListener(messageListener);
        currentMessageListener = null;
        // Disable stop button
        isStreaming = false;
        stopButton.disabled = true;
      } else if (message.action === 'streamError') {
        assistantMessageDiv.classList.remove('streaming');
        updateStreamingMessage(assistantMessageDiv, `Error: ${message.error}`);
        chrome.runtime.onMessage.removeListener(messageListener);
        currentMessageListener = null;
        // Disable stop button
        isStreaming = false;
        stopButton.disabled = true;
      }
    };

    currentMessageListener = messageListener;
    chrome.runtime.onMessage.addListener(messageListener);

  } catch (error) {
    console.error('Error streaming LLM response:', error);
    assistantMessageDiv.classList.remove('streaming');
    updateStreamingMessage(assistantMessageDiv, `Error: ${error.message}`);
        // Disable stop button
        isStreaming = false;
        stopButton.disabled = true;
    currentMessageListener = null;
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

// Add statistics message after LLM response
function addStatisticsMessage(executionTime, promptTokens, completionTokens, totalTokens) {
  const statsText = `⏱️ ${executionTime}s | ${promptTokens} prompt | ${completionTokens} gen | ${totalTokens} total`;
  const statsDiv = document.createElement('div');
  statsDiv.className = 'message stats';
  statsDiv.innerHTML = formatMessageText(statsText);
  chatMessages.appendChild(statsDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;
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
