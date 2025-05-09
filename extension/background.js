// MCP Chrome Extension Background Script - Persistent Background Service

// WebSocket connection management
let ws = null;
let isConnected = false;
let lastMessage = null;
const PORT = 8765;
const HEARTBEAT_INTERVAL = 30000; // 30秒ごとにハートビート
const MAX_RECONNECT_ATTEMPTS = 5; // 最大再接続試行回数
const MAX_BACKOFF_DELAY = 32000; // 最大再接続待機時間（32秒）
let heartbeatTimer = null;
let reconnectAttempts = 0;
let reconnectTimer = null;
let heartbeatTimeout = null;

// タブ管理
let tabsState = new Map();

// タブごとのコンテンツスクリプトの準備状態を追跡
let contentScriptReady = new Map();

// タブの状態を監視
chrome.tabs.onCreated.addListener((tab) => {
  tabsState.set(tab.id, tab);
  broadcastTabUpdate('created', tab);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  tabsState.set(tabId, tab);
  broadcastTabUpdate('updated', tab, changeInfo);
  if (changeInfo.status === 'loading') {
    contentScriptReady.delete(tabId);
  }
});

chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  const tab = tabsState.get(tabId);
  tabsState.delete(tabId);
  broadcastTabUpdate('removed', tab, removeInfo);
  contentScriptReady.delete(tabId);
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const tab = await chrome.tabs.get(activeInfo.tabId);
  broadcastTabUpdate('activated', tab);
});

// タブの状態変更をブロードキャスト
function broadcastTabUpdate(eventType, tab, additionalInfo = null) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      jsonrpc: "2.0",
      id: `tab_update_${Date.now()}`,
      method: "tab_update",
      content: [{
        type: "text",
        text: JSON.stringify({
          eventType,
          tab,
          additionalInfo
        })
      }],
      _meta: {}
    }));
  }
}

// Handle messages from popup or other extension parts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.method === 'getConnectionStatus') {
    sendResponse({
      jsonrpc: "2.0",
      method: "getConnectionStatus",
      result: {
        isConnected,
        lastMessage,
        port: PORT
      }
    });
  } else if (message.method === 'getAllTabs') {
    chrome.tabs.query({}).then(tabs => {
      sendResponse({
        jsonrpc: "2.0",
        method: "getAllTabs",
        result: { tabs }
      });
    });
    return true;
  } else if (message.method === 'getTabState') {
    sendResponse({
      jsonrpc: "2.0",
      method: "getTabState",
      result: {
        tabs: Array.from(tabsState.values())
      }
    });
  } else if (message.method === 'contentScriptReady') {
    contentScriptReady.set(sender.tab.id, true);
    console.log('Content script ready in tab:', sender.tab.id);
    broadcastTabUpdate('content_ready', sender.tab);
  }
  return true;
});

// Broadcast connection status to all extension views
function broadcastConnectionStatus() {
  chrome.runtime.sendMessage({
    jsonrpc: "2.0",
    method: "connectionStatus",
    result: {
      isConnected,
      port: PORT
    }
  }).catch(() => {
    // Ignore errors when no listeners are available
  });
}

// Initialize WebSocket connection
function initializeWebSocket() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    return;
  }

  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    console.log('Max reconnection attempts reached. Stopping reconnection.');
    return;
  }

  try {
    cleanupWebSocket();
    
    ws = new WebSocket(`ws://localhost:${PORT}`);
    
    ws.onopen = () => {
      console.log('WebSocket connected');
      isConnected = true;
      reconnectAttempts = 0;
      broadcastConnectionStatus();
      startHeartbeat();
    };

    ws.onmessage = async (event) => {
      try {
        const request = JSON.parse(event.data);
        lastMessage = request;
        
        if (request.method === 'heartbeat') {
          ws.send(JSON.stringify({
            jsonrpc: "2.0",
            id: request.id || `heartbeat_${Date.now()}`,
            method: "heartbeat",
            content: [{
              type: "text",
              text: JSON.stringify({ type: 'heartbeat_response' })
            }],
            _meta: {}
          }));
          if (heartbeatTimeout) {
            clearTimeout(heartbeatTimeout);
          }
          return;
        }
        
        broadcastNewMessage(request);
        const response = await handleMCPRequest(request);
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(response));
        }
      } catch (error) {
        console.error('Error handling message:', error);
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            jsonrpc: "2.0",
            id: request?.id || `error_${Date.now()}`,
            method: request?.method || "error",
            error: {
              code: -32603,
              message: error.message
            },
            content: [{
              type: "text",
              text: JSON.stringify({
                error: error.message
              })
            }],
            _meta: {},
            isError: true
          }));
        }
      }
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      isConnected = false;
      broadcastConnectionStatus();
      scheduleReconnect();
    };

    ws.onclose = () => {
      console.log('WebSocket closed');
      isConnected = false;
      broadcastConnectionStatus();
      scheduleReconnect();
    };
  } catch (error) {
    console.error('Failed to create WebSocket:', error);
    isConnected = false;
    broadcastConnectionStatus();
    scheduleReconnect();
  }
}

// 指数バックオフを使用した再接続スケジューリング
function scheduleReconnect() {
  cleanupWebSocket();
  
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
  }

  reconnectAttempts++;
  if (reconnectAttempts <= MAX_RECONNECT_ATTEMPTS) {
    const delay = Math.min(1000 * Math.pow(2, reconnectAttempts - 1), MAX_BACKOFF_DELAY);
    console.log(`Scheduling reconnect attempt ${reconnectAttempts} in ${delay}ms`);
    reconnectTimer = setTimeout(initializeWebSocket, delay);
  }
}

// Cleanup WebSocket connection
function cleanupWebSocket() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  
  if (heartbeatTimeout) {
    clearTimeout(heartbeatTimeout);
    heartbeatTimeout = null;
  }
  
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  
  if (ws) {
    // WebSocketの状態をチェックして適切にクローズ
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close();
    }
    ws = null;
  }
}

// Broadcast new message to all extension views
function broadcastNewMessage(data) {
  chrome.runtime.sendMessage({
    jsonrpc: "2.0",
    method: "newMessage",
    result: { data }
  }).catch(() => {
    // Ignore errors when no listeners are available
  });
}

// MCP request handler
async function handleMCPRequest(request) {
  try {
    let result;
    switch (request.method) {
      case 'chrome_get_active_tab':
        result = await handleGetActiveTab();
        break;
      case 'chrome_get_all_tabs':
        result = await handleGetAllTabs();
        break;
      case 'chrome_execute_script':
        result = await handleExecuteScriptViaContent(request.params);
        break;
      case 'chrome_inject_css':
        result = await handleInjectCSSViaContent(request.params);
        break;
      case 'chrome_get_extension_info':
        result = await handleGetExtensionInfo(request.params);
        break;
      case 'chrome_send_message':
        result = await handleSendMessage(request.params);
        break;
      case 'chrome_get_cookies':
        result = await handleGetCookies(request.params);
        break;
      case 'chrome_capture_screenshot':
        result = await handleCaptureScreenshot(request.params);
        break;
      case 'chrome_create_tab':
        result = await handleCreateTab(request.params);
        break;
      default:
        throw new Error(`Unknown method: ${request.method}`);
    }
    return {
      jsonrpc: "2.0",
      id: request.id || `${request.method}_${Date.now()}`,
      method: request.method,
      content: [{
        type: "text",
        text: JSON.stringify(result)
      }],
      _meta: {}
    };
  } catch (error) {
    return {
      jsonrpc: "2.0",
      id: request.id || `error_${Date.now()}`,
      method: request.method,
      error: {
        code: -32603,
        message: error.message
      },
      content: [{
        type: "text",
        text: JSON.stringify({
          error: error.message
        })
      }],
      _meta: {},
      isError: true
    };
  }
}

// Handler functions
async function handleGetActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

// スクリプトを実行するハンドラー
async function handleExecuteScriptViaContent({ tab_id, operation }) {
  if (!tab_id || !operation) {
    throw new Error('Missing required parameters: tab_id or operation');
  }

  try {
    // タブの存在確認
    try {
      const tab = await chrome.tabs.get(tab_id);
      if (!tab) {
        throw new Error(`Tab ${tab_id} not found`);
      }
      
      // chrome:// URLやその他特殊なURLのチェック
      if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') || tab.url.startsWith('https://chrome.google.com/webstore/')) {
        throw new Error(`Cannot execute script on restricted page: ${tab.url}`);
      }
    } catch (error) {
      throw new Error(`Tab error: ${error.message}`);
    }

    // 操作の検証
    if (!operation.action) {
      throw new Error('Missing required operation action');
    }

    // 操作の実行
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab_id },
      func: (op) => {
        function handleDOMOperation(operation) {
          switch (operation.action) {
            case 'querySelector':
              const element = document.querySelector(operation.selector);
              if (!element) return null;
              return {
                text: element.textContent,
                html: element.innerHTML,
                attributes: Array.from(element.attributes).reduce((acc, attr) => {
                  acc[attr.name] = attr.value;
                  return acc;
                }, {})
              };

            case 'querySelectorAll':
              return Array.from(document.querySelectorAll(operation.selector)).map(el => ({
                text: el.textContent,
                html: el.innerHTML,
                attributes: Array.from(el.attributes).reduce((acc, attr) => {
                  acc[attr.name] = attr.value;
                  return acc;
                }, {})
              }));

            case 'setText':
              const targetForText = document.querySelector(operation.selector);
              if (!targetForText) throw new Error('Element not found');
              targetForText.textContent = operation.value;
              return true;

            case 'setHTML':
              const targetForHTML = document.querySelector(operation.selector);
              if (!targetForHTML) throw new Error('Element not found');
              targetForHTML.innerHTML = operation.value;
              return true;

            case 'setAttribute':
              const targetForAttr = document.querySelector(operation.selector);
              if (!targetForAttr) throw new Error('Element not found');
              targetForAttr.setAttribute(operation.attribute, operation.value);
              return true;

            case 'removeAttribute':
              const targetForRemoveAttr = document.querySelector(operation.selector);
              if (!targetForRemoveAttr) throw new Error('Element not found');
              targetForRemoveAttr.removeAttribute(operation.attribute);
              return true;

            case 'addClass':
              const targetForAddClass = document.querySelector(operation.selector);
              if (!targetForAddClass) throw new Error('Element not found');
              targetForAddClass.classList.add(operation.value);
              return true;

            case 'removeClass':
              const targetForRemoveClass = document.querySelector(operation.selector);
              if (!targetForRemoveClass) throw new Error('Element not found');
              targetForRemoveClass.classList.remove(operation.value);
              return true;

            case 'toggleClass':
              const targetForToggleClass = document.querySelector(operation.selector);
              if (!targetForToggleClass) throw new Error('Element not found');
              targetForToggleClass.classList.toggle(operation.value);
              return true;

            case 'createElement':
              const newElement = document.createElement(operation.tagName);
              if (operation.attributes) {
                Object.entries(operation.attributes).forEach(([key, value]) => {
                  newElement.setAttribute(key, value);
                });
              }
              if (operation.innerText) {
                newElement.textContent = operation.innerText;
              }
              const elementId = 'mcp-' + Date.now();
              newElement.setAttribute('data-mcp-id', elementId);
              return { elementId };

            case 'appendChild':
              const parent = document.querySelector(operation.selector);
              const child = document.querySelector(`[data-mcp-id="${operation.elementId}"]`);
              if (!parent || !child) throw new Error('Parent or child element not found');
              parent.appendChild(child);
              return true;

            case 'removeElement':
              const elementToRemove = document.querySelector(operation.selector);
              if (!elementToRemove) throw new Error('Element not found');
              elementToRemove.remove();
              return true;

            case 'getPageInfo':
              return {
                title: document.title,
                url: window.location.href,
                metaTags: Array.from(document.getElementsByTagName('meta')).map(meta => ({
                  name: meta.getAttribute('name'),
                  content: meta.getAttribute('content')
                }))
              };

            case 'getElementsInfo':
              return Array.from(document.querySelectorAll(operation.selector)).map(el => ({
                tagName: el.tagName,
                text: el.textContent,
                attributes: Array.from(el.attributes).reduce((acc, attr) => {
                  acc[attr.name] = attr.value;
                  return acc;
                }, {}),
                classes: Array.from(el.classList)
              }));

            case 'log':
              console.log(operation.message);
              return true;

            case 'click':
              const targetForClick = document.querySelector(operation.selector);
              if (!targetForClick) throw new Error('Element not found');
              targetForClick.click();
              return true;

            default:
              throw new Error('Unknown operation type');
          }
        }

        try {
          return handleDOMOperation(op);
        } catch (error) {
          throw new Error(error.message);
        }
      },
      args: [operation]
    });

    if (!results || results.length === 0) {
      throw new Error('Script execution failed: No results returned');
    }

    if (results[0].result === undefined) {
      throw new Error('Script execution failed: No result in response');
    }

    return results[0].result;

  } catch (error) {
    console.error('Script execution error:', error);
    throw error;
  }
}

// content.jsを介してCSSを注入する新しいハンドラー
async function handleInjectCSSViaContent({ tab_id, css }) {
  if (!tab_id || !css) {
    throw new Error('Missing required parameters: tab_id or css');
  }
  
  await chrome.tabs.sendMessage(tab_id, {
    jsonrpc: "2.0",
    method: "injectCSS",
    params: { css }
  });
  return true;
}

async function handleGetExtensionInfo({ extension_id }) {
  if (extension_id) {
    return await chrome.management.get(extension_id);
  } else {
    return await chrome.management.getAll();
  }
}

async function handleSendMessage({ extension_id, message }) {
  if (!extension_id || !message) {
    throw new Error('Missing required parameters: extension_id or message');
  }
  return await chrome.runtime.sendMessage(extension_id, message);
}

async function handleGetCookies({ domain }) {
  if (!domain) {
    throw new Error('Missing required parameter: domain');
  }
  return await chrome.cookies.getAll({ domain });
}

async function handleCaptureScreenshot({ tab_id, format = 'png', quality = 100, area }) {
  const options = {
    format,
    quality
  };

  if (area) {
    options.clip = area;
  }

  return await chrome.tabs.captureVisibleTab(
    tab_id ? tab_id : null,
    options
  );
}

// 新しいハンドラー関数
async function handleGetAllTabs() {
  return await chrome.tabs.query({});
}

// タブ作成のハンドラー
async function handleCreateTab({ url, active = true, index, windowId }) {
  const createProperties = {
    url,
    active,
  };

  if (typeof index === 'number') {
    createProperties.index = index;
  }

  if (typeof windowId === 'number') {
    createProperties.windowId = windowId;
  }

  return await chrome.tabs.create(createProperties);
}

// ハートビート開始
function startHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
  }
  if (heartbeatTimeout) {
    clearTimeout(heartbeatTimeout);
  }
  
  heartbeatTimer = setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        jsonrpc: "2.0",
        method: "heartbeat",
        params: {}
      }));
      
      // ハートビートのタイムアウトを設定
      heartbeatTimeout = setTimeout(() => {
        console.log('Heartbeat timeout - reconnecting...');
        cleanupWebSocket();
        initializeWebSocket();
      }, 10000);
    }
  }, HEARTBEAT_INTERVAL);
}

// Initialize WebSocket connection
initializeWebSocket();

// 定期的な接続チェック
setInterval(() => {
  if (!isConnected || !ws || ws.readyState !== WebSocket.OPEN) {
    console.log('Connection check: Reconnecting...');
    cleanupWebSocket();
    initializeWebSocket();
  }
}, 60000); // 1分ごとにチェック 

// 拡張機能のアンロード時にリソースをクリーンアップ
chrome.runtime.onSuspend.addListener(() => {
  cleanupWebSocket();
});

// メモリ使用量の最適化のため、未使用のメッセージをクリア
setInterval(() => {
  if (lastMessage && Date.now() - lastMessage.timestamp > 3600000) { // 1時間以上経過したメッセージをクリア
    lastMessage = null;
  }
}, 3600000); // 1時間ごとにチェック