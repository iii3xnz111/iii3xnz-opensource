[CmdletBinding()]
param(
    [switch]$InstallDocker,
    [switch]$Stop,
    [switch]$OpenBrowser,
    [switch]$RemoveData,
    [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
$LauncherPath = $PSCommandPath
$InstallRoot = Split-Path -Parent $PSScriptRoot
$DataRoot = Join-Path $env:ProgramData "iii3xnz"
$ConfigPath = Join-Path $DataRoot "config.env"
$LogPath = Join-Path $DataRoot "launcher.log"
$ComposeFile = Join-Path $InstallRoot "docker-compose.yml"
$ProjectName = "iii3xnz"
$DockerDesktopInstallerUrl = "https://desktop.docker.com/win/main/amd64/Docker%20Desktop%20Installer.exe"

New-Item -ItemType Directory -Force -Path $DataRoot | Out-Null

function Write-Log([string]$Message) {
    $line = "{0:u} {1}" -f (Get-Date), $Message
    Add-Content -LiteralPath $LogPath -Value $line
    Write-Host $line
}

function Show-Failure([string]$Message) {
    Write-Log "ERROR: $Message"
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show($Message, "iii3xnz", "OK", "Error") | Out-Null
    exit 1
}

function Test-TcpPort([int]$Port) {
    $client = New-Object Net.Sockets.TcpClient
    try {
        $task = $client.ConnectAsync("127.0.0.1", $Port)
        return $task.Wait(250)
    } catch {
        return $false
    } finally {
        $client.Dispose()
    }
}

function Find-FreePort([int]$Preferred) {
    $port = $Preferred
    while (Test-TcpPort $port) {
        $port++
        if ($port -gt 65500) { Show-Failure "No free TCP port was found near $Preferred." }
    }
    return $port
}

function Get-DockerPath {
    $command = Get-Command docker.exe -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    $candidates = @(
        "$env:ProgramFiles\Docker\Docker\resources\bin\docker.exe",
        "$env:ProgramFiles\Docker\Docker\resources\bin\com.docker.cli.exe",
        "$env:LocalAppData\Programs\DockerDesktop\resources\bin\docker.exe",
        "$env:LocalAppData\Programs\DockerDesktop\resources\bin\com.docker.cli.exe"
    )
    foreach ($candidate in $candidates) {
        if (Test-Path $candidate) { return $candidate }
    }
    return $null
}

function Get-DockerCandidates {
    @(
        "$env:ProgramFiles\Docker\Docker\resources\bin\docker.exe",
        "$env:ProgramFiles\Docker\Docker\resources\bin\com.docker.cli.exe",
        "$env:LocalAppData\Docker\Docker Desktop.exe",
        "$env:LocalAppData\Programs\DockerDesktop\resources\bin\docker.exe",
        "$env:LocalAppData\Programs\DockerDesktop\resources\bin\com.docker.cli.exe"
    )
}

function Get-DockerDesktopPath {
    $candidates = @(
        "$env:ProgramFiles\Docker\Docker\Docker Desktop.exe",
        "$env:LocalAppData\Docker\Docker Desktop.exe",
        "$env:LocalAppData\Programs\DockerDesktop\Docker Desktop.exe"
    )
    foreach ($candidate in $candidates) {
        if (Test-Path $candidate) { return $candidate }
    }
    return $null
}

function Test-DockerReady([string]$DockerPath) {
    try {
        & $DockerPath info *> $null
        return $LASTEXITCODE -eq 0
    } catch {
        return $false
    }
}

function Ensure-Docker {
    $dockerPath = Get-DockerPath
    $desktopPath = Get-DockerDesktopPath
    if (-not $dockerPath -or -not $desktopPath) {
        if (-not $InstallDocker) {
            Show-Failure "Docker Desktop is not installed. Re-run iii3xnz setup to install Docker Desktop from Docker's official download location."
        }

        $download = Join-Path $env:TEMP ("iii3xnz-Docker-Desktop-Installer-{0}.exe" -f ([guid]::NewGuid().ToString("N")))
        Write-Log "Downloading Docker Desktop from the official Docker distribution URL."
        try {
            $webClient = New-Object Net.WebClient
            $webClient.DownloadFile($DockerDesktopInstallerUrl, $download)
            $webClient.Dispose()
            $signature = Get-AuthenticodeSignature -FilePath $download
            if ($signature.Status -ne "Valid" -or $signature.SignerCertificate.Subject -notmatch "Docker") {
                Show-Failure "Docker Desktop download failed signature verification. The installer was not run."
            }
            Write-Log "Launching the official Docker Desktop per-user installer with the WSL 2 backend; Windows may show UAC or require a restart for WSL setup."
            $arguments = @("install", "--user", "--accept-license", "--backend=wsl-2", "--quiet")
            $process = Start-Process -FilePath $download -ArgumentList $arguments -Wait -PassThru
            Write-Log "Official Docker Desktop installer exited with code $($process.ExitCode). Verifying installation artifacts."
            $artifactDeadline = (Get-Date).AddMinutes(2)
            while (-not (Get-DockerDesktopPath) -and -not (Get-DockerPath)) {
                if ((Get-Date) -gt $artifactDeadline) { break }
                Start-Sleep -Seconds 3
            }
            if (-not (Get-DockerDesktopPath) -and -not (Get-DockerPath)) {
                if ($process.ExitCode -eq 3010) {
                    New-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\RunOnce" -Name "iii3xnzResume" -Value "powershell.exe -NoProfile -File `"$LauncherPath`" -InstallDocker" -Force | Out-Null
                    Show-Failure "Docker Desktop requires a Windows restart. Restart Windows, then iii3xnz setup will resume automatically."
                }
                Show-Failure "Docker Desktop installation returned exit code $($process.ExitCode) and no installation artifacts were found. Complete Docker Desktop setup, then launch iii3xnz again."
            }
            if ($process.ExitCode -ne 0) {
                Write-Log "Docker Desktop installation returned nonzero code $($process.ExitCode), but installation artifacts were found; continuing to engine readiness verification."
            }
        } catch {
            Show-Failure "Docker Desktop could not be downloaded or installed: $($_.Exception.Message)"
        } finally {
            Remove-Item -LiteralPath $download -Force -ErrorAction SilentlyContinue
        }
        $dockerPath = Get-DockerPath
        $desktopPath = Get-DockerDesktopPath
    }

    if (-not $dockerPath) {
        Show-Failure "Docker CLI was not found after Docker Desktop installation."
    }

    if (-not (Test-DockerReady $dockerPath)) {
        if ($desktopPath) {
            Write-Log "Starting Docker Desktop."
            Start-Process -FilePath $desktopPath | Out-Null
        } else {
            Show-Failure "Docker Desktop is installed but its executable could not be located. Start Docker Desktop and launch iii3xnz again."
        }
    }

    Write-Log "Waiting for Docker Engine readiness."
    $deadline = (Get-Date).AddMinutes(5)
    while (-not (Test-DockerReady $dockerPath)) {
        if ((Get-Date) -gt $deadline) {
            Show-Failure "Docker Engine did not become ready within five minutes. Start Docker Desktop, then launch iii3xnz again."
        }
        Start-Sleep -Seconds 3
    }
    return $dockerPath
}

function Read-OrCreateConfig {
    if (-not (Test-Path $ConfigPath)) {
        $appPort = Find-FreePort 80
        $apiPort = Find-FreePort 4000
        $pgPort = Find-FreePort 5432
        @(
            "APP_PORT=$appPort"
            "API_PORT=$apiPort"
            "PG_PORT=$pgPort"
            "APP_URL=http://localhost:$appPort"
            "COMPOSE_PROJECT_NAME=$ProjectName"
        ) | Set-Content -LiteralPath $ConfigPath -Encoding ASCII
        Write-Log "Created persistent local configuration with app port $appPort and API port $apiPort."
    }

    $values = @{}
    foreach ($line in Get-Content -LiteralPath $ConfigPath) {
        if ($line -match '^([A-Za-z_][A-Za-z0-9_]*)=(.*)$') { $values[$matches[1]] = $matches[2] }
    }
    if (-not $values.ContainsKey("APP_PORT") -or -not $values.ContainsKey("API_PORT")) {
        Show-Failure "The iii3xnz configuration file is incomplete: $ConfigPath"
    }
    if (-not $values.ContainsKey("APP_URL")) {
        Add-Content -LiteralPath $ConfigPath -Value "APP_URL=http://localhost:$($values.APP_PORT)"
        $values["APP_URL"] = "http://localhost:$($values.APP_PORT)"
    }
    if (-not $values.ContainsKey("PG_PORT")) {
        $values["PG_PORT"] = Find-FreePort 5432
        Add-Content -LiteralPath $ConfigPath -Value "PG_PORT=$($values.PG_PORT)"
    }
    if ($values.COMPOSE_PROJECT_NAME -ne $ProjectName) {
        $values["COMPOSE_PROJECT_NAME"] = $ProjectName
        Save-Config $values
    }
    return $values
}

function Invoke-Compose([string]$DockerPath, [string[]]$Arguments) {
    $attempts = if ($Arguments -contains "up") { 3 } else { 1 }
    for ($attempt = 1; $attempt -le $attempts; $attempt++) {
        & $DockerPath compose --project-name $ProjectName --env-file $ConfigPath -f $ComposeFile @Arguments
        $exitCode = $LASTEXITCODE
        if ($exitCode -eq 0) { return }
        if ($Arguments -contains "up") {
            $running = @(& $DockerPath compose --project-name $ProjectName --env-file $ConfigPath -f $ComposeFile ps --status running --services 2>$null)
            $required = @("postgres", "backend", "worker", "frontend")
            if (($required | Where-Object { $running -contains $_ }).Count -eq $required.Count) {
                Write-Log "Docker Compose reported exit code $exitCode, but all required services are running; readiness checks will decide success."
                return
            }
        }
        if ($attempt -lt $attempts) {
            Write-Log "Docker Compose failed with exit code $exitCode; retrying in five seconds ($attempt/$attempts)."
            Start-Sleep -Seconds 5
        } else {
            Show-Failure "Docker Compose failed with exit code $exitCode. See $LogPath and Docker Desktop for details."
        }
    }
}

function Save-Config([hashtable]$Config) {
    $Config.GetEnumerator() |
        Sort-Object Name |
        ForEach-Object { "{0}={1}" -f $_.Key, $_.Value } |
        Set-Content -LiteralPath $ConfigPath -Encoding ASCII
}

function Reconcile-ConfiguredPorts([string]$DockerPath, [hashtable]$Config) {
    $ownedPorts = (& $DockerPath ps --filter "label=com.docker.compose.project=$ProjectName" --format "{{.Ports}}" 2>$null) -join " `n"
    $changed = $false
    foreach ($key in @("APP_PORT", "API_PORT", "PG_PORT")) {
        $port = [int]$Config[$key]
        $isOwned = $ownedPorts -match (":$port->")
        if ((Test-TcpPort $port) -and -not $isOwned) {
            $newPort = Find-FreePort ($port + 1)
            Write-Log "Configured $key port $port is occupied by another process; using $newPort."
            $Config[$key] = $newPort
            if ($key -eq "APP_PORT") {
                $Config["APP_URL"] = "http://localhost:$newPort"
            }
            $changed = $true
        }
    }
    if ($changed) { Save-Config $Config }
    return $Config
}

function Wait-Http([string]$Url, [int]$TimeoutSeconds = 180) {
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        try {
            $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) { return }
        } catch { }
        Start-Sleep -Seconds 2
    } while ((Get-Date) -lt $deadline)
    Show-Failure "iii3xnz did not become ready at $Url. Check Docker Desktop and $LogPath."
}

function Start-Application([string]$DockerPath, [hashtable]$Config) {
    $images = & $DockerPath compose --project-name $ProjectName --env-file $ConfigPath -f $ComposeFile images -q backend 2>$null
    if ([string]::IsNullOrWhiteSpace(($images -join ""))) {
        Write-Log "First launch: building iii3xnz images."
        Invoke-Compose $DockerPath @("up", "-d", "--build")
    } else {
        Write-Log "Starting existing iii3xnz images without rebuilding."
        Invoke-Compose $DockerPath @("up", "-d")
    }

    $appPort = [int]$Config.APP_PORT
    $apiPort = [int]$Config.API_PORT
    Write-Log "Waiting for PostgreSQL, backend, worker, and frontend readiness."
    Wait-Http "http://127.0.0.1:$apiPort/health"
    Wait-Http "http://127.0.0.1:$apiPort/readiness"
    $worker = & $DockerPath compose --project-name $ProjectName --env-file $ConfigPath -f $ComposeFile ps --status running --services 2>$null
    if ($worker -notcontains "worker") {
        Show-Failure "The iii3xnz worker is not running. Check Docker Desktop logs."
    }
    Wait-Http "http://127.0.0.1:$appPort/"
    if (-not $NoBrowser) {
        Start-Process "http://localhost:$appPort/"
    }
    Write-Log "iii3xnz is ready at http://localhost:$appPort/"
}

if ($RemoveData) {
    Add-Type -AssemblyName System.Windows.Forms
    $answer = [System.Windows.Forms.MessageBox]::Show("This removes PostgreSQL data, generated secrets, accounts, workflows, credentials, and executions. Continue?", "Remove iii3xnz user data", "YesNo", "Warning")
    if ($answer -eq "Yes") {
        $dockerPath = Get-DockerPath
        if ($dockerPath -and (Test-DockerReady $dockerPath) -and (Test-Path $ConfigPath)) {
            & $dockerPath compose --project-name $ProjectName --env-file $ConfigPath -f $ComposeFile down -v
        }
        Remove-Item -LiteralPath $DataRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
    exit 0
}

$docker = Ensure-Docker
$config = Read-OrCreateConfig

if ($Stop) {
    Invoke-Compose $docker @("stop")
    exit 0
}

$config = Reconcile-ConfiguredPorts $docker $config
Start-Application $docker $config