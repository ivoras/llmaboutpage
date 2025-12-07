// Background service worker for API communication

// Listen for streaming requests
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'streamLLM') {
    streamLLMRequest(request, sender.tab?.id || sender.id)
      .catch(error => {
        chrome.runtime.sendMessage({
          action: 'streamError',
          error: error.message
        });
      });
    return true; // Keep channel open
  }
});

async function streamLLMRequest(request, tabId) {
  const { url, model, apiKey, messages } = request;

  // Construct API URL - support both OpenAI and Ollama formats
  const apiUrl = url.endsWith('/v1/chat/completions')
    ? `${url}`
    : `${url.replace(/\/$/, '')}/v1/chat/completions`;

  // Prepare request body
  const requestBody = {
    model: model,
    messages: messages,
    stream: true
  };

  // Prepare headers
  const headers = {
    'Content-Type': 'application/json'
  };

  // Add API key if provided (for OpenAI) or Authorization header for Ollama
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API Error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    // Handle streaming response
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullResponse = '';

    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        // Send final complete message
        chrome.runtime.sendMessage({
          action: 'streamComplete',
          fullResponse: fullResponse
        });
        break;
      }

      // Decode chunk
      buffer += decoder.decode(value, { stream: true });

      // Process complete lines
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer

      for (const line of lines) {
        if (line.trim() === '') continue;
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') {
            chrome.runtime.sendMessage({
              action: 'streamComplete',
              fullResponse: fullResponse
            });
            return;
          }

          try {
            const json = JSON.parse(data);
            const delta = json.choices?.[0]?.delta;
            if (delta?.content) {
              const chunk = delta.content;
              fullResponse += chunk;

              // Send chunk to side panel
              chrome.runtime.sendMessage({
                action: 'streamChunk',
                chunk: chunk
              });
            }
          } catch (e) {
            // Skip invalid JSON lines
            console.warn('Failed to parse SSE data:', data, e);
          }
        }
      }
    }
  } catch (error) {
    console.error('Streaming error:', error);
    chrome.runtime.sendMessage({
      action: 'streamError',
      error: error.message
    });
  }
}

// Handle side panel opening on install
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setOptions({
    path: 'sidepanel/index.html',
    enabled: true
  });
});

// Open side panel when extension icon is clicked
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
});
