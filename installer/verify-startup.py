"""Verify real entry points with a clean profile, without credentials or application actions."""
from pathlib import Path
import argparse,json,os,socket,subprocess,time,urllib.request
ap=argparse.ArgumentParser();ap.add_argument('root');ap.add_argument('profile');ap.add_argument('--shortcut');ap.add_argument('--default-profile',action='store_true');a=ap.parse_args()
root=Path(a.root).resolve();profile=Path(a.profile).resolve()
assert (root/'Control/bundle-manifest.json').exists()
ports=[17788,7797,17830]
def listening(port):
    with socket.socket() as s:return s.connect_ex(('127.0.0.1',port))==0
if any(map(listening,ports)):raise RuntimeError('Refusing to touch an existing desktop service')
def call(url,data=None):
    req=urllib.request.Request(url,data=json.dumps(data).encode() if data is not None else None,headers={'Content-Type':'application/json'})
    return json.load(urllib.request.urlopen(req,timeout=5))
def ready():
    deadline=time.monotonic()+90;last=None
    while time.monotonic()<deadline:
        try:
            state=call('http://127.0.0.1:17830/api/state')
            page=call('http://127.0.0.1:17788/api/webui/providers/world%3Awindows-desktop/panels/activity/desktopState',{'args':[]})
            assert isinstance(page.get('apps'),list)
            if state['runtime']['bridgeOnline']:return state
        except Exception as e:last=str(e)
        time.sleep(1)
    raise RuntimeError('Packaged host failed to start: '+str(last))
def stop():
    try:call('http://127.0.0.1:17788/api/webui/providers/world%3Adesktop-pet/panels/pet/quitApplication',{'args':[]})
    except Exception:pass
    deadline=time.monotonic()+30
    while any(map(listening,ports)) and time.monotonic()<deadline:time.sleep(.5)
    if any(map(listening,ports)):raise RuntimeError('Packaged services did not stop')
    time.sleep(2)
env=os.environ.copy()
for key in ['CORTICO_COMPANION_DATA','DESKTOP_CONTROL_DATA','COMPANION_CONTROL_ASR','COMPANION_CONTROL_PROFILE','ELECTRON_RUN_AS_NODE']:env.pop(key,None)
if not a.default_profile:env['COMPANION_CONTROL_PROFILE']=str(profile)
launch=None
try:
    if a.shortcut:
        os.environ.clear();os.environ.update(env);os.startfile(str(Path(a.shortcut).resolve()))
    else:launch=subprocess.Popen([str(root/'CompanionControl.exe')],env=env,cwd=root)
    state=ready()
    config=profile/'core/home/companion/config.json'
    c=json.loads(config.read_text(encoding='utf-8'));assert c['worlds']['windows-desktop']['enabled']
    assert (profile/'desktop/desktop.json').exists()
    assert not (root/'Coopanion/data').exists()
    assert not (root/'Control/data').exists()
    assert all(app['access']=='off' for app in state['apps'] if not app['id'].startswith('builtin:'))
    marker=profile/'desktop/entry-point-retention.txt';marker.write_text('same-profile',encoding='utf-8')
    stop()
    if launch:launch.wait(timeout=10)
    # Login items and pinned taskbar shortcuts launch the upstream executable directly.
    launch=subprocess.Popen([str(root/'Coopanion/Coopanion.exe'),'--background'],env=env,cwd=root)
    ready()
    assert marker.read_text(encoding='utf-8')=='same-profile'
    assert not (root/'Coopanion/data').exists() and not (root/'Control/data').exists()
    report={'version':json.loads((root/'Control/bundle-manifest.json').read_text(encoding='utf-8'))['version'],'coreStarted':True,'controlStarted':True,'originalSettingsPanelAvailable':True,'factoryAppPermissionsEmpty':True,'profileOutsideProgram':True,'rawExecutableReusesProfile':True,'desktopShortcutLaunched':bool(a.shortcut)}
    (profile.parent/'startup-verification.json').write_text(json.dumps(report,indent=2),encoding='utf-8');print(json.dumps(report))
finally:
    stop()
    if launch:
        try:launch.wait(timeout=10)
        except subprocess.TimeoutExpired:raise RuntimeError('Packaged host process did not exit')
