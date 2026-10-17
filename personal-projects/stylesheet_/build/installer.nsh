; installer.nsh: extra steps for the Windows installer (NSIS). electron-builder picks this file up automatically
; (it is build/installer.nsh, the default "include" of the nsis target). Not part of the app itself.
;
; Why it exists: electron-builder registers the .S_ file type (package.json "fileAssociations": the ProgID
; Stylesheet_.Project, its DefaultIcon = $INSTDIR\resources\file-icon.ico) but does NOT tell Windows afterwards that
; file associations changed. Explorer then keeps showing what it had cached (often a blank document icon) until it
; restarts or the user signs out. SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_FLUSH) is the standard "associations
; changed, refresh your icons" call. customInstall runs right after the file associations are written.

!macro customInstall
  ; 0x08000000 = SHCNE_ASSOCCHANGED, 0x1000 = SHCNF_FLUSH (wait until Explorer has processed it)
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0x1000, p 0, p 0)'
!macroend
