Option Explicit

Dim shell, fileSystem, scriptDir, repoRoot
Dim startMenu, programsDir, shortcutPath, startScript, iconPath
Dim shortcut

Set shell = CreateObject("WScript.Shell")
Set fileSystem = CreateObject("Scripting.FileSystemObject")

scriptDir = fileSystem.GetParentFolderName(WScript.ScriptFullName)
repoRoot = fileSystem.GetParentFolderName(scriptDir)
startScript = fileSystem.BuildPath(scriptDir, "start-catrace-dev-hidden.vbs")

startMenu = shell.SpecialFolders("StartMenu")
programsDir = fileSystem.BuildPath(startMenu, "Programs")
shortcutPath = fileSystem.BuildPath(programsDir, "Catrace Dev.lnk")

Set shortcut = shell.CreateShortcut(shortcutPath)
shortcut.TargetPath = shell.ExpandEnvironmentStrings("%WINDIR%\System32\wscript.exe")
shortcut.Arguments = Chr(34) & startScript & Chr(34)
shortcut.WorkingDirectory = repoRoot
shortcut.Description = "Start the Catrace source tree in Tauri development mode"

iconPath = fileSystem.BuildPath(repoRoot, "src-tauri\icons\icon.ico")
If fileSystem.FileExists(iconPath) Then
  shortcut.IconLocation = iconPath & ",0"
Else
  shortcut.IconLocation = WScript.FullName & ",0"
End If

shortcut.Save

MsgBox "Catrace Dev shortcut created." & vbCrLf & vbCrLf & shortcutPath, vbInformation, "Catrace Dev"
