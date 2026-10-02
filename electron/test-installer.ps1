$ErrorActionPreference = 'Stop'
$project = Split-Path $PSScriptRoot -Parent
$version = (Get-Content (Join-Path $project 'package.json') -Raw | ConvertFrom-Json).version
$installer = Join-Path $project "release/GrainOceanAtlas-$version-win-x64-Setup.exe"
if (!(Test-Path -LiteralPath $installer)) { throw "Installer missing: $installer" }
# Do not replace an existing real installation in the current account.
$existing = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName -like 'Grain Ocean Atlas*' }
if ($existing) { throw 'Run this test in a Windows account without Grain Ocean Atlas installed.' }
$temporaryRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$fixture = Join-Path $temporaryRoot ('grain-installer-test-' + [guid]::NewGuid().ToString('N'))
$target = Join-Path $fixture 'application'
New-Item -ItemType Directory -Path $fixture | Out-Null
$installed = Join-Path $target 'GrainOceanAtlas.exe'
$uninstaller = Join-Path $target 'Uninstall GrainOceanAtlas.exe'
try {
    $process = Start-Process -FilePath $installer -ArgumentList "/S /currentuser /D=$target" -WindowStyle Hidden -Wait -PassThru
    if ($process.ExitCode -ne 0) { throw "Installation failed: $($process.ExitCode)" }
    if (!(Test-Path -LiteralPath $installed)) { throw 'Installed EXE missing' }
    if (!(Test-Path -LiteralPath $uninstaller)) { throw 'Uninstaller missing' }
    $windowsShell = New-Object -ComObject Shell.Application
    $desktop = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Путь зерна.lnk'
    $menu = Join-Path ([Environment]::GetFolderPath('Programs')) 'Путь зерна.lnk'
    # Exercise a filename outside the system ANSI code page as a regression check.
    $unicodeProbe = Join-Path $fixture 'shortcut-字.lnk'
    Copy-Item -LiteralPath $desktop -Destination $unicodeProbe
    foreach ($shortcut in @($desktop, $menu, $unicodeProbe)) {
        if (!(Test-Path -LiteralPath $shortcut)) { throw "Shortcut missing: $shortcut" }
        # Shell.Application reads Unicode names; WScript.CreateShortcut can return an empty target.
        $folder = $windowsShell.Namespace([IO.Path]::GetDirectoryName($shortcut))
        $item = $folder.ParseName([IO.Path]::GetFileName($shortcut))
        $shortcutTarget = $item.GetLink.Path
        # Resolve junctions, short (8.3) names and drive aliases before comparing Windows paths.
        & node -e 'const fs=require("node:fs");const [actual,expected]=process.argv.slice(1);const real=p=>fs.realpathSync.native(p).toLowerCase();if(real(actual)!==real(expected)){throw Error(`Wrong shortcut target: ${actual}; expected ${expected}`)}' $shortcutTarget $installed
        if ($LASTEXITCODE -ne 0) { throw "Wrong shortcut target: $shortcut; actual $shortcutTarget; expected $installed" }
    }
    & node (Join-Path $PSScriptRoot 'smoke.cjs') $installed
    if ($LASTEXITCODE -ne 0) { throw 'Installed application offline test failed' }
} finally {
    if ((Test-Path -LiteralPath $installed) -and !(Test-Path -LiteralPath $uninstaller)) { throw 'Retaining fixture: installation has no uninstaller' }
    if (Test-Path -LiteralPath $uninstaller) {
        # _?= keeps the uninstaller in this test directory so Wait observes completion.
        $process = Start-Process -FilePath $uninstaller -ArgumentList "/S /currentuser _?=$target" -WindowStyle Hidden -Wait -PassThru
        if ($process.ExitCode -ne 0) { throw "Uninstall failed: $($process.ExitCode)" }
        if (Test-Path -LiteralPath $installed) { throw 'Application remains after uninstall' }
        foreach ($shortcut in @($desktop, $menu)) {
            if ($shortcut -and (Test-Path -LiteralPath $shortcut)) { throw "Shortcut remains after uninstall: $shortcut" }
        }
    }
    $remaining = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue |
        Where-Object { $_.DisplayName -like 'Grain Ocean Atlas*' }
    if ($remaining) { throw 'Retaining fixture: uninstall registration remains' }
    # Verify the final absolute path before recursively removing only our temporary fixture.
    $resolvedFixture = [IO.Path]::GetFullPath($fixture)
    if (!(($resolvedFixture + [IO.Path]::DirectorySeparatorChar).StartsWith($temporaryRoot, [StringComparison]::OrdinalIgnoreCase)) -or
        [IO.Path]::GetFileName($resolvedFixture) -notmatch '^grain-installer-test-[a-f0-9]{32}$') { throw 'Unsafe cleanup path' }
    Remove-Item -LiteralPath $resolvedFixture -Recurse -Force
}
Write-Host 'PASS installer: installation, shortcuts, offline launch and uninstall'
