# Performance

Targets for v1.0 (plan/eng.md §10) and how to measure them on a release build.

| Metric | Spike | Target v1.0 | How |
|---|---|---|---|
| Hotkey → focus, median | 11–13 ms (max 33) | ≤ 50 ms, ≥ 49 of 50 | the log line `activate #n: focus OK after k attempt(s), X ms` |
| Show → first frame, median | 26 ms | ≤ 100 ms, no failure in 100 | S-2 below |
| Esc → hidden | 11–12 ms | ≤ 150 ms | the S-2 video: the ruler is gone within 9 frames at 60 fps |
| CPU when idle | 0.004–0.02 % | ≤ 0.05 % over 10 min, main window in the tray | S-3 below |
| RAM, working set | 69 MB | ≤ 80 MB with the main window in the tray; with it open: record | S-3 below |
| Exe size | — | ≤ 8 MB | the release assets |

## S-1: focus

Open the ruler 50 times over the map (`docs/in-game-checklist.md`), then count the lines in the
log (`%LOCALAPPDATA%\dev.mapper.app\logs\mapper.log`):

```powershell
$log = "$env:LOCALAPPDATA\dev.mapper.app\logs\mapper.log"
$times = Select-String $log -Pattern 'focus OK after \d+ attempt\(s\), ([\d.]+) ms' |
  ForEach-Object { [double]$_.Matches[0].Groups[1].Value } | Sort-Object
"$($times.Count) activations, median $($times[[int]($times.Count / 2)]) ms, max $($times[-1]) ms"
```

## S-2: showing without a flash

Record the screen at 60 fps (OBS or the Xbox Game Bar) while opening and closing the ruler 20
times at 100 % and at 150 % Windows scale. Step through the video frame by frame: no frame may show
the previous measurement, a white or a black rectangle.

## S-3: CPU and RAM

Mapper is `mapper.exe` plus its WebView2 processes, which run with Mapper's own data folder. Start
Mapper with Windows (or `mapper.exe --autostart`), wait a minute, then run this PowerShell for 10
minutes of sampling:

```powershell
function Get-MapperProcesses {
  Get-CimInstance Win32_Process |
    Where-Object { $_.Name -eq 'mapper.exe' -or ($_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -like '*dev.mapper.app*') } |
    ForEach-Object { Get-Process -Id $_.ProcessId }
}
$cores = [Environment]::ProcessorCount
$start = Get-MapperProcesses; $cpu0 = ($start | Measure-Object CPU -Sum).Sum
Start-Sleep -Seconds 600
$end = Get-MapperProcesses; $cpu1 = ($end | Measure-Object CPU -Sum).Sum
"CPU {0:N3} %, working set {1:N0} MB, private {2:N0} MB, {3} processes" -f
  (($cpu1 - $cpu0) / 600 / $cores * 100),
  (($end | Measure-Object WorkingSet64 -Sum).Sum / 1MB),
  (($end | Measure-Object PrivateMemorySize64 -Sum).Sum / 1MB),
  $end.Count
```

Repeat with the main window open and note the numbers.

## S-3 and G-6 in the game: PresentMon

[PresentMon](https://github.com/GameTechDev/PresentMon) records how the game presents its frames.
Run it during a match, three times one minute each: the ruler and HUD hidden, the HUD showing a
result, the ruler open. Pass: with Mapper hidden the game stays on *Hardware: Independent Flip*,
and with the HUD the 99th-percentile frame time grows by at most 1 ms.
