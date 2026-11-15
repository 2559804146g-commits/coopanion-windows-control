# 原管理窗口中的语音配置

保留智控台的模型配置与音色管理功能，使用当前应用的字段、配色和字体。密钥经父页面的受限通道保存到本机，不发给角色模型；页面只读取遮罩值。

安装依赖后，在仓库根目录运行 `npm run build:voice`。产物在 `bridge/control-ui`，安装器复制至原桌宠已经允许的静态来源，不需要另一套服务或数据库。来源清单见 upstream-manifest.json，原 MIT 许可见 LICENSE.xiaozhi。
