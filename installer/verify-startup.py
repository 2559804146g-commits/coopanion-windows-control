"""Exercise the packaged host with a new profile and no credentials, then stop only that host."""
from pathlib import Path
import json,os,subprocess,sys,time,urllib.request
root=Path(sys.argv[1]).resolve();profile=Path(sys.argv[2]).resolve()
assert (root/'Control/bundle-manifest.json').exists()
for port in [17788,7797,17830]:
    import socket
    with socket.socket() as s:
        if s.connect_ex(('127.0.0.1',port))==0:raise RuntimeError('Refusing to touch an existing desktop service')
env=os.environ.copy();env['COMPANION_CONTROL_PROFILE']=str(profile)
launcher=subprocess.Popen([str(root/'CompanionControl.exe')],env=env,cwd=root)
def call(url,data=None):
    req=urllib.request.Request(url,data=json.dumps(data).encode() if data is not None else None,headers={'Content-Type':'application/json'})
    return json.load(urllib.request.urlopen(req,timeout=5))
try:
    deadline=time.monotonic()+90;last=None
    while time.monotonic()<deadline:
        try:
            state=call('http://127.0.0.1:17830/api/state')
            page=call('http://127.0.0.1:17788/api/webui/providers/world%3Awindows-desktop/panels/activity/desktopState',{'args':[]})
            assert isinstance(page.get('apps'),list)
            if state['runtime']['bridgeOnline']:break
        except Exception as e:last=str(e)
        time.sleep(1)
    else:raise RuntimeError('Packaged host failed to start: '+str(last))
    config=profile/'core/home/companion/config.json'
    c=json.loads(config.read_text(encoding='utf-8'));assert c['worlds']['windows-desktop']['enabled']
    assert (profile/'desktop/desktop.json').exists()
    assert not (root/'Coopanion/data').exists()
    assert not (root/'Control/data').exists()
    assert all(a['access']=='off' for a in state['apps'] if not a['id'].startswith('builtin:'))
    report={'version':'0.14.0','coreStarted':True,'controlStarted':True,'originalSettingsPanelAvailable':True,'factoryAppPermissionsEmpty':True,'profileOutsideProgram':True,'bodyConnected':state.get('character',{}).get('connected')}
    (profile.parent/'startup-verification.json').write_text(json.dumps(report,indent=2),encoding='utf-8');print(json.dumps(report))
finally:
    try:call('http://127.0.0.1:17788/api/webui/providers/world%3Adesktop-pet/panels/pet/quitApplication',{'args':[]})
    except Exception:pass
    try:launcher.wait(timeout=10)
    except subprocess.TimeoutExpired:launcher.terminate()
