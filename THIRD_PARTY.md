# 来源与许可

## 主程序与扩展

本仓库的桌面控制、持续任务和原界面集成源码以 **AGPL-3.0-or-later** 发布，全文见 `LICENSE`。这是一份基于原应用的扩展，不声称是官方 Coopanion，不复制原程序的完整发行包、人物美术、账号配置或运行数据。

- [Pal-AI-Lab/Coopanion](https://github.com/Pal-AI-Lab/Coopanion)：AGPL-3.0-or-later。本扩展对固定 0.2.19 便携版及其 `cortico-world-desktop-pet` 做有限可回退补丁；原版权和许可证不变。原程序和美术由使用者从官方来源另行取得。
- `install-qq-integration.mjs` 可对使用者已安装的 `cortico-world-qqbot` 0.4.2 加回复投递钩子。原模块是 AGPL-3.0-or-later，本仓库不捆绑该模块或登录信息。

## 智控台语音配置页

`control-ui/src` 中的模型表、动态字段、音色管理与共用组件基于 [xiaozhi-esp32-server](https://github.com/xinnan-tech/xiaozhi-esp32-server) 的 manager-web 移植，按当前应用主题和本机存储重新接入。原 MIT 版权和许可保留于 `control-ui/LICENSE.xiaozhi` 与 `LICENSES/xiaozhi-MIT.txt`。原始文件路径与快照哈希在 `control-ui/upstream-manifest.json`。MIT 部分继续适用其原许可。

页面的 Vue 2.7.16、Element UI 2.15.14、vue-i18n 8.28.2，以及构建工具和各间接依赖，分别保留各自 npm 包中的版权及许可证。Electron 45.3.1 按其 MIT 及 Chromium / 第三方许可分发；依赖由使用者安装，不把本机 node_modules 打包进源码。

## 参考实现

参考 [xiangshazaosha/dsh-dafeiyu-deploy](https://github.com/xiangshazaosha/dsh-dafeiyu-deploy) 快照 `3c6539dd68a8e217ba6ea94ade87d437ebf10815`：

- `reply-policy.mjs` 的回复分段改编自 `assets/voice-controls/index.mjs`。
- `execution-profile.mjs` 的保存配置修订思路来自 `assets/breeze-cover/saved-profile.mjs`。
- 任务去重、分层素材缓存和投递去重参考 `assets/song-library/request-guard.mjs` 与 `references/cover-routing-and-reuse.md`。
- 本地翻唱的处理顺序与参数身份核对参考 `assets/breeze-cover/studio.mjs` 和 `separate.py`，按本项目任务和素材库重写。

原仓库上述原创代码采用 CC0-1.0，全文保留于 `LICENSES/reference-CC0.txt`。没有复制独立受限许可的 `.breeze` 预设或声音模型。

## 可选音频环境与媒体

本仓库没有捆绑音色权重、索引、训练集、示例歌曲或用户录音，也不授予这些资产的权利。可选的 Applio 与 audio-separator 代码采用 MIT；各分离模型、RVC 声音模型及依赖需要分别检查其来源与许可。FFmpeg 不随源码分发，按使用者选择的构建遵守相应许可。

网易云歌曲资料、可用音源及抖音音乐榜元数据取自相应平台当前可访问的接口，访问可能变化或失败。本仓库不提供账号 Cookie、签名绕过、付费解锁或跨地区伪装。平台内容不因本仓库开源而变成可自由再分发内容。

## 仓库初始化模板

仓库初始化时选择的 MPL-2.0 许可模板归档于 `LICENSES/initial-repository-MPL-2.0.txt`。本次发布的桌面扩展源码使用与上游集成相适应的 AGPL-3.0-or-later；各单独标明的 MIT / CC0 部分保留原许可。

## 0.14 整合安装包

安装包从固定哈希的官方 Coopanion 0.2.19 便携发行包构建并保留其组件许可；不含 `web/whale` 的受限贴图，默认提供 Coo。Windows/Electron/MinGit/原生语音库等沿用各自许可证，具体来源在 `installer/inputs.lock.json` 和发布组件清单中。MeloTTS 模型为 MIT，Kokoro int8 模型为 Apache-2.0，Whisper small int8 模型按 Whisper 的 MIT 许可，模型目录内许可证随包保存。模型来自 sherpa-onnx 官方模型发行或其固定校验的模型来源。原应用修改点及全部构建源码公开；发布资产另附对应原应用源码目录。不把代码许可扩展为人物美术、商标或声音人格的许可。
