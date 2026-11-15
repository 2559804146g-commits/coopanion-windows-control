"""Publish only the allowlisted build outputs using the workflow's repository token."""
from pathlib import Path
import hashlib,json,os,urllib.request,urllib.error,urllib.parse,zipfile
root=Path(__file__).resolve().parent.parent
out=Path(os.environ['RELEASE_DIR']);payload=Path(os.environ['PAYLOAD_DIR']);repo=os.environ['GITHUB_REPOSITORY'];token=os.environ['GH_TOKEN'];sha=os.environ['GITHUB_SHA'];tag='v0.14.0'
assert repo=='2559804146g-commits/coopanion-windows-control'
def call(url,method='GET',data=None,content_type='application/json'):
    req=urllib.request.Request(url,data=data,method=method,headers={'Authorization':'Bearer '+token,'Accept':'application/vnd.github+json','Content-Type':content_type,'User-Agent':'CompanionControlRelease'})
    with urllib.request.urlopen(req,timeout=180) as r:return json.load(r)
source=out/'CompanionControl-0.14.0-source.zip'
with zipfile.ZipFile(source,'w',zipfile.ZIP_DEFLATED) as z:
    for name in json.loads((root/'installer/source-files.json').read_text(encoding='utf-8')):z.write(root/name,'coopanion-windows-control/'+name)
    # Exact application sources and all upstream notices corresponding to the included runtime.
    for f in (payload/'Coopanion/resources/app').rglob('*'):
        if f.is_file():z.write(f,'bundled-app/'+f.relative_to(payload/'Coopanion/resources/app').as_posix())
exe=out/'CompanionControl-0.14.0-win-x64-Setup.exe'
assert exe.stat().st_size>100_000_000
checksum=out/(exe.name+'.sha256');checksum.write_text(hashlib.file_digest(exe.open('rb'),'sha256').hexdigest()+'  '+exe.name+'\n',encoding='ascii')
assets=[exe,checksum,source,out/'bundle-manifest-0.14.0.json']
url='https://api.github.com/repos/'+repo+'/releases'
body='Windows 10/11 x64 社区整合安装版。下载 Setup.exe 后安装，桌面快捷方式直接启动。\n\n已含桌宠、应用控制、Node 运行时、中文离线朗读和 Whisper 语音识别模型，无需安装开发环境。聊天模型账号与密钥由使用者自己填写。默认提供 Coo，受限鲸鱼贴图与私人翻唱音色不随包分发。\n\n聊天和设置保存在用户目录，升级与卸载默认保留。此版本尚未做代码签名，Windows 可能显示未知发布者。首次发布标为预发行版。\n\n附 SHA256、完整应用对应源码和组件清单。构建提交：'+sha
try:
    release=call(url+'/tags/'+tag)
    if not release['draft']:raise RuntimeError('An existing published version is never replaced automatically')
except urllib.error.HTTPError as e:
    if e.code!=404:raise
    release=call(url,'POST',json.dumps({'tag_name':tag,'target_commitish':sha,'name':'桌面伙伴 Windows 控制 0.14.0 · 整合安装版','body':body,'draft':True,'prerelease':True},ensure_ascii=False).encode())
existing={a['name'] for a in release.get('assets',[])}
for f in assets:
    if f.name in existing:raise RuntimeError('Existing draft asset requires manual review: '+f.name)
    call(release['upload_url'].split('{')[0]+'?name='+urllib.parse.quote(f.name),'POST',f.read_bytes(),'application/octet-stream')
release=call(url+'/'+str(release['id']),'PATCH',json.dumps({'draft':False}).encode())
print(json.dumps({'release':release['html_url'],'files':[a.name for a in assets]}))
