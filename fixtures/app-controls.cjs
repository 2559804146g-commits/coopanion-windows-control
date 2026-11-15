const {app,BrowserWindow}=require('electron');
const http=require('node:http');
app.setName('应用控件验收');let win;
const server=http.createServer((req,res)=>{
 if(req.headers.host!=='127.0.0.1:17835'){res.writeHead(403).end();return;}
 if(req.method==='GET'&&req.url==='/health'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({fixture:'scoped-app-controls',pid:process.pid}));return;}
 if(req.method==='POST'&&req.url==='/quit'){res.end('ok');setImmediate(()=>app.quit());return;}
 res.writeHead(404).end();
});
server.on('error',()=>app.quit());
app.whenReady().then(async()=>{
 await new Promise(resolve=>server.listen(17835,'127.0.0.1',resolve));
 win=new BrowserWindow({title:'应用控件验收窗口',width:680,height:460,autoHideMenuBar:true,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}});
 const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>应用控件验收窗口</title><style>body{font:16px sans-serif;padding:35px;background:#edf2ef;color:#173528}label{display:block;margin:20px 0 10px}input,button{font:inherit;padding:10px}p{margin-top:25px}</style><h1>应用操作验收</h1><label for="query">搜索测试</label><input id="query" aria-label="搜索测试"><button id="find">查找</button><p id="result" aria-live="polite">尚未查找</p><label for="protected">保护字段</label><input id="protected" type="password" value="fixture-secret-never-output" aria-label="保护字段"><button id="sensitive">删除（仅验收）</button><script>document.getElementById('find').onclick=()=>document.getElementById('result').textContent='找到：'+document.getElementById('query').value;</script></html>`;
 await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(html));
 win.show();
});
app.on('before-quit',()=>server.close());app.on('window-all-closed',()=>app.quit());
