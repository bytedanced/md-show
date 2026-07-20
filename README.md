# 墨览 Markdown Studio

一款基于 Tauri、React 和 TypeScript 的轻量 Markdown 媒体查看与编辑工具。

## 开发环境

- Node.js 22 或更高版本
- Rust 稳定版工具链
- Windows C++ Build Tools 和 WebView2

## 常用命令

首次使用时，在项目目录打开 PowerShell 并安装依赖：

```powershell
npm install
```

启动桌面客户端：

```powershell
npm run tauri dev
```

首次启动需要编译 Rust 依赖，等待时间会比较长，之后启动会明显加快。

仅启动浏览器中的前端界面：

```powershell
npm run dev
```

检查代码：

```powershell
npm run lint
npm run format:check
```

构建前端：

```powershell
npm run build
```

构建 Windows 安装包：

```powershell
npm run tauri build
```

安装包会生成在 Tauri 构建目录的 `bundle/nsis` 文件夹中。

## 常见问题

如果终端提示找不到 `cargo` 或 `rustc`，关闭当前终端并重新打开，然后再次执行启动命令。

如果依赖尚未安装或 `node_modules` 被删除，重新执行：

```powershell
npm install
```

详细开发进度参见 [PLAN.md](./PLAN.md)。
