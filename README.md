# Orange Cloud Scripting 版 v1.0.0

iPhone 上的 Cloudflare 管理客户端，跑在 **Scripting** App 里。不用侧载（不占 3 个名额）、不用 Xcode 编译、不用 OAuth、不用搭回调服务器——API Token 直接存在本机钥匙串里。

原版 Orange Cloud（App Store 已下架）是原生 App；这是它的 Scripting 重写，只做“管 Cloudflare”这个核心。

## 功能

- **账号**：保存 API Token（本机钥匙串）、检测令牌和账号（支持多账号切换）、查 workers.dev 子域名
- **域名**：域名列表；点进一个域名可以看 DNS 记录、**新建 / 改 / 删记录、开关联代理开关**，还能看 WAF 规则集（只读）
- **Workers**：列表、详情（创建/修改时间、计费模式、地址）；点进一个 Worker 可以编辑代码、从剪贴板粘贴、从文件选代码、**部署（覆盖）**，部署完实测地址；也能新建 Worker
- **Pages**：项目列表、生产分支、最近一次部署状态、打开地址
- **存储**：R2 存储桶、D1 数据库、KV 命名空间（列表）
- **流量**：选一个域名，看最近 24 小时按小时的请求数

## 故意不做的

- **OAuth 登录**：改用 API Token，更简单，不用搭回调服务器
- **实时日志流**（wrangler tail 那种）：Scripting 不支持 WebSocket，看日志去 Cloudflare 面板
- **WAF 规则编辑、新建存储桶 / 数据库、跑 SQL**：手机端改这些容易误操作，去 Cloudflare 面板做
- **Apple Watch、图表、流量地图、灵动岛**：原生 App 才有的东西

## 安装（手机上）

1. Scripting App → Remote Resources → 添加仓库：`https://github.com/nnyzjh/orange-cloud-scripting`
2. 打开“Orange Cloud”
3. 首页粘贴 Cloudflare API Token，点“保存令牌”，再点“开始检测”
   - 令牌获取：dash.cloudflare.com → 右上角头像 → API Tokens → Create Token
   - 想新建 Worker：选 **Edit Cloudflare Workers** 模板（账号级权限）
   - 只想覆盖某个已有的 Worker：选 Individual Workers、只授权那一个也行
4. 检测通过后，点进各个页面就能管了

## 提醒

- `/user/tokens/verify` 返回 401 不代表令牌已死：个别作用域的令牌验证会 401，但只要账号和列表接口能通，令牌就是有效的，App 里已经按这个逻辑处理了。
- 部署用的是 Cloudflare API 的 multipart 上传（metadata + worker.js），和 Wrangler 走同一套接口。部署成功后，Worker 即使令牌过期也会继续运行。
- 令牌只存在本机钥匙串（和旧版部署脚本同一把钥匙 `cf_api_token`），不会打印到日志，也不会上传到别处。

## 文件

- `index.tsx`：App 本体（UI + 页面逻辑）
- `cf-api.ts`：Cloudflare API 层（纯函数，不依赖 Scripting，可单测）
- `script.json`：项目配置（name + entry）
- `tests/cf-api.test.mjs`：API 层单测（假 fetch，不碰真实接口）

## 本地验证

```bash
# 打包检查（scripting 是运行时提供的模块，标 external）
npx esbuild index.tsx --bundle --format=esm --platform=browser --external:scripting --outfile=/tmp/orange-cloud.bundle.js
# API 层单测（41 项）
node tests/cf-api.test.mjs
```

## 改动记录

- v1.0.0（2026-11-23）：首版。全套管理功能；API 层从旧版部署脚本（cloudflare-scripting v3.1）复用并扩展。
