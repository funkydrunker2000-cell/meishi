# 営業名刺帳（GitHub Pages ＋ Supabase）

営業訪問先ごとに、もらった名刺と営業履歴を社内で共有するシステムです。

- 名刺をスマホで撮影すると、会社名・氏名・電話などを自動で読み取って登録
- 訪問先ごとに営業履歴（日付・担当者・面談相手・内容・見込み度・次回予定）を記録
- 見込みA／7日以内の予定／予定日超過／受注 で絞り込み
- 状況を「受注」にすると、受注後の手続き（広告管理システム①→稟議→ヒアリングシート）のチェックと、ヒアリングシート用のまとめ文を表示
- 他の社員が登録した内容は、開いている画面にすぐ反映

## しくみ

```
スマホ・PCのブラウザ
   │  画面（HTML/CSS/JS）…… GitHub Pages で公開
   │
   ├─ ログイン・データ・名刺画像 …… Supabase（Auth / Database / Storage / Realtime）
   │
   └─ 名刺の読み取り …… Supabase Edge Function「read-card」 → Claude API
                         （Anthropic の API キーは Supabase 側だけに保存）
```

| ファイル | 役割 |
|---|---|
| `index.html` | 画面とデザイン、ログイン画面 |
| `config.js` | Supabase の接続先（URL と公開キー） |
| `core.js` | データの読み書き・リアルタイム反映・名刺画像・読み取りの呼び出し |
| `app.js` | 一覧・詳細・各入力フォーム |
| `auth.js` | ログイン・招待・パスワード再設定 |
| `supabase/schema.sql` | テーブル・アクセス権・画像保存場所の初期設定 |
| `supabase/functions/read-card/index.ts` | 名刺読み取り用のサーバー関数 |

ビルドは不要です。ファイルをそのまま GitHub Pages に置けば動きます。

---

## 設定手順

所要時間の目安は30〜40分です。上から順に進めてください。

### 1. Supabase にテーブルを作る

1. [Supabase ダッシュボード](https://supabase.com/dashboard) で対象のプロジェクトを開く
2. 左メニュー **SQL Editor** → **New query**
3. `supabase/schema.sql` の中身を全部貼り付けて **Run**
4. 「Success. No rows returned」と出れば完了
   - 左メニュー **Table Editor** に `companies`（訪問先）・`contacts`（名刺）・`visits`（営業履歴）・`profiles`（記入者名）ができています
   - **Storage** に `cards` バケット（名刺画像）ができています

### 2. ログインを「招待した社員だけ」にする

1. **Authentication** → **Sign In / Providers**（または **Providers**）→ **Email**
   - **Allow new users to sign up**（新規登録を許可）を **オフ**
   - **Email** プロバイダ自体は **オン** のまま
2. **Authentication** → **URL Configuration**
   - **Site URL** に GitHub Pages の URL を入れる（例：`https://あなたのユーザー名.github.io/meishi/`）
   - **Redirect URLs** にも同じ URL を追加
   - ※ GitHub Pages の URL は手順6で決まります。先に手順6を済ませてから戻ってきても大丈夫です

### 3. Claude API キーを Supabase に保存する

1. [Claude Console](https://console.anthropic.com/) → **API Keys** → **Create Key** でキーを作る（`sk-ant-...`）
   - 請求先（Billing）の設定が必要です
2. Supabase の **Edge Functions** → **Secrets**（または **Manage secrets**）
3. **Name** に `ANTHROPIC_API_KEY`、**Value** に作ったキーを入れて保存

> API キーは `config.js` や GitHub には絶対に書かないでください。

### 4. 名刺読み取り用の関数を作る

1. Supabase の **Edge Functions** → **Deploy a new function** → **Via Editor**
2. 関数名を **`read-card`** にする（この名前で画面から呼び出します）
3. エディタの中身を消して、`supabase/functions/read-card/index.ts` の中身を全部貼り付け
4. **Deploy function**

関数の中でログイン中の社員かどうかを確認しているので、ログインしていない人や外部からは使えません。

> 読み取りで「ログインの有効期限が切れました」と出続ける場合は、関数の **Details**（設定）で **Verify JWT with legacy secret**（Enforce JWT verification）を **オフ** にしてください。新しい形式のキーを使うプロジェクトでは、この設定がログイン中の社員の呼び出しまで断ってしまうことがあります。オフにしても、上記のとおり関数の中でログインを確認しています。

### 5. `config.js` に接続先を入れる

Supabase の **Project Settings** → **API Keys**（または画面上部の **Connect**）で次の2つを確認し、`config.js` に入れます。

```js
window.MEISHI_CONFIG = {
  supabaseUrl: "https://abcdefghijklmnop.supabase.co",   // Project URL
  supabaseKey: "sb_publishable_xxxxxxxx",                // Publishable key（または anon public key）
};
```

- 入れるのは **公開してよいキー**（Publishable key / anon key）です
- **service_role key / Secret key は絶対に入れないでください**（全データを誰でも操作できてしまいます）
- 公開キーは GitHub に載っても問題ありません。データは手順1のアクセス権設定で、招待した社員以外は読めないよう守られています

### 6. GitHub Pages で公開する

1. GitHub で新しいリポジトリを作る（例：`meishi`）
   - GitHub の無料プランで Pages を使う場合、リポジトリは **Public** にする必要があります（コードは見えますが、データや API キーは含まれません）
   - コードも非公開にしたい場合は、有料プラン（Pro / Team など）で Private リポジトリの Pages を使います
2. このフォルダで次を実行して、作ったリポジトリに送る（`あなたのユーザー名` は置き換え）

   ```bash
   git remote add origin https://github.com/あなたのユーザー名/meishi.git
   ```

   ```bash
   git push -u origin main
   ```

3. GitHub のリポジトリ → **Settings** → **Pages**
   - **Source**：Deploy from a branch
   - **Branch**：`main` / `/ (root)` → **Save**
4. 1〜2分待つと `https://あなたのユーザー名.github.io/meishi/` で開けます
5. この URL を手順2の **Site URL / Redirect URLs** に入れる

### 7. 社員を招待する

1. Supabase の **Authentication** → **Users** → **Add user** → **Send invitation**
2. 社員のメールアドレスを入れて送信
3. 社員は届いたメールのリンクを開く → パスワードを設定 → 記入者名を登録 → 利用開始

退職などで使えなくする場合は、**Users** で該当の人を選んで **Delete user** します（その人が書いた履歴は残ります）。

### 8. 動作確認

- [ ] 招待メールのリンクから、パスワード設定と記入者名の登録ができる
- [ ] スマホで「名刺を撮影」→ 項目が自動で入る → 登録できる
- [ ] 登録した名刺の画像が表示される
- [ ] 営業履歴を記入できる
- [ ] 別の人（または別の端末）で開いている画面に、すぐ反映される
- [ ] ログアウトすると、データが見えなくなる

---

## 運用メモ

### 費用の目安

| サービス | 内容 |
|---|---|
| GitHub Pages | 無料（Public リポジトリの場合） |
| Supabase Free プラン | 無料。データベース 500MB・画像保存 1GB まで。**1週間アクセスが無いとプロジェクトが一時停止**します（ダッシュボードから再開可能）。毎日使うなら問題になりにくいですが、止まると困る場合は Pro プラン（月25ドル〜）を検討してください |
| Claude API | 読み取り1回あたり数円程度（Claude Opus 5、画像1枚＋短い応答）。実際の金額は Claude Console の **Usage** で確認できます |

名刺画像は長辺1600pxに縮小して保存するため、1枚あたり200〜400KB 程度です。Free プランの 1GB で、おおよそ2,500〜5,000枚分です。

### 読み取りについて

- モデルは `claude-opus-5`（effort: low）を使っています
- Claude が安全上の理由で応答を断った場合に、自動で別のモデルに切り替えて続ける設定（server-side fallback）を入れています
- 読み取り結果は必ず担当者が名刺と見比べてから登録する画面にしています

### アクセス権

- ログインした社員は全員、すべての訪問先・名刺・履歴を見て、編集・削除できます
- 「自分が書いた履歴だけ編集できる」などに絞りたい場合は、`supabase/schema.sql` のアクセス権（RLS）を変更します

### バックアップ

Supabase の Free プランには自動バックアップの復元機能がありません。定期的に **Table Editor** で各テーブルを開き、**Export → CSV** で保存しておくと安心です。
