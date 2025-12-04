const { app, BrowserWindow, globalShortcut, ipcMain, shell, clipboard, screen, dialog, nativeImage } = require('electron');
const path = require('path');
const Store = require('electron-store');
const fetch = require('node-fetch');
const cheerio = require('cheerio');
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const ip = require('ip');
const QRCode = require('qrcode');

const store = new Store();
const isMac = process.platform === 'darwin';
const PINNED_ON_TOP_LEVEL = isMac ? 'pop-up-menu' : 'screen-saver'; // 较低层级，避免遮挡拖拽预览
const DRAGGING_ON_TOP_LEVEL = isMac ? 'floating' : 'screen-saver';  // 拖拽时进一步降低层级
const CAPTURE_ON_TOP_LEVEL = PINNED_ON_TOP_LEVEL;
let mainWindow;
let captureWindow;
let lastShowAt = 0; // 记录最近一次显示时间，用于忽略刚显示时的 blur
let server; // Express server instance

// --- Local Server for Mobile Sync ---
function startLocalServer() {
  // 如果已有服务器实例，先关闭它
  if (server) {
    try {
      server.close();
    } catch (e) {
      console.log('Closing existing server:', e.message);
    }
  }

  const expressApp = express();
  const PORT = 3000;
  const WebSocket = require('ws');

  expressApp.use(cors());
  expressApp.use(bodyParser.json());

  // Serve static files (Web Dashboard)
  expressApp.use(express.static(__dirname));

  // Create HTTP server
  server = require('http').createServer(expressApp);

  // Create WebSocket server
  const wss = new WebSocket.Server({ server });

  wss.on('connection', (ws) => {
    console.log('Client connected');
    ws.on('close', () => console.log('Client disconnected'));
  });

  // Broadcast function
  const broadcastUpdate = (data) => {
    // Notify Electron window
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('refresh-items');
    }

    // Notify WebSocket clients
    const message = JSON.stringify({ type: 'data-updated', data });
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  };

  // API Endpoints
  expressApp.get('/api/items', (req, res) => {
    const items = store.get('items', []);
    res.json(items);
  });

  expressApp.post('/api/items', (req, res) => {
    const newItem = req.body;
    const items = store.get('items', []);
    items.unshift(newItem);
    store.set('items', items);

    broadcastUpdate(items);

    res.json(items);
  });

  expressApp.delete('/api/items/:id', (req, res) => {
    const { id } = req.params;
    const items = store.get('items', []);
    const newItems = items.filter(i => i.id !== id);
    store.set('items', newItems);

    broadcastUpdate(newItems);

    res.json(newItems);
  });

  expressApp.put('/api/items', (req, res) => {
    const newItems = req.body;
    store.set('items', newItems);

    broadcastUpdate(newItems);

    res.json(newItems);
  });

  expressApp.put('/api/items/pin/:id', (req, res) => {
    const { id } = req.params;
    let items = store.get('items', []);
    const index = items.findIndex(i => i.id === id);

    if (index !== -1) {
      items[index].pinned = !items[index].pinned;
      items.sort((a, b) => {
        if (a.pinned === b.pinned) return 0;
        return a.pinned ? -1 : 1;
      });
      store.set('items', items);

      broadcastUpdate(items);
    }

    res.json(items);
  });

  expressApp.get('/api/metadata', async (req, res) => {
    const { url } = req.query;
    if (!url) return res.json({ title: '', image: '' });

    try {
      // YouTube oEmbed API
      if (/youtube\.com\/watch|youtu\.be\//i.test(url)) {
        try {
          const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
          const oembedRes = await fetch(oembedUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
            timeout: 5000
          });
          if (oembedRes.ok) {
            const data = await oembedRes.json();
            return res.json({
              title: (data.title || '').trim(),
              image: data.thumbnail_url || ''
            });
          }
        } catch (e) {
          console.error('YouTube oEmbed error:', e);
        }
      }

      // Generic fetch
      const response = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
        timeout: 5000
      });
      const html = await response.text();
      const $ = cheerio.load(html);

      const title = $('meta[property="og:title"]').attr('content') ||
        $('meta[name="twitter:title"]').attr('content') ||
        $('title').text() || '';

      const image = $('meta[property="og:image"]').attr('content') ||
        $('meta[name="twitter:image"]').attr('content') || '';

      res.json({ title: title.trim(), image });
    } catch (error) {
      res.json({ title: '', image: '' });
    }
  });

  // 设置错误处理（必须在 listen 之前）
  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      console.error(`端口 ${PORT} 已被占用，请关闭占用该端口的程序或重启应用`);
      // 显示错误对话框
      if (mainWindow && !mainWindow.isDestroyed()) {
        dialog.showErrorBox(
          '端口占用错误',
          `端口 ${PORT} 已被占用。\n\n可能的原因：\n1. 应用的其他实例正在运行\n2. 其他程序占用了该端口\n\n解决方案：\n- 关闭其他占用端口的程序\n- 或重启应用`
        );
      }
    } else {
      console.error('Server error:', e);
    }
  });

  // 尝试启动服务器
  try {
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`Server running at http://${ip.address()}:${PORT}`);
    });
  } catch (e) {
    console.error('Failed to start server:', e);
    if (e.code === 'EADDRINUSE') {
      if (mainWindow && !mainWindow.isDestroyed()) {
        dialog.showErrorBox(
          '端口占用错误',
          `端口 ${PORT} 已被占用。\n\n请关闭占用该端口的程序后重试。`
        );
      }
    }
  }
}

let mainWindowPinned = false; // 主窗口置顶状态
let isDragging = false; // 拖拽状态，拖拽时不隐藏窗口
let captureWindowPinned = false; // Capture 窗口置顶状态
let captureWindowWasOnTopDuringDrag = false; // 记录拖拽前的置顶状态，用于恢复

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 800,
    show: false,
    alwaysOnTop: false, // 默认不置顶
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    icon: path.join(__dirname, 'icon.png')
  });

  mainWindow.loadFile('flow.html');

  // 设置在所有工作区可见（包括全屏应用）
  try {
    mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  } catch (_) { }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // 失去焦点时隐藏（仅在非置顶状态且非拖拽状态）
  mainWindow.on('blur', () => {
    if (!mainWindowPinned && !isDragging && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.hide();
    }
  });

  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

function createCaptureWindow() {
  captureWindow = new BrowserWindow({
    width: 500,
    height: 650,
    show: false,
    frame: false, // 无边框
    resizable: false,
    alwaysOnTop: true, // 永远置顶
    transparent: true, // 支持透明背景
    hasShadow: true,
    skipTaskbar: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  captureWindow.loadFile('capture.html');

  // 失去焦点时隐藏（但忽略刚显示后的短暂失焦，以及置顶状态）
  captureWindow.on('blur', () => {
    if (captureWindowPinned) return; // 置顶时不隐藏
    
    const elapsed = Date.now() - lastShowAt;
    if (elapsed < 800) return; // 忽略刚显示后的短暂失焦

    setTimeout(() => {
      try {
        if (captureWindow && !captureWindow.isDestroyed() && !captureWindow.isFocused() && !captureWindowPinned) {
          captureWindow.hide();
        }
      } catch (err) { }
    }, 200);
  });
}

// 在所有工作区（包括全屏）显示窗口
async function showCaptureOnActiveSpace() {
  if (!captureWindow || captureWindow.isDestroyed()) {
    createCaptureWindow();
    return;
  }

  // 获取鼠标所在显示器
  const cursorPoint = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursorPoint);
  const workArea = display.workArea;

  const { width: winW, height: winH } = captureWindow.getBounds();
  const targetX = Math.round(workArea.x + (workArea.width - winW) / 2);
  const targetY = Math.round(workArea.y + (workArea.height - winH) / 3); // 偏上一点

  console.log('[DEBUG] cursorPoint:', cursorPoint);
  console.log('[DEBUG] display:', display.id, workArea);
  console.log('[DEBUG] targetX/Y:', targetX, targetY);

  captureWindow.setPosition(targetX, targetY);

  // 临时在所有工作区可见（包括全屏）
  try {
    captureWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    console.log('[DEBUG] setVisibleOnAllWorkspaces(true) called');
  } catch (_) { }

  // 使用最高层级
  try {
    captureWindow.setAlwaysOnTop(true, CAPTURE_ON_TOP_LEVEL);
  } catch (_) { }

  captureWindow.show();
  captureWindow.focus();
  lastShowAt = Date.now();

  // 通知渲染进程窗口已显示
  if (captureWindow && !captureWindow.isDestroyed() && captureWindow.webContents) {
    try {
      captureWindow.webContents.send('window-shown');
    } catch (err) { }
  }

  // 🔑 关键修复：不再还原工作区可见性
  // 之前 200ms 后调用 setVisibleOnAllWorkspaces(false) 会导致窗口在全屏应用前面来回跳动
  // 因为这会让窗口回到原来的 Space，而不是停留在当前全屏应用的 Space
  // 保持 setVisibleOnAllWorkspaces(true) 可以让窗口始终覆盖在当前 Space（包括全屏应用）
  console.log('[SHOW_CAPTURE] 保持窗口在所有工作区可见（避免全屏应用前跳动）');
}

app.whenReady().then(() => {
  createMainWindow();
  createCaptureWindow();
  startLocalServer();

  // 注册全局快捷键
  const ret = globalShortcut.register('CommandOrControl+Shift+I', async () => {
    if (captureWindow) {
      if (captureWindow.isVisible()) {
        captureWindow.hide();
      } else {
        await showCaptureOnActiveSpace();
      }
    } else {
      createCaptureWindow();
    }
  });

  if (!ret) {
    console.log('⚠️ 快捷键 Shift+Cmd+I 注册失败（可能已被其他应用占用）');
  } else {
    console.log('✅ 快捷键 Shift+Cmd+I 注册成功');
  }

  app.on('activate', () => {
    if (!mainWindow) createMainWindow();
    if (mainWindow) mainWindow.show();
  });
});

app.on('before-quit', () => {
  app.isQuitting = true;
  if (server) server.close();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

// --- IPC 通信 ---

ipcMain.on('hide-capture-window', () => {
  if (captureWindow) captureWindow.hide();
});

ipcMain.on('item-saved', () => {
  if (mainWindow) {
    mainWindow.webContents.send('refresh-items');
  }
});

ipcMain.on('open-dashboard', () => {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  }
});

ipcMain.handle('get-items', () => {
  return store.get('items', []);
});

ipcMain.handle('set-items', (event, items) => {
  store.set('items', items);
  return items;
});

ipcMain.handle('save-item', (event, item) => {
  const items = store.get('items', []);
  items.unshift(item);
  store.set('items', items);
  return items;
});

ipcMain.handle('delete-item', (event, id) => {
  const items = store.get('items', []);
  const newItems = items.filter(i => i.id !== id);
  store.set('items', newItems);
  return newItems;
});

ipcMain.handle('update-items', (event, newItems) => {
  store.set('items', newItems);
  return newItems;
});

ipcMain.handle('toggle-pin', (event, id) => {
  let items = store.get('items', []);
  const index = items.findIndex(i => i.id === id);
  if (index !== -1) {
    items[index].pinned = !items[index].pinned;
    items.sort((a, b) => {
      if (a.pinned === b.pinned) return 0;
      return a.pinned ? -1 : 1;
    });
    store.set('items', items);
  }
  return items;
});

ipcMain.handle('update-item', (event, id, updates) => {
  let items = store.get('items', []);
  const index = items.findIndex(i => i.id === id);
  if (index !== -1) {
    items[index] = { ...items[index], ...updates };
    store.set('items', items);
  }
  return items;
});

ipcMain.handle('read-clipboard', () => {
  return clipboard.readText();
});

// 导出数据到文件
ipcMain.handle('export-data', async (event, { defaultName, data }) => {
  try {
    const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, {
      title: '导出数据',
      defaultPath: defaultName,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });
    
    if (canceled || !filePath) {
      return { canceled: true };
    }
    
    const fs = require('fs');
    fs.writeFileSync(filePath, data, 'utf-8');
    return { success: true, path: filePath };
  } catch (e) {
    console.error('导出失败:', e);
    return { success: false, error: e.message };
  }
});

// 置顶窗口相关
ipcMain.handle('get-always-on-top', () => {
  return mainWindowPinned;
});

ipcMain.handle('toggle-always-on-top', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  mainWindowPinned = !mainWindowPinned;
  mainWindow.setAlwaysOnTop(mainWindowPinned, mainWindowPinned ? PINNED_ON_TOP_LEVEL : 'normal');
  return mainWindowPinned;
});

// Capture 窗口置顶
ipcMain.handle('toggle-capture-always-on-top', () => {
  if (!captureWindow || captureWindow.isDestroyed()) return false;
  captureWindowPinned = !captureWindowPinned;
  captureWindow.setAlwaysOnTop(captureWindowPinned, captureWindowPinned ? CAPTURE_ON_TOP_LEVEL : 'normal');
  // Capture 窗口置顶时不会因失去焦点而隐藏
  return captureWindowPinned;
});

ipcMain.handle('fetch-metadata', async (event, url) => {
  try {
    if (!url.startsWith('http')) return { title: '', image: '' };

    // Special handling for YouTube - use oEmbed API
    if (/youtube\.com\/watch|youtu\.be\//i.test(url)) {
      try {
        const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
        const oembedRes = await fetch(oembedUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
          timeout: 5000
        });
        if (oembedRes.ok) {
          const data = await oembedRes.json();
          return {
            title: (data.title || '').trim(),
            image: data.thumbnail_url || ''
          };
        }
      } catch (e) {
        console.error('YouTube oEmbed error:', e);
        // Fall through to generic fetch
      }
    }

    // Special handling for Twitter/X
    if (url.includes('twitter.com') || url.includes('x.com')) {
      // Use a bot User-Agent to get OpenGraph tags
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)'
        },
        timeout: 5000
      });
      const html = await res.text();
      const $ = cheerio.load(html);

      const title = $('meta[property="og:title"]').attr('content') ||
        $('meta[name="twitter:title"]').attr('content') ||
        $('title').text() || '';

      const image = $('meta[property="og:image"]').attr('content') ||
        $('meta[name="twitter:image"]').attr('content') || '';

      return { title: title.trim(), image };
    }

    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.114 Safari/537.36'
      },
      timeout: 5000
    });

    const html = await res.text();
    const $ = cheerio.load(html);

    const title = $('meta[property="og:title"]').attr('content') ||
      $('meta[name="twitter:title"]').attr('content') ||
      $('title').text() ||
      '';

    const image = $('meta[property="og:image"]').attr('content') ||
      $('meta[name="twitter:image"]').attr('content') ||
      '';

    return { title: title.trim(), image };
  } catch (error) {
    console.error('Fetch metadata error:', error);
    return { title: '', image: '' };
  }
});

ipcMain.handle('get-mobile-connect-info', async () => {
  const address = ip.address();
  const port = 3000;
  const url = `http://${address}:${port}/web-dashboard.html`;
  const qrCode = await QRCode.toDataURL(url);
  return { url, qrCode };
});

// 文件拖拽导出
const fs = require('fs');
const os = require('os');

function setDragSafeWindowLevels() {
  if (mainWindow && !mainWindow.isDestroyed() && mainWindowPinned) {
    mainWindow.setAlwaysOnTop(true, DRAGGING_ON_TOP_LEVEL);
  }
  if (captureWindow && !captureWindow.isDestroyed() && captureWindowWasOnTopDuringDrag) {
    captureWindow.setAlwaysOnTop(true, DRAGGING_ON_TOP_LEVEL);
  }
}

function restoreWindowLevelsAfterDrag() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setAlwaysOnTop(mainWindowPinned, mainWindowPinned ? PINNED_ON_TOP_LEVEL : 'normal');
  }
  if (captureWindow && !captureWindow.isDestroyed()) {
    captureWindow.setAlwaysOnTop(
      captureWindowWasOnTopDuringDrag,
      captureWindowWasOnTopDuringDrag ? CAPTURE_ON_TOP_LEVEL : 'normal'
    );
  }
  captureWindowWasOnTopDuringDrag = false;
}

// 准备临时文件用于拖拽（预先写入）
ipcMain.handle('prepare-drag-file', async (event, { id, fileName, fileData }) => {
  try {
    const tempDir = path.join(os.tmpdir(), 'info-filter-drag');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    const tempPath = path.join(tempDir, fileName);
    const buffer = Buffer.from(fileData, 'base64');
    fs.writeFileSync(tempPath, buffer);
    
    return { success: true, path: tempPath };
  } catch (e) {
    console.error('准备拖拽文件失败:', e);
    return { success: false, error: e.message };
  }
});

// 拖拽状态管理
ipcMain.on('drag-start', () => {
  isDragging = true;
  console.log('[DRAG] 开始拖拽，禁用 blur 隐藏');
  captureWindowWasOnTopDuringDrag = !!(captureWindow && !captureWindow.isDestroyed() && captureWindow.isAlwaysOnTop());
  // 降低置顶层级，让拖拽预览显示在窗口上方
  setDragSafeWindowLevels();
});

ipcMain.on('drag-end', () => {
  isDragging = false;
  console.log('[DRAG] 拖拽结束，恢复 blur 隐藏');
  restoreWindowLevelsAfterDrag();
});

// 执行拖拽
ipcMain.on('ondragstart', (event, payload) => {
  try {
    const filePath = typeof payload === 'string' ? payload : payload?.filePath;
    const fileName = typeof payload === 'object' ? payload?.fileName : null;
    console.log('[startDrag] 收到拖拽请求:', filePath);
    isDragging = true; // 设置拖拽状态
    if (!captureWindowWasOnTopDuringDrag) {
      captureWindowWasOnTopDuringDrag = !!(captureWindow && !captureWindow.isDestroyed() && captureWindow.isAlwaysOnTop());
    }
    setDragSafeWindowLevels();
    
    if (fs.existsSync(filePath)) {
      // 创建一个 16x16 的透明图标
      const iconBuffer = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAEklEQVQ4jWNgGAWjYBSMglEAAAPQAAH0yT' +
        '3FAAAAAElFTkSuQmCC',
        'base64'
      );
      const icon = nativeImage.createFromBuffer(iconBuffer);
      
      console.log('[startDrag] 开始拖拽文件');
      event.sender.startDrag({
        file: filePath,
        files: [filePath],
        icon: icon
      });
      console.log('[startDrag] 拖拽启动完成');
    } else {
      console.error('[startDrag] 文件不存在:', filePath);
    }
  } catch (e) {
    console.error('[startDrag] 拖拽失败:', e);
  } finally {
    // 延迟重置拖拽状态，给拖拽操作足够时间
    setTimeout(() => {
      if (isDragging) {
        isDragging = false;
        restoreWindowLevelsAfterDrag();
      }
    }, 3000);
  }
});
