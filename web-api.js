// Web 版本的存储适配器（使用 localStorage）
// Last updated: Trigger Netlify deploy
const webStorage = {
  get: async (key) => {
    try {
      const data = localStorage.getItem(key);
      return data ? JSON.parse(data) : null;
    } catch (e) {
      return null;
    }
  },
  set: async (key, value) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      return false;
    }
  }
};

// Web 版本的 API 适配器
const webAPI = {
  // 获取所有收藏
  getItems: async () => {
    return await webStorage.get('items') || [];
  },

  // 保存新收藏
  saveItem: async (item) => {
    const items = await webAPI.getItems();
    items.unshift(item);
    await webStorage.set('items', items);
    return items;
  },

  // 删除收藏
  deleteItem: async (id) => {
    const items = await webAPI.getItems();
    const newItems = items.filter(i => i.id !== id);
    await webStorage.set('items', newItems);
    return newItems;
  },

  // 更新所有收藏（用于排序）
  updateItems: async (newItems) => {
    await webStorage.set('items', newItems);
    return newItems;
  },

  // 切换置顶
  togglePin: async (id) => {
    const items = await webAPI.getItems();
    const index = items.findIndex(i => i.id === id);
    if (index !== -1) {
      items[index].pinned = !items[index].pinned;
      items.sort((a, b) => {
        if (a.pinned === b.pinned) return 0;
        return a.pinned ? -1 : 1;
      });
      await webStorage.set('items', items);
    }
    return items;
  },

  // 读取剪贴板（Web API）
  readClipboard: async () => {
    try {
      const text = await navigator.clipboard.readText();
      return text;
    } catch (e) {
      // 降级方案：提示用户手动粘贴
      return '';
    }
  },

  // 抓取元数据（需要后端 API）
  fetchMetadata: async (url) => {
    try {
      // 使用 CORS 代理或后端 API
      // 这里先用一个简单的代理服务
      const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
      const response = await fetch(proxyUrl);
      const data = await response.json();
      const html = data.contents;

      // 使用 DOMParser 解析 HTML
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');

      const title = doc.querySelector('meta[property="og:title"]')?.content ||
        doc.querySelector('meta[name="twitter:title"]')?.content ||
        doc.querySelector('title')?.textContent || '';

      const image = doc.querySelector('meta[property="og:image"]')?.content ||
        doc.querySelector('meta[name="twitter:image"]')?.content || '';

      return { title: title.trim(), image };
    } catch (error) {
      console.error('Fetch metadata error:', error);
      return { title: '', image: '' };
    }
  }
};

// 混合模式 API：优先使用 localStorage，可选同步到桌面端
const hybridAPI = {
  conn: null,
  dataCallback: null,
  isConnected: false,
  peer: null,

  init: (peerId) => {
    const updateStatus = (status, msg) => {
      const el = document.getElementById('status-bar');
      if (el) {
        if (status === 'connected') {
          el.style.display = 'block';
          el.style.background = '#d1fae5';
          el.style.color = '#065f46';
          el.textContent = '已连接到桌面端（数据已同步）';
          setTimeout(() => { el.style.display = 'none'; }, 3000);
        } else if (status === 'connecting') {
          el.style.display = 'block';
          el.style.background = '#fef3c7';
          el.style.color = '#92400e';
          el.textContent = '正在连接桌面端...';
        } else if (status === 'disconnected') {
          el.style.display = 'block';
          el.style.background = '#f3f4f6';
          el.style.color = '#4b5563';
          el.textContent = '本地模式（数据已保存到本地）';
          setTimeout(() => { el.style.display = 'none'; }, 3000);
        } else {
          el.style.display = 'block';
          el.style.background = '#fee2e2';
          el.style.color = '#991b1b';
          el.textContent = msg || '连接断开，使用本地数据';
        }
      }
    };

    // 先加载本地数据，确保即使连接失败也能使用
    webStorage.get('items').then(localItems => {
      const items = localItems || [];
      if (hybridAPI.dataCallback && items.length > 0) {
        hybridAPI.dataCallback(items);
      }
    });

    return new Promise((resolve) => {
      updateStatus('connecting');

      const peer = new Peer(null, {
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:global.stun.twilio.com:3478' }
          ]
        }
      });

      hybridAPI.peer = peer;

      peer.on('open', () => {
        console.log('My Peer ID:', peer.id);
        const conn = peer.connect(peerId, {
          reliable: true
        });

        conn.on('open', async () => {
          console.log('Connected to Desktop App');
          hybridAPI.conn = conn;
          hybridAPI.isConnected = true;
          updateStatus('connected');

          // 立即请求桌面端数据（延迟一下确保连接稳定）
          setTimeout(() => {
            if (hybridAPI.conn && hybridAPI.conn.open) {
              console.log('Requesting items from desktop...');
              hybridAPI.conn.send({ type: 'get-items' });
            }
          }, 300);
          
          // 同时发送本地数据到桌面端（如果本地有数据）
          const localItems = await webStorage.get('items') || [];
          if (localItems.length > 0) {
            // 延迟一下，确保连接稳定
            setTimeout(() => {
              if (hybridAPI.conn && hybridAPI.conn.open) {
                console.log('Sending local items to desktop:', localItems.length);
                hybridAPI.conn.send({ type: 'update-items', items: localItems });
              }
            }, 800);
          }
          
          resolve(true);
        });

        conn.on('data', async (data) => {
          console.log('Received data from desktop:', data);
          if (data.type === 'items-updated') {
            // 同步桌面端数据到本地
            const desktopItems = data.items || [];
            
            // 合并策略：智能合并
            const localItems = await webStorage.get('items') || [];
            
            if (desktopItems.length > 0) {
              // 如果桌面端有数据，优先使用桌面端数据（作为主数据源）
              // 但保留本地新增但桌面端没有的数据（通过 ID 判断）
              const desktopIds = new Set(desktopItems.map(item => item.id));
              const localOnlyItems = localItems.filter(item => !desktopIds.has(item.id));
              
              // 合并：桌面端数据 + 本地独有的数据
              const mergedItems = [...desktopItems, ...localOnlyItems].sort((a, b) => {
                // 置顶的优先
                if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
                // 按创建时间排序
                return new Date(b.createdAt) - new Date(a.createdAt);
              });
              
              console.log('Syncing desktop data to local:', mergedItems.length, 'items');
              await webStorage.set('items', mergedItems);
              
              // 立即触发回调更新 UI
              if (hybridAPI.dataCallback) {
                hybridAPI.dataCallback(mergedItems);
              }
            } else if (localItems.length > 0) {
              // 如果桌面端没有数据，但本地有，同步本地数据到桌面端
              console.log('Syncing local data to desktop:', localItems.length, 'items');
              if (hybridAPI.conn && hybridAPI.conn.open) {
                hybridAPI.conn.send({ type: 'update-items', items: localItems });
              }
            }
          }
        });

        conn.on('close', () => {
          updateStatus('disconnected');
          hybridAPI.conn = null;
          hybridAPI.isConnected = false;
        });

        conn.on('error', (err) => {
          console.error('Connection error:', err);
          updateStatus('disconnected');
          hybridAPI.isConnected = false;
          resolve(false); // 连接失败但不阻止使用
        });
      });

      peer.on('error', (err) => {
        console.error('Peer error:', err);
        updateStatus('disconnected');
        hybridAPI.isConnected = false;
        resolve(false); // 连接失败但不阻止使用
      });

      // 超时处理：5秒后如果还没连接，回退到本地模式
      setTimeout(() => {
        if (!hybridAPI.isConnected) {
          updateStatus('disconnected');
          resolve(false);
        }
      }, 5000);
    });
  },

  getItems: async () => {
    // 优先返回本地数据
    const localItems = await webStorage.get('items') || [];
    
    // 如果已连接，也请求桌面端数据（异步合并）
    if (hybridAPI.conn && hybridAPI.conn.open) {
      hybridAPI.conn.send({ type: 'get-items' });
    }
    
    return localItems;
  },

  saveItem: async (item) => {
    // 先保存到本地
    const items = await webStorage.get('items') || [];
    items.unshift(item);
    await webStorage.set('items', items);
    
    // 如果已连接，同步到桌面端
    if (hybridAPI.conn && hybridAPI.conn.open) {
      hybridAPI.conn.send({ type: 'save-item', item });
    }
    
    return items;
  },

  deleteItem: async (id) => {
    // 先删除本地数据
    const items = await webStorage.get('items') || [];
    const newItems = items.filter(i => i.id !== id);
    await webStorage.set('items', newItems);
    
    // 如果已连接，同步到桌面端
    if (hybridAPI.conn && hybridAPI.conn.open) {
      hybridAPI.conn.send({ type: 'delete-item', id });
    }
    
    return newItems;
  },

  updateItems: async (newItems) => {
    // 先更新本地数据
    await webStorage.set('items', newItems);
    
    // 如果已连接，同步到桌面端
    if (hybridAPI.conn && hybridAPI.conn.open) {
      hybridAPI.conn.send({ type: 'update-items', items: newItems });
    }
    
    return newItems;
  },

  togglePin: async (id) => {
    // 先更新本地数据
    const items = await webStorage.get('items') || [];
    const index = items.findIndex(i => i.id === id);
    if (index !== -1) {
      items[index].pinned = !items[index].pinned;
      items.sort((a, b) => {
        if (a.pinned === b.pinned) return 0;
        return a.pinned ? -1 : 1;
      });
      await webStorage.set('items', items);
    }
    
    // 如果已连接，同步到桌面端
    if (hybridAPI.conn && hybridAPI.conn.open) {
      hybridAPI.conn.send({ type: 'toggle-pin', id });
    }
    
    return items;
  },

  readClipboard: async () => {
    try {
      return await navigator.clipboard.readText();
    } catch (e) {
      return '';
    }
  },

  fetchMetadata: async (url) => {
    // 使用 webAPI 的 fetchMetadata（通过代理）
    return await webAPI.fetchMetadata(url);
  },

  subscribe: (callback) => {
    console.log('Subscribing to data updates');
    hybridAPI.dataCallback = callback;
    
    // 立即返回本地数据
    webStorage.get('items').then(items => {
      if (items && items.length > 0) {
        callback(items);
      }
    });
    
    // 如果已连接，请求桌面端数据
    if (hybridAPI.conn && hybridAPI.conn.open) {
      hybridAPI.conn.send({ type: 'get-items' });
    }
  }
};

// 导出适配的 API
(async function initAPI() {
  let isElectron = false;
  try {
    if (typeof require !== 'undefined') {
      const electron = require('electron');
      isElectron = !!electron;
    }
  } catch (e) {
    isElectron = false;
  }

  if (isElectron) {
    // Electron 环境
    try {
      const { ipcRenderer } = require('electron');
      window.webAPI = {
        getItems: () => ipcRenderer.invoke('get-items'),
        saveItem: (item) => ipcRenderer.invoke('save-item', item),
        deleteItem: (id) => ipcRenderer.invoke('delete-item', id),
        updateItems: (items) => ipcRenderer.invoke('update-items', items),
        togglePin: (id) => ipcRenderer.invoke('toggle-pin', id),
        readClipboard: () => ipcRenderer.invoke('read-clipboard'),
        fetchMetadata: (url) => ipcRenderer.invoke('fetch-metadata', url),
        getMobileConnectInfo: () => ipcRenderer.invoke('get-mobile-connect-info'),
        subscribe: (callback) => {
          ipcRenderer.on('refresh-items', async () => {
            const items = await ipcRenderer.invoke('get-items');
            callback(items);
          });
        }
      };
    } catch (e) {
      window.webAPI = webAPI;
    }
  } else {
    // Web 环境
    const urlParams = new URLSearchParams(window.location.search);
    const peerId = urlParams.get('peer');

    if (peerId) {
      // 混合模式：优先使用本地存储，可选同步到桌面端
      console.log('Running in Hybrid Mode - Connecting to desktop:', peerId);
      window.webAPI = hybridAPI;
      
      // 异步初始化连接（不阻塞页面使用）
      hybridAPI.init(peerId).then(connected => {
        if (connected) {
          console.log('Desktop sync enabled');
        } else {
          console.log('Using local storage only');
        }
      }).catch(err => {
        console.error('Connection attempt failed, using local storage:', err);
      });
    } else {
      // 默认本地模式（完全独立）
      console.log('Running in Standalone Web Mode (Local Storage)');
      window.webAPI = {
        ...webAPI,
        subscribe: (callback) => {
          // 立即返回本地数据
          webStorage.get('items').then(items => {
            if (items) callback(items);
          });
          
          // 监听 storage 事件（跨标签页同步）
          window.addEventListener('storage', (e) => {
            if (e.key === 'items') {
              try {
                callback(JSON.parse(e.newValue));
              } catch (err) {
                console.error('Failed to parse storage data:', err);
              }
            }
          });
        }
      };
    }
  }
})();

