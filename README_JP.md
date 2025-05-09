# Chrome拡張機能 MCP サーバー (Go実装版)

Chrome拡張機能APIのためのModel Context Protocol (MCP) サーバーのGo言語による実装です。ClaudeがChromeブラウザの拡張機能と対話することを可能にします。

## 概要

このプロジェクトは、[オリジナルのTypeScript版](https://github.com/tesla0225/chromeextension)のChrome拡張機能MCPサーバーをGo言語で実装したものです。Claude AIとChrome拡張機能の間を橋渡しするWebSocketサーバーを提供し、Chrome APIを通じて様々なブラウザ操作を実行できるようにします。

## 機能

- Chrome拡張機能との通信のためのWebSocketサーバー
- Model Context Protocol (MCP) のサポート
- 以下のようなツールを通じた様々なChrome操作：
  - タブ管理
  - DOM操作
  - CSS注入
  - 拡張機能管理
  - Cookie操作
  - スクリーンショット取得
  - その他

## インストール

### 1. Chrome拡張機能のインストール

#### Dockerを使用する場合
1. Dockerコンテナをビルドして実行：
```bash
docker build -t mcp/chromeextension-go .
docker run -i --rm mcp/chromeextension-go
```

2. 拡張機能パッケージを抽出（まだない場合）：
```bash
docker cp $(docker ps -q -f ancestor=mcp/chromeextension-go):/app/extension extension
```

3. Chromeにインストール：
   - Chromeを開き、`chrome://extensions/` にアクセス
   - 右上の「デベロッパーモード」を有効にする
   - 「パッケージ化されていない拡張機能を読み込む」をクリックし、抽出した拡張機能ディレクトリを選択

#### 手動インストール
1. 拡張機能ディレクトリに移動：
```bash
cd extension
```

2. Chromeにインストール：
   - Chromeを開き、`chrome://extensions/` にアクセス
   - 右上の「デベロッパーモード」を有効にする
   - 「パッケージ化されていない拡張機能を読み込む」をクリックし、拡張機能ディレクトリを選択

### 2. サーバーの実行

#### ソースから実行
```bash
go run main.go
```

#### バイナリを使用
```bash
go build
./chrome-extension-mcp-go
```

### 3. Claude用のMCPサーバー設定

`claude_desktop_config.json` に以下を追加：

```json
{
  "mcpServers": {
    "chromeextension": {
      "command": "path/to/chrome-extension-mcp-go",
      "args": [],
      "env": {
        "CHROME_EXTENSION_ID": "あなたの拡張機能ID"
      }
    }
  }
}
```

## ツール

このMCPサーバーはClaudeに以下のツールを提供します：

1. `chrome_get_active_tab`: 現在アクティブなタブについての情報を取得
2. `chrome_get_all_tabs`: 開いているすべてのタブの情報を取得
3. `chrome_execute_script`: WebページのコンテキストでDOM操作を実行
4. `chrome_inject_css`: WebページにCSSを注入
5. `chrome_get_extension_info`: インストールされた拡張機能の情報を取得
6. `chrome_send_message`: 拡張機能のバックグラウンドスクリプトにメッセージを送信
7. `chrome_get_cookies`: 特定のドメインのCookieを取得
8. `chrome_capture_screenshot`: 現在のタブのスクリーンショットを撮影
9. `chrome_create_tab`: 指定されたURLとオプションで新しいタブを作成

## ライセンス

このプロジェクトはMITライセンスの下で提供されています。