# スケジュールアプリ セットアップ手順

このアプリは Firebase(Google が提供する無料のサーバー・データベース・ログインの仕組み)を使っています。
以下の手順を上から順にやれば使えるようになります。難しい言葉が出てきますが、基本はコピー&ペーストで進められます。

## 1. Firebase プロジェクトを作る

1. https://console.firebase.google.com/ を開く(Google アカウントでログイン)
2. 「プロジェクトを作成」→ 名前を入力(例: `my-schedule`)→ そのまま進めて作成完了

## 2. ログイン機能(Google認証)を有効にする

1. 作成したプロジェクトを開く
2. 左メニュー「構築」→「Authentication」→「始める」
3. 「Sign-in method」タブ →「Google」を選択 → 有効にする → 保存

## 3. データベース(Firestore)を作る

1. 左メニュー「構築」→「Firestore Database」→「データベースの作成」
2. ロケーションは `asia-northeast1`(東京)などお好みで選択
3. 「本番環境モード」で作成(ルールは後で上書きします)
4. 作成できたら「ルール」タブを開き、このプロジェクトの `firestore.rules` の中身を全部コピーして貼り付け →「公開」

これで「自分のデータは自分にしか見えない」設定が反映されます。

## 4. アプリの設定情報を取得する

1. 左上の歯車アイコン →「プロジェクトの設定」
2. 下にスクロールし「マイアプリ」→ `</>`(ウェブ)のアイコンをクリック
3. アプリのニックネームを適当に入力(例: `web`)→「Firebase Hosting も設定します」はチェックなしでOK →「アプリを登録」
4. 表示される `firebaseConfig = { ... }` の中身をコピー
5. このプロジェクトの `firebase-config.js` を開き、`export const firebaseConfig = { ... }` の中身を、コピーした内容に置き換えて保存

## 5. ローカルで動作確認する

自分のパソコン(`localhost`)で開いたときは、本番ではなく **Firebase エミュレーター**(手元だけで動く偽物のログインとデータベース)につながるようになっています。手元でどれだけいじっても、本番の予定データには一切触れません。

### 必要なもの(最初の1回だけ)

- Git for Windows(https://git-scm.com/ )… 一緒に入る「Git Bash」でコマンドを打ちます
- Node.js(https://nodejs.org/ の LTS 版)
- Java(JDK 11 以上。例: https://adoptium.net/ )… エミュレーターに必要
- firebase-tools: `npm install -g firebase-tools`

### 起動

このフォルダで:

```bash
firebase emulators:start
```

- アプリ: http://localhost:5000
- エミュレーターの管理画面(偽データベースの中身が見られる): http://localhost:4000

ログインボタンを押すと偽のGoogleログイン画面が出るので、「Add new account」で適当なアカウントを作ってログインしてください。止めるときは `Ctrl + C` です(データは消えます)。

## 5.5. ブランチで安全にいじる流れ

本番が更新されるのは `firebase deploy` を実行したときだけです。GitHub にプッシュしても本番は変わりません。

```bash
git switch master && git pull          # 最新の master にする
git switch -c feature/やりたいこと      # 作業用ブランチを作る
# …コードを編集して、firebase emulators:start で確認…
git add . && git commit -m "変更内容"
git push -u origin feature/やりたいこと  # GitHub に保存(本番には影響なし)
```

満足したら GitHub でプルリクエストを作って `master` にマージし、**`master` に戻ってから** デプロイします:

```bash
git switch master && git pull
firebase deploy --only hosting,firestore:rules
```

⚠️ 作業用ブランチにいるまま `firebase deploy` すると、作業中の状態が本番に出てしまうので注意。

## 6. 公開する(スマホ・PC両方から使えるようにする)

1. Node.js をインストール(https://nodejs.org/ から LTS 版)
2. ターミナル(コマンドプロンプト)でこのフォルダに移動し、以下を実行:

```bash
npm install -g firebase-tools
firebase login
firebase use --add
```

`firebase use --add` で、さきほど作ったプロジェクトを選択してください。

3. 公開する:

```bash
firebase deploy --only hosting,firestore:rules
```

4. 完了すると `https://(プロジェクトID).web.app` のようなURLが表示されます。これがあなた専用アプリのURLです。スマホ・PCどちらでもこのURLを開き、同じGoogleアカウントでログインすれば、同じ予定が確認・編集できます。他の人が同じURLを開いても、その人自身のGoogleアカウントでログインすれば、その人専用の(あなたのとは別の)予定を持てます。

## 困ったときは

- ログインボタンを押しても反応しない → 手順2(Authentication の Google 有効化)ができているか確認
- 保存できない/データが表示されない → 手順3のFirestoreルールが正しく貼り付けられ「公開」されているか確認
- 見た目が崩れる/真っ白になる → ブラウザの開発者ツール(F12)の「Console」タブにエラーが出ていないか確認し、そのエラー内容を教えてください
