#!/bin/bash

# 信息过滤器 - 一键打包部署脚本

echo "🔄 关闭正在运行的应用..."
pkill -f "信息过滤器" 2>/dev/null || true
sleep 1

echo "📦 开始打包..."
npm run build

if [ $? -eq 0 ]; then
    echo "🗑️  删除旧版本..."
    rm -rf "/Applications/信息过滤器.app"
    
    echo "📂 复制新版本到 Applications..."
    cp -R "dist/mac-arm64/信息过滤器.app" /Applications/
    
    echo "✅ 部署完成！"
    
    # 询问是否立即启动
    read -p "是否立即启动应用？(y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        open "/Applications/信息过滤器.app"
    fi
else
    echo "❌ 打包失败"
    exit 1
fi
