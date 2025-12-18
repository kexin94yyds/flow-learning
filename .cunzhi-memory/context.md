# 项目上下文信息

- ## iOS 应用开发进度 (2025-12-17)

### 已完成
1. Capacitor 项目配置 - webapp 转 iOS
2. 后台剪贴板监听 - 私有 PBServerConnection API + Darwin 通知
3. 静音音频后台保活 - AVAudioPlayer 循环
4. 本地通知 - 后台检测剪贴板变化并发送通知 ✅
5. 点击通知传递内容给 WebView - sendClipboardToWebView

### 待完成
1. iOS 移动端 UI 适配 - sidebar 太宽
2. 自动弹出添加界面 - handleClipboardFromNative 未触发
3. 测试完整流程

### 关键文件
- ios/App/App/AppDelegate.swift - 后台监听
- flow.js - window.handleClipboardFromNative
- www/index.html - Flow UI

### 分支
feature/ios-app
- iOS 端 flow 剪贴板自动检测逻辑完善：修复了因 index.html 与 flow.html 结构不一致导致的旧版弹窗回退问题；在 index.html 中同步了 captureModal 样式和结构；更新了 flow.js 中的 handleClipboardFromNative 直接调用 openCaptureModal。
- | PAT-2025-003 | Twitter 抓取增强 | 移动端抓取 X/Twitter 推文时，常规 fetch 会被拦截。应优先使用 fxtwitter.com 镜像并配合 CORS 代理，以获取完整的推文内容（og:description）和预览图（og:image）。 |
- 会话总结：为 iOS 端 Flow 实现了类似桌面端的剪贴板自动检测和全功能 Capture 弹窗。解决了 Twitter/X 预览图和标题抓取不完整的问题，通过引入 fxtwitter 镜像抓取优化了移动端的元数据获取成功率。同步了 www 与 iOS public 目录下的入口文件。
- 本次会话完成了 iOS 端 GUI 的全面极简重构：将侧边栏改为顶部横向图标 Tab 栏，压缩了顶部 Header 空间，实现了卡片双列显示，并统一了药丸形 UI 风格。修复了 Twitter 平台识别逻辑和顶部双重间距问题。同步了 www 与 iOS public 目录。
