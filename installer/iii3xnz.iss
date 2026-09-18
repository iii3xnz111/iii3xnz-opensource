#define AppName "iii3xnz"
#define AppVersion "0.1.0"
#define AppPublisher "iii3xnz"
#define AppExeName "iii3xnz.exe"
#define SourceRoot AddBackslash(SourcePath) + ".."

[Setup]
AppId={{A2B23E5F-6B7A-4A70-B7D2-13A3E0000001}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={autopf}\iii3xnz
DefaultGroupName=iii3xnz
OutputDir={#SourceRoot}\dist\installer
OutputBaseFilename=iii3xnz-Setup
Compression=lzma2
SolidCompression=yes
PrivilegesRequired=admin
ArchitecturesInstallIn64BitMode=x64
WizardStyle=modern
ChangesAssociations=no

[Files]
Source: "{#SourceRoot}\docker-compose.yml"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourceRoot}\.dockerignore"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourceRoot}\README.md"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourceRoot}\LICENSE"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourceRoot}\THIRD-PARTY-NOTICES.txt"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourceRoot}\backend\Dockerfile"; DestDir: "{app}\backend"; Flags: ignoreversion
Source: "{#SourceRoot}\backend\docker-entrypoint.sh"; DestDir: "{app}\backend"; Flags: ignoreversion
Source: "{#SourceRoot}\backend\package.json"; DestDir: "{app}\backend"; Flags: ignoreversion
Source: "{#SourceRoot}\backend\package-lock.json"; DestDir: "{app}\backend"; Flags: ignoreversion
Source: "{#SourceRoot}\backend\src\*"; DestDir: "{app}\backend\src"; Flags: recursesubdirs ignoreversion
Source: "{#SourceRoot}\frontend\Dockerfile"; DestDir: "{app}\frontend"; Flags: ignoreversion
Source: "{#SourceRoot}\frontend\nginx.conf"; DestDir: "{app}\frontend"; Flags: ignoreversion
Source: "{#SourceRoot}\frontend\index.html"; DestDir: "{app}\frontend"; Flags: ignoreversion
Source: "{#SourceRoot}\frontend\package.json"; DestDir: "{app}\frontend"; Flags: ignoreversion
Source: "{#SourceRoot}\frontend\package-lock.json"; DestDir: "{app}\frontend"; Flags: ignoreversion
Source: "{#SourceRoot}\frontend\vite.config.js"; DestDir: "{app}\frontend"; Flags: ignoreversion
Source: "{#SourceRoot}\frontend\public\*"; DestDir: "{app}\frontend\public"; Flags: recursesubdirs ignoreversion
Source: "{#SourceRoot}\frontend\src\*"; DestDir: "{app}\frontend\src"; Flags: recursesubdirs ignoreversion
Source: "{#SourceRoot}\docs\*"; DestDir: "{app}\docs"; Flags: recursesubdirs ignoreversion
Source: "{#SourceRoot}\installer\iii3xnz-launcher.ps1"; DestDir: "{app}\installer"; Flags: ignoreversion

[Dirs]
Name: "{commonappdata}\iii3xnz"; Permissions: users-modify

[Icons]
Name: "{group}\iii3xnz"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -File ""{app}\installer\iii3xnz-launcher.ps1"" -InstallDocker"; WorkingDir: "{app}"
Name: "{group}\Stop iii3xnz"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -File ""{app}\installer\iii3xnz-launcher.ps1"" -Stop"; WorkingDir: "{app}"
Name: "{group}\Remove iii3xnz user data"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -File ""{app}\installer\iii3xnz-launcher.ps1"" -RemoveData"; WorkingDir: "{app}"
Name: "{autodesktop}\iii3xnz"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -File ""{app}\installer\iii3xnz-launcher.ps1"" -InstallDocker"; WorkingDir: "{app}"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Create a Desktop shortcut"; GroupDescription: "Additional shortcuts:"; Flags: unchecked

[Run]
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -File ""{app}\installer\iii3xnz-launcher.ps1"" -InstallDocker"; WorkingDir: "{app}"; Description: "Start iii3xnz"; Flags: postinstall

[UninstallDelete]
Type: files; Name: "{app}\installer\launcher.log"