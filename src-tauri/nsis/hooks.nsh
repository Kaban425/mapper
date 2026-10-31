;; Mapper's NSIS hooks (Tauri `installerHooks`). The uninstaller removes only what Mapper itself
;; wrote outside its folders: the "start with Windows" value under HKCU\...\Run
;; (src-tauri/src/platform/win/autostart.rs, value name dev.mapper.app). The guard allows no
;; Exec, WriteReg or File here.

!macro NSIS_HOOK_PREUNINSTALL
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "dev.mapper.app"
!macroend
