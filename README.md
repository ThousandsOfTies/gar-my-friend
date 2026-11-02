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

Productの`gpio.csv`には任意の`debounce_us`列を追加できます。
`encoder_a`・`encoder_b`・`encoder_sw`へ同じ0〜1000000のマイクロ秒値を指定すると、
入力アダプターが共有読取の`--debounce-us`へ渡し、GPIOを要求するときにOSへ設定します。
列の省略・空欄・0は従来どおりデバウンスを要求しません。
値はProductの配線プロファイルが所有し、アプリやドライバーにボード固有の値を埋め込みません。
この設定を使うProductは、`--debounce-us`に対応したgar-toolsのコミットも固定してください。

WebPanelはアプリを起動せず、仮想ドライバの画素と入力信号を中継します。
WebPanelを終了しても、このアプリのGPIO入力とSPI描画は継続します。

## 履歴

元のGarMyFriendからアプリに関係するファイルの変更履歴を引き継いでいます。
機種別Productは `GarMyFriend-OrangePiZero2W` に改名しました。

## Optional body and Japanese speech

Initialize with `git submodule update --init --recursive`. `dependencies/gar-servo-pet` pins the existing C servo controller; it is not copied into this application. Set `GAR_BUILD_SERVO=1` in the Product build environment to compile `gar-servoctl`. Product CSVs own calibration, I2C assignment and output enablement. Missing `effects.csv` preserves face-only operation. `FriendRuntime` coordinates selected expression text, bounded neutral output and playback-time mouth animation. Open JTalk/dictionary/voice and ALSA are external optional runtime dependencies. `tools/say.cjs` tests speech from the selected Product CSVs.

`tools/body.cjs forward|backward|stop|lie|stand` exposes bounded body modes.
For motion, explicitly supply `--from stand|lie`; the mechanism must actually be
at that pose. `--dry-run` prints keyframes without device access or native child
processes. Product `body-motions.csv` owns role-based keyframes and timing; the
application maps them to calibration-file order for the native `sequence`
command. `FriendRuntime.command(mode, {from})` exposes the same semantic API for
local controls and future LLM tools. Stop preempts active work; modes are never
queued or repeated forever. Every native action ends FULL_OFF, so no physical
pose is inferred after output is disabled. Ground locomotion and load-bearing
poses require physical tuning; these patterns alone do not validate either.
