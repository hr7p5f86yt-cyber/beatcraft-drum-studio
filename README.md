# BeatCraft Drum Studio

ブラウザで動くドラム譜エディタです(iPad の Safari / Windows の Chrome・Edge)。1 枚の HTML(`index.html`)で動きます。

- 五線のドラム譜を、タップ(iPad)またはキーボード(PC)で入力
- 強弱記号・アクセント・ゴースト・3連符・連桁・繰り返し(`|: :|`)・小節繰り返し(%)・複数小節休符・拍子の途中変更
- 計算で作ったドラム音で再生(録音した音ファイルに差し替えも可)。再生中の自動スクロール
- 画像・写真・PDF からの簡易読み取り(取り込み後に手直しが必要です)

## 使い方

公開ページ: GitHub Pages の URL(リポジトリの Settings → Pages で設定)

保存・読み込みはブラウザ内の保存領域を使います。環境によっては保存できないので、「📂 開く」→「バックアップ」でテキストとして控えられます。個人情報や外部サーバーへの送信はありません(画像・PDF の読み取りもブラウザ内で行います。PDF を読む部品 pdf.js だけは、PDF を使うときに cdnjs から読み込みます)。

## 開発

ソースは `src/` にあります。1 枚の HTML にまとめるには:

```
python3 build.py        # → index.html
```

テスト(Node と Playwright が必要):

```
node test/model.test.js && node test/sim.test.js && node test/ts.test.js && node test/expr.test.js
node test/make-wavs.js
node test/e2e.js index.html
```

## ライセンス

コードは MIT。録音した音源を使う場合は、再配布してよいライセンスのものだけを使ってください(`samples/README.md`)。
