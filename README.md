# gar-my-friend

GarMyFriendの共通アプリです。幾何図形で目・鼻・口・頬を描き、ノブの回転で8つの表情を切り替え、押下でまばたきします。表情の補間とアニメーションはこのアプリが処理します。

実機への導入、配線、VirtualBoxとWebPanelの使い方は、機種別Productの
[GarMyFriend-OrangePiZero2W](https://github.com/ThousandsOfTies/GarMyFriend-OrangePiZero2W)を参照してください。Productがこのリポジトリとgar-toolsのコミットをサブモジュールで固定します。

| 場所 | 役割 |
| --- | --- |
| `application/` | 表情・アニメーション、GPIO入力、SPI出力、ProductのCSV読込 |
| `firmware/` | 240×240 RGB565のC++描画コア |
| `shared/` | 表情データの正本と生成処理 |
| `preview/` | 任意で使うブラウザー上の顔デザイン用プレビュー |
| `tests/` | 表情処理とCSV読込のテスト |

## 検証

Node.js 18以上を使用します。基本テストには追加パッケージが不要です。

```sh
npm test
```

プレビューを再生成するときは `npm run build`、ブラウザー試験には `npm ci` 後に
`npm run test:preview` を使います。WindowsはEdge、それ以外はPlaywrightのChromiumを使います。

## Productからのビルドと実行

Linux GPIO v2とSPIを使用します。VMでも実機でも同じアプリを実行します。
以下はProductルートで実行する例です。

```sh
GAR_TOOLS_ROOT="$PWD/sources/gar-tools" \
GAR_BUILD_DIR="$PWD/build" \
sh sources/gar-my-friend/tools/build-native.sh

GAR_HARDWARE_DIR="$PWD/hardware" \
GAR_BIN_DIR="$PWD/build" \
node sources/gar-my-friend/application/face.cjs
```

`GAR_HARDWARE_DIR` はProductの `gpio.csv` と `spi.csv` があるディレクトリーです。
実機用の番号・電源・配線はProductが管理し、アプリには埋め込みません。
`GAR_BIN_DIR` を省略した場合は、このアプリの `build/` を使います。
ARM64向けのコンパイラー選択や自動起動サービスもProductが担当します。

WebPanelはアプリを起動せず、仮想ドライバの画素と入力信号を中継します。
WebPanelを終了しても、このアプリのGPIO入力とSPI描画は継続します。

## 履歴

元のGarMyFriendからアプリに関係するファイルの変更履歴を引き継いでいます。
機種別Productは `GarMyFriend-OrangePiZero2W` に改名しました。
