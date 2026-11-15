"""Build the offline Windows application from pinned, public inputs only."""
from pathlib import Path
import argparse, hashlib, json, os, shutil, subprocess, tarfile, urllib.request, zipfile

ROOT = Path(__file__).resolve().parent.parent
LOCK = json.loads((ROOT / 'installer/inputs.lock.json').read_text(encoding='utf-8'))
def digest(p):
    with p.open('rb') as f: return hashlib.file_digest(f, 'sha256').hexdigest()
def acquire(spec, cache):
    file = cache / spec['archive']
    if not file.exists() or digest(file) != spec['sha256']:
        print('Downloading', spec['archive'], flush=True)
        partial = file.with_suffix(file.suffix + '.partial')
        with urllib.request.urlopen(spec['url'], timeout=90) as src, partial.open('wb') as out:
            shutil.copyfileobj(src, out)
        if digest(partial) != spec['sha256']: raise RuntimeError('Input hash mismatch: ' + spec['archive'])
        partial.replace(file)
    return file
def replace(file, old, new):
    s = file.read_text(encoding='utf-8')
    if s.count(old) != 1: raise RuntimeError('Pinned upstream source changed: ' + str(file))
    file.write_text(s.replace(old, new), encoding='utf-8', newline='')
def safe_member(name):
    return not Path(name).is_absolute() and '..' not in Path(name).parts and ':' not in name

def build(work, output, prepare_only=False):
    work = work.resolve(); output = output.resolve()
    cache = work / 'downloads'; cache.mkdir(parents=True, exist_ok=True)
    payload = work / 'payload'
    if payload.exists(): raise RuntimeError('Use a fresh --work directory; existing builds are never overwritten.')
    payload.mkdir(); output.mkdir(parents=True, exist_ok=True)
    upstream = acquire(LOCK['coopanion'], cache)
    app = payload / 'Coopanion'; app.mkdir()
    with zipfile.ZipFile(upstream) as z:
        for n in z.namelist():
            if not safe_member(n): raise RuntimeError('Archive path escaped the payload')
            # Retain upstream built-in figures and their original attribution notices.
            z.extract(n, app)
    control = payload / 'Control'; control.mkdir()
    names = json.loads((ROOT / 'installer/source-files.json').read_text(encoding='utf-8'))
    for n in names:
        if not safe_member(n) or n.startswith(('data/', 'node_modules/', 'config/runtime.json')): raise RuntimeError('Non-source file in allowlist')
        target = control / n; target.parent.mkdir(parents=True, exist_ok=True); shutil.copy2(ROOT / n, target)
    if not (ROOT / 'bridge/control-ui/index.html').exists(): raise RuntimeError('Build the voice settings before packaging')
    shutil.copytree(ROOT / 'bridge/control-ui', control / 'bridge/control-ui')
    (control / 'config/runtime.json').write_text(json.dumps({'companionDir':'../Coopanion','host':'coopanion','node':'../Runtime/node.exe','voicesDir':'../Models/voices'}, indent=2), encoding='utf-8')
    runtime = payload / 'Runtime'; runtime.mkdir()
    with zipfile.ZipFile(acquire(LOCK['node'], cache)) as z:
        prefix = 'node-v' + LOCK['node']['version'] + '-win-x64/'
        for n in ['node.exe','LICENSE','README.md']:
            (runtime/n).write_bytes(z.read(prefix+n))
    models = payload/'Models'; voices=models/'voices'; voices.mkdir(parents=True)
    for spec in LOCK['voices']:
        with tarfile.open(acquire(spec, cache), 'r:bz2') as t: t.extractall(voices, filter='data')
    whisper = models/'asr'/LOCK['whisper']['name']; whisper.mkdir(parents=True)
    for spec in LOCK['whisper']['files']:
        source = cache/'whisper'/spec['name']
        if not source.exists() or digest(source)!=spec['sha256']:
            source.parent.mkdir(exist_ok=True)
            with urllib.request.urlopen(LOCK['whisper']['base']+spec['name'],timeout=90) as r,source.open('wb') as f: shutil.copyfileobj(r,f)
        if digest(source)!=spec['sha256']: raise RuntimeError('Whisper model hash mismatch')
        shutil.copy2(source,whisper/spec['name'])
    whisper_license=cache/'whisper/LICENSE'
    if not whisper_license.exists(): whisper_license.write_bytes(urllib.request.urlopen('https://raw.githubusercontent.com/openai/whisper/main/LICENSE',timeout=30).read())
    shutil.copy2(whisper_license,whisper/'LICENSE')
    # The complete pinned public runtime is retained, including all original component notices.
    upstream_root=app/'resources/app'; core=upstream_root/'core'; pet=upstream_root/'node_modules/cortico-world-desktop-pet'
    entry=upstream_root/'app/main.cjs'
    bootstrap="""// Community bundle host; every entry, including login and pinned taskbar launch, shares one profile.
{
 const p=require('node:path'),base=p.resolve(__dirname,'../../../..');
 const local=process.env.LOCALAPPDATA||p.join(require('node:os').homedir(),'AppData/Local');
 const profile=process.env.COMPANION_CONTROL_PROFILE||p.join(local,'CompanionControl/Profile');
 process.env.CORTICO_COMPANION_DATA||=p.join(profile,'core');
 process.env.DESKTOP_CONTROL_DATA||=p.join(profile,'desktop');
 process.env.COMPANION_CONTROL_ASR||=p.join(base,'Models/asr');
 process.env.PET_TTS_MODEL||='int8';
 process.env.PATH=p.join(base,'Runtime')+p.delimiter+(process.env.PATH||'');
}
if(process.argv.includes('--desktop-control-host')){require(require('node:path').resolve(__dirname,'../../../../Control/main.cjs'));return;}
"""
    entry.write_text(bootstrap+entry.read_text(encoding='utf-8'),encoding='utf-8',newline='')
    companion=core/'companion.ts'
    companion.write_text("import WINDOWS_CONTROL from '../../../../Control/bridge/index.mjs';\n"+companion.read_text(encoding='utf-8'),encoding='utf-8',newline='')
    replace(companion,'declares: [CONSOLE.id, DESKTOP_PET.id, NOTICE.id]', 'declares: [CONSOLE.id, DESKTOP_PET.id, NOTICE.id, WINDOWS_CONTROL.id]')
    replace(companion,'const bundled = [CONSOLE, DESKTOP_PET, NOTICE]', 'const bundled = [CONSOLE, DESKTOP_PET, NOTICE, WINDOWS_CONTROL]')
    replace(companion,"{ id: DESKTOP_PET.id, packageName: 'cortico-world-desktop-pet' },", "{ id: DESKTOP_PET.id, packageName: 'cortico-world-desktop-pet' },\n    { id: WINDOWS_CONTROL.id, packageName: 'cortico-world-windows-desktop' },")
    replace(core/'seed.ts',"worlds: { 'desktop-pet': { cua: { permission: CUA_ASK } } },", "worlds: { 'desktop-pet': { skin: { figure: 'whale', scheme: 'deepseek' }, cua: { permission: CUA_ASK }, asr: { engine: 'whisper', enabled: true, mic: { mode: 'hold', hotkey: 'F8' } } }, 'windows-desktop': { enabled: true } },")
    replace(pet/'src/definition.ts','modelsDir: () => modelsDirFor(modelsRoot()),','modelsDir: () => process.env.COMPANION_CONTROL_ASR || modelsDirFor(modelsRoot()),')
    proxy=upstream_root/'node_modules/cortico-world-windows-desktop'; proxy.mkdir()
    meta=json.loads((control/'bridge/package.json').read_text(encoding='utf-8'));meta['main']='index.mjs';meta['cortico']['webUiClient']='webui.js'
    (proxy/'package.json').write_text(json.dumps(meta,ensure_ascii=False,indent=2),encoding='utf-8')
    (proxy/'index.mjs').write_text("export {default} from '../../../../../Control/bridge/index.mjs';\n",encoding='utf-8')
    shutil.copy2(control/'bridge/webui.js',proxy/'webui.js')
    subprocess.run([str(runtime/'node.exe'),'--input-type=module','-e',"import {installIntegration} from './install-integration.mjs'; console.log(installIntegration());"],cwd=control,check=True)
    world=pet/'src/world.ts'
    # Ship the edited application sources as well as the build recipe. No user's deployment is read.
    for original in [entry,companion,core/'seed.ts',pet/'src/definition.ts',world]:
        target=control/'installer/patched-upstream'/original.relative_to(upstream_root);target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(original,target)
    csc=Path(os.environ['WINDIR'])/'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
    subprocess.run([str(csc),'/nologo','/target:winexe','/platform:x64','/optimize+','/reference:System.Windows.Forms.dll','/win32icon:'+str(upstream_root/'app/icons/icon.ico'),'/out:'+str(payload/'CompanionControl.exe'),str(ROOT/'installer/Launcher.cs')],check=True)
    shutil.copy2(ROOT/'LICENSE',payload/'LICENSE')
    (payload/'使用说明.txt').write_text('桌面伙伴 · Windows 控制 社区整合版 0.14.2\n\n双击桌面快捷方式即可启动。首次在原管理窗口填写自己的聊天模型账号。\n已内置应用控制、中文离线朗读和 Whisper 语音识别环境；按住 F8 说话，松开发送。\n应用授权在“桌面生态扩展 → 应用与活动”，安装不会默认授权电脑里的应用。\n聊天、声音、形象与设置共用原管理窗口，关闭窗口后桌宠仍在托盘运行。\n\n账号密钥、QQ登录、个人声音、歌曲作品均未预置。保留原版内置鲸鱼娘及全部配色，首次使用默认 DeepSeek 配色；装扮页仍可切换 Coo 和其他内置装扮。原素材来源与权利声明完整保留。\n翻唱属于可选制作功能，授权声音与其制作模型需单独导入；本控制版不附带你的个人翻唱模型。\n聊天和设置位于 %LOCALAPPDATA%\\CompanionControl\\Profile，卸载默认保留。\n源码与全部构建配方：https://github.com/2559804146g-commits/coopanion-windows-control\n上游源码：https://github.com/Pal-AI-Lab/Coopanion/tree/v0.2.19\n第三方许可见程序各组件 LICENSE/THIRD_PARTY_NOTICES 与 Control/THIRD_PARTY.md。\n',encoding='utf-8')
    manifest={'version':'0.14.2','inputs':LOCK,'files':{}}
    for file in payload.rglob('*'):
        if file.is_file(): manifest['files'][file.relative_to(payload).as_posix()]={'sha256':digest(file),'bytes':file.stat().st_size}
    (control/'bundle-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
    if prepare_only: return payload
    with zipfile.ZipFile(acquire(LOCK['nsis'],cache)) as z: z.extractall(work/'tools')
    compiler=next((work/'tools').glob('nsis-*/makensis.exe'))
    # Explicit delete list preserves anything the user added, and never touches profile data.
    uninstall=work/'uninstall-files.nsh';lines=[]
    for file in payload.rglob('*'):
        if file.is_file(): lines.append('Delete "$INSTDIR\\'+str(file.relative_to(payload)).replace('/','\\').replace('$','$$')+'"')
    for d in sorted((d for d in payload.rglob('*') if d.is_dir()),key=lambda p:len(p.parts),reverse=True):lines.append('RMDir "$INSTDIR\\'+str(d.relative_to(payload)).replace('/','\\').replace('$','$$')+'"')
    uninstall.write_text('\n'.join(lines)+'\n',encoding='utf-8-sig')
    target=output/'CompanionControl-0.14.2-win-x64-Setup.exe'
    script=work/'setup.nsi';shutil.copy2(ROOT/'installer/setup.nsi',script)
    subprocess.run([str(compiler),'/V2','/INPUTCHARSET','UTF8','/DPAYLOAD='+str(payload),'/DOUTPUT='+str(target),'/DUNINSTALL_FILES='+str(uninstall),str(script)],check=True)
    (output/(target.name+'.sha256')).write_text(digest(target)+'  '+target.name+'\n',encoding='ascii')
    shutil.copy2(control/'bundle-manifest.json',output/'bundle-manifest-0.14.2.json')
    print(json.dumps({'installer':str(target),'bytes':target.stat().st_size,'sha256':digest(target)},ensure_ascii=False),flush=True)
    return payload
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--work',type=Path,required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--prepare-only',action='store_true');a=p.parse_args();build(a.work,a.output,a.prepare_only)
