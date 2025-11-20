#!/bin/bash

# 更新应用到本地脚本
# 自动构建并更新到 /Applications/信息过滤器.app

echo "🚀 开始构建应用..."

# 停止可能正在运行的应用
pkill -f "信息过滤器" 2>/dev/null || true

# 构建应用
npm run build

if [ $? -ne 0 ]; then
    echo "❌ 构建失败！"
    exit 1
fi

echo "📦 构建完成，正在更新到本地应用..."

# 备份旧应用（可选）
if [ -d "/Applications/信息过滤器.app" ]; then
    echo "📋 备份旧应用..."
    rm -rf "/Applications/信息过滤器.app.backup" 2>/dev/null || true
    cp -R "/Applications/信息过滤器.app" "/Applications/信息过滤器.app.backup" 2>/dev/null || true
fi

# 删除旧应用并复制新应用
rm -rf "/Applications/信息过滤器.app"
cp -R "dist/mac-arm64/信息过滤器.app" "/Applications/信息过滤器.app"

if [ $? -eq 0 ]; then
    echo "✅ 应用更新成功！"
    echo "📍 应用位置: /Applications/信息过滤器.app"
    echo ""
    echo "💡 提示: 如果应用正在运行，请先退出并重新启动以使用新版本"
else
    echo "❌ 更新失败！"
    exit 1
fi

