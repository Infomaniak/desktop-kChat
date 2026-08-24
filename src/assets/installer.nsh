# This macro fetches the currently installed MM version via MSI (if any) and uninstalls it first
!macro customInit
  nsExec::ExecToStack "$\"$%SYSTEMROOT%\system32\WindowsPowerShell\v1.0\powershell.exe$\" -command $\"$$Installer = New-Object -ComObject WindowsInstaller.Installer; $$MMProduct = $$Installer.ProductsEx('', '', 7) | Where-Object -FilterScript {$$_.InstallProperty('ProductName') -eq 'Mattermost'}; if ($$MMProduct -ne $$null) {Write-Host -NoNewline $$MMProduct.ProductCode()}$\""
  Pop $0
  Pop $1
  StrCmp $1 "" 0 +1
  ExecWait '"$%SYSTEMROOT%\system32\msiexec.exe" /x $1 /qn'
!macroend

# This macro cleans up the auto-launch registry entry on uninstall and kills any running kChat processes
!macro customUnInstall
  # Graceful shutdown: send WM_CLOSE to kChat and its child processes so the app can flush state
  ExecWait '"$SYSDIR\taskkill.exe" /T /IM "kChat.exe"'

  # Give the app 5 s to exit gracefully and flush persistent state (IndexedDB, logs, settings)
  Sleep 5000

  # Force kill if still running, including child processes (renderer, GPU, utility, etc)
  ExecWait '"$SYSDIR\taskkill.exe" /F /T /IM "kChat.exe"'

  # Remove auto-start registry entry (HKCU)
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "kChat"
!macroend
