using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using Accessibility;
using System.Text;

public static class NeteasePlaybackAccess {
    [DllImport("oleacc.dll")] private static extern int AccessibleObjectFromWindow(IntPtr hwnd, uint objectId, ref Guid iid, [MarshalAs(UnmanagedType.Interface)] out object result);
    [DllImport("oleacc.dll")] private static extern int AccessibleChildren(IAccessible parent, int start, int count, [Out, MarshalAs(UnmanagedType.LPArray, SizeParamIndex=2)] object[] children, out int obtained);
    [DllImport("user32.dll")] private static extern bool EnumChildWindows(IntPtr parent, EnumChild callback, IntPtr data);
    private delegate bool EnumChild(IntPtr hwnd, IntPtr data);
    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumChild callback, IntPtr data);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr hwnd,int command);
    public static bool RestoreForControl(long hwnd) {var window=new IntPtr(hwnd);if(!IsIconic(window))return false;ShowWindow(window,4);return true;}
    public static void FinishControl(long hwnd) {ShowWindow(new IntPtr(hwnd),7);}
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int count);
    public static long[] WindowsForProcess(int pid) {
        var values=new List<long>();
        EnumWindows(delegate(IntPtr hwnd,IntPtr ignored) {uint owner;GetWindowThreadProcessId(hwnd,out owner);if(owner==(uint)pid && IsWindowVisible(hwnd) && Caption(hwnd.ToInt64()).Length>0)values.Add(hwnd.ToInt64());return true;},IntPtr.Zero);
        return values.ToArray();
    }
    public static string Caption(long hwnd) {var text=new StringBuilder(1024);GetWindowText(new IntPtr(hwnd),text,text.Capacity);return text.ToString();}
    private sealed class Node { public IAccessible Owner; public object Child; public string Name; public int X,Y,W,H; }
    public sealed class State { public bool Found; public string Button; public bool CanNext; public bool CanPrevious; public int Nodes; public string Error; }
    private static readonly Dictionary<long,List<Node>> Cache = new Dictionary<long,List<Node>>();
    private static void Siblings(Node play,List<Node> output) {
        IAccessible scope=play.Owner;
        for(int level=0;level<3 && scope!=null;level++) {
            try {
                int count=Math.Min(scope.accChildCount,100);object[] values=new object[count];int got;
                if(count>0 && AccessibleChildren(scope,0,count,values,out got)>=0) for(int i=0;i<got;i++) {
                    if(values[i] is IAccessible) {var a=(IAccessible)values[i];Add(a,0,output);}
                    else if(values[i] is int) {Add(scope,values[i],output);try{object child=scope.get_accChild(values[i]);if(child is IAccessible)Add((IAccessible)child,0,output);}catch{}}
                }
                object parent=scope.accParent;scope=parent as IAccessible;
            }catch{break;}
        }
    }
    private static void At(IAccessible root,int x,int y,List<Node> output) {
        try {
            IAccessible owner=root;
            for(int depth=0;depth<12;depth++) {
                object hit=owner.accHitTest(x,y);
                if(hit is IAccessible) {
                    var next=(IAccessible)hit; int before=output.Count; Add(next,0,output); if(output.Count>before)return;
                    object parent=next.accParent;
                    for(int p=0;p<3 && parent is IAccessible;p++) {var a=(IAccessible)parent;before=output.Count;Add(a,0,output);if(output.Count>before)return;parent=a.accParent;}
                    if(Object.ReferenceEquals(next,owner))return;owner=next;
                } else if(hit is int) {Add(owner,hit,output);object child=owner.get_accChild(hit);if(child is IAccessible)owner=(IAccessible)child;else return;}
                else return;
            }
        } catch { }
    }
    private static List<Node> Buttons(IntPtr hwnd, out int visited) {
        var result = new List<Node>(); var queue = new Queue<IAccessible>(); var roots = new List<IntPtr>(); roots.Add(hwnd);
        visited=0;
        List<Node> cached;
        if(Cache.TryGetValue(hwnd.ToInt64(),out cached)) {
            var live=new List<Node>();
            foreach(var n in cached) {try {var name=n.Owner.get_accName(n.Child);if(name=="play"||name=="pause"||name=="next"||name=="pre"){n.Name=name;live.Add(n);}}catch{}}
            if(Playback(live)!=null)return live;
            Cache.Remove(hwnd.ToInt64());
        }
        EnumChildWindows(hwnd, delegate(IntPtr child, IntPtr unused) { roots.Add(child); return roots.Count < 80; }, IntPtr.Zero);
        Guid iid = new Guid("618736E0-3C3D-11CF-810C-00AA00389B71");
        var seen = new HashSet<long>();
        foreach (var handle in roots) {
            object value; if (AccessibleObjectFromWindow(handle, 0xFFFFFFFC, ref iid, out value) >= 0 && value is IAccessible) {
                var root=(IAccessible)value;queue.Enqueue(root);
                try {int x,y,w,h;root.accLocation(out x,out y,out w,out h,0);
                    if(w>300&&h>250){foreach(double f in new double[]{.945,.96,.925,.90})At(root,x+w/2,y+(int)(h*f),result);}
                    var play=Playback(result);
                    if(play!=null){int cx=play.X+play.W/2,cy=play.Y+play.H/2;foreach(double f in new double[]{1.1,1.4,1.8,2.2}){At(root,cx+(int)(play.W*f),cy,result);At(root,cx-(int)(play.W*f),cy,result);}}
                }catch{}
            }
        }
        if(Playback(result)!=null){Siblings(Playback(result),result);Cache[hwnd.ToInt64()]=result;return result;}
        var clock=Stopwatch.StartNew();
        while (queue.Count > 0 && visited < 600 && clock.ElapsedMilliseconds < 2500) {
            var accessible = queue.Dequeue();
            try {
                IntPtr unknown = Marshal.GetIUnknownForObject(accessible); long identity = unknown.ToInt64(); Marshal.Release(unknown);
                if (!seen.Add(identity)) continue;
                visited++;
                Add(accessible, 0, result);
                int count = Math.Min(accessible.accChildCount, 1500); if (count <= 0) continue;
                object[] children = new object[count]; int obtained;
                if (AccessibleChildren(accessible, 0, count, children, out obtained) < 0) continue;
                for (int i=0; i<obtained; i++) {
                    if (children[i] is IAccessible) queue.Enqueue((IAccessible)children[i]);
                    else if (children[i] is int) { visited++; Add(accessible, children[i], result); try {object child=accessible.get_accChild(children[i]);if(child is IAccessible)queue.Enqueue((IAccessible)child);}catch{} }
                }
            } catch { }
        }
        if(Playback(result)!=null){Siblings(Playback(result),result);Cache[hwnd.ToInt64()]=result;}
        return result;
    }
    private static void Add(IAccessible owner, object child, List<Node> output) {
        try {
            string name = owner.get_accName(child);
            if (name != "play" && name != "pause" && name != "next" && name != "pre") return;
            int role = Convert.ToInt32(owner.get_accRole(child));
            if (role != 43) return;
            int flags = Convert.ToInt32(owner.get_accState(child)); if ((flags & 0x18000) != 0 || (flags & 1) != 0) return;
            int x,y,w,h; owner.accLocation(out x,out y,out w,out h,child); if (w <= 0 || h <= 0) return;
            output.Add(new Node { Owner=owner, Child=child, Name=name, X=x,Y=y,W=w,H=h });
        } catch { }
    }
    private static Node Playback(List<Node> buttons) {
        Node best = null;
        foreach (var n in buttons) if (n.Name == "play" || n.Name == "pause") {
            if (best == null || n.Y > best.Y) best=n;
        }
        return best;
    }
    public static State Observe(long window) {
        try {
            int count; var buttons=Buttons(new IntPtr(window),out count); var play=Playback(buttons);
            var state=new State {Found=play!=null,Button=play==null?null:play.Name,Nodes=count};
            if(play!=null) foreach(var n in buttons) if(Math.Abs(n.Y-play.Y)<50) {if(n.Name=="next")state.CanNext=true;if(n.Name=="pre")state.CanPrevious=true;}
            return state;
        } catch(Exception e) { return new State {Found=false,Error=e.Message}; }
    }
    public static bool Invoke(long window,string command) {
        int count; var buttons=Buttons(new IntPtr(window),out count); var play=Playback(buttons); if(play==null)return false;
        if(command=="play" && play.Name=="pause" || command=="pause" && play.Name=="play") return true;
        Node target=play;
        if(command=="next" || command=="previous") {
            target=null; string expected=command=="next"?"next":"pre";
            foreach(var n in buttons) if(n.Name==expected && Math.Abs(n.Y-play.Y)<50) {target=n;break;}
        }
        if(target==null)return false;
        try { target.Owner.accDoDefaultAction(target.Child);return true; } catch { return false; }
    }
}
