# ito

スマホを並べて遊ぶ、価値観共有型のリアルタイムWebゲームです。

## 実装済み

- 4桁のルーム作成・参加（2〜20人）
- 1〜100の重複しない数字を暗号学的乱数で配布
- お題・参加者・回答状況・OPENを全端末へリアルタイム同期
- 回答決定後は名前と回答だけを表示
- ゲームマスター限定の開始・OPEN・次ゲーム操作
- マスター退出時は次の参加者へ自動引き継ぎ
- ルームデータを6時間後に自動削除
- スマートフォン向けUI

## 構成

- 画面: GitHub Pages（HTML / CSS / JavaScript）
- 通信: Amazon API Gateway WebSocket
- 処理: AWS Lambda（Node.js）
- 保存: Amazon DynamoDB オンデマンド
- IaC: AWS SAM / CloudFormation（`template.yaml`）

常時稼働サーバーはなく、利用したリクエスト・接続時間・DB操作だけが課金対象です。小規模利用なら無料利用枠内に収まる可能性が高いですが、AWS Budgetsで予算通知を設定してください。

## 初回デプロイ

PCでAWS CLIとAWS SAM CLIを設定後、リポジトリ直下で実行します。

```bash
sam build
sam deploy --guided
```

- Stack Name: `ito-game`
- AWS Region: `ap-northeast-1`
- Confirm changes before deploy: `Y`
- Allow SAM CLI IAM role creation: `Y`
- Save arguments to configuration file: `Y`

この操作は、`template.yaml`を基にWebSocket API、Lambda、DynamoDBをAWS上へ作成します。完了時の `WebSocketUrl` をコピーし、`config.js` を次のように変更してmainへpushします。

```js
window.ITO_CONFIG = {
  websocketUrl: "wss://表示されたURL/prod"
};
```

最後にGitHubの **Settings → Pages → Build and deployment → Source** で **Deploy from a branch**、Branchで **main / (root)** を選んで保存します。公開URLは通常 `https://ryuya-matsubara.github.io/ito/` です。

## ローカル画面確認

```bash
python3 -m http.server 8080
```

このコマンドは現在のフォルダを一時的なWebサーバーとして配信します。ブラウザで `http://localhost:8080` を開きます。対戦通信には上記AWSデプロイと `config.js` の設定が必要です。

## ゲーム進行

1. 全員が名前を入力し、ゲームマスターがルームを作成
2. 他の人が4桁の番号で参加
3. ゲームマスターがお題を決めて開始
4. 各自が数字を確認し、数字に合う回答を決定
5. 全員の回答を見せ合い、数字が小さいと思う順にスマホを並べる
6. ゲームマスターがOPENし、全員の数字を確認
7. 「次のゲームへ」で次のお題へ
