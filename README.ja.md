# myfans-to-pikpak

[English](README.md)

MyFansで正当に閲覧できる動画を、rclone経由でPikPakへ同期する非公式CLIです。

投稿ごとにMyFans、ローカル作業領域、PikPakを照合します。
リモートを書き換える前に確認可能な計画を作り、計画と同じダイジェストが指定された場合だけ実行します。
既存ファイルは上書きせず、ローカル削除には別の計画と承認を要求します。

> [!WARNING]
> 本プロジェクトはMyFans、PikPak、rcloneの公式製品ではなく、各社から承認や推奨を受けたものでもありません。
> 利用者自身が閲覧と保存の権限を持つコンテンツだけを対象にしてください。
> サービス規約、著作権、プライバシー、適用法令を守る責任は利用者にあります。

2026年8月10日に確認した[MyFans利用規約](https://myfans.jp/terms)は、主催者の書面による事前承諾がないコンテンツの転載と、サービスの知的財産権を侵害するおそれのあるリバースエンジニアリングなどを禁止しています。
会費の支払いだけで、本ツールの使用や公開に必要な許可が得られるとは限りません。
利用や再配布の前に、MyFansと各コンテンツの権利者から必要な許可を得てください。
この記載は法律上の助言ではありません。

## 公開状況

ソースコード、テスト、Schema、npm配布物の構成は`1.0.0`向けに整備しています。
npmパッケージはまだ公開していません。
npmで公開する前に、公開許可、npmの所有者と公開設定を確定し、クリーンなチェックアウトでCIとtarballを確認する必要があります。

## 特徴

- 投稿総数の一致を前提にせず、投稿ごとに差分を判定します。
- 変更前に各投稿を`skip`、`rename`、`transfer`へ分類します。
- SHA-256ダイジェストと24時間の有効期限を持つ計画を保存します。
- 書き込み直前にリモートを再確認し、rcloneの上書き禁止オプションを使います。
- 投稿単位の台帳を保存するため、中断した処理を安全に再開できます。
- 検証済みローカルファイルの削除にも、別の計画とダイジェストを要求します。
- 自動処理とAIエージェント向けに、stdoutへ安定したJSONを一つだけ出力します。
- MyFansやPikPakの実アカウントを使わずに自動テストできます。
- 最初の公開版からWindows、macOS、Linuxを対応対象にしています。

## 動作条件

- Node.js 22.12以上
- `PATH`から実行できるFFmpegとFFprobe
- `PATH`から実行できるrclone
- rcloneに設定済みのPikPakリモート
- ローカルのChromium系ブラウザーにあるMyFansセッション、またはプロセス環境の`MYFANS_TOKEN`

rcloneはPikPakバックエンドを標準で提供しています。
利用前に`rclone config`を実行し、[PikPakの公式設定手順](https://rclone.org/pikpak/)に従ってください。

## インストール

最初のnpmリリースまでは、ソースから導入します。

```console
git clone https://github.com/getsetmind/myfans-to-pikpak.git
cd myfans-to-pikpak
npm ci
npm run build
npm link
myfans-to-pikpak --help
```

npmパッケージの公開後は、次のコマンドでグローバルに導入できます。

```console
npm install --global myfans-to-pikpak
```

利用可能になった時点でリリースノートに明記します。

## 認証

トークンをシェル履歴やプロセス一覧へ残さないため、CLIにはトークンを受け取るオプションがありません。

対話利用では、専用プロファイルとlocalhostのデバッグ用エンドポイントを指定してChromium系ブラウザーを起動し、そのブラウザーでMyFansへログインします。

```console
chromium --remote-debugging-port=9222 --user-data-dir=/absolute/path/to/a/dedicated-profile
```

実行ファイルの名前とパスは、OSとブラウザーによって異なります。
エンドポイントはlocalhostだけで待ち受けさせ、ネットワークへ公開せず、作業後にブラウザーを閉じてください。
CLIは既定で`http://127.0.0.1:9222`にあるMyFansタブからセッションを読みます。
別のローカルエンドポイントを使う場合は、グローバルオプション`--cdp-url`で指定します。

非対話環境では、`MYFANS_TOKEN`をプロセス環境へ渡せます。
リポジトリ、共有ログ、計画ファイル、シェルスクリプトへ保存しないでください。
PikPakの認証情報はrcloneの設定内に残り、このCLIが直接読むことはありません。

## クイックスタート

標準の手順は、読み取り専用の計画と、明示的に承認した実行に分かれています。

```text
doctor -> plans -> plan -> ダイジェストを確認 -> sync -> verify
                              |
                              +-> 別の削除計画 -> ダイジェストを確認 -> cleanup
```

### 1. 実行環境を確認する

`doctor`はNode.js、FFmpeg、FFprobe、rclone、MyFans認証、指定したrcloneリモートの設定を確認します。
MyFans、ローカル動画、PikPakの状態は変更しません。

```console
myfans-to-pikpak doctor --to pikpak:MyFans/example --json
```

### 2. 加入中のプランを確認する

対象のプランIDが分からない場合は、ログイン中のアカウントが加入しているプランを一覧にします。

```console
myfans-to-pikpak plans --json
```

結果には、プランID、URL、プラン名、クリエイター、投稿数、加入日、取得できる場合は次回更新日または満了日が含まれます。
このコマンドは読み取り専用です。

### 3. 同期計画を作る

プランIDまたはMyFansのプランURLを指定します。
保存先にはrcloneのリモートパスを指定します。

```console
myfans-to-pikpak plan --plan-id PLAN_ID_OR_URL --to pikpak:MyFans/example --out .myfans-to-pikpak/sync-plan.json --json
```

結果にある対象、件数、警告、有効期限、64文字の`digest`を確認してください。
計画ファイルには非公開のタイトルとローカルパスが含まれるため、コミットや共有をしないでください。
CLIは既存の計画ファイルを上書きしません。

保存先フォルダーが存在しない場合、`plan`は新規の空フォルダーとして扱います。
認証失敗、通信失敗、その他のrcloneエラーは`REMOTE_ERROR`で停止します。

### 4. 確認した計画だけを実行する

計画が正しい場合だけ、表示されたダイジェストをそのまま指定します。

```console
myfans-to-pikpak sync --plan .myfans-to-pikpak/sync-plan.json --confirm EXACT_SYNC_DIGEST --jobs 2 --json
```

`sync`は、異なるダイジェスト、変更済みまたは期限切れの計画、計画後に変わったリモート、既存のアップロード先を拒否します。
`--jobs`には1から16までの整数を指定できます。

### 5. 結果を検証する

```console
myfans-to-pikpak verify --plan .myfans-to-pikpak/sync-plan.json --json
```

検証が成功するまで削除計画を作らないでください。
利用可能なハッシュをPikPakが返さない場合、検証は予定ファイル名と既知のサイズまでです。

## ローカル動画を削除する

同期の成功は、ローカル動画を削除する承認ではありません。
検証済みの同期計画から、別の削除計画を作ります。

```console
myfans-to-pikpak cleanup --source-plan .myfans-to-pikpak/sync-plan.json --out .myfans-to-pikpak/cleanup-plan.json --json
```

すべてのパスと新しいダイジェストを確認し、正しい場合だけ実行します。

```console
myfans-to-pikpak cleanup --plan .myfans-to-pikpak/cleanup-plan.json --confirm EXACT_CLEANUP_DIGEST --json
```

台帳で検証済みになっており、計画後に変わっておらず、設定した作業ディレクトリ内に実体がある通常ファイルだけを削除します。
PikPakの内容は変更しません。

## コマンド

| コマンド | 状態の変更 | 用途 |
|---|---:|---|
| `doctor` | なし | ローカル依存、MyFans認証、任意のrclone設定を確認する。 |
| `plans` | なし | ログイン中のMyFansアカウントが加入しているプランを一覧にする。 |
| `plan` | なし | 投稿ごとの`skip`、`rename`、`transfer`を計画する。 |
| `sync` | リモートとローカル作業状態 | ダイジェストで承認した有効な計画を一つだけ実行する。 |
| `status` | なし | 永続台帳と実行履歴を読む。 |
| `verify` | なし | 予定ファイル名と既知のサイズをPikPakと照合する。 |
| `cleanup` | ローカルファイルだけ | 別に承認する削除計画を作成または実行する。 |
| `rollback` | リモートの名前変更だけ | 承認済み同期計画で記録した名前変更を戻す。 |

`rollback`はアップロード済み動画を削除せず、管理対象外のリモートファイルも変更しません。
各コマンドのオプションは`myfans-to-pikpak <command> --help`で確認できます。

## 差分判定とファイル名

投稿本文の最初の空でない行をタイトルとして使います。
ファイル名はUnicodeを正規化し、Windowsで禁止される文字、空タイトル、予約名、末尾の禁止文字、長すぎる名前を補正します。

同じタイトルが複数ある場合は、区別に必要な長さの投稿ID接頭辞を付けます。

```text
同じタイトル [12345678].mp4
```

投稿ごとに、最終タイトル名があれば`skip`、以前の`投稿ID.mp4`があれば`rename`、リモートになければ`transfer`と判定します。
転送時は一致するローカルファイルを再利用し、必要な場合だけMyFansから取得します。
管理対象外のリモートファイルは警告へ含め、変更しません。

## JSONと自動処理の契約

すべての主要コマンドはグローバルオプション`--json`を受け付けます。
stdoutにはJSONオブジェクトを一つだけ書き、診断はstderrへ分離します。

```json
{
  "schemaVersion": 1,
  "command": "plan",
  "ok": true,
  "result": {},
  "warnings": [],
  "error": null
}
```

機械可読な契約は[`schemas/`](schemas)にあります。
自動処理ではメッセージ本文を解析せず、`ok`、`error.code`、プロセス終了コードで分岐してください。

| 終了コード | エラーコード | 意味 |
|---:|---|---|
| 1 | `INTERNAL_ERROR` | 分類されていない内部エラー。 |
| 2 | `USAGE_ERROR` | オプション、ID、対象、並列数が不正。 |
| 3 | `DEPENDENCY_MISSING` | 必要な実行ファイルが`PATH`にない。 |
| 3 | `AUTH_REQUIRED` | MyFans認証を取得できない。 |
| 4 | `SOURCE_ERROR` | MyFansの応答または投稿データが不正。 |
| 5 | `REMOTE_ERROR` | rcloneまたは設定済みリモートの処理に失敗。 |
| 6 | `REMOTE_CONFLICT` | リモートの項目を安全に照合できない。 |
| 7 | `PLAN_INVALID` | 計画の構造、ダイジェスト、ローカルパスが不正。 |
| 7 | `PLAN_STALE` | 計画が期限切れ、または計画後に外部状態が変化。 |
| 7 | `PLAN_NOT_CONFIRMED` | `--confirm`が計画ダイジェストと不一致。 |
| 8 | `DOWNLOAD_FAILED` | HTTPまたはFFmpegによる取得に失敗。 |
| 9 | `VERIFY_FAILED` | メディアまたはリモートの検証に失敗。 |
| 10 | `STATE_ERROR` | 台帳または状態ファイルを読み書きできない。 |

エラーメッセージは変更する場合がありますが、Schemaバージョン1では上記のコードを自動処理の契約とします。

## 状態と非公開ファイル

既定の状態ディレクトリは次のとおりです。

| OS | 状態ディレクトリ |
|---|---|
| Windows | `%LOCALAPPDATA%\myfans-to-pikpak` |
| macOS | `~/Library/Application Support/myfans-to-pikpak` |
| Linux | `$XDG_STATE_HOME/myfans-to-pikpak`、未設定時は`~/.local/state/myfans-to-pikpak` |

新しいディレクトリが存在せず、旧`myfans-pikpak`ディレクトリだけが存在する場合は、データを移動や削除せずに旧ディレクトリを使います。
両方が存在する場合は、新しい`myfans-to-pikpak`ディレクトリを優先します。

`--state-dir`と`--work-dir`で変更できます。
どちらにもファイルシステムのルートは指定できません。
状態は投稿単位の遷移後に原子的に保存するため、中断後も完了した処理を確認できます。

同期計画、削除計画、台帳、ブラウザープロファイル、rclone設定、ダウンロード済み動画は非公開情報として扱ってください。
標準のローカルパスはリポジトリの除外設定に含まれますが、公開前にはコミットと配布物を必ず確認してください。

## AIエージェントから使う

本プロジェクトはCLI自体をエージェントとの契約に使い、MCPサーバーは提供しません。
安定したJSON、JSON Schema、エラーコード、保存済み計画、ダイジェスト承認により、人間、スクリプト、AIエージェントが同じインターフェースを利用できます。

Codexへインポート作業を依頼する場合は、リポジトリのSkillを指定します。

```text
$myfans-to-pikpak-operator を使って、PLAN_ID_OR_URL から
pikpak:MyFans/example への同期計画を作ってください。
doctorと読み取り専用のplanまで実行し、操作、件数、警告、有効期限、
ダイジェストを報告してください。
私が同じダイジェストを承認するまでsyncを実行しないでください。
トークン、非公開タイトル、ローカルの絶対パスを出力しないでください。
```

保守作業では次のように依頼できます。

```text
$myfans-to-pikpak-maintainer を使って、この変更を実装してください。
安全条件とJSON契約を維持し、匿名fixtureだけを使い、npm run checkを実行してください。
変更ファイル、検証結果、残る制約を報告してください。
```

正本は[`AGENTS.md`](AGENTS.md)と[`.agents/skills`](.agents/skills)です。
Claude Code用のコピーは`.claude/skills`へ生成し、`.github/copilot-instructions.md`は対応するエージェントを同じ規則へ案内します。
Skillを探索できないエージェントは、対象の`SKILL.md`を直接読んだうえで、READMEにあるCLIコマンドを実行できます。

CLIを主役にしながらAgent Skillを見つけられる構成は、[uv](https://github.com/astral-sh/uv)、[mise](https://github.com/jdx/mise)、[GitHub CLI](https://github.com/cli/cli)、[rclone](https://github.com/rclone/rclone)の構成を参考にしています。

## トラブルシューティング

- `AUTH_REQUIRED`では、専用のChromiumが起動中でMyFansへログイン済みか、指定したCDP URLへlocalhostから接続できるかを確認します。
- `DEPENDENCY_MISSING`では、表示された実行ファイルを導入し、`PATH`から実行できるかを確認します。
- `REMOTE_ERROR`では、`rclone listremotes`でリモート名を確認し、rcloneから直接接続を試します。
- `PLAN_STALE`では古い計画を再試行せず、新しい計画を作って内容を確認します。
- `VERIFY_FAILED`ではローカルファイルを残し、削除前に表示された名前とサイズを調べます。
- `REMOTE_CONFLICT`では両方のファイルを保持し、想定外のファイルを整理してから新しい計画を作ります。

## 開発

```console
npm ci
npm run check
npm audit --omit=dev
npm pack --dry-run
```

`npm run check`は、生成済みAgent Skill、フォーマット、lint、TypeScript、カバレッジ基準、本番ビルド、CLIのスモークテストを確認します。
テストではMyFans、メディア処理、外部プロセス、ストレージの偽実装を使い、実サービスへ接続しません。

ソースコードの主な構成は次のとおりです。

```text
src/cli.ts       実行入口
src/cli/         Commanderの配線、オプション、出力契約
src/commands/    公開コマンドごとの実装
src/core/        計画、命名、検証、安全規則
src/services/    同期処理の組み立て
src/adapters/    MyFans、ブラウザー認証、FFmpeg、rclone、外部プロセス
src/state/       計画と台帳の原子的な保存
schemas/         公開JSON Schema
```

変更前に[`AGENTS.md`](AGENTS.md)を読み、変更範囲を限定し、匿名fixtureを使って上記の四コマンドを実行してください。
不具合報告には、CLIバージョン、OS、Node.jsバージョン、コマンド、エラーコード、秘匿情報を除いた出力を含めます。
認証情報の漏えい、意図しない上書きや削除、パストラバーサル、認証回避は公開Issueへ投稿しないでください。
GitHubの非公開脆弱性報告が利用できる場合はその機能を使い、利用できない場合は認証情報や非公開動画を添付せずに管理者へ連絡してください。

## 制約

- MyFansの非公開インターフェースに依存するため、サービス側の変更で動かなくなる可能性があります。
- DRMやアクセス制御を回避しません。
- 同期計画の有効期限は24時間です。
- PikPakが利用可能なハッシュを返さない場合、検証はファイル名と既知のサイズまでです。
- 通常のアカウント利用とは別に、公開や利用の許可が必要になる場合があります。

## ライセンス

[MIT License](LICENSE)で提供します。
製品名と商標は各権利者に帰属します。
