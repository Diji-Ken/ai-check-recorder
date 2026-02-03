# 配布用リリース手順（ワンクリックダウンロード用）

招待ページの「アプリをダウンロード」ボタンで、**押すだけでそのままダウンロード**が始まるようにするには、GitHub Releases にビルド済みZIPをアップロードする必要があります。

## 前提

- GitHub にリポジトリ `Diji-Ken/ai-check-recorder` があること
- [GitHub CLI](https://cli.github.com/) がインストール済み: `brew install gh`
- 認証済み: `gh auth login`

## 初回のみ：リポジトリ作成

GitHub で新規リポジトリを作成する場合:

1. https://github.com/new で `ai-check-recorder` を作成（Public）
2. ローカルでこのフォルダを別リポジトリとして push するか、既存の Diji-Ken/ai-check-recorder にこのコードを push

## リリース作成（毎回）

```bash
cd path/to/ai-check-recorder
chmod +x scripts/release-for-download.sh
./scripts/release-for-download.sh
```

または手動:

```bash
npm run build && npm run dist:mac && npm run dist:win
# release/ に ZIP ができるので、GitHub の Releases ページで
# 新規リリース (v1.0.0 など) を作成し、以下をアップロード:
# - AI-Check-Recorder-Mac-arm64.zip  (AI Check Recorder-1.0.0-arm64-mac.zip をリネーム)
# - AI-Check-Recorder-Windows.zip    (AI Check Recorder-1.0.0-win.zip をリネーム)
```

**重要:** アップロード時のファイル名は **必ず** 以下にすること（招待ページのURLと一致）。

- `AI-Check-Recorder-Mac-arm64.zip`
- `AI-Check-Recorder-Windows.zip`

## 動作確認

- Mac: https://github.com/Diji-Ken/ai-check-recorder/releases/latest/download/AI-Check-Recorder-Mac-arm64.zip  
- Windows: https://github.com/Diji-Ken/ai-check-recorder/releases/latest/download/AI-Check-Recorder-Windows.zip  

ブラウザで上記URLを開くと、ログインなしでそのままダウンロードが始まればOKです。
