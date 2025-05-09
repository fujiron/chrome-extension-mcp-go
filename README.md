# Chrome Extension MCP Server (Go Version)

A Go implementation of the Model Context Protocol (MCP) server for Chrome Extension API, enabling Claude to interact with Chrome browser extensions.

## Overview

This project is a Go implementation of the [original TypeScript version](https://github.com/tesla0225/chromeextension) of the Chrome Extension MCP Server. It provides a WebSocket server that bridges the Claude AI with Chrome extensions, allowing Claude to perform various browser operations through the Chrome API.

## Features

- WebSocket server for Chrome extension communication
- Support for Model Context Protocol (MCP)
- Various Chrome browser operations through tools:
  - Tab management
  - DOM manipulation
  - CSS injection
  - Extension management
  - Cookie access
  - Screenshot capture
  - And more

## Installation

### 1. Install Chrome Extension

#### Using Docker
1. Build and run the Docker container:
```bash
docker build -t mcp/chromeextension-go .
docker run -i --rm mcp/chromeextension-go
```

2. Extract the extension package (if not already available):
```bash
docker cp $(docker ps -q -f ancestor=mcp/chromeextension-go):/app/extension extension
```

3. Install in Chrome:
   - Open Chrome and go to `chrome://extensions/`
   - Enable "Developer mode" in the top right
   - Click "Load unpacked" and select the extracted extension directory

#### Manual Installation
1. Navigate to the extension directory:
```bash
cd extension
```

2. Load in Chrome:
   - Open Chrome and go to `chrome://extensions/`
   - Enable "Developer mode" in the top right
   - Click "Load unpacked" and select the extension directory

### 2. Running the Server

#### From Source
```bash
go run main.go
```

#### Using Binary
```bash
go build
./chrome-extension-mcp-go
```

### 3. Configure MCP Server for Claude

Add the following to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "chromeextension": {
      "command": "path/to/chrome-extension-mcp-go",
      "args": [],
      "env": {
        "CHROME_EXTENSION_ID": "your-extension-id"
      }
    }
  }
}
```

## Tools

This MCP server provides the following tools to Claude:

1. `chrome_get_active_tab`: Get information about the currently active tab
2. `chrome_get_all_tabs`: Get information about all open tabs
3. `chrome_execute_script`: Execute DOM operations in the context of a web page
4. `chrome_inject_css`: Inject CSS into a web page
5. `chrome_get_extension_info`: Get information about installed extensions
6. `chrome_send_message`: Send a message to an extension's background script
7. `chrome_get_cookies`: Get cookies for a specific domain
8. `chrome_capture_screenshot`: Take a screenshot of the current tab
9. `chrome_create_tab`: Create a new tab with specified URL and options

## License

This project is licensed under the MIT License.
