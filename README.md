# 📦 ShareBox

基于 Cloudflare R2 的个人视频分享网盘。传视频给朋友，不经过第三方中转。

## 功能

- 🎬 视频上传（拖拽 / 点击，最大 2GB）
- ▶️ 在线预览播放
- 🔗 一键生成分享链接（7天有效，朋友免登录可看可下载）
- 🗑 文件管理删除
- 🔐 可选访问密码

## 快速开始

```bash
npm install
cp .env.example .env
# 填写 R2 配置
npm start
# 打开 http://localhost:3000
```

## R2 配置

1. Cloudflare Dashboard → R2 → 创建存储桶
2. R2 → Manage R2 API Tokens → 创建 Token（读写权限）
3. 填入 `.env`：
   - `R2_ACCOUNT_ID`：R2 页面 URL 中的那串 ID
   - `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`：Token 的 key
   - `R2_BUCKET_NAME`：存储桶名

## 部署

Render / Railway：
- Build: `npm install`
- Start: `npm start`
- 环境变量：填入上方 4 个 R2 配置（+ 可选 `ADMIN_PASSWORD`）

## 分享链接

点视频 → 🔗 复制分享链接 → 发给朋友。朋友打开是一个漂亮的播放页，可在线看、可下载，7天有效（可在 `.env` 用 `SHARE_EXPIRES` 调整秒数）。

## License

MIT
