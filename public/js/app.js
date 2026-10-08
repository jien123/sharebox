// ShareBox 前端
let authToken = localStorage.getItem('sb_auth') || '';
let files = [];
let currentKey = '';

const $ = id => document.getElementById(id);

function headers() {
  return authToken ? { 'x-auth': authToken } : {};
}
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}
function fmtSize(b) {
  if (b > 1e9) return (b / 1e9).toFixed(2) + ' GB';
  if (b > 1e6) return (b / 1e6).toFixed(1) + ' MB';
  return (b / 1e3).toFixed(0) + ' KB';
}
function fmtDate(s) {
  return new Date(s).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

// ---------- 登录 ----------
async function checkAuth() {
  const r = await fetch('/api/health');
  const d = await r.json();
  if (d.needAuth && !authToken) {
    $('loginMask').classList.remove('hidden');
  } else {
    $('loginMask').classList.add('hidden');
    loadFiles();
  }
}
$('loginBtn').onclick = async () => {
  const pwd = $('pwdInput').value;
  const r = await fetch('/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: pwd }),
  });
  const d = await r.json();
  if (d.ok) {
    authToken = d.token;
    localStorage.setItem('sb_auth', authToken);
    $('loginMask').classList.add('hidden');
    loadFiles();
  } else {
    $('loginErr').textContent = '密码错误';
  }
};
$('pwdInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('loginBtn').click(); });

// ---------- 文件列表 ----------
async function loadFiles() {
  const r = await fetch('/api/files', { headers: headers() });
  if (r.status === 401) {
    localStorage.removeItem('sb_auth'); authToken = '';
    $('loginMask').classList.remove('hidden');
    return;
  }
  const d = await r.json();
  files = d.files || [];
  $('count').textContent = `(${files.length})`;
  $('empty').classList.toggle('hidden', files.length > 0);
  $('fileGrid').innerHTML = files.map((f, i) => `
    <div class="file-card" data-i="${i}">
      <div class="file-thumb">${f.isVideo ? '🎬' : '📄'}</div>
      <div class="file-info">
        <div class="file-name">${esc(f.name)}</div>
        <div class="file-meta">${fmtSize(f.size)} · ${fmtDate(f.updated)}</div>
      </div>
    </div>`).join('');
  document.querySelectorAll('.file-card').forEach(el => {
    el.onclick = () => openPreview(+el.dataset.i);
  });
}
function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ---------- 上传 ----------
const dropZone = $('dropZone'), fileInput = $('fileInput');
dropZone.onclick = e => { if (!e.target.closest('#uploadList')) fileInput.click(); };
fileInput.onchange = () => uploadFiles(fileInput.files);
['dragover', 'dragenter'].forEach(ev => dropZone.addEventListener(ev, e => {
  e.preventDefault(); dropZone.classList.add('dragover');
}));
['dragleave', 'drop'].forEach(ev => dropZone.addEventListener(ev, e => {
  e.preventDefault(); dropZone.classList.remove('dragover');
}));
dropZone.addEventListener('drop', e => uploadFiles(e.dataTransfer.files));

async function uploadFiles(list) {
  for (const file of list) {
    const item = document.createElement('div');
    item.className = 'upload-item';
    item.innerHTML = `<div>${esc(file.name)} (${fmtSize(file.size)})</div><div class="bar"><div style="width:0%"></div></div>`;
    $('uploadList').appendChild(item);
    const bar = item.querySelector('.bar > div');

    const fd = new FormData();
    fd.append('file', file);
    try {
      await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/upload');
        if (authToken) xhr.setRequestHeader('x-auth', authToken);
        xhr.upload.onprogress = e => {
          if (e.lengthComputable) bar.style.width = (e.loaded / e.total * 100) + '%';
        };
        xhr.onload = () => xhr.status === 200 ? resolve() : reject(new Error('上传失败'));
        xhr.onerror = () => reject(new Error('网络错误'));
        xhr.send(fd);
      });
      bar.style.width = '100%';
      toast(`✅ ${file.name} 上传成功`);
    } catch (e) {
      item.style.border = '1px solid #ff6b6b';
      toast(`❌ ${file.name} 上传失败`);
    }
  }
  fileInput.value = '';
  setTimeout(() => { $('uploadList').innerHTML = ''; }, 3000);
  loadFiles();
}

// ---------- 预览 & 分享 ----------
function openPreview(i) {
  const f = files[i];
  currentKey = f.key;
  $('previewName').textContent = f.name;
  $('shareTip').textContent = '';
  // 获取播放链接
  fetch(`/api/share?key=${encodeURIComponent(f.key)}`, { headers: headers() })
    .then(r => r.json())
    .then(d => {
      if (d.ok) $('previewVideo').src = d.url;
    });
  $('previewModal').classList.remove('hidden');
}
$('closeModal').onclick = () => {
  $('previewModal').classList.add('hidden');
  $('previewVideo').pause();
  $('previewVideo').src = '';
};
$('previewModal').addEventListener('click', e => {
  if (e.target === $('previewModal')) $('closeModal').click();
});

$('shareBtn').onclick = async () => {
  const r = await fetch(`/api/share?key=${encodeURIComponent(currentKey)}`, { headers: headers() });
  const d = await r.json();
  if (!d.ok) return toast('生成失败');
  // 分享页链接 (7天有效, 免登录可看)
  const sharePage = `${location.origin}/s/${btoa(currentKey).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')}`;
  try {
    await navigator.clipboard.writeText(sharePage);
    $('shareTip').textContent = '✅ 链接已复制，发给朋友吧（7天有效）';
  } catch (e) {
    $('shareTip').textContent = '链接: ' + sharePage;
  }
  toast('分享链接已生成');
};

$('delBtn').onclick = async () => {
  if (!confirm('确定删除这个视频吗？')) return;
  await fetch(`/api/file?key=${encodeURIComponent(currentKey)}`, {
    method: 'DELETE', headers: headers(),
  });
  $('closeModal').click();
  toast('已删除');
  loadFiles();
};

checkAuth();
