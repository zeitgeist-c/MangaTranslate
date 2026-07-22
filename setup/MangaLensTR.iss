#ifndef MyAppVersion
  #define MyAppVersion "0.0.0"
#endif

#define MyAppName "MangaLens TR"
#define MyAppPublisher "MangaLens TR"
#define MyAppExeName "MangaLensTR-Kurulum-Yardimcisi.exe"
#define SourceRoot ".."

[Setup]
AppId={{A7C443A5-A1D1-4AC4-A547-3C0263A74735}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={localappdata}\Programs\MangaLens TR
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=.
OutputBaseFilename=MangaLensTR-Setup-{#MyAppVersion}
SetupIconFile=assets\MangaLensTR.ico
UninstallDisplayIcon={app}\{#MyAppExeName}
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
CloseApplications=no
RestartApplications=no
VersionInfoVersion={#MyAppVersion}
VersionInfoDescription={#MyAppName} Kurulum Paketi
VersionInfoProductName={#MyAppName}
VersionInfoProductVersion={#MyAppVersion}
VersionInfoCompany={#MyAppPublisher}

[Languages]
Name: "turkish"; MessagesFile: "compiler:Languages\Turkish.isl"

[Tasks]
Name: "startmenuicon"; Description: "Başlat menüsü kısayolu oluştur"; GroupDescription: "Kısayollar:"; Flags: checkedonce
Name: "desktopicon"; Description: "Masaüstü kısayolu oluştur"; GroupDescription: "Kısayollar:"; Flags: unchecked

[Files]
Source: "build\{#MyAppExeName}"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourceRoot}\manifest.json"; DestDir: "{app}\Extension"; Flags: ignoreversion
Source: "{#SourceRoot}\assets\*"; DestDir: "{app}\Extension\assets"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#SourceRoot}\popup\*"; DestDir: "{app}\Extension\popup"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#SourceRoot}\src\*"; DestDir: "{app}\Extension\src"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#MyAppName} Kurulum Yardımcısı"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"; Tasks: startmenuicon
Name: "{autodesktop}\{#MyAppName} Kurulum Yardımcısı"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{#MyAppName} tarayıcı kurulumunu tamamla"; Flags: nowait postinstall skipifsilent

[Code]
function InitializeUninstall(): Boolean;
begin
  MsgBox(
    'MangaLens TR dosyaları kaldırılacak.' + #13#10 + #13#10 +
    'Uzantıyı Chrome, Edge, Brave, Vivaldi veya Opera içine geliştirici moduyla yüklediyseniz, tarayıcının Uzantılar sayfasından ayrıca Kaldır seçeneğini kullanın.',
    mbInformation,
    MB_OK
  );
  Result := True;
end;
