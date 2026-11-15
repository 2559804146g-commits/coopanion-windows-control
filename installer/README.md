# 整合安装程序

安装包包含固定版本的原应用、控制扩展、Node 22、中文离线朗读和 Whisper 语音识别模型。使用者无需执行命令、安装 Node 或注册本地扩展。首次只需在同一个原管理窗口填写自己的聊天模型账号，再决定应用权限。

所有输入来源与 SHA256 在 `inputs.lock.json`；全新目录构建，不读取开发机的任何用户配置。原版直接从官方便携发行包校验提取，按固定源代码接口集成 World 和宿主。默认使用有明确代码许可的 Coo，原 `web/whale` 贴图不纳入再分发。原版及各第三方声明全部保留。原语音模型经固定哈希校验，MeloTTS 为 MIT，Kokoro 和相应运行库按其独立许可，Whisper 为 MIT。个人云端音色和翻唱模型不打包。

程序安装在当前用户 Programs，数据独立保存在 `%LOCALAPPDATA%/CompanionControl/Profile`。升级不包含用户数据；卸载按明确安装文件清单删除程序，保留用户数据和自行添加的文件，不递归删除整个安装目录。运行中程序会阻止覆盖，不强行结束用户任务。发现别的桌宠占用相同端口时提示退出，避免连错已有账号。

开发者可在 Windows 上构建（需 Python 3.13、原生 .NET Framework 编译器）：

```powershell
npm ci
npm --prefix control-ui ci
npm run build:voice
python installer/build.py --work D:/CompanionControlBuild --output D:/CompanionControlRelease
```

`--work` 必须没有旧 payload；输入下载缓存可预先放在其 downloads 目录。产物为单文件 NSIS 安装程序、SHA256 和完整组件清单。GitHub 的发布工作流会在检查实际离线合成、识别、全新安装、桌面快捷方式、直接启动时资料复用与卸载保留成功后，附上对应应用源码再发布预发行版。发布到相同版本时不会自动覆盖已有公开资产。

当前尚无代码签名证书；系统可能显示未知发布者。代码签名需要维护者自己的证书，构建不修改 Windows 的保护设置。翻唱是另一个可选的制作模块，控制版不预置其 Python 推理环境或受限歌声音色；它不影响已内置的对话语音和应用控制。
