using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;

namespace DeepSeekHarnessDesktop.Services;

/// <summary>3090 HTTP 桥（对应 Electron 版 session-tools 的 HTTP server：health/info/restart/open/reveal/dom）。</summary>
public class SessionToolsServer : IDisposable
{
    private readonly HttpListener _listener = new();
    private readonly DshServiceManager _server;
    private readonly CrashRecovery _recovery;
    private readonly AppSettings _settings;
    private readonly int _port;
    private CancellationTokenSource? _cts;
    private bool _disposed;

    /// <summary>由 MainWindow 注入，用于 /dom 端点在 WebView2 中执行 JS。</summary>
    public Func<string, Task<string>>? DomExecutor { get; set; }

    public SessionToolsServer(DshServiceManager server, CrashRecovery recovery, AppSettings settings, int port = 3090)
    {
        _server = server;
        _recovery = recovery;
        _settings = settings;
        _port = port;
    }

    public void Start()
    {
        _cts = new CancellationTokenSource();
        _listener.Prefixes.Add($"http://127.0.0.1:{_port}/");
        try
        {
            _listener.Start();
            _ = Task.Run(() => AcceptLoop(_cts.Token));
            Log.Info($"Session tools server started on 127.0.0.1:{_port}");
        }
        catch (HttpListenerException ex)
        {
            // 端口被占用（如 Electron 版 session-tools 已在运行），不影响主功能
            Log.Warn($"Session tools server on {_port} failed: {ex.Message} (port in use, skipping)");
        }
        catch (Exception ex)
        {
            Log.Warn($"Session tools server start failed: {ex.Message} (skipping)");
        }
    }

    private async Task AcceptLoop(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            try
            {
                var ctx = await _listener.GetContextAsync().WaitAsync(ct);
                _ = HandleRequest(ctx);
            }
            catch (OperationCanceledException) { break; }
            catch (HttpListenerException) { break; }
            catch (Exception e) { Log.Error($"3090 accept error: {e.Message}"); }
        }
    }

    private async Task HandleRequest(HttpListenerContext ctx)
    {
        var req = ctx.Request;
        var resp = ctx.Response;
        try
        {
            var path = req.Url?.AbsolutePath?.TrimEnd('/') ?? "/";
            var query = req.Url?.Query ?? "";
            string json;

            switch (path)
            {
                case "/health":
                    json = HandleHealth(query);
                    break;
                case "/info":
                    json = HandleInfo();
                    break;
                case "/restart":
                    json = await HandleRestart();
                    break;
                case "/open":
                    json = HandleOpen(req);
                    break;
                case "/reveal":
                    json = HandleReveal(req);
                    break;
                case "/dom":
                    json = await HandleDom(req);
                    break;
                default:
                    json = "{\"ok\":false,\"error\":\"unknown endpoint\"}";
                    break;
            }

            var buf = Encoding.UTF8.GetBytes(json);
            resp.ContentType = "application/json; charset=utf-8";
            resp.ContentLength64 = buf.Length;
            resp.Headers.Add("Access-Control-Allow-Origin", "*");
            await resp.OutputStream.WriteAsync(buf, 0, buf.Length);
        }
        catch (Exception e)
        {
            try
            {
                var err = JsonSerializer.Serialize(new { ok = false, error = e.Message });
                var buf = Encoding.UTF8.GetBytes(err);
                resp.ContentType = "application/json";
                resp.ContentLength64 = buf.Length;
                await resp.OutputStream.WriteAsync(buf, 0, buf.Length);
            }
            catch { }
        }
        finally
        {
            try { resp.Close(); } catch { }
        }
    }

    private string HandleHealth(string query)
    {
        var probe = Regex.Match(query, @"probe=(\w+)", RegexOptions.IgnoreCase).Groups[1].Value.ToLower();
        if (probe == "liveness")
        {
            // 真实探活
            var ok = _server.HttpProbeReady(2000).GetAwaiter().GetResult();
            var crash = new
            {
                consecutive = _recovery.Consecutive,
                recent60 = _recovery.Recent60,
                lastCause = _recovery.LastCause,
                safeMode = _recovery.SafeModeActive,
                cooldownUntil = _recovery.CooldownUntil,
                breakerOpen = _recovery.BreakerOpen
            };
            return JsonSerializer.Serialize(new
            {
                ok,
                status = _server.CurrentStatus.ToString().ToLower(),
                safeMode = _recovery.SafeModeActive,
                crash
            });
        }
        if (probe == "metrics")
        {
            var mem = new
            {
                rss = Environment.WorkingSet,
                heapUsed = GC.GetTotalMemory(false),
                heapTotal = 0L, // .NET 不暴露 heap total 配置
            };
            var crash = new
            {
                consecutive = _recovery.Consecutive,
                recent60 = _recovery.Recent60,
                lastCause = _recovery.LastCause,
                safeMode = _recovery.SafeModeActive,
                cooldownUntil = _recovery.CooldownUntil,
                breakerOpen = _recovery.BreakerOpen
            };
            return JsonSerializer.Serialize(new
            {
                ok = true,
                status = _server.CurrentStatus.ToString().ToLower(),
                uptime = (int)(DateTime.UtcNow - Process.GetCurrentProcess().StartTime.ToUniversalTime()).TotalSeconds,
                memory = mem,
                childAlive = _server.Child != null && !_server.Child.HasExited,
                crash
            });
        }
        if (probe == "readiness")
        {
            var running = _server.CurrentStatus == DshServiceManager.Status.Running;
            return JsonSerializer.Serialize(new { ok = running, status = running ? "running" : _server.CurrentStatus.ToString().ToLower(), safeMode = _recovery.SafeModeActive });
        }
        // 默认健康检查
        return JsonSerializer.Serialize(new { ok = true });
    }

    private Task<string> HandleRestart()
    {
        var (ok, reason) = _recovery.RestartLimiter.Allow();
        if (!ok) return Task.FromResult(JsonSerializer.Serialize(new { ok = false, error = reason, code = 429 }));

        _ = Task.Run(async () =>
        {
            await _server.StopServer();
            await Task.Delay(500);
            _server.ManualStop = false;
            await _server.StartServer();
        });
        return Task.FromResult(JsonSerializer.Serialize(new { ok = true, message = "正在重启 DSH 服务…" }));
    }

    private string HandleInfo()
    {
        return JsonSerializer.Serialize(new
        {
            ok = true,
            appVersion = "1.0.0 (native)",
            serverStatus = _server.CurrentStatus.ToString().ToLower(),
            serverPort = _server.TargetPort,
            serverUrl = $"http://{_server.Host}:{_server.TargetPort}/",
            settings = new
            {
                host = _settings.Host,
                port = _settings.Port,
                workspaceDir = _settings.WorkspaceDir,
                minimizeToTray = _settings.MinimizeToTray,
                keepServerOnQuit = _settings.KeepServerOnQuit,
                autoStart = _settings.AutoStart,
                startServerOnLaunch = _settings.StartServerOnLaunch
            }
        });
    }

    private string HandleOpen(HttpListenerRequest req)
    {
        // 对应 Electron 版 /open：打开工作区中的文件/文件夹
        try
        {
            var path = GetQueryParam(req, "path") ?? "";
            var abs = ResolveWorkspacePath(path);
            if (abs == null)
                return JsonSerializer.Serialize(new { ok = false, error = "路径不在工作区内" });
            Process.Start(new ProcessStartInfo(abs) { UseShellExecute = true });
            return JsonSerializer.Serialize(new { ok = true });
        }
        catch (Exception e)
        {
            return JsonSerializer.Serialize(new { ok = false, error = e.Message });
        }
    }

    private string HandleReveal(HttpListenerRequest req)
    {
        try
        {
            var path = GetQueryParam(req, "path") ?? "";
            string target;
            if (string.IsNullOrEmpty(path))
            {
                // 无参数：显示日志目录
                target = Log.LogDir;
            }
            else
            {
                var abs = ResolveWorkspacePath(path);
                if (abs == null)
                    return JsonSerializer.Serialize(new { ok = false, error = "路径不在工作区内" });
                if (!Directory.Exists(abs) && !File.Exists(abs))
                    return JsonSerializer.Serialize(new { ok = false, error = "路径不存在: " + abs });
                target = abs;
            }
            Process.Start("explorer.exe", $"/select,\"{target}\"");
            return JsonSerializer.Serialize(new { ok = true });
        }
        catch (Exception e)
        {
            return JsonSerializer.Serialize(new { ok = false, error = e.Message });
        }
    }

    private async Task<string> HandleDom(HttpListenerRequest req)
    {
        var js = GetQueryParam(req, "q") ?? "";
        if (string.IsNullOrEmpty(js))
            return JsonSerializer.Serialize(new { ok = false, error = "missing q" });
        if (DomExecutor == null)
            return JsonSerializer.Serialize(new { ok = false, error = "no dom executor" });
        try
        {
            var result = await DomExecutor(js);
            return JsonSerializer.Serialize(new { ok = true, result });
        }
        catch (Exception e)
        {
            return JsonSerializer.Serialize(new { ok = false, error = e.Message });
        }
    }

    private static string? GetQueryParam(HttpListenerRequest req, string name)
    {
        var m = Regex.Match(req.Url?.Query ?? "", $@"[?&]{name}=([^&]+)", RegexOptions.IgnoreCase);
        return m.Success ? Uri.UnescapeDataString(m.Groups[1].Value) : null;
    }

    /// <summary>解析工作区路径（对应 Electron 版 resolveBridgePath）。</summary>
    private string? ResolveWorkspacePath(string input)
    {
        var root = WorkspaceRoot();
        var rel = string.IsNullOrEmpty(input) ? "" : (Path.IsPathRooted(input) ? Path.GetRelativePath(root, input) : input);
        var abs = Path.GetFullPath(Path.Combine(root, rel));
        var normRoot = Path.GetFullPath(root) + Path.DirectorySeparatorChar;
        if (abs != Path.GetFullPath(root) && !abs.StartsWith(normRoot, StringComparison.OrdinalIgnoreCase))
            return null;
        return abs;
    }

    private string WorkspaceRoot()
    {
        if (!string.IsNullOrEmpty(_settings.WorkspaceDir) && Directory.Exists(_settings.WorkspaceDir))
            return _settings.WorkspaceDir;
        var candidates = new[] { "D:\\deepseek_harness", AppContext.BaseDirectory };
        foreach (var c in candidates)
        {
            if (Directory.Exists(c)) return c;
        }
        return Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _cts?.Cancel();
        try { _listener.Stop(); } catch { }
        _cts?.Dispose();
    }
}