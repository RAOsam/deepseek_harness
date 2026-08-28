using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;

namespace DeepSeekHarnessDesktop.Services;

/// <summary>崩溃分类。</summary>
public enum CrashCause { External, PortConflict, Oom, PluginCrash, Runtime, Clean, Unknown }

/// <summary>防崩溃恢复引擎（对应 Electron 版 classifyCrash/handleCrash/recordCrash/enterSafeMode/startWatchdog）。</summary>
public class CrashRecovery : IDisposable
{
    private readonly DshServiceManager _server;
    private readonly CrashStateStore _stateStore;
    private readonly string? _profileDir;
    private readonly CircuitBreaker _breaker = new("restart", failThreshold: 0.4, requestThreshold: 3, openMs: 60_000);
    private readonly RateLimiter _restartLimiter = new(3, 60_000);
    private CancellationTokenSource? _watchdogCts;
    private SessionBackup? _backup;
    private bool _disposed;

    // 崩溃状态
    public int Consecutive { get; private set; }
    public int Recent60 { get; private set; }
    public string? LastCause { get; private set; }
    public bool SafeModeActive { get; private set; }
    public long CooldownUntil { get; private set; }
    public bool BreakerOpen => _breaker.Status == "OPEN";
    public RateLimiter RestartLimiter => _restartLimiter;

    /// <summary>设置备份引擎（在 CrashRecovery 创建后由 App 注入）。</summary>
    public void SetBackup(SessionBackup backup) => _backup = backup;

    public CrashRecovery(DshServiceManager server, CrashStateStore stateStore, string? profileDir)
    {
        _server = server;
        _stateStore = stateStore;
        _profileDir = profileDir;
        // 恢复持久化状态
        Consecutive = _stateStore.Crashes.Count > 0
            ? _stateStore.Crashes.Max(c => c.Consecutive)
            : 0;
        SafeModeActive = _stateStore.SafeMode;
        // 筛选最近60s的崩溃
        PurgeRecent();
    }

    // ── 崩溃分类 ──
    public CrashCause ClassifyCrash(int? exitCode, string? signal, string? stderrTail)
    {
        // 外部终止（SIGTERM/SIGKILL）
        if (signal == "SIGTERM" || signal == "SIGKILL") return CrashCause.External;
        // 端口冲突：stderr 含 "EADDRINUSE" 或 "listen EACCES"
        var stderr = stderrTail ?? "";
        if (stderr.Contains("EADDRINUSE", StringComparison.OrdinalIgnoreCase)
            || stderr.Contains("listen EACCES", StringComparison.OrdinalIgnoreCase))
            return CrashCause.PortConflict;
        // OOM
        if (stderr.Contains("FATAL ERROR", StringComparison.OrdinalIgnoreCase)
            && (stderr.Contains("Reached heap limit", StringComparison.OrdinalIgnoreCase)
                || stderr.Contains("Allocation failed", StringComparison.OrdinalIgnoreCase)))
            return CrashCause.Oom;
        // 插件崩溃（stderr 含 plugin 或 cordis 的异常）
        if (stderr.Contains("plugin error", StringComparison.OrdinalIgnoreCase)
            || stderr.Contains("cordis", StringComparison.OrdinalIgnoreCase) && stderr.Contains("TypeError", StringComparison.OrdinalIgnoreCase))
            return CrashCause.PluginCrash;
        // Windows 上强制终止：exitCode != 0, signal=null
        // 640 或 4294967295 或 1 等
        if (exitCode.HasValue && exitCode.Value != 0)
        {
            if (exitCode.Value == 0) return CrashCause.Clean;
            // 空 stderr + 非 0 exit → runtime 崩溃
            if (string.IsNullOrWhiteSpace(stderr)) return CrashCause.Runtime;
            return CrashCause.Runtime;
        }
        if (exitCode == 0) return CrashCause.Clean;
        return CrashCause.Unknown;
    }

    // ── 记录崩溃 ──
    public void RecordCrash(CrashCause cause)
    {
        PurgeRecent();
        Consecutive++;
        Recent60++;
        LastCause = cause.ToString().ToLower();
        // 崩溃文件持久化
        var records = _stateStore.Crashes.ToList();
        records.Add(new CrashRecord
        {
            At = DateTime.UtcNow.ToString("O"),
            Cause = LastCause,
            Consecutive = Consecutive
        });
        // 只保留最近 50 条
        if (records.Count > 50) records = records.Skip(records.Count - 50).ToList();
        _stateStore.Save(SafeModeActive, records);
    }

    // ── 处理崩溃 → 决定是否自动恢复 ──
    public async Task<bool> HandleCrash(int? exitCode, string? signal, bool wasManualStop)
    {
        // 抑制：手动停止 / 退出中 / 非自有服务
        if (wasManualStop || _server.ManualStop)
        {
            Log.Info("[anticrash] suppressed (manual stop or quitting)");
            return false;
        }
        if (!_server.StartedByUs)
        {
            Log.Info("[anticrash] suppressed (not our service)");
            return false;
        }

        var cause = ClassifyCrash(exitCode, signal, string.Join("\n", _server.StderrTail));
        // 外部终止 / 端口冲突 → 不自动恢复
        if (cause == CrashCause.External || cause == CrashCause.PortConflict)
        {
            Log.Info($"[anticrash] suppressed (cause={cause})");
            return false;
        }

        // 记录
        RecordCrash(cause);

        // 冷却期检查
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        if (now < CooldownUntil)
        {
            Log.Info($"[anticrash] cooldown active until {new DateTime(CooldownUntil, DateTimeKind.Utc):HH:mm:ss}");
            return false;
        }

        // 熔断器检查
        if (!_breaker.Allow())
        {
            Log.Info($"[anticrash] breaker OPEN, skipping restart");
            return false;
        }

        // 连续 3 次 → 安全模式
        if (Consecutive >= 3 && (cause == CrashCause.Runtime || cause == CrashCause.PluginCrash))
        {
            await EnterSafeMode();
            // 安全模式后重置计数
            Consecutive = 0;
            _stateStore.Save(_stateStore.SafeMode, _stateStore.Crashes);
            // 冷却 120s
            CooldownUntil = now + 120_000;
            // 进入安全模式后也重启尝试
            await _server.StopServer();
            await Task.Delay(500);
            await _server.StartServer();
            return true;
        }

        // 指数退避：1s, 2s, 4s, 8s, … 上限 60s
        var delayMs = Math.Min((int)Math.Pow(2, Consecutive - 1) * 1000, 60_000);
        Log.Info($"[anticrash] cause={cause} consecutive={Consecutive} recent60={Recent60}");
        Log.Info($"[anticrash] auto-restart in {delayMs}ms (cause={cause})");

        // 重启前自动备份会话
        if (_backup != null)
        {
            try { await _backup.Backup(); }
            catch (Exception e) { Log.Warn($"[anticrash] backup before restart failed: {e.Message}"); }
        }

        await Task.Delay(delayMs + 500); // 额外等 500ms 确保端口释放

        Log.Info("[anticrash] executing auto-restart");
        await _server.StopServer();
        // stop 会设置 ManualStop = true，但 auto-restart 需要 reset
        _server.ManualStop = false;
        await _server.StartServer();
        // 记录重启成功
        _breaker.Record(true);
        return true;
    }

    // ── 进入安全模式 ──
    public Task EnterSafeMode()
    {
        if (_profileDir == null)
        {
            Log.Error("[safe-mode] no profile directory");
            return Task.CompletedTask;
        }
        var patchFile = Path.Combine(_profileDir, "cordis.patch.yml");
        if (!File.Exists(patchFile)) return Task.CompletedTask;

        try
        {
            var content = File.ReadAllText(patchFile);
            var modified = DisableNonCorePlugins(content);
            if (modified != content)
            {
                File.WriteAllText(patchFile, modified);
                SafeModeActive = true;
                _stateStore.Save(true, _stateStore.Crashes);
                Log.Info("[safe-mode] activated: non-core plugins disabled");
            }
        }
        catch (Exception e) { Log.Error($"[safe-mode] failed: {e.Message}"); }
        return Task.CompletedTask;
    }

    // ── 恢复安全模式 ──
    public void ClearSafeMode()
    {
        SafeModeActive = false;
        _stateStore.Save(false, _stateStore.Crashes);
        // 清除 patch 中的 disabled: true
        if (_profileDir == null) return;
        var patchFile = Path.Combine(_profileDir, "cordis.patch.yml");
        if (!File.Exists(patchFile)) return;
        try
        {
            var content = File.ReadAllText(patchFile);
            // 去掉所有 disabled: true 行
            var cleaned = Regex.Replace(content, @"^\s+disabled:\s*true\s*$\n?", "", RegexOptions.Multiline);
            if (cleaned != content)
            {
                File.WriteAllText(patchFile, cleaned);
                Log.Info("[safe-mode] cleared: disabled lines removed");
            }
        }
        catch (Exception e) { Log.Error($"[safe-mode] clear failed: {e.Message}"); }
    }

    // ── disableNonCorePlugins ──
    public static string DisableNonCorePlugins(string content)
    {
        // 核心插件 ID 列表
        var coreIds = new HashSet<string> { "dsh-skin-switch", "dsh-session-tools", "dsh-persona-manager", "dsh-memory" };
        // 按 - insert: 块解析
        var lines = content.Split('\n').ToList();
        var result = new List<string>(lines.Count);
        var i = 0;
        while (i < lines.Count)
        {
            var line = lines[i];
            result.Add(line);
            if (line.Trim() == "- insert:")
            {
                // 收集块内的 id
                string? blockId = null;
                var j = i + 1;
                while (j < lines.Count && lines[j].StartsWith(" ") && lines[j].Trim() != "- insert:")
                {
                    var m = Regex.Match(lines[j].Trim(), @"^-\s+id:\s*(.+)$");
                    if (m.Success) blockId = m.Groups[1].Value.Trim();
                    // 检查是否已有 disabled: true
                    if (Regex.IsMatch(lines[j].Trim(), @"^disabled:\s*true\s*$"))
                        blockId = null; // 已经禁用了
                    j++;
                }
                // 如果块是有效的非核心插件，且尚未禁用，追加 disabled: true
                if (blockId != null && !coreIds.Contains(blockId))
                {
                    // 找到块内最后一个缩进级别，追加 disabled
                    var lastIndent = "";
                    for (var k = i + 1; k < j; k++)
                    {
                        if (!string.IsNullOrWhiteSpace(lines[k]))
                            lastIndent = Regex.Match(lines[k], @"^(\s+)").Value;
                    }
                    // 缩进对齐：在块内最后一行后插入 disabled: true
                    // 用 12 空格（与 main.js 的 disableNonCorePlugins 一致）
                    var indent = "            ";
                    result.Add($"{indent}disabled: true");
                    Log.Info($"[safe-mode] disabled plugin: {blockId}");
                }
                i = j - 1;
            }
            i++;
        }
        return string.Join("\n", result);
    }

    // ── Watchdog ──
    public void StartWatchdog()
    {
        _watchdogCts = new CancellationTokenSource();
        var ct = _watchdogCts.Token;
        _ = Task.Run(async () =>
        {
            var failCount = 0;
            while (!ct.IsCancellationRequested)
            {
                try
                {
                    await Task.Delay(5000, ct);
                    if (ct.IsCancellationRequested) break;
                    if (_server.Child == null || _server.Child.HasExited) continue;
                    var ok = await _server.HttpProbeReady();
                    if (ok) { failCount = 0; }
                    else
                    {
                        failCount++;
                        Log.Info($"[watchdog] probe fail #{failCount}");
                        if (failCount >= 3)
                        {
                            Log.Info("[watchdog] 3 consecutive failures, killing child");
                            try { _server.Child?.Kill(entireProcessTree: true); } catch { }
                            failCount = 0;
                            // exit 事件会触发 HandleCrash
                        }
                    }
                }
                catch (TaskCanceledException) { break; }
                catch (Exception e) { Log.Error($"watchdog error: {e.Message}"); }
            }
        }, ct);
    }

    public void ResetCrashMeters()
    {
        Consecutive = 0;
        Recent60 = 0;
        CooldownUntil = 0;
        _breaker.Reset();
        LastCause = null;
    }

    public void ResetBreaker() => _breaker.Reset();

    private void PurgeRecent()
    {
        var cutoff = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - 60_000;
        var recent = _stateStore.Crashes.Count(c =>
        {
            if (DateTime.TryParse(c.At, out var dt)) return dt.ToUniversalTime() >= DateTimeOffset.FromUnixTimeMilliseconds(cutoff).UtcDateTime;
            return false;
        });
        Recent60 = recent;
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _watchdogCts?.Cancel();
        _watchdogCts?.Dispose();
    }
}