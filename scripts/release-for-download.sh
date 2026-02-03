#!/bin/bash
# GitHub Releases にアップロードして、招待ページからワンクリックでダウンロードできるようにする
# 前提: gh コマンドがインストール済み (brew install gh)、かつ gh auth login 済み
set -e
cd "$(dirname "$0")/.."
REPO="${GITHUB_REPO:-Diji-Ken/ai-check-recorder}"
VERSION="${1:-v$(node -p "require('./package.json').version")}"

echo "==> ビルド (Mac arm64, Windows)..."
npm run build
npm run dist:mac   # arm64 を優先で生成
npm run dist:win

echo "==> アップロード用ファイル名にコピー..."
RELEASE_DIR="release"
cd "$RELEASE_DIR"
MAC_SRC="AI Check Recorder-1.0.0-arm64-mac.zip"
WIN_SRC="AI Check Recorder-1.0.0-win.zip"

if [ ! -f "$MAC_SRC" ]; then
  echo "エラー: $MAC_SRC が見つかりません。先に npm run dist:mac を実行してください。"
  exit 1
fi
if [ ! -f "$WIN_SRC" ]; then
  echo "エラー: $WIN_SRC が見つかりません。先に npm run dist:win を実行してください。"
  exit 1
fi

cp "$MAC_SRC" "AI-Check-Recorder-Mac-arm64.zip"
cp "$WIN_SRC" "AI-Check-Recorder-Windows.zip"
cd ..

echo "==> GitHub Release 作成・アップロード..."
gh release create "$VERSION" \
  "$RELEASE_DIR/AI-Check-Recorder-Mac-arm64.zip" \
  "$RELEASE_DIR/AI-Check-Recorder-Windows.zip" \
  --repo "$REPO" \
  --title "AI Check Recorder $VERSION" \
  --notes "PC記録ツール。招待ページの「アプリをダウンロード」から利用できます。"

echo "==> 完了"
echo "ダウンロードURL:"
echo "  Mac:    https://github.com/$REPO/releases/latest/download/AI-Check-Recorder-Mac-arm64.zip"
echo "  Windows: https://github.com/$REPO/releases/latest/download/AI-Check-Recorder-Windows.zip"
