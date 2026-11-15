const { app, BrowserWindow, screen } = require('electron');
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
app.setPath('userData', path.resolve(__dirname, '../验收/fixture-data'));
let win, server;
app.whenReady().then(async () => {
  const a = screen.getPrimaryDisplay().workArea;
  win = new BrowserWindow({ width: 620, height: 280, x: a.x + 65, y: a.y + Math.min(350, a.height - 330), title: '空间联动验收窗口', alwaysOnTop: true, backgroundColor: '#213b37', webPreferences: { nodeIntegration: false, contextIsolation: true } });
  win.setMenu(null);
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<html lang="zh-CN"><meta charset="utf-8"><body style="margin:0;padding:36px;background:#213b37;color:#dfede6;font:16px/1.8 Microsoft YaHei"><h2 style="font-weight:500;margin:0 0 15px">真实 Windows 窗口联动验收</h2><p>此窗口由测试程序创建，用于核验角色抵达、跟随移动、最小化和恢复。</p><p style="color:#a7c6b7">检查结束后自动关闭，不读取或修改其他应用。</p></body></html>'));
  win.showInactive();
  server = http.createServer(async (req, res) => {
    if (req.headers['x-fixture-token'] !== process.env.DESKTOP_FIXTURE_TOKEN) { res.writeHead(403).end(); return; }
    let data = ''; for await (const chunk of req) data += chunk;
    try {
      const value = JSON.parse(data || '{}');
      if (value.action === 'move') { const b = win.getBounds(); win.setBounds({ ...b, x: b.x + 130, y: b.y + 40 }); }
      if (value.action === 'minimize') win.minimize();
      if (value.action === 'restore') { win.restore(); win.showInactive(); }
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true, bounds: win.getBounds() }));
      if (value.action === 'quit') app.quit();
    } catch { res.writeHead(400).end(); }
  });
  server.listen(17831, '127.0.0.1');
});
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => server?.close());
