// ── PATH: ensure ffmpeg + whisper are always found ─────────────────────────
process.env.PATH = [
  '/Users/mukunthanurradhavenkat/Library/Python/3.9/bin',
  '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin',
  process.env.PATH
].join(':');

const {
  app, BrowserWindow, ipcMain, Tray, Menu,
  nativeImage, systemPreferences, shell, dialog, screen, globalShortcut,
  clipboard, desktopCapturer, Notification
} = require('electron');
const path = require('path');
const fs   = require('fs');
const { exec } = require('child_process');
const os   = require('os');

let mainWindow, tray, isQuitting = false;

// ── Storage paths ────────────────────────────────────────────────────────────
const LOCAL_DIR   = path.join(os.homedir(), '.logat');
const LOGAT_FOLDER = 'LOGAT_Chats';
const ensureDir = d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); };
ensureDir(LOCAL_DIR);

// ── External SSD helpers ─────────────────────────────────────────────────────
function findExternalDrive() {
  try {
    const skip = new Set(['Macintosh HD', 'Macintosh HD - Data']);
    const ext = fs.readdirSync('/Volumes')
      .find(v => !skip.has(v) && !v.startsWith('.') && fs.existsSync(`/Volumes/${v}`));
    if (ext) {
      const p = `/Volumes/${ext}/${LOGAT_FOLDER}`;
      ensureDir(p);
      return { path: p, name: ext };
    }
  } catch (_) {}
  return null;
}

function syncToExternal(extPath) {
  try {
    fs.readdirSync(LOCAL_DIR)
      .filter(f => f.endsWith('.json'))
      .forEach(f => {
        const dst = path.join(extPath, f);
        if (!fs.existsSync(dst)) fs.copyFileSync(path.join(LOCAL_DIR, f), dst);
      });
  } catch (_) {}
}

function getStorage() {
  const ext = findExternalDrive();
  if (ext) syncToExternal(ext.path);
  return { path: ext?.path || LOCAL_DIR, isExternal: !!ext, driveName: ext?.name || null };
}

// ── Chat file helpers ─────────────────────────────────────────────────────────
function getChatFiles(dir) {
  try {
    ensureDir(dir);
    return fs.readdirSync(dir)
      .filter(f => f.startsWith('chat_') && f.endsWith('.json'))
      .map(f => {
        try {
          const d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
          return {
            id: f.replace('.json', ''),
            title: d.title || 'Untitled',
            date: fs.statSync(path.join(dir, f)).mtime.toISOString(),
            messageCount: d.messages?.length || 0
          };
        } catch (_) { return null; }
      })
      .filter(Boolean)
      .sort((a, b) => new Date(b.date) - new Date(a.date));
  } catch (_) { return []; }
}

// ── IPC: Chat ─────────────────────────────────────────────────────────────────
ipcMain.handle('get-storage', () => getStorage());

ipcMain.handle('list-chats', () => {
  const s = getStorage();
  const chats = getChatFiles(s.path);
  if (s.isExternal) {
    const ids = new Set(chats.map(c => c.id));
    getChatFiles(LOCAL_DIR).forEach(c => { if (!ids.has(c.id)) chats.push(c); });
    chats.sort((a, b) => new Date(b.date) - new Date(a.date));
  }
  return chats;
});

ipcMain.handle('load-chat', (_, id) => {
  const s = getStorage();
  for (const dir of s.isExternal ? [s.path, LOCAL_DIR] : [LOCAL_DIR]) {
    const f = path.join(dir, id + '.json');
    if (fs.existsSync(f)) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) {} }
  }
  return null;
});

ipcMain.handle('save-chat', (_, data) => {
  try {
    const s = getStorage();
    const fn = data.id + '.json';
    ensureDir(LOCAL_DIR);
    fs.writeFileSync(path.join(LOCAL_DIR, fn), JSON.stringify(data, null, 2));
    if (s.isExternal) fs.writeFileSync(path.join(s.path, fn), JSON.stringify(data, null, 2));
    return true;
  } catch (_) { return false; }
});

ipcMain.handle('delete-chat', (_, id) => {
  const fn = id + '.json';
  try { const f = path.join(LOCAL_DIR, fn); if (fs.existsSync(f)) fs.unlinkSync(f); } catch (_) {}
  try {
    const s = getStorage();
    if (s.isExternal) { const f = path.join(s.path, fn); if (fs.existsSync(f)) fs.unlinkSync(f); }
  } catch (_) {}
  return true;
});

// ── IPC: Memory ───────────────────────────────────────────────────────────────
ipcMain.handle('load-memory', () => {
  try {
    const f = path.join(LOCAL_DIR, 'memory.json');
    if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch (_) {}
  return { facts: [] };
});

ipcMain.handle('save-memory', (_, data) => {
  try {
    fs.writeFileSync(path.join(LOCAL_DIR, 'memory.json'), JSON.stringify(data, null, 2));
    const s = getStorage();
    if (s.isExternal) fs.writeFileSync(path.join(s.path, 'memory.json'), JSON.stringify(data, null, 2));
    return true;
  } catch (_) { return false; }
});

// ── IPC: Audio transcription ──────────────────────────────────────────────────
ipcMain.handle('transcribe-audio', (_, b64) => new Promise(resolve => {
  try {
    const webm = path.join(os.tmpdir(), `logan_${Date.now()}.webm`);
    const wav  = path.join(os.tmpdir(), `logan_${Date.now()}.wav`);
    fs.writeFileSync(webm, Buffer.from(b64, 'base64'));
    const cleanup = () => {
      try { fs.unlinkSync(webm); } catch (_) {}
      try { fs.unlinkSync(wav);  } catch (_) {}
    };
    const whisperBins = [
      '/Users/mukunthanurradhavenkat/Library/Python/3.9/bin/whisper',
      'whisper', '/usr/local/bin/whisper',
      `${os.homedir()}/.local/bin/whisper`,
      `${os.homedir()}/Library/Python/3.11/bin/whisper`,
      `${os.homedir()}/Library/Python/3.12/bin/whisper`,
      `${os.homedir()}/Library/Python/3.13/bin/whisper`
    ];
    const runWhisper = audio => {
      const try_ = i => {
        if (i >= whisperBins.length) { cleanup(); resolve({ ok: false, error: 'WHISPER_NOT_FOUND' }); return; }
        exec(
          `"${whisperBins[i]}" "${audio}" --model tiny --language en --output_format txt --output_dir "${os.tmpdir()}" 2>/dev/null`,
          { timeout: 30000 },
          err => {
            if (!err) {
              const txt = path.join(os.tmpdir(), path.basename(audio, path.extname(audio)) + '.txt');
              if (fs.existsSync(txt)) {
                const text = fs.readFileSync(txt, 'utf8').trim();
                try { fs.unlinkSync(txt); } catch (_) {}
                cleanup(); resolve({ ok: true, text });
              } else try_(i + 1);
            } else try_(i + 1);
          }
        );
      };
      try_(0);
    };
    exec('which ffmpeg', err => {
      if (!err) exec(`ffmpeg -y -i "${webm}" -ar 16000 -ac 1 "${wav}" 2>/dev/null`, e => runWhisper(e ? webm : wav));
      else runWhisper(webm);
    });
  } catch (e) { resolve({ ok: false, error: e.message }); }
}));

// ── IPC: PDF reader ───────────────────────────────────────────────────────────
ipcMain.handle('read-pdf', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Open PDF',
    properties: ['openFile'],
    filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
  });
  if (res.canceled || !res.filePaths.length) return null;
  const pdfPath = res.filePaths[0];
  const txtPath = path.join(os.tmpdir(), `logat_pdf_${Date.now()}.txt`);
  const bins = ['/opt/homebrew/bin/pdftotext', '/usr/local/bin/pdftotext', 'pdftotext'];
  return new Promise(resolve => {
    const tryBin = i => {
      if (i >= bins.length) {
        resolve({ ok: false, name: path.basename(pdfPath), error: 'PDFTOTEXT_NOT_FOUND' });
        return;
      }
      exec(`"${bins[i]}" "${pdfPath}" "${txtPath}" 2>/dev/null`, err => {
        if (!err && fs.existsSync(txtPath)) {
          const text = fs.readFileSync(txtPath, 'utf8').trim();
          try { fs.unlinkSync(txtPath); } catch(_) {}
          resolve({ ok: true, name: path.basename(pdfPath), text: text.substring(0, 10000) });
        } else tryBin(i + 1);
      });
    };
    tryBin(0);
  });
});

// ── IPC: Image / schematic reader ─────────────────────────────────────────────
ipcMain.handle('read-image', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Open Image or Schematic',
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp'] }]
  });
  if (res.canceled || !res.filePaths.length) return null;
  const imgPath = res.filePaths[0];
  try {
    const data = fs.readFileSync(imgPath);
    const b64 = data.toString('base64');
    const ext = path.extname(imgPath).replace('.', '').toLowerCase();
    const mime = (ext === 'jpg' || ext === 'jpeg') ? 'image/jpeg'
               : ext === 'png'  ? 'image/png'
               : ext === 'webp' ? 'image/webp'
               : ext === 'gif'  ? 'image/gif'
               : 'image/png';
    return { ok: true, name: path.basename(imgPath), b64, mime };
  } catch(e) {
    return { ok: false, error: e.message };
  }
});

// ── IPC: App launcher ─────────────────────────────────────────────────────────
ipcMain.handle('launch-app', async (_, appPath) => {
  try { await shell.openPath(appPath); return true; } catch (_) { return false; }
});

ipcMain.handle('pick-app', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    defaultPath: '/Applications',
    properties: ['openFile'],
    filters: [{ name: 'Applications', extensions: ['app'] }]
  });
  if (res.canceled || !res.filePaths.length) return null;
  return { path: res.filePaths[0], name: path.basename(res.filePaths[0], '.app') };
});

ipcMain.handle('load-apps', () => {
  try {
    const f = path.join(LOCAL_DIR, 'apps.json');
    if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch (_) {}
  return { apps: [
    { name: 'Safari',          path: '/Applications/Safari.app' },
    { name: 'Finder',          path: '/System/Library/CoreServices/Finder.app' },
    { name: 'Terminal',        path: '/System/Applications/Utilities/Terminal.app' },
    { name: 'System Settings', path: '/System/Applications/System Settings.app' }
  ]};
});

ipcMain.handle('save-apps', (_, data) => {
  try { fs.writeFileSync(path.join(LOCAL_DIR, 'apps.json'), JSON.stringify(data, null, 2)); return true; }
  catch (_) { return false; }
});

// ── IPC: Tasks ────────────────────────────────────────────────────────────────
ipcMain.handle('load-tasks', () => {
  try {
    const f = path.join(LOCAL_DIR, 'tasks.json');
    if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch (_) {}
  return { tasks: [] };
});

ipcMain.handle('save-tasks', (_, data) => {
  try { fs.writeFileSync(path.join(LOCAL_DIR, 'tasks.json'), JSON.stringify(data, null, 2)); return true; }
  catch (_) { return false; }
});

// ── IPC: Export chat ──────────────────────────────────────────────────────────
ipcMain.handle('export-chat', async (_, { title, text }) => {
  const res = await dialog.showSaveDialog(mainWindow, {
    title: 'Export Chat',
    defaultPath: path.join(os.homedir(), 'Desktop', (title || 'logan-chat') + '.txt'),
    filters: [{ name: 'Text Files', extensions: ['txt'] }]
  });
  if (res.canceled || !res.filePath) return false;
  try { fs.writeFileSync(res.filePath, text, 'utf8'); return true; } catch (_) { return false; }
});

// ── IPC: Settings ─────────────────────────────────────────────────────────────
ipcMain.handle('load-settings', () => {
  try {
    const f = path.join(LOCAL_DIR, 'settings.json');
    if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch (_) {}
  return { voiceOn: true, voiceSpeed: 1.05, clapApp: 'LOGAT', clapAppPath: '' };
});

ipcMain.handle('save-settings', (_, data) => {
  try { fs.writeFileSync(path.join(LOCAL_DIR, 'settings.json'), JSON.stringify(data, null, 2)); return true; }
  catch (_) { return false; }
});

// ── IPC: Data management ──────────────────────────────────────────────────────
ipcMain.handle('clear-all-chats', async () => {
  try {
    const s = getStorage();
    for (const dir of [LOCAL_DIR, s.isExternal ? s.path : null].filter(Boolean)) {
      fs.readdirSync(dir).filter(f => f.startsWith('chat_') && f.endsWith('.json'))
        .forEach(f => { try { fs.unlinkSync(path.join(dir, f)); } catch (_) {} });
    }
    return true;
  } catch (_) { return false; }
});

ipcMain.handle('clear-all-memory', async () => {
  try {
    const data = { facts: [] };
    fs.writeFileSync(path.join(LOCAL_DIR, 'memory.json'), JSON.stringify(data, null, 2));
    const s = getStorage();
    if (s.isExternal) fs.writeFileSync(path.join(s.path, 'memory.json'), JSON.stringify(data, null, 2));
    return true;
  } catch (_) { return false; }
});

// ── IPC: Window control ───────────────────────────────────────────────────────
ipcMain.on('hide',        () => mainWindow.hide());
ipcMain.on('minimize',    () => mainWindow.minimize());
ipcMain.on('show-window', () => { mainWindow.show(); mainWindow.focus(); });

ipcMain.on('enter-mini', () => {
  const { workArea } = screen.getPrimaryDisplay();
  mainWindow.setMinimumSize(200, 60);                // MUST unlock before resize
  mainWindow.setAlwaysOnTop(true, 'floating');
  mainWindow.setSize(340, 72);
  mainWindow.setPosition(workArea.x + workArea.width - 360, workArea.y + 20);
  mainWindow.show();
});

ipcMain.on('exit-mini', () => {
  mainWindow.setAlwaysOnTop(false);
  mainWindow.setMinimumSize(420, 600);
  mainWindow.setSize(520, 860);
  mainWindow.center();
});

// ── Mic permission ────────────────────────────────────────────────────────────
async function requestMic() {
  if (process.platform === 'darwin' &&
      systemPreferences.getMediaAccessStatus('microphone') !== 'granted') {
    await systemPreferences.askForMediaAccess('microphone');
  }
}

// ── Window + Tray ─────────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 740, height: 700, minWidth: 360, minHeight: 480, resizable: true,
    frame: false, transparent: true,
    titleBarStyle: 'hidden', trafficLightPosition: { x: 14, y: 14 },
    webPreferences: { nodeIntegration: true, contextIsolation: false, webSecurity: false },
    show: false
  });
  mainWindow.webContents.session.setPermissionRequestHandler((_, __, cb) => cb(true));
  mainWindow.webContents.session.setPermissionCheckHandler(() => true);
  mainWindow.loadFile('index.html');
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('close', e => { if (isQuitting) return; e.preventDefault(); mainWindow.hide(); });
}

function createTray() {
  tray = new Tray(nativeImage.createEmpty());
  tray.setToolTip('ARIA');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open ARIA', click: () => { mainWindow.show(); mainWindow.focus(); } },
    { type: 'separator' },
    { label: 'Quit', click: () => app.exit(0) }
  ]));
  tray.on('click', () =>
    mainWindow.isVisible() ? mainWindow.hide() : (mainWindow.show(), mainWindow.focus())
  );
}

// ── IPC: PDF export ───────────────────────────────────────────────────────────
ipcMain.handle('export-pdf', async () => {
  try {
    const data = await mainWindow.webContents.printToPDF({
      printBackground: true, pageSize: 'A4'
    });
    const res = await dialog.showSaveDialog(mainWindow, {
      title: 'Export Chat as PDF',
      defaultPath: path.join(os.homedir(), 'Desktop', `logan-chat-${Date.now()}.pdf`),
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    });
    if (res.canceled || !res.filePath) return false;
    fs.writeFileSync(res.filePath, data);
    return true;
  } catch(e) { return false; }
});

// ── IPC: iMessage ─────────────────────────────────────────────────────────────
ipcMain.handle('send-imessage', async (_, { to, text }) => {
  if (process.platform !== 'darwin') return { ok: false, error: 'macOS only' };
  const safe = text.replace(/"/g, '\\"').replace(/'/g, "\\'");
  const script = `tell application "Messages"\nset targetService to 1st service whose service type = iMessage\nset targetBuddy to buddy "${to}" of targetService\nsend "${safe}" to targetBuddy\nend tell`;
  return new Promise(resolve => {
    exec(`osascript -e '${script}'`, err =>
      err ? resolve({ ok: false, error: err.message }) : resolve({ ok: true })
    );
  });
});

// ── IPC: Network speed test ───────────────────────────────────────────────────
ipcMain.handle('speed-test', () => new Promise(resolve => {
  const https = require('https');
  const start = Date.now();
  let bytes = 0;
  const req = https.get('https://speed.cloudflare.com/__down?bytes=1000000', res => {
    res.on('data', d => { bytes += d.length; });
    res.on('end', () => {
      const ms = Date.now() - start;
      const mbps = ((bytes * 8) / (ms / 1000) / 1e6).toFixed(2);
      resolve({ ok: true, mbps, ms, bytes });
    });
  });
  req.on('error', e => resolve({ ok: false, error: e.message }));
  req.setTimeout(15000, () => { req.destroy(); resolve({ ok: false, error: 'Timeout' }); });
}));

// ── IPC: Generate HTML file ───────────────────────────────────────────────────
ipcMain.handle('save-and-open-html', async (_, { html, name }) => {
  try {
    const f = path.join(os.tmpdir(), `logan_${name || 'page'}_${Date.now()}.html`);
    fs.writeFileSync(f, html, 'utf8');
    await shell.openExternal(`file://${f}`);
    return { ok: true, path: f };
  } catch(e) { return { ok: false, error: e.message }; }
});

// ── IPC: Execute code snippet ─────────────────────────────────────────────────
ipcMain.handle('exec-code', async (_, { code, lang }) => {
  const choice = await dialog.showMessageBox(mainWindow, {
    type: 'warning', buttons: ['Run', 'Cancel'], defaultId: 1,
    title: `Run ${lang || 'code'} snippet`,
    message: 'Execute this code snippet?',
    detail: code.substring(0, 300)
  });
  if (choice.response !== 0) return { ok: false, error: 'Cancelled' };
  return new Promise(resolve => {
    let cmd, ext;
    if (lang === 'python' || lang === 'python3') { ext = '.py'; cmd = 'python3'; }
    else if (lang === 'javascript' || lang === 'js' || lang === 'node') { ext = '.js'; cmd = 'node'; }
    else if (lang === 'bash' || lang === 'sh') { ext = '.sh'; cmd = 'bash'; }
    else { resolve({ ok: false, error: `Unsupported language: ${lang}` }); return; }
    const tmpFile = path.join(os.tmpdir(), `logat_snippet_${Date.now()}${ext}`);
    fs.writeFileSync(tmpFile, code, 'utf8');
    exec(`${cmd} "${tmpFile}"`, { timeout: 30000 }, (err, stdout, stderr) => {
      try { fs.unlinkSync(tmpFile); } catch(_) {}
      if (err && !stdout) resolve({ ok: false, error: stderr || err.message });
      else resolve({ ok: true, output: (stdout + (stderr ? '\n[stderr]\n' + stderr : '')).trim().substring(0, 3000) });
    });
  });
});

// ── IPC: Notes ────────────────────────────────────────────────────────────────
ipcMain.handle('load-notes', () => {
  try {
    const f = path.join(LOCAL_DIR, 'notes.json');
    if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch (_) {}
  return { notes: [] };
});

ipcMain.handle('save-notes', (_, data) => {
  try { fs.writeFileSync(path.join(LOCAL_DIR, 'notes.json'), JSON.stringify(data, null, 2)); return true; }
  catch (_) { return false; }
});

// ── IPC: Documents ────────────────────────────────────────────────────────────
ipcMain.handle('load-docs', () => {
  try {
    const f = path.join(LOCAL_DIR, 'documents.json');
    if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch (_) {}
  return { docs: [] };
});

ipcMain.handle('save-docs', (_, data) => {
  try { fs.writeFileSync(path.join(LOCAL_DIR, 'documents.json'), JSON.stringify(data, null, 2)); return true; }
  catch (_) { return false; }
});

// ── IPC: Screenshot ───────────────────────────────────────────────────────────
ipcMain.handle('take-screenshot', async () => {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen'], thumbnailSize: { width: 1920, height: 1080 }
    });
    if (!sources.length) return { ok: false, error: 'No screen source found' };
    const b64 = sources[0].thumbnail.toPNG().toString('base64');
    return { ok: true, b64, mime: 'image/png' };
  } catch(e) { return { ok: false, error: e.message }; }
});

// ── IPC: System stats ─────────────────────────────────────────────────────────
ipcMain.handle('get-system-stats', () => {
  try {
    const cpus = os.cpus();
    let totalIdle = 0, totalTick = 0;
    cpus.forEach(cpu => {
      for (const t in cpu.times) totalTick += cpu.times[t];
      totalIdle += cpu.times.idle;
    });
    const cpuPct = Math.round((1 - totalIdle / totalTick) * 100);
    const free = os.freemem(), total = os.totalmem();
    const ramPct = Math.round((1 - free / total) * 100);
    const ramFreeGB = (free / 1e9).toFixed(1);
    const ramTotalGB = (total / 1e9).toFixed(1);
    const platform = os.platform();
    const uptime = os.uptime();
    return { ok: true, cpuPct, ramPct, ramFreeGB, ramTotalGB, platform, uptime };
  } catch(e) { return { ok: false, error: e.message }; }
});

// ── IPC: Clipboard ────────────────────────────────────────────────────────────
ipcMain.handle('read-clipboard', () => {
  try { return { ok: true, text: clipboard.readText() }; }
  catch(e) { return { ok: false, text: '' }; }
});

// ── IPC: Shell execution ──────────────────────────────────────────────────────
ipcMain.handle('exec-shell', async (_, cmd) => {
  const choice = await dialog.showMessageBox(mainWindow, {
    type: 'warning', buttons: ['Run', 'Cancel'], defaultId: 1,
    title: 'Execute Command', message: 'Run this shell command?', detail: cmd
  });
  if (choice.response !== 0) return { ok: false, error: 'Cancelled by user' };
  return new Promise(resolve => {
    exec(cmd, { timeout: 30000 }, (err, stdout, stderr) => {
      if (err) resolve({ ok: false, error: err.message, output: stderr });
      else resolve({ ok: true, output: (stdout || stderr || '(no output)').trim().substring(0, 3000) });
    });
  });
});

// ── IPC: Knowledge Base ───────────────────────────────────────────────────────
ipcMain.handle('load-knowledge', () => {
  try {
    const f = path.join(LOCAL_DIR, 'knowledge.json');
    if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch (_) {}
  return { entries: [] };
});

ipcMain.handle('save-knowledge', (_, data) => {
  try { fs.writeFileSync(path.join(LOCAL_DIR, 'knowledge.json'), JSON.stringify(data, null, 2)); return true; }
  catch (_) { return false; }
});

// ── IPC: Personas ─────────────────────────────────────────────────────────────
ipcMain.handle('load-personas', () => {
  try {
    const f = path.join(LOCAL_DIR, 'personas.json');
    if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch (_) {}
  return { personas: [], activeId: null };
});

ipcMain.handle('save-personas', (_, data) => {
  try { fs.writeFileSync(path.join(LOCAL_DIR, 'personas.json'), JSON.stringify(data, null, 2)); return true; }
  catch (_) { return false; }
});

// ── IPC: Process list ─────────────────────────────────────────────────────────
ipcMain.handle('get-processes', () => new Promise(resolve => {
  const cmd = process.platform === 'darwin'
    ? "ps aux -r | head -21"
    : "ps aux --sort=-%cpu | head -21";
  exec(cmd, { timeout: 10000 }, (err, stdout) => {
    if (err) { resolve({ ok: false, processes: [] }); return; }
    const lines = stdout.trim().split('\n').slice(1);
    const processes = lines.map(line => {
      const parts = line.trim().split(/\s+/);
      return {
        pid: parts[1],
        cpu: parseFloat(parts[2]) || 0,
        mem: parseFloat(parts[3]) || 0,
        name: parts.slice(10).join(' ').substring(0, 35) || parts[10] || '?'
      };
    }).filter(p => p.pid && p.name);
    resolve({ ok: true, processes: processes.slice(0, 18) });
  });
}));

ipcMain.handle('kill-process', async (_, pid) => {
  const choice = await dialog.showMessageBox(mainWindow, {
    type: 'warning', buttons: ['Kill', 'Cancel'], defaultId: 1,
    title: 'Kill Process', message: `Terminate process ${pid}?`
  });
  if (choice.response !== 0) return false;
  return new Promise(resolve => { exec(`kill ${pid}`, err => resolve(!err)); });
});

// ── IPC: Reminders ────────────────────────────────────────────────────────────
ipcMain.handle('load-reminders', () => {
  try {
    const f = path.join(LOCAL_DIR, 'reminders.json');
    if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch (_) {}
  return { reminders: [] };
});

ipcMain.handle('save-reminders', (_, data) => {
  try { fs.writeFileSync(path.join(LOCAL_DIR, 'reminders.json'), JSON.stringify(data, null, 2)); return true; }
  catch (_) { return false; }
});

ipcMain.handle('show-notification', (_, { title, body }) => {
  try {
    if (Notification.isSupported()) new Notification({ title, body }).show();
    return true;
  } catch(_) { return false; }
});

// ── IPC: Open external URL ────────────────────────────────────────────────────
ipcMain.handle('open-url', (_, url) => {
  try { shell.openExternal(url); return true; } catch(_) { return false; }
});

// ── IPC: Set window size ──────────────────────────────────────────────────────
ipcMain.handle('set-size', (_, { w, h }) => {
  if (mainWindow) mainWindow.setSize(w, h, true);
  return true;
});

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  await requestMic();
  createWindow();
  createTray();
  globalShortcut.register('CommandOrControl+Shift+L', () => {
    if (mainWindow.isVisible() && mainWindow.isFocused()) mainWindow.hide();
    else { mainWindow.show(); mainWindow.focus(); }
  });
});
app.on('before-quit', () => { isQuitting = true; globalShortcut.unregisterAll(); });
app.on('window-all-closed', e => { if (!isQuitting) e.preventDefault(); });
app.on('activate', () => mainWindow.show());
