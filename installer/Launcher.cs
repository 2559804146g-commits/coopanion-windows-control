using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Threading;
using System.Windows.Forms;
[assembly: AssemblyTitle("桌面伙伴 · Windows 控制")]
[assembly: AssemblyProduct("Coopanion Windows Control Community Edition")]
[assembly: AssemblyVersion("0.14.1.0")]
class Launcher {
 static readonly string Root=Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
 static readonly string Exe=Path.Combine(Root,"Coopanion","Coopanion.exe");
 static bool OwnRunning(){foreach(var p in Process.GetProcessesByName("Coopanion")){try{if(String.Equals(p.MainModule.FileName,Exe,StringComparison.OrdinalIgnoreCase))return true;}catch{}}return false;}
 static bool Listening(int port){try{using(var c=new TcpClient()){var a=c.BeginConnect("127.0.0.1",port,null,null);if(!a.AsyncWaitHandle.WaitOne(250))return false;c.EndConnect(a);return true;}}catch{return false;}}
 static bool Post(string path){try{var r=(HttpWebRequest)WebRequest.Create("http://127.0.0.1:17788"+path);r.Method="POST";r.ContentType="application/json";r.Timeout=2000;var b=System.Text.Encoding.UTF8.GetBytes("{\"args\":[]}");r.ContentLength=b.Length;using(var s=r.GetRequestStream())s.Write(b,0,b.Length);using(var response=(HttpWebResponse)r.GetResponse())return response.StatusCode==HttpStatusCode.OK;}catch{return false;}}
 [STAThread] static int Main(string[] args){
  Application.EnableVisualStyles();
  try{
   if(Array.IndexOf(args,"--stop")>=0){if(OwnRunning())Post("/api/webui/providers/world%3Adesktop-pet/panels/pet/quitApplication");return 0;}
   if(!File.Exists(Exe)||!File.Exists(Path.Combine(Root,"Runtime","node.exe"))||!File.Exists(Path.Combine(Root,"Control","bundle-manifest.json")))throw new Exception("安装文件不完整，请重新安装桌面伙伴。你的聊天和设置会保留。");
   if(!OwnRunning()&&(Listening(17788)||Listening(7797)||Listening(17830)))throw new Exception("检测到另一份桌宠正在运行。请先从它的托盘退出，再打开桌面伙伴；不会合并或覆盖另一份程序的数据。");
   var custom=Environment.GetEnvironmentVariable("COMPANION_CONTROL_PROFILE");
   var profile=String.IsNullOrWhiteSpace(custom)?Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"CompanionControl","Profile"):Path.GetFullPath(custom);
   Directory.CreateDirectory(profile);
   var info=new ProcessStartInfo(Exe){WorkingDirectory=Path.GetDirectoryName(Exe),UseShellExecute=false,CreateNoWindow=true};
   info.EnvironmentVariables.Remove("ELECTRON_RUN_AS_NODE");
   info.EnvironmentVariables["CORTICO_COMPANION_DATA"]=Path.Combine(profile,"core");
   info.EnvironmentVariables["DESKTOP_CONTROL_DATA"]=Path.Combine(profile,"desktop");
   info.EnvironmentVariables["COMPANION_CONTROL_ASR"]=Path.Combine(Root,"Models","asr");
   info.EnvironmentVariables["PET_TTS_MODEL"]="int8";
   info.EnvironmentVariables["PATH"]=Path.Combine(Root,"Runtime")+Path.PathSeparator+Environment.GetEnvironmentVariable("PATH");
   Process.Start(info);
   // Reuse the original window, including when the application is already running.
   for(int i=0;i<120;i++){Thread.Sleep(500);if(Post("/api/webui/providers/world%3Adesktop-pet/panels/pet/openSettings"))return 0;}
   throw new Exception("程序启动较慢，或本机端口被占用。请查看托盘图标；仍未出现时，重新打开桌面伙伴。");
  }catch(Exception e){MessageBox.Show(e.Message,"桌面伙伴",MessageBoxButtons.OK,MessageBoxIcon.Information);return 1;}
 }
}
