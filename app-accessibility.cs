using System;
using System.Text;
using System.Diagnostics;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using Accessibility;

// Public Windows accessibility only. Every observation/action is bound to one
// HWND, its process and exact executable path; no desktop-wide input is exposed.
public static class ScopedAppAccess {
    [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
    static ScopedAppAccess(){try{SetProcessDpiAwarenessContext(new IntPtr(-4));}catch{}}
    [DllImport("oleacc.dll")] static extern int AccessibleObjectFromWindow(IntPtr hwnd,uint objectId,ref Guid iid,[MarshalAs(UnmanagedType.Interface)] out object value);
    [DllImport("oleacc.dll")] static extern int AccessibleChildren(IAccessible parent,int start,int count,[Out,MarshalAs(UnmanagedType.LPArray,SizeParamIndex=2)]object[] values,out int got);
    [DllImport("oleacc.dll")] static extern int WindowFromAccessibleObject([MarshalAs(UnmanagedType.Interface)]IAccessible value,out IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr hwnd,EnumProc callback,IntPtr data);
    delegate bool EnumProc(IntPtr hwnd,IntPtr data);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd,out uint pid);
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hwnd);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool IsChild(IntPtr parent,IntPtr child);
    [DllImport("user32.dll")] static extern bool GetGUIThreadInfo(uint thread,ref GuiInfo info);
    [DllImport("user32.dll")] static extern bool PostMessage(IntPtr hwnd,uint message,IntPtr wparam,IntPtr lparam);
    [DllImport("user32.dll")] static extern uint SendInput(uint count,Input[] inputs,int size);
    [DllImport("user32.dll")] static extern bool GetLastInputInfo(ref LastInput info);
    [DllImport("user32.dll")] static extern bool SetCursorPos(int x,int y);
    [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(Point point);
    [DllImport("user32.dll")] static extern bool ScreenToClient(IntPtr hwnd,ref Point point);
    [StructLayout(LayoutKind.Sequential)] struct Point {public int x,y;}
    [StructLayout(LayoutKind.Sequential)] struct LastInput {public uint size,time;}
    [StructLayout(LayoutKind.Sequential)] struct Mouse {public int dx,dy;public uint data,flags,time;public UIntPtr extra;}
    [StructLayout(LayoutKind.Sequential)] struct Keyboard {public ushort key,scan;public uint flags,time;public UIntPtr extra;}
    [StructLayout(LayoutKind.Explicit)] struct InputData {[FieldOffset(0)]public Mouse mouse;[FieldOffset(0)]public Keyboard keyboard;}
    [StructLayout(LayoutKind.Sequential)] struct Input {public uint type;public InputData data;}
    public static uint BeforeInputTick,AfterInputTick;
    public static bool ActionDispatched;
    public static string ActionTransport;
    static IntPtr previousDpiContext;
    public static void ResetAction(){previousDpiContext=SetThreadDpiAwarenessContext(new IntPtr(-4));ActionDispatched=false;BeforeInputTick=AfterInputTick=0;ActionTransport=null;}
    public static void RestoreActionContext(){if(previousDpiContext!=IntPtr.Zero){SetThreadDpiAwarenessContext(previousDpiContext);previousDpiContext=IntPtr.Zero;}}
    static uint InputTick(){var info=new LastInput {size=(uint)Marshal.SizeOf(typeof(LastInput))};GetLastInputInfo(ref info);return info.time;}
    static void BeginInput(){if(BeforeInputTick==0){foreach(int key in new int[]{16,17,18,91,92})if((GetAsyncKeyState(key)&0x8000)!=0)throw new Exception("user_modifier_active");BeforeInputTick=InputTick();}}
    static Input Key(ushort key,uint flags,ushort scan){return new Input {type=1,data=new InputData {keyboard=new Keyboard {key=key,scan=scan,flags=flags,extra=new UIntPtr(0x45434f)}}};}
    static void Send(Input[] input){ActionDispatched=true;if(SendInput((uint)input.Length,input,Marshal.SizeOf(typeof(Input)))!=input.Length)throw new Exception("input_not_accepted");}
    static void KeyboardFocus(Node n,Frame frame){
        var hwnd=new IntPtr(frame.observation.window);if(GetForegroundWindow()!=hwnd)throw new Exception("foreground_changed");
        n.owner.accSelect(1,n.child);
        System.Threading.Thread.Sleep(100);
        if((Convert.ToInt32(n.owner.get_accState(n.child))&4)==0){
            var info=Describe(n,n.info.id);int x=info.x+info.width/2,y=info.y+info.height/2;
            var at=WindowFromPoint(new Point {x=x,y=y});if(at!=hwnd&&!IsChild(hwnd,at))throw new Exception("control_occluded");
            BeginInput();SetCursorPos(x,y);if(GetForegroundWindow()!=hwnd)throw new Exception("foreground_changed");
            Send(new Input[]{new Input {type=0,data=new InputData {mouse=new Mouse {flags=2}}},new Input {type=0,data=new InputData {mouse=new Mouse {flags=4}}}});
            for(int i=0;i<10&&(Convert.ToInt32(n.owner.get_accState(n.child))&4)==0;i++)System.Threading.Thread.Sleep(50);
            AfterInputTick=InputTick();
        }
        if((Convert.ToInt32(n.owner.get_accState(n.child))&4)==0)throw new Exception("editable_control_not_focused");
        if(GetForegroundWindow()!=hwnd)throw new Exception("foreground_changed");
    }
    [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr hwnd,StringBuilder value,int count);
    [StructLayout(LayoutKind.Sequential)] struct Rect {public int left,top,right,bottom;}
    [StructLayout(LayoutKind.Sequential)] struct GuiInfo {public uint size,flags;public IntPtr active,focus,capture,menuOwner,moveSize,caret;public Rect rect;}
    public sealed class NodeInfo {public string id,parentId,name,value,action;public int role;public bool enabled,offscreen,readOnly,protectedValue;public int x,y,width,height;}
    public sealed class Observation {public string snapshotId,appPath,title,capturedAt;public long window;public int processId,visited;public bool minimized,truncated;public NodeInfo[] nodes;}
    sealed class Node {public IAccessible owner;public object child;public string parentId;public NodeInfo info;}
    sealed class Frame {public Observation observation;public Dictionary<string,Node> nodes;public DateTime at;}
    static Dictionary<string,Frame> frames=new Dictionary<string,Frame>();
    static readonly Dictionary<int,string> Roles=new Dictionary<int,string>();
    static string Cut(string value,int max) {return value==null?"":value.Length>max?value.Substring(0,max):value;}
    static long Identity(IAccessible value) {IntPtr p=Marshal.GetIUnknownForObject(value);long id=p.ToInt64();Marshal.Release(p);return id;}
    static uint Guard(long window,string app) {
        var hwnd=new IntPtr(window);uint pid;
        if(!IsWindow(hwnd))throw new Exception("window_closed");
        GetWindowThreadProcessId(hwnd,out pid);
        var actual=Process.GetProcessById((int)pid).MainModule.FileName;
        if(!String.Equals(actual,app,StringComparison.OrdinalIgnoreCase))throw new Exception("window_application_changed");
        return pid;
    }
    static NodeInfo Describe(Node node,string id) {
        var a=node.owner;var c=node.child;var flags=Convert.ToInt32(a.get_accState(c));
        int role=Convert.ToInt32(a.get_accRole(c)),x,y,w,h;
        if(role==40||(flags&0x18000)!=0)return null;
        a.accLocation(out x,out y,out w,out h,c);
        var n=new NodeInfo {id=id,parentId=node.parentId,role=role,name=Cut(a.get_accName(c),400),enabled=(flags&1)==0,offscreen=(flags&0x18000)!=0,readOnly=(flags&0x40)!=0,protectedValue=(flags&0x20000000)!=0,x=x,y=y,width=w,height=h};
        if(!n.protectedValue&&role==42)try{n.value=Cut(a.get_accValue(c),2000);}catch{}
        if(role==43||role==37||role==12||role==30||role==34||role==22||(role==20&&System.Text.RegularExpressions.Regex.IsMatch(n.name,@"^(\d+|pause|play)\s")))try{n.action=Cut(a.get_accDefaultAction(c),80);}catch{}
        return n;
    }
    public static Observation Observe(long window,string app) {
        uint pid=Guard(window,app);var hwnd=new IntPtr(window);var title=new StringBuilder(1024);GetWindowText(hwnd,title,title.Capacity);
        var observation=new Observation {snapshotId=Guid.NewGuid().ToString("N"),appPath=app,window=window,processId=(int)pid,title=title.ToString(),minimized=IsIconic(hwnd),capturedAt=DateTimeOffset.UtcNow.ToString("o")};
        var output=new List<NodeInfo>();var bound=new Dictionary<string,Node>();var queue=new Queue<Node>();var seen=new HashSet<string>();
        var roots=new List<IntPtr>();roots.Add(hwnd);EnumChildWindows(hwnd,delegate(IntPtr child,IntPtr unused){roots.Add(child);return roots.Count<60;},IntPtr.Zero);
        var iid=new Guid("618736E0-3C3D-11CF-810C-00AA00389B71");
        IAccessible primary=null,document=null;long documentArea=0;
        foreach(var handle in roots){object value;try{if(AccessibleObjectFromWindow(handle,0xFFFFFFFC,ref iid,out value)>=0&&value is IAccessible){var a=(IAccessible)value;if(handle==hwnd)primary=a;if(Convert.ToInt32(a.get_accRole(0))==15){int x,y,w,h;a.accLocation(out x,out y,out w,out h,0);long area=(long)w*h;if(area>documentArea){document=a;documentArea=area;}}}}catch{}}
        // Chromium exposes the same document from several HWND roots. Traverse
        // its largest document once, rather than duplicating the entire DOM.
        if(document!=null||primary!=null)queue.Enqueue(new Node {owner=document??primary,child=0});
        var clock=Stopwatch.StartNew();int visited=0;
        while(queue.Count>0&&visited<2500&&clock.ElapsedMilliseconds<18000){
            var node=queue.Dequeue();
            try{
                string identity=Identity(node.owner)+":"+node.child.ToString();if(!seen.Add(identity))continue;visited++;
                var id="n"+visited;var info=Describe(node,id);if(info==null)continue;node.info=info;
                // Protected values are never read; offscreen containers may lead to visible descendants.
                output.Add(info);bound[id]=node;
                if(Convert.ToInt32(node.child)!=0)continue;
                int count=Math.Min(node.owner.accChildCount,1200);if(count<=0)continue;
                var children=new object[count];int got;if(AccessibleChildren(node.owner,0,count,children,out got)<0)continue;
                for(int i=0;i<got;i++){
                    if(children[i] is IAccessible)queue.Enqueue(new Node {owner=(IAccessible)children[i],child=0,parentId=id});
                    else if(children[i] is int){object child=null;try{child=node.owner.get_accChild(children[i]);}catch{}
                        queue.Enqueue(child is IAccessible?new Node {owner=(IAccessible)child,child=0,parentId=id}:new Node {owner=node.owner,child=children[i],parentId=id});}
                }
            }catch{}
        }
        observation.nodes=output.ToArray();observation.visited=visited;observation.truncated=queue.Count>0;observation.capturedAt=DateTimeOffset.UtcNow.ToString("o");
        if(frames.Count>=8)frames.Clear();frames[observation.snapshotId]=new Frame {observation=observation,nodes=bound,at=DateTime.UtcNow};
        return observation;
    }
    static Node Target(string snapshot,string id,string app,out Frame frame) {
        if(!frames.TryGetValue(snapshot,out frame)||(DateTime.UtcNow-frame.at).TotalSeconds>25)throw new Exception("stale_observation");
        if(!String.Equals(frame.observation.appPath,app,StringComparison.OrdinalIgnoreCase))throw new Exception("wrong_application");
        if(Guard(frame.observation.window,app)!=(uint)frame.observation.processId)throw new Exception("window_process_changed");
        Node node;if(!frame.nodes.TryGetValue(id,out node))throw new Exception("unknown_control");
        var actual=Describe(node,id);
        if(actual==null)throw new Exception("control_unavailable");
        if(actual.name!=node.info.name||actual.role!=node.info.role||(actual.role==42&&actual.value!=node.info.value))throw new Exception("control_changed");
        if(!actual.enabled||actual.offscreen||actual.width<=0||actual.height<=0)throw new Exception("control_unavailable");
        if(actual.protectedValue)throw new Exception("protected_control");
        return node;
    }
    public static string SetText(string snapshot,string id,string app,string text) {
        BeforeInputTick=AfterInputTick=0;
        Frame frame;var n=Target(snapshot,id,app,out frame);
        if(n.info.role!=42||n.info.readOnly)throw new Exception("not_writable_text_control");
        if(text==null||text.Length>2000)throw new Exception("invalid_text");
        foreach(char c in text)if(Char.IsControl(c))throw new Exception("single_line_text_only");
        try{ActionDispatched=true;n.owner.set_accValue(n.child,text);}catch{}
        string value=n.owner.get_accValue(n.child);
        if(value!=text){
            KeyboardFocus(n,frame);BeginInput();
            Send(new Input[]{Key(0x11,0,0),Key(0x41,0,0),Key(0x41,2,0),Key(0x11,2,0)});
            System.Threading.Thread.Sleep(60);
            foreach(char c in text){if(GetForegroundWindow()!=new IntPtr(frame.observation.window))throw new Exception("foreground_changed");Send(new Input[]{Key(0,4,c),Key(0,6,c)});}
            System.Threading.Thread.Sleep(40);AfterInputTick=InputTick();value=n.owner.get_accValue(n.child);
        }
        for(int i=0;i<10&&value!=text;i++){System.Threading.Thread.Sleep(100);value=n.owner.get_accValue(n.child);}
        frames.Remove(snapshot);return value;
    }
    public static bool Invoke(string snapshot,string id,string app) {
        Frame frame;var n=Target(snapshot,id,app,out frame);
        if(n.info.role!=43&&n.info.role!=37&&n.info.role!=12&&n.info.role!=30&&n.info.role!=34&&n.info.role!=22)throw new Exception("control_not_invokable");
        ActionDispatched=true;n.owner.accDoDefaultAction(n.child);frames.Remove(snapshot);return true;
    }
    public static bool Enter(string snapshot,string id,string app) {
        BeforeInputTick=AfterInputTick=0;
        Frame frame;var n=Target(snapshot,id,app,out frame);
        if(n.info.role!=42||n.info.readOnly)throw new Exception("not_writable_text_control");
        var hwnd=new IntPtr(frame.observation.window);
        if(GetForegroundWindow()!=hwnd)throw new Exception("foreground_changed");
        KeyboardFocus(n,frame);
        uint pid;uint thread=GetWindowThreadProcessId(hwnd,out pid);var gui=new GuiInfo {size=(uint)Marshal.SizeOf(typeof(GuiInfo))};
        if(!GetGUIThreadInfo(thread,ref gui)||gui.focus==IntPtr.Zero||(gui.focus!=hwnd&&!IsChild(hwnd,gui.focus)))throw new Exception("focus_not_in_application");
        if(GetForegroundWindow()!=hwnd)throw new Exception("foreground_changed");
        BeginInput();Send(new Input[]{Key(13,0,0),Key(13,2,0)});System.Threading.Thread.Sleep(40);AfterInputTick=InputTick();
        frames.Remove(snapshot);return true;
    }
    public static bool ActivateText(string snapshot,string id,string app,string expectedRowName) {
        BeforeInputTick=AfterInputTick=0;Frame frame;var n=Target(snapshot,id,app,out frame);
        if(n.info.role!=41)throw new Exception("text_control_required");
        bool rowMatches=false;IAccessible row=null,parent=n.owner;
        for(int i=0;i<8&&parent!=null;i++){try{if(parent.get_accName(0)==expectedRowName){rowMatches=true;row=parent;break;}parent=parent.accParent as IAccessible;}catch{break;}}
        if(!rowMatches)throw new Exception("song_row_changed");
        string action=null;try{action=row.get_accDefaultAction(0);}catch{}
        if(!String.IsNullOrEmpty(action)&&System.Text.RegularExpressions.Regex.IsMatch(action,@"double|双击|播放|play",System.Text.RegularExpressions.RegexOptions.IgnoreCase)){ActionTransport="semantic-row";ActionDispatched=true;row.accDoDefaultAction(0);frames.Remove(snapshot);return true;}
        var hwnd=new IntPtr(frame.observation.window);
        var actual=Describe(n,id);int x=actual.x+actual.width/2,y=actual.y+actual.height/2;
        var screenOwner=WindowFromPoint(new Point {x=x,y=y});
        bool coveredByOtherWindow=screenOwner!=hwnd&&!IsChild(hwnd,screenOwner);
        if(GetForegroundWindow()!=hwnd||coveredByOtherWindow){
            IAccessible document=n.owner;
            for(int i=0;i<15&&document!=null&&Convert.ToInt32(document.get_accRole(0))!=15;i++)document=document.accParent as IAccessible;
            if(document==null)throw new Exception("foreground_required");
            IAccessible hit=document;bool hitRow=false;var hitSeen=new HashSet<long>();
            // MSAA providers may return an immediate container, rather than the
            // deepest element. Descend each returned child before walking up.
            for(int depth=0;depth<30&&hit!=null;depth++){
                if(!hitSeen.Add(Identity(hit)))break;
                IAccessible ancestor=hit;
                for(int i=0;i<12&&ancestor!=null;i++){if(ancestor.get_accName(0)==expectedRowName){hitRow=true;break;}ancestor=ancestor.accParent as IAccessible;}
                if(hitRow)break;
                object next=hit.accHitTest(x,y);if(next is int){if(Convert.ToInt32(next)==0)break;next=hit.get_accChild(next);}
                var child=next as IAccessible;if(child==null)break;hit=child;
            }
            int hitRole=hit==null?0:Convert.ToInt32(hit.get_accRole(0));
            bool rootOnly=hit==null||hitRole==15||((hitRole==20||hitRole==10)&&String.IsNullOrEmpty(hit.get_accName(0)));
            // Some providers return only the document when another application
            // covers it. No screen input is used in this branch: validate the
            // live target row and document bounds before messaging its own HWND.
            if(!hitRow){
                if(!coveredByOtherWindow||!rootOnly)throw new Exception("control_occluded");
                int rx,ry,rw,rh,dx,dy,dw,dh;row.accLocation(out rx,out ry,out rw,out rh,0);document.accLocation(out dx,out dy,out dw,out dh,0);
                if(x<rx||y<ry||x>=rx+rw||y>=ry+rh||x<dx||y<dy||x>=dx+dw||y>=dy+dh)throw new Exception("invalid_control_position");
            }
            IntPtr view;uint owner;
            if(WindowFromAccessibleObject(document,out view)<0||view==IntPtr.Zero||(view!=hwnd&&!IsChild(hwnd,view)))throw new Exception("foreground_required");
            GetWindowThreadProcessId(view,out owner);if(owner!=(uint)frame.observation.processId)throw new Exception("window_process_changed");
            var point=new Point {x=x,y=y};if(!ScreenToClient(view,ref point))throw new Exception("invalid_control_position");
            var position=new IntPtr((point.x&0xffff)|((point.y&0xffff)<<16));
            ActionTransport="scoped-window-messages";ActionDispatched=true;
            bool posted=PostMessage(view,0x200,IntPtr.Zero,position);
            posted=PostMessage(view,0x201,new IntPtr(1),position)&&posted;
            posted=PostMessage(view,0x202,IntPtr.Zero,position)&&posted;
            posted=PostMessage(view,0x203,new IntPtr(1),position)&&posted;
            posted=PostMessage(view,0x202,IntPtr.Zero,position)&&posted;
            frames.Remove(snapshot);return posted;
        }
        var at=WindowFromPoint(new Point {x=x,y=y});if(at!=hwnd&&!IsChild(hwnd,at))throw new Exception("control_occluded");
        ActionTransport="foreground-pointer";BeforeInputTick=InputTick();SetCursorPos(x,y);
        if(GetForegroundWindow()!=hwnd)throw new Exception("foreground_changed");
        var down=new Input {type=0,data=new InputData {mouse=new Mouse {flags=2}}};var up=new Input {type=0,data=new InputData {mouse=new Mouse {flags=4}}};
        Send(new Input[]{down,up,down,up});System.Threading.Thread.Sleep(40);AfterInputTick=InputTick();frames.Remove(snapshot);return true;
    }
}
