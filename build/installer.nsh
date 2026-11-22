!addincludedir build

!ifndef BUILD_UNINSTALLER
    ; Variables must exist before the functions that use them are compiled, and
    ; installer-languages.nsh defines those functions, so declare them first.
    Var TactileSetupSmallIcon
    Var TactileSetupBigIcon
    Var TactileSetupIconPrepared
    Var TactileShortcutLightIconPath
    Var TactileShortcutDarkIconPath
    Var TactileLangCombo
    Var TactileLangLabel
    Var TactileSelectedLanguage

    !include LogicLib.nsh
    !include nsDialogs.nsh
    !include installer-languages.nsh

    !define MUI_CUSTOMFUNCTION_GUIINIT PrimeTactileSetupWindowIcon
    !define MUI_PAGE_CUSTOMFUNCTION_SHOW StartTactileSetupWindowIconRefresh

    !macro customInstallMode
    !macroend
!else
    !macro customInstallMode
    !macroend
!endif

; Uninstaller state. Declared only for the uninstaller build: the installer
; build compiles neither the page nor the removal step, and NSIS treats an
; unused global as an error here.
!ifdef BUILD_UNINSTALLER
    Var /GLOBAL TactileUnDataDialog
    Var /GLOBAL TactileUnDataCheckbox
    Var /GLOBAL TactileUnDataHint
    Var /GLOBAL TactileDeleteUserData

    !include LogicLib.nsh
    !include nsDialogs.nsh

    ; One page between the welcome screen and the progress bar. Keeping the data
    ; is the default, so an uninstall followed by a reinstall keeps profiles and
    ; the sound library. Imported sound files are never inside these folders.
    !macro customUnWelcomePage
        !insertmacro MUI_UNPAGE_WELCOME
        UninstPage custom un.TactileUserDataPageCreate un.TactileUserDataPageLeave

        Function un.TactileUserDataPageCreate
            !insertmacro MUI_HEADER_TEXT "Remove Tactile" "Choose what happens to the data on this computer."
            nsDialogs::Create 1018
            Pop $TactileUnDataDialog
            ${If} $TactileUnDataDialog == error
                Abort
            ${EndIf}

            ${NSD_CreateLabel} 0 8u 100% 34u "Tactile will be removed from this computer. Your profiles and settings can stay, so a later install starts where you left off."
            Pop $0

            ${NSD_CreateCheckbox} 0 50u 100% 18u "Also delete my Tactile settings, profiles and backup history"
            Pop $TactileUnDataCheckbox

            ${NSD_CreateLabel} 14u 72u 92% 34u "Leave this unchecked to keep the data. Imported sound files and cloud copies are never deleted."
            Pop $TactileUnDataHint

            nsDialogs::Show
        FunctionEnd

        Function un.TactileUserDataPageLeave
            ${NSD_GetState} $TactileUnDataCheckbox $TactileDeleteUserData
        FunctionEnd
    !macroend
!endif

!ifndef BUILD_UNINSTALLER
    ; Adds a language to the setup combobox. Declared at the top level because
    ; NSIS does not allow a macro definition inside another macro.
    !macro TACTILE_ADD_LANG TACTILE_CODE TACTILE_LABEL
        ${NSD_CB_AddString} $TactileLangCombo "${TACTILE_LABEL}"
    !macroend
!endif

!macro customHeader
    !ifndef BUILD_UNINSTALLER
    !define TACTILE_WM_SETICON 0x0080
    !define TACTILE_IMAGE_ICON 1
    !define TACTILE_LR_LOADFROMFILE 0x00000010

    ; The very first page of the wizard: users pick the setup and app language
    ; before anything touches the disk. The Windows display language is
    ; preselected, English is the fallback.
    Function TactileLanguagePageCreate
        !insertmacro MUI_HEADER_TEXT "Choose your language" "Tactile and this setup wizard will use the language you select. You can change it later in Settings."
        nsDialogs::Create 1018
        Pop $0
        ${If} $0 == error
            Abort
        ${EndIf}

        ${NSD_CreateLabel} 0 0 100% 24u "Select the language for Tactile. Windows display language is preselected when it is available; otherwise English is used."
        Pop $TactileLangLabel

        ${NSD_CreateComboBox} 0 34u 100% 120u ""
        Pop $TactileLangCombo
        !insertmacro TACTILE_LANGUAGE_ITEMS

        Call TactileDetectInstallerLanguage
        Call TactileSelectInstallerLanguage

        nsDialogs::Show
    FunctionEnd

    Function TactileLanguagePageLeave
        SendMessage $TactileLangCombo ${CB_GETCURSEL} 0 0 $0
        ${If} $0 == -1
            StrCpy $TactileSelectedLanguage "en"
        ${Else}
            Push $0
            Call TactileLanguageCodeFromIndex
            Pop $TactileSelectedLanguage
        ${EndIf}
    FunctionEnd

    Function PrepareTactileSetupWindowIcon
        StrCmp $TactileSetupIconPrepared "1" prepared

        InitPluginsDir
        File /oname=$PLUGINSDIR\setupWindowIcon.ico "${BUILD_RESOURCES_DIR}\setupWindowIcon.ico"

        System::Call 'user32::LoadImageW(p 0, w "$PLUGINSDIR\setupWindowIcon.ico", i ${TACTILE_IMAGE_ICON}, i 16, i 16, i ${TACTILE_LR_LOADFROMFILE}) p.r0'
        StrCpy $TactileSetupSmallIcon $0

        System::Call 'user32::LoadImageW(p 0, w "$PLUGINSDIR\setupWindowIcon.ico", i ${TACTILE_IMAGE_ICON}, i 32, i 32, i ${TACTILE_LR_LOADFROMFILE}) p.r1'
        StrCpy $TactileSetupBigIcon $1

        StrCpy $TactileSetupIconPrepared "1"
        prepared:
    FunctionEnd

    Function PrimeTactileSetupWindowIcon
        Call PrepareTactileSetupWindowIcon
        Call SetTactileSetupWindowIcon
    FunctionEnd

    Function StartTactileSetupWindowIconRefresh
        Call PrepareTactileSetupWindowIcon
        Call SetTactileSetupWindowIcon
    FunctionEnd

    Function SetTactileSetupWindowIcon
        IntCmp $TactileSetupSmallIcon 0 smallIconDone smallIconReady smallIconReady
        smallIconReady:
        SendMessage $HWNDPARENT ${TACTILE_WM_SETICON} 0 $TactileSetupSmallIcon
        smallIconDone:

        IntCmp $TactileSetupBigIcon 0 bigIconDone bigIconReady bigIconReady
        bigIconReady:
        SendMessage $HWNDPARENT ${TACTILE_WM_SETICON} 1 $TactileSetupBigIcon
        bigIconDone:
    FunctionEnd

    Function InstallTactileShortcutIconBridge
        StrCpy $TactileShortcutLightIconPath "$APPDATA\Tactile\Icons\Tactile-light.ico"
        StrCpy $TactileShortcutDarkIconPath "$APPDATA\Tactile\Icons\Tactile-bg.ico"
        CreateDirectory "$APPDATA\Tactile\Icons"
        File /oname=$TactileShortcutLightIconPath "${BUILD_RESOURCES_DIR}\installerHeaderIcon.ico"
        File /oname=$TactileShortcutDarkIconPath "${BUILD_RESOURCES_DIR}\installerIcon.ico"

        ${if} $installMode == "all"
            nsExec::ExecToLog 'icacls "$APPDATA\Tactile" /grant *S-1-5-32-545:(OI)(CI)M /T /C'
        ${endIf}

        ${if} ${FileExists} "$newStartMenuLink"
            CreateShortCut "$newStartMenuLink" "$appExe" "" "$TactileShortcutLightIconPath" 0 "" "" "${APP_DESCRIPTION}"
            ClearErrors
            WinShell::SetLnkAUMI "$newStartMenuLink" "${APP_ID}"
            nsExec::ExecToLog 'icacls "$newStartMenuLink" /grant *S-1-5-32-545:M /C'
        ${endIf}

        ${if} ${FileExists} "$newDesktopLink"
            CreateShortCut "$newDesktopLink" "$appExe" "" "$TactileShortcutLightIconPath" 0 "" "" "${APP_DESCRIPTION}"
            ClearErrors
            WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
            nsExec::ExecToLog 'icacls "$newDesktopLink" /grant *S-1-5-32-545:M /C'
        ${endIf}

        System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
    FunctionEnd
    !endif
!macroend

!macro customWelcomePage
    !ifndef BUILD_UNINSTALLER
    Page custom TactileLanguagePageCreate TactileLanguagePageLeave
    !endif
!macroend

!macro customInstall
    SetRegView 64
    ReadRegStr $0 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\X64" "Version"
    SetRegView 32

    StrCmp $0 '' notInstalled installed

    notInstalled:
    DetailPrint "VC++ Redistributable package is missing!"
    inetc::get "https://aka.ms/vs/17/release/vc_redist.x64.exe" $PLUGINSDIR\vcredist.exe
    DetailPrint "Installing Visual Studio Redistributable package..."
    ExecWait '"$PLUGINSDIR\vcredist.exe" /q /norestart'
    DetailPrint "Done"

    installed:
    DetailPrint "VC++ Redistributable installed"
    !ifndef BUILD_UNINSTALLER
        Call InstallTactileShortcutIconBridge

        ; Hand the language picked on the first wizard page to the app. The main
        ; process reads this once on first launch and deletes it.
        CreateDirectory "$APPDATA\Tactile"
        StrCmp $TactileSelectedLanguage "" 0 tactileWriteLanguage
        StrCpy $TactileSelectedLanguage "en"
        tactileWriteLanguage:
        ClearErrors
        FileOpen $0 "$APPDATA\Tactile\installer-language.txt" w
        ${IfNot} ${Errors}
            FileWrite $0 "$TactileSelectedLanguage"
            FileClose $0
        ${EndIf}

        ; A standalone copy of the product mark lets Windows Settings, the
        ; taskbar and the Start menu render the icon without loading the whole
        ; executable first. The file is small and lives next to the app.
        ClearErrors
        File /oname=$INSTDIR\tactile-icon.ico "${BUILD_RESOURCES_DIR}\installerIcon.ico"

        ; Publisher and support metadata shown by Windows Settings and the
        ; classic Control Panel. The product stays Tactile, the publisher is
        ; Vellium, and no Microsoft Store certificate is involved.
        WriteRegStr SHCTX "${UNINSTALL_REGISTRY_KEY}" "Publisher" "Vellium Teknoloji Anonim Şirketi"
        WriteRegStr SHCTX "${UNINSTALL_REGISTRY_KEY}" "URLInfoAbout" "https://vellium.dev"
        WriteRegStr SHCTX "${UNINSTALL_REGISTRY_KEY}" "URLUpdateInfo" "https://vellium.dev/en/products/tactile"
        WriteRegStr SHCTX "${UNINSTALL_REGISTRY_KEY}" "HelpLink" "https://vellium.dev/en/legal/support"
        WriteRegStr SHCTX "${UNINSTALL_REGISTRY_KEY}" "Contact" "support@vellium.dev"
        WriteRegStr SHCTX "${UNINSTALL_REGISTRY_KEY}" "Comments" "Tactile - A Vellium product (https://vellium.dev)"
        WriteRegDWORD SHCTX "${UNINSTALL_REGISTRY_KEY}" "NoModify" 1
        WriteRegDWORD SHCTX "${UNINSTALL_REGISTRY_KEY}" "NoRepair" 1
        ${If} ${FileExists} "$INSTDIR\tactile-icon.ico"
            WriteRegStr SHCTX "${UNINSTALL_REGISTRY_KEY}" "DisplayIcon" "$INSTDIR\tactile-icon.ico,0"
        ${EndIf}
    !endif
!macroend

!macro customInit
    # Kill running instances before install
    nsExec::Exec `taskkill /F /IM Tactile.exe`
!macroend

!macro customUnInit
    # Kill running instances before uninstall
    nsExec::Exec `taskkill /F /IM Tactile.exe`
!macroend

!macro customUnInstall
    ; The optional page collected the answer in $TactileDeleteUserData.
    ; Silent uninstalls leave the flag empty, which keeps the data.
    ${If} $TactileDeleteUserData == ${BST_CHECKED}
        ${If} $installMode == "all"
            SetShellVarContext current
        ${EndIf}

        RMDir /r "$APPDATA\Tactile"
        RMDir /r "$APPDATA\tactile"
        RMDir /r "$LOCALAPPDATA\Tactile"
        RMDir /r "$LOCALAPPDATA\tactile"
        DeleteRegKey HKCU "Software\Vellium\Tactile"
        DeleteRegKey SHCTX "Software\Vellium\Tactile"

        ${If} $installMode == "all"
            SetShellVarContext all
        ${EndIf}
    ${EndIf}
!macroend
