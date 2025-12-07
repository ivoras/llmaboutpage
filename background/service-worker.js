// Background service worker for API communication

// Track active streaming requests
let activeStreamController = null;

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
  } else if (request.action === 'stopStream') {
    if (activeStreamController) {
      activeStreamController.abort();
      activeStreamController = null;
    }
    return true;
  }
});

async function streamLLMRequest(request, tabId) {
  const { url, model, apiKey, messages } = request;

  // Construct API URL - support both OpenAI and Ollama formats
  var apiUrl = url;
  if (apiUrl.endsWith('/v1/chat/completions')) {
    // pass
  } else if (apiUrl.endsWith('/v1')) {
    apiUrl = apiUrl + '/chat/completions';
  } else {
    apiUrl = `${url.replace(/\/$/, '')}/v1/chat/completions`
  }

  // Prepare request body
  const requestBody = {
    model: model,
    messages: messages,
    stream: true,
    stream_options: {include_usage: true}
  };

  // Prepare headers
  const headers = {
    'Content-Type': 'application/json'
  };

  // Add API key if provided (for OpenAI) or Authorization header for Ollama
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  // Create AbortController for cancellation
  const abortController = new AbortController();
  activeStreamController = abortController;

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(requestBody),
      signal: abortController.signal
    });

    if (!response.ok) {
      const errorText = await response.text();
      alert(`API Error: ${response.status} ${response.statusText} - ${errorText}`)
      throw new Error(`API Error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    // Handle streaming response
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullResponse = '';
    let tokenStats = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0
    };

    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        // Send final complete message with statistics
        chrome.runtime.sendMessage({
          action: 'streamComplete',
          fullResponse: fullResponse,
          stats: tokenStats
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
              fullResponse: fullResponse,
              stats: tokenStats
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

            // Capture token usage if available
            if (json.usage) {
              tokenStats.promptTokens = json.usage.prompt_tokens || json.usage.promptTokens || 0;
              tokenStats.completionTokens = json.usage.completion_tokens || json.usage.completionTokens || 0;
              tokenStats.totalTokens = json.usage.total_tokens || json.usage.totalTokens || (tokenStats.promptTokens + tokenStats.completionTokens);
            }
          } catch (e) {
            // Skip invalid JSON lines
            console.warn('Failed to parse SSE data:', data, e);
          }
        }
      }
    }
  } catch (error) {
    // Don't send error if it was aborted
    if (error.name === 'AbortError') {
      activeStreamController = null;
      return;
    }
    console.error('Streaming error:', error);
    chrome.runtime.sendMessage({
      action: 'streamError',
      error: error.message
    });
    activeStreamController = null;
  } finally {
    activeStreamController = null;
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
