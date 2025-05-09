package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"log"
	"math/rand"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

const (
	PORT = 8765
)

// MCP Server struct
type MCPServer struct {
	Name    string `json:"name"`
	Version string `json:"version"`
}

// Tool represents a Chrome extension tool
type Tool struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	InputSchema json.RawMessage `json:"inputSchema"`
}

// Tool definitions
var (
	getActiveTabTool = Tool{
		Name:        "chrome_get_active_tab",
		Description: "Get information about the currently active tab",
		InputSchema: json.RawMessage(`{
			"type": "object",
			"properties": {}
		}`),
	}

	getAllTabsTool = Tool{
		Name:        "chrome_get_all_tabs",
		Description: "Get information about all open tabs",
		InputSchema: json.RawMessage(`{
			"type": "object",
			"properties": {}
		}`),
	}

	executeScriptTool = Tool{
		Name:        "chrome_execute_script",
		Description: "Execute DOM operations in the context of a web page",
		InputSchema: json.RawMessage(`{
			"type": "object",
			"properties": {
				"tab_id": {
					"type": "number",
					"description": "The ID of the target tab"
				},
				"operation": {
					"type": "object",
					"description": "DOM operation details",
					"required": ["action"],
					"properties": {
						"action": {
							"type": "string",
							"enum": [
								"querySelector",
								"querySelectorAll",
								"setText",
								"setHTML",
								"setAttribute",
								"removeAttribute",
								"addClass",
								"removeClass",
								"toggleClass",
								"createElement",
								"appendChild",
								"removeElement",
								"getPageInfo",
								"getElementsInfo",
								"log",
								"click"
							],
							"description": "The type of DOM operation to perform"
						},
						"selector": {
							"type": "string",
							"description": "CSS selector for targeting elements"
						},
						"value": {
							"type": ["string", "number", "boolean"],
							"description": "Value to set (for setText, setHTML, setAttribute, etc.)"
						},
						"attribute": {
							"type": "string",
							"description": "Attribute name for setAttribute/removeAttribute operations"
						},
						"tagName": {
							"type": "string",
							"description": "Tag name for createElement operation"
						},
						"attributes": {
							"type": "object",
							"description": "Attributes for createElement operation",
							"additionalProperties": {
								"type": ["string", "number", "boolean"]
							}
						},
						"innerText": {
							"type": "string",
							"description": "Inner text for createElement operation"
						},
						"elementId": {
							"type": "string",
							"description": "Element ID for appendChild operation"
						},
						"message": {
							"type": "string",
							"description": "Message for log operation"
						}
					}
				}
			},
			"required": ["tab_id", "operation"]
		}`),
	}

	injectCssTool = Tool{
		Name:        "chrome_inject_css",
		Description: "Inject CSS into a web page",
		InputSchema: json.RawMessage(`{
			"type": "object",
			"properties": {
				"tab_id": {
					"type": "number",
					"description": "The ID of the target tab"
				},
				"css": {
					"type": "string",
					"description": "CSS code to inject"
				}
			},
			"required": ["tab_id", "css"]
		}`),
	}

	getExtensionInfoTool = Tool{
		Name:        "chrome_get_extension_info",
		Description: "Get information about installed extensions",
		InputSchema: json.RawMessage(`{
			"type": "object",
			"properties": {
				"extension_id": {
					"type": "string",
					"description": "Specific extension ID to query"
				}
			}
		}`),
	}

	sendMessageTool = Tool{
		Name:        "chrome_send_message",
		Description: "Send a message to an extension's background script",
		InputSchema: json.RawMessage(`{
			"type": "object",
			"properties": {
				"extension_id": {
					"type": "string",
					"description": "Target extension ID"
				},
				"message": {
					"type": "object",
					"description": "Message payload to send"
				}
			},
			"required": ["extension_id", "message"]
		}`),
	}

	getCookiesTool = Tool{
		Name:        "chrome_get_cookies",
		Description: "Get cookies for a specific domain",
		InputSchema: json.RawMessage(`{
			"type": "object",
			"properties": {
				"domain": {
					"type": "string",
					"description": "Domain to get cookies for"
				}
			},
			"required": ["domain"]
		}`),
	}

	captureScreenshotTool = Tool{
		Name:        "chrome_capture_screenshot",
		Description: "Take a screenshot of the current tab",
		InputSchema: json.RawMessage(`{
			"type": "object",
			"properties": {
				"tab_id": {
					"type": "number",
					"description": "The ID of the target tab (defaults to active tab)"
				},
				"format": {
					"type": "string",
					"description": "Image format ('png' or 'jpeg', defaults to 'png')",
					"enum": ["png", "jpeg"],
					"default": "png"
				},
				"quality": {
					"type": "number",
					"description": "Image quality for jpeg format (0-100)",
					"minimum": 0,
					"maximum": 100
				},
				"area": {
					"type": "object",
					"description": "Capture specific area",
					"properties": {
						"x": { "type": "number" },
						"y": { "type": "number" },
						"width": { "type": "number" },
						"height": { "type": "number" }
					},
					"required": ["x", "y", "width", "height"]
				}
			}
		}`),
	}

	createTabTool = Tool{
		Name:        "chrome_create_tab",
		Description: "Create a new tab with specified URL and options",
		InputSchema: json.RawMessage(`{
			"type": "object",
			"properties": {
				"url": {
					"type": "string",
					"description": "URL to open in the new tab"
				},
				"active": {
					"type": "boolean",
					"description": "Whether the new tab should be active",
					"default": true
				},
				"index": {
					"type": "number",
					"description": "The position the tab should take in the window"
				},
				"windowId": {
					"type": "number",
					"description": "The window to create the new tab in"
				}
			}
		}`),
	}
)

// AllTools returns all the defined tools
func AllTools() []Tool {
	return []Tool{
		getActiveTabTool,
		getAllTabsTool,
		executeScriptTool,
		injectCssTool,
		getExtensionInfoTool,
		sendMessageTool,
		getCookiesTool,
		captureScreenshotTool,
		createTabTool,
	}
}

// JSONRPC Request structure
type JSONRPCRequest struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      string          `json:"id,omitempty"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

// JSONRPC Response structure
type JSONRPCResponse struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      string          `json:"id,omitempty"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   *JSONRPCError   `json:"error,omitempty"`
}

// JSONRPC Error structure
type JSONRPCError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

// MCP Request structure
type MCPRequest struct {
	Schema string          `json:"schema"`
	ID     string          `json:"id"`
	Params json.RawMessage `json:"params"`
}

// MCP Response structure
type MCPResponse struct {
	Schema string      `json:"schema"`
	ID     string      `json:"id"`
	Result interface{} `json:"result"`
}

// MCP Error Response structure
type MCPErrorResponse struct {
	Schema string `json:"schema"`
	ID     string `json:"id"`
	Error  struct {
		Message string `json:"message"`
	} `json:"error"`
}

// ListToolsResult is the result for ListTools request
type ListToolsResult struct {
	Tools []Tool `json:"tools"`
}

// ContentItem represents an item in the content array
type ContentItem struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

// CallToolResult is the result for CallTool request
type CallToolResult struct {
	Content []ContentItem  `json:"content"`
	Meta    map[string]any `json:"_meta,omitempty"`
	IsError bool           `json:"isError,omitempty"`
}

// CallToolParams represents the parameters for a call tool request
type CallToolParams struct {
	Name      string          `json:"name"`
	Arguments json.RawMessage `json:"arguments"`
}

// Global variables
var (
	activeConnection *websocket.Conn
	connMutex        sync.Mutex
	responseChannels = make(map[string]chan json.RawMessage)
	channelMutex     sync.Mutex
)

// WebSocket upgrade configuration
var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true // Allow any origin for this example
	},
}

// Handle WebSocket connections
func handleWebSocketConnections(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("Error upgrading to WebSocket: %v", err)
		return
	}
	defer conn.Close()

	// Set this connection as the active one
	connMutex.Lock()
	activeConnection = conn
	connMutex.Unlock()

	log.Println("New WebSocket connection established")

	// Connection cleanup when it closes
	defer func() {
		connMutex.Lock()
		if activeConnection == conn {
			activeConnection = nil
		}
		connMutex.Unlock()
		log.Println("WebSocket connection closed")
	}()

	// Main message handling loop
	for {
		_, message, err := conn.ReadMessage()
		if err != nil {
			log.Printf("Error reading message: %v", err)
			break
		}

		// Parse and handle the message
		var request JSONRPCRequest
		if err := json.Unmarshal(message, &request); err != nil {
			log.Printf("Error parsing message: %v", err)
			continue
		}

		// Handle heartbeat message
		if request.Method == "heartbeat" {
			response := JSONRPCResponse{
				JSONRPC: "2.0",
				Method:  "heartbeat",
				Result:  json.RawMessage(`{"type":"heartbeat_response"}`),
			}
			responseBytes, _ := json.Marshal(response)
			conn.WriteMessage(websocket.TextMessage, responseBytes)
			continue
		}

		// Regular response handling
		log.Printf("Received message: %s", string(message))

		// Handle response to a previous request
		if request.ID != "" {
			channelMutex.Lock()
			responseChan, exists := responseChannels[request.ID]
			channelMutex.Unlock()

			if exists {
				responseChan <- message
			}
		}
	}
}

// Send request to Chrome extension and wait for response
func sendRequestToExtension(method string, params json.RawMessage) (json.RawMessage, error) {
	connMutex.Lock()
	conn := activeConnection
	connMutex.Unlock()

	if conn == nil {
		return nil, fmt.Errorf("no active Chrome extension connection")
	}

	// Create unique request ID
	requestID := fmt.Sprintf("%s_%d_%d", method, time.Now().Unix(), rand.Intn(1000000))

	// Create response channel
	responseChan := make(chan json.RawMessage, 1)
	channelMutex.Lock()
	responseChannels[requestID] = responseChan
	channelMutex.Unlock()

	// Cleanup channel when done
	defer func() {
		channelMutex.Lock()
		delete(responseChannels, requestID)
		channelMutex.Unlock()
	}()

	// Create the request
	request := JSONRPCRequest{
		JSONRPC: "2.0",
		ID:      requestID,
		Method:  method,
		Params:  params,
	}

	// Marshal and send request
	requestBytes, err := json.Marshal(request)
	if err != nil {
		return nil, fmt.Errorf("error marshalling request: %v", err)
	}

	if err := conn.WriteMessage(websocket.TextMessage, requestBytes); err != nil {
		return nil, fmt.Errorf("error sending request: %v", err)
	}

	// Wait for response with timeout
	select {
	case response := <-responseChan:
		return response, nil
	case <-time.After(30 * time.Second):
		return nil, fmt.Errorf("timeout waiting for Chrome extension response")
	}
}

// Handle MCP ListTools request
func handleListTools(requestID string) []byte {
	response := MCPResponse{
		Schema: "mcp:response/list-tools@v1",
		ID:     requestID,
		Result: ListToolsResult{
			Tools: AllTools(),
		},
	}
	responseBytes, _ := json.Marshal(response)
	return responseBytes
}

// Handle MCP CallTool request
func handleCallTool(requestID string, params json.RawMessage) []byte {
	var callToolParams CallToolParams
	if err := json.Unmarshal(params, &callToolParams); err != nil {
		return createErrorResponse(requestID, fmt.Sprintf("Invalid call tool parameters: %v", err))
	}

	// Check for arguments
	if callToolParams.Arguments == nil {
		return createErrorResponse(requestID, "No arguments provided")
	}

	// Send request to Chrome extension
	response, err := sendRequestToExtension(callToolParams.Name, callToolParams.Arguments)
	if err != nil {
		return createErrorResponse(requestID, err.Error())
	}

	// Parse response
	var jsonRPCResponse JSONRPCResponse
	if err := json.Unmarshal(response, &jsonRPCResponse); err != nil {
		return createErrorResponse(requestID, fmt.Sprintf("Error parsing extension response: %v", err))
	}

	// Check for error
	if jsonRPCResponse.Error != nil {
		return createErrorResponse(requestID, jsonRPCResponse.Error.Message)
	}

	// Create and return MCP response
	callToolResult := CallToolResult{
		Content: []ContentItem{
			{
				Type: "text",
				Text: string(jsonRPCResponse.Result),
			},
		},
		Meta: map[string]any{},
	}

	responseObj := MCPResponse{
		Schema: "mcp:response/call-tool@v1",
		ID:     requestID,
		Result: callToolResult,
	}
	responseBytes, _ := json.Marshal(responseObj)
	return responseBytes
}

// Create error response
func createErrorResponse(requestID, message string) []byte {
	errorResponse := MCPErrorResponse{
		Schema: "mcp:error@v1",
		ID:     requestID,
		Error: struct {
			Message string `json:"message"`
		}{
			Message: message,
		},
	}
	responseBytes, _ := json.Marshal(errorResponse)
	return responseBytes
}

// Handle MCP requests from stdin
func handleMCPRequests() {
	scanner := bufio.NewScanner(os.Stdin)
	for scanner.Scan() {
		requestLine := scanner.Text()
		if requestLine == "" {
			continue
		}

		var request MCPRequest
		if err := json.Unmarshal([]byte(requestLine), &request); err != nil {
			log.Printf("Error parsing MCP request: %v", err)
			continue
		}

		var responseBytes []byte
		switch request.Schema {
		case "mcp:request/list-tools@v1":
			responseBytes = handleListTools(request.ID)
		case "mcp:request/call-tool@v1":
			responseBytes = handleCallTool(request.ID, request.Params)
		default:
			log.Printf("Unknown schema: %s", request.Schema)
			responseBytes = createErrorResponse(request.ID, fmt.Sprintf("Unknown schema: %s", request.Schema))
		}

		fmt.Println(string(responseBytes))
	}

	if err := scanner.Err(); err != nil {
		log.Printf("Error reading from stdin: %v", err)
	}
}

func main() {
	// Initialize random with current time as seed
	r := rand.New(rand.NewSource(time.Now().UnixNano()))
	rand.Seed = func(seed int64) {
		r.Seed(seed)
	}

	// Start WebSocket server
	http.HandleFunc("/", handleWebSocketConnections)
	go func() {
		log.Printf("Starting WebSocket server on port %d", PORT)
		if err := http.ListenAndServe(fmt.Sprintf(":%d", PORT), nil); err != nil {
			log.Fatalf("Failed to start WebSocket server: %v", err)
		}
	}()

	// Print server information to stderr
	log.Printf("Chrome Extension MCP Server running on port %d", PORT)
	log.Printf("WebSocket server started at ws://localhost:%d", PORT)

	// Handle MCP requests from stdin
	handleMCPRequests()
}