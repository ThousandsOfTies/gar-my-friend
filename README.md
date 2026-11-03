# gar-my-friend

GarMyFriendの共通アプリです。濃紺の輪郭・白い顔模様・オレンジのくちばしを持つペンギンの顔を幾何図形で描きます。ノブの回転で8つの表情を切り替え、押下でまばたきします。表情の補間とアニメーションはこのアプリが処理します。

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

`tools/audio.cjs devices|check|record|play|say` provides explicit local USB-audio
checks on Linux. The Product sets `GAR_HARDWARE_DIR` and `GAR_TOOLS_ROOT` and
packages the shared `targets/linux-device/runtime/alsa-audio/audio.cjs` adapter.
Product `audio.csv` contains `direction,device` rows for `capture` and `playback`.
Empty devices disable commands until setup. When this CSV exists, speech shares
its playback selection; older Products without it retain effects.csv's device.
Recording is bounded to 1–15 seconds, 16kHz mono PCM. Only successful WAVs are
published, existing files are preserved, and cancellation discards partial data.
The CLI does not record continuously, recognize speech, upload audio, or actuate
the body. Its standalone replay/speech is separate from the running face service.

The optional `GAR_FRIEND_CONTROL_SOCKET` enables a private Linux Unix socket for
semantic commands against the running application. `friend-control.cjs` owns
Gemini-independent tool schemas/instructions and execution: `change_emotion`,
`move_body`, and `get_friend_state`. Expression candidates come from canonical
expression data. Body tools require an explicit starting pose and await actual
native completion; nonblocking manual commands use the same ServoOutput.
`GAR_EFFECTS_DIR` optionally selects effect configuration separately from GPIO/SPI
CSV paths. The Product enables this only in its dedicated simulator today.
Speaking state is renewed by the playback adapter and expires without renewal.
No API key or audio is accepted by the local command socket. Browser/ALSA audio
and Gemini connection are replaceable adapters, not a second face renderer.

`tools/live.cjs check|start` adds opt-in physical USB/Gemini conversation. The
Product injects hardware/tools/binary paths; `face.cjs` starts Live only with
`GAR_FRIEND_LIVE=1`. `live-session.cjs` coordinates raw ALSA and the same
DOM-independent Gemini protocol used by the browser. `GEMINI_API_KEY` is passed
at launch and removed before child processes start. Face-only startup is unchanged.
Body tools require explicit `--body --from stand|lie`; without that, only voice
and expression tools are available. Default half-duplex suppresses microphone
upload during playback and a 250 ms echo tail; `--duplex` enables simultaneous
audio when the caller has validated echo cancellation. On errors/shutdown,
audio and any enabled motion stop. No key or recording is saved.
