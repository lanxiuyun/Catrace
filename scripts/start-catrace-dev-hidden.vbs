Option Explicit

Dim shell, fileSystem, scriptDir, repoRoot
Set shell = CreateObject("WScript.Shell")
Set fileSystem = CreateObject("Scripting.FileSystemObject")

scriptDir = fileSystem.GetParentFolderName(WScript.ScriptFullName)
repoRoot = fileSystem.GetParentFolderName(scriptDir)
shell.CurrentDirectory = repoRoot

' WindowStyle 0 keeps cmd/pnpm output out of sight while the Tauri window runs normally.
shell.Run "cmd.exe /d /s /c pnpm tauri dev", 0, False
