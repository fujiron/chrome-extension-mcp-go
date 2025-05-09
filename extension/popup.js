document.addEventListener('DOMContentLoaded', () => {
  const connectionStatusEl = document.getElementById('connection-status');
  const portEl = document.getElementById('port');
  const extensionIdEl = document.getElementById('extension-id');
  
  // 拡張機能IDを表示
  extensionIdEl.textContent = chrome.runtime.id;

  // 接続状態を取得・表示
  chrome.runtime.sendMessage({
    method: 'getConnectionStatus'
  }, (response) => {
    if (chrome.runtime.lastError) {
      console.error(chrome.runtime.lastError);
      connectionStatusEl.textContent = 'Error: Could not connect to background script';
      connectionStatusEl.className = 'status disconnected';
      return;
    }
    
    updateConnectionStatus(response.result.isConnected);
    portEl.textContent = response.result.port || 8765;
  });

  // 接続状態更新用リスナー
  chrome.runtime.onMessage.addListener((message) => {
    if (message.method === 'connectionStatus') {
      updateConnectionStatus(message.result.isConnected);
      portEl.textContent = message.result.port || 8765;
    }
  });

  // 接続状態表示を更新
  function updateConnectionStatus(isConnected) {
    connectionStatusEl.className = isConnected ? 'status connected' : 'status disconnected';
    connectionStatusEl.textContent = isConnected 
      ? 'Connected to WebSocket server' 
      : 'Disconnected from WebSocket server';
  }
});