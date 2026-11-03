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

## 音源(任意)

アプリは合成音で鳴りますが、録音済みの音を読み込んで使うこともできます(「🥁 録音した音を使う」)。**音源ファイルはこのリポジトリに含まれていません。** 各自で入手し、自分の端末に読み込んでください(読み込んだ音は、その端末のブラウザの中にだけ保存されます)。

- ファイル名からパーツを自動で判定します(例: `snare_…`, `hihatClosed_…`, `hihatOpen_…`, `kick_…`, `hiTom_…`, `loTom_…`, `crash…`, `ride…`)。
- ファイル名に `Ghost / PP / P / MP / F / FF` があれば、その順(弱い→強い)で演奏の強さに割り当てます。
- 読み込める合計は約80MBまでです。パーツごとに数個〜10個ほど選ぶのがおすすめです。

動作を確かめた音源の例: **Salamander Drumkit**(Alexander Holm 作、[CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/))。入手先は [Internet Archive](https://archive.org/details/SalamanderDrumkit) などです(配布元の案内: <https://github.com/endolith/Salamander-Drumkit>)。音源を配布・公開する場合は、各音源のライセンスに従って作者名の表記などを行ってください。

## ライセンス

コードは MIT。録音した音源を使う場合は、再配布してよいライセンスのものだけを使ってください(`samples/README.md`)。

## ホーム画面に追加(iPad / iPhone)

公開ページを Safari で開き、共有ボタン →「ホーム画面に追加」で、アイコン付きのアプリのように起動できます(アイコンは `icons/`、設定は `manifest.webmanifest`)。
