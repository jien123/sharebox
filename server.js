/**
 * ShareBox - 基于 Cloudflare R2 的视频分享网盘
 * 传视频给朋友, 不经过第三方中转
 */
require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const {
  S3Client,
  ListObjectsV2Command,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const app = express();
const PORT = process.env.PORT || 3000;
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_BUCKET = process.env.R2_BUCKET_NAME;
const SHARE_EXPIRES = parseInt(process.env.SHARE_EXPIRES) || 604800; // 7天
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

if (!R2_ACCOUNT_ID || !R2_BUCKET) {
  console.warn('⚠️  未配置 R2, 请复制 .env.example 为 .env 并填写');
}

const s3 = new S3Client({
  region: 'auto',
  endpoint: R2_ACCOUNT_ID ? `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : undefined,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
  },
});

app.use(express.json());

// 简单密码验证 (如设置了 ADMIN_PASSWORD)
function auth(req, res, next) {
  if (!ADMIN_PASSWORD) return next();
  const token = req.headers['x-auth'] || req.query.auth;
  // 简单 token: sha256(password) 前 16 位
  const expect = crypto.createHash('sha256').update(ADMIN_PASSWORD).digest('hex').slice(0, 16);
  if (token === expect) return next();
  // 允许分享页免登录
  if (req.path.startsWith('/s/') || req.path === '/share.html') return next();
  res.status(401).json({ ok: false, error: '需要密码' });
}
app.use(auth);
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 * 1024 }, // 2GB
});

const ok = (res, data) => res.json({ ok: true, ...data });
const fail = (res, msg, code = 400) => res.status(code).json({ ok: false, error: msg });

// 登录验证
app.post('/api/login', (req, res) => {
  if (!ADMIN_PASSWORD) return ok(res, { token: '' });
  const expect = crypto.createHash('sha256').update(ADMIN_PASSWORD).digest('hex').slice(0, 16);
  const input = crypto.createHash('sha256').update(req.body.password || '').digest('hex').slice(0, 16);
  if (input === expect) return ok(res, { token: expect });
  fail(res, '密码错误', 401);
});

// 文件列表
app.get('/api/files', async (req, res) => {
  try {
    const out = await s3.send(new ListObjectsV2Command({
      Bucket: R2_BUCKET, MaxKeys: 1000, Delimiter: '/',
    }));
    const files = (out.Contents || [])
      .filter(o => !o.Key.endsWith('/'))
      .map(o => ({
        key: o.Key,
        name: o.Key.split('/').pop(),
        size: o.Size,
        updated: o.LastModified,
        isVideo: /\.(mp4|webm|mov|mkv|avi|m4v)$/i.test(o.Key),
      }))
      .sort((a, b) => new Date(b.updated) - new Date(a.updated));
    ok(res, { files });
  } catch (e) {
    fail(res, '列出失败: ' + e.message, 500);
  }
});

// 上传
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return fail(res, '没有收到文件');
    // 文件名: 时间戳_原名, 避免冲突
    const safe = req.file.originalname.replace(/[^\w.\-() \[\]]/g, '_');
    const key = `videos/${Date.now()}_${safe}`;
    await s3.send(new PutObjectCommand({
      Bucket: R2_BUCKET, Key: key,
      Body: req.file.buffer, ContentType: req.file.mimetype,
    }));
    ok(res, { key, name: req.file.originalname, size: req.file.size });
  } catch (e) {
    fail(res, '上传失败: ' + e.message, 500);
  }
});

// 删除
app.delete('/api/file', async (req, res) => {
  try {
    await s3.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: req.query.key }));
    ok(res, {});
  } catch (e) {
    fail(res, '删除失败', 500);
  }
});

// 生成分享链接 (预签名 URL)
app.get('/api/share', async (req, res) => {
  try {
    const key = req.query.key;
    if (!key) return fail(res, '缺少 key');
    const url = await getSignedUrl(s3,
      new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }),
      { expiresIn: SHARE_EXPIRES });
    ok(res, { url, expiresIn: SHARE_EXPIRES });
  } catch (e) {
    fail(res, '生成失败', 500);
  }
});

// 分享页: /s/<base64url(key)>
app.get('/s/:id', async (req, res) => {
  try {
    const key = Buffer.from(req.params.id, 'base64url').toString('utf8');
    const url = await getSignedUrl(s3,
      new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }),
      { expiresIn: SHARE_EXPIRES });
    const name = key.split('/').pop();
    // 返回一个漂亮的视频播放页
    res.send(`<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escHtml(name)} - ShareBox</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0a0a0f;color:#fff;font-family:-apple-system,"PingFang SC",sans-serif;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px}
.card{max-width:900px;width:100%;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:20px;overflow:hidden;backdrop-filter:blur(20px)}
video{width:100%;max-height:70vh;background:#000;display:block}
.info{padding:20px}
h1{font-size:1.1rem;margin-bottom:8px;word-break:break-all}
.meta{color:#888;font-size:.85rem;margin-bottom:16px}
.btn{display:inline-block;padding:12px 28px;background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;border-radius:12px;text-decoration:none;font-weight:600}
.logo{margin-top:24px;color:#555;font-size:.8rem}
</style></head><body>
<div class="card">
<video src="${url}" controls playsinline preload="metadata"></video>
<div class="info"><h1>${escHtml(name)}</h1>
<div class="meta">分享链接 ${Math.round(SHARE_EXPIRES/86400)} 天内有效</div>
<a class="btn" href="${url}" download="${escHtml(name)}">⬇ 下载视频</a></div>
</div><div class="logo">📦 ShareBox · R2 驱动</div>
</body></html>`);
  } catch (e) {
    res.status(404).send('链接无效或已过期');
  }
});

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

app.get('/api/health', (req, res) => {
  ok(res, { r2: !!(R2_ACCOUNT_ID && R2_BUCKET), needAuth: !!ADMIN_PASSWORD });
});

app.listen(PORT, () => console.log(`📦 ShareBox 运行在 http://localhost:${PORT}`));
