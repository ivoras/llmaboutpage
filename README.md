# "Ask LLM about a page" Chrome Extension

A Chrome browser extension that provides a sidebar interface for chatting with LLMs via OpenAI-compatible APIs, with support for including current page content.

Version 0.1-beta

## Features

- **Side Panel Interface**: Modern Material Design sidebar for LLM interaction
- **LLM Configuration**: Configure base URL, model name, and API key
- **Chat Interface**: Full chat history with streaming responses
- **Page Content Inclusion**: Optionally convert current page HTML to Markdown and include in prompts
- **Settings Persistence**: All settings saved to browser local storage
- **Streaming Responses**: Real-time display of LLM responses
- **No Remote Dependencies**: All libraries bundled locally

### Why this exists?

This Chrome extension exists because I couldn't get Page Assist to include the entire page's content into the LLM prompt, and I needed that to analyze some reports. This extension gets the current page's rendered HTML (including whatever was done to the DOM in JavaScript, which covers SPA), converts it to Markdown, and sends it with your question into the prompt. Here are some examples that work with this extension, but don't work with Page Assist:

- Load [news.ycombinator.dom](https://news.ycombinator.com), ask questions like: "What's the 20th news item", or "List all news items created by the user 'tosh'".
- Load a GitHub org list of repos [like this one](https://github.com/orgs/ggml-org/repositories), ask a question: "List all repos on this page ordered alphabetically by their name"

**Notes:**

- You should manually clear the chat history when asking something about a new page.
- Models need to support however long the page is. A 16k context is realistically the minimum.
- I've tested this mostly with the `qwen3-coder:30b` model with Ollama, with context size increased to 32k. It works really nice.

### Obligatory screenshot

<img width="800" alt="screenshot" src="https://github.com/user-attachments/assets/1ff5088d-ab7f-4e2b-8aeb-1d4792ddeddb" />

## Installation

Clone this repo, and skip to "Load Extension in Chrome", or ...

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Build Dependencies**:
   ```bash
   npm run build
   ```
   This copies the Turndown library to the `lib/` directory.

3. **Generate Icons**:
   - Open `icons/generate-icons.html` in a web browser
   - The required icon files will be automatically downloaded
   - Place them in the `icons/` directory:
     - `icon-16.png`
     - `icon-48.png`
     - `icon-128.png`

4. **Load Extension in Chrome**:
   - Open Chrome and navigate to `chrome://extensions/`
   - Enable "Developer mode" (toggle in top right)
   - Click "Load unpacked"
   - Select the extension directory

## Configuration

### Default Settings
- **Base URL**: `http://localhost:11434` (Ollama default)
- **Model**: `granite4:3b`
- **API Key**: Optional (not required for Ollama)

### Using with Ollama

1. Make sure Ollama is running locally
2. Ensure the model `granite4:3b` is installed:
   ```bash
   ollama pull granite4:3b
   ```
3. Add the following environment variable to your OS environment: `OLLAMA_ORIGINS=chrome-extension://*,moz-extension://*,safari-web-extension://*`
4. Optionally, add also this one, which should improve performance: `OLLAMA_FLASH_ATTENTION=1`, and if you're running on Intel or AMD GPUs, this one: `OLLAMA_VULKAN=1`

**The 'Include Page Content' mode uses a large amount of prompt context!** Using Ollama models with at least 16k context is usually required for modern pages, and 32k is probably the sweet spot.
See [this tutorial](https://localllm.in/blog/local-llm-increase-context-length-ollama) on how to do that.

### Using with OpenAI API

1. Set Base URL to: `https://api.openai.com`
2. Enter your OpenAI API key
3. Set Model Name to: `gpt-3.5-turbo` or `gpt-4`

## Usage

1. **Open the Side Panel**:
   - Click the extension icon in the Chrome toolbar
   - Or use the extension's action button

2. **Configure LLM**:
   - Enter your LLM configuration in the top section
   - Click "Save Configuration"

3. **Chat**:
   - Type your message in the input box
   - Click "Send" or press Enter (if enabled)
   - View streaming responses in real-time

4. **Include Page Content**:
   - Click the document icon (📄) to enable/disable
   - When enabled, the current page's content will be converted to Markdown and included in your prompt

5. **Other Controls**:
   - **Retry** (⟳): Resend the last user message
   - **Send on Enter** (↩): Toggle Enter key to send messages
   - **Clear Chat** (⊘): Clear all chat messages

## Project Structure

```
.
├── manifest.json              # Extension manifest
├── package.json               # Dependencies
├── sidepanel/
│   ├── index.html            # Side panel UI
│   ├── styles.css            # Material Design styles
│   └── main.js               # Side panel logic
├── content/
│   └── content.js            # Content script for page extraction
├── background/
│   └── service-worker.js     # Background service worker
├── lib/
│   └── turndown/            # HTML to Markdown converter
└── icons/                   # Extension icons
```

## Requirements

- Chrome 114+ (for Side Panel API support)
- Node.js and npm (for building)
- Ollama (for local LLM) or OpenAI API key

## Development

To modify the extension:

1. Make your changes to the source files
2. Run `npm run build` to update dependencies if needed
3. Reload the extension in Chrome (`chrome://extensions/` → click reload icon)

## License

MIT

## Useless information

Vibe-coded in a third world country (according to Google, which doesn't let me register as a Chrome developer from Croatia) with love, in one afternoon. Bugs are expected.

Until Google adds Croatia on the list of supported countries, the only way to install this Chrome extension is manually - described above.
