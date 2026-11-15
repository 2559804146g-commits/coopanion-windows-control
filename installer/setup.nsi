Unicode True
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "x64.nsh"
!define PRODUCT "桌面伙伴 · Windows 控制"
!define REGKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\CompanionControl"
Name "${PRODUCT}"
Icon "${PAYLOAD}\Coopanion\resources\app\app\icons\icon.ico"
UninstallIcon "${PAYLOAD}\Coopanion\resources\app\app\icons\icon.ico"
OutFile "${OUTPUT}"
InstallDir "$LOCALAPPDATA\Programs\CompanionControl"
InstallDirRegKey HKCU "${REGKEY}" "InstallLocation"
RequestExecutionLevel user
; Neural weights are large and mostly incompressible; zlib keeps repeatable builds practical.
SetCompressor zlib
VIProductVersion "0.14.1.0"
VIAddVersionKey "ProductName" "${PRODUCT}"
VIAddVersionKey "FileDescription" "桌面伙伴 · Windows 控制整合安装程序"
VIAddVersionKey "FileVersion" "0.14.1"
VIAddVersionKey "ProductVersion" "0.14.1"
VIAddVersionKey "LegalCopyright" "Coopanion Windows Control contributors; upstream notices included"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TEXT "安装桌面伙伴、应用控制功能和所需运行环境。安装后直接使用，不需要另装 Node.js 或运行命令。$\r$\n$\r$\n聊天模型使用你自己的账号。聊天和设置保存在用户目录，更新和卸载默认保留。$\r$\n$\r$\n这是基于 Coopanion 的社区整合版。"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN "$INSTDIR\CompanionControl.exe"
!define MUI_FINISHPAGE_RUN_TEXT "打开桌面伙伴"
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"
!macro RequireClosed PREFIX
 IfFileExists "$INSTDIR\Coopanion\Coopanion.exe" 0 done_${PREFIX}
 System::Call 'kernel32::CreateFileW(w "$INSTDIR\Coopanion\Coopanion.exe", i 0x40000000, i 0, p 0, i 3, i 0, p 0) p.r0'
 ${If} $0 == -1
  IfSilent 0 +3
   SetErrorLevel 23
   Abort
  MessageBox MB_ICONINFORMATION "请先从托盘退出这份桌面伙伴，再继续安装或卸载。不会自动结束你的任务。"
  Abort
 ${EndIf}
 System::Call 'kernel32::CloseHandle(p r0)'
 done_${PREFIX}:
!macroend
Function .onInit
 ${IfNot} ${RunningX64}
  MessageBox MB_ICONSTOP "此安装包适用于 64 位 Windows。"
  Abort
 ${EndIf}
 SetRegView 64
 ReadRegStr $0 HKCU "${REGKEY}" "InstallLocation"
 ${If} $0 != ""
  StrCpy $INSTDIR $0
 ${EndIf}
FunctionEnd
Function un.onInit
 !insertmacro RequireClosed uninstall
FunctionEnd
Function .onVerifyInstDir
 System::Call 'shlwapi::PathIsRootW(w "$INSTDIR") i.r0'
 ${If} $0 != 0
  Abort
 ${EndIf}
 ${If} $INSTDIR == $WINDIR
  Abort
 ${EndIf}
FunctionEnd
Section "桌面伙伴"
 !insertmacro RequireClosed install
 SetShellVarContext current
 SetOutPath "$INSTDIR"
 SetOverwrite on
 File /r "${PAYLOAD}\*.*"
 WriteUninstaller "$INSTDIR\Uninstall.exe"
 CreateDirectory "$SMPROGRAMS\桌面伙伴"
 CreateShortcut "$SMPROGRAMS\桌面伙伴\桌面伙伴.lnk" "$INSTDIR\CompanionControl.exe"
 CreateShortcut "$SMPROGRAMS\桌面伙伴\卸载桌面伙伴.lnk" "$INSTDIR\Uninstall.exe"
 CreateShortcut "$DESKTOP\桌面伙伴.lnk" "$INSTDIR\CompanionControl.exe"
 WriteRegStr HKCU "${REGKEY}" "DisplayName" "${PRODUCT}"
 WriteRegStr HKCU "${REGKEY}" "DisplayVersion" "0.14.1"
 WriteRegStr HKCU "${REGKEY}" "Publisher" "Coopanion Windows Control contributors (community build)"
 WriteRegStr HKCU "${REGKEY}" "InstallLocation" "$INSTDIR"
 WriteRegStr HKCU "${REGKEY}" "DisplayIcon" "$INSTDIR\CompanionControl.exe"
 WriteRegStr HKCU "${REGKEY}" "UninstallString" '$\"$INSTDIR\Uninstall.exe$\"'
 WriteRegStr HKCU "${REGKEY}" "URLInfoAbout" "https://github.com/2559804146g-commits/coopanion-windows-control"
 WriteRegDWORD HKCU "${REGKEY}" "NoModify" 1
 WriteRegDWORD HKCU "${REGKEY}" "NoRepair" 1
SectionEnd
Section "Uninstall"
 SetShellVarContext current
 SetRegView 64
 ; Remove only the exact files shipped by this installer. Never recurse through user data.
 !include "${UNINSTALL_FILES}"
 Delete "$DESKTOP\桌面伙伴.lnk"
 Delete "$SMPROGRAMS\桌面伙伴\桌面伙伴.lnk"
 Delete "$SMPROGRAMS\桌面伙伴\卸载桌面伙伴.lnk"
 RMDir "$SMPROGRAMS\桌面伙伴"
 DeleteRegKey HKCU "${REGKEY}"
 DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Coopanion $INSTDIR\Coopanion"
 Delete "$INSTDIR\Uninstall.exe"
 RMDir "$INSTDIR"
SectionEnd
