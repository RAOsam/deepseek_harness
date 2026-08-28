using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.Sockets;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;

namespace DeepSeekHarnessDesktop.Services;

/// <summary>DSH 服务进程管理器（对应 Electron 版 server mgr + ensureServer + releasePort + httpProbe）。</summary>
public class DshServiceManager : IDisposable
{
    // ── 状态 ──
    public enum Status { Idle, Starting, Running, Stopped, Error }
    public Status CurrentStatus { get; private set; } = Status.Idle;
    public Process? Child { get; private set; }
    public bool StartedByUs { get; private set; }
    public int? Port { get; private set; }
    public List<string> StdoutTail { get; } = new(capacity: 200);
    public List<string> StderrTail { get; } = new(capacity: 200);
    public bool ManualStop { get; set; }

    // ── 事件 ──
    public event Action<Status, string>? StatusChanged;
    public event Action<int, string?>? ChildExited; // (exitCode, cause)

    // ── 配置 ──
    public string Host { get; set; } = "127.0.0.1";
    public int TargetPort { get; set; } = 3080;
    public string? NodePath { get; set; }
    public string? DshCliPath { get; set; }
    public string? WorkspaceDir { get; set; }

    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(3) };
    private bool _disposed;

    // ── 探活 ──
    public async Task<bool> TcpProbe(int port, int timeoutMs = 1200)
    {
        try
        {
            using var tcp = new TcpClient();
            var task = tcp.ConnectAsync(Host, port);
            if (await Task.WhenAny(task, Task.Delay(timeoutMs)) == task)
                return true;
            return false;
        }
        catch { return false; }
    }

    public async Task<bool> HttpProbeReady(int timeoutMs = 2000)
    {
        try
        {
            using var cts = new CancellationTokenSource(timeoutMs);
            var resp = await _http.GetAsync($"http://{Host}:{TargetPort}/", cts.Token);
            return resp.StatusCode == HttpStatusCode.OK;
        }
        catch { return false; }
    }

    // ── 解析 Node 与 DSH CLI ──
    private string ResolveNode()
    {
        if (!string.IsNullOrEmpty(NodePath) && File.Exists(NodePath)) return NodePath;
        var fromEnv = Environment.GetEnvironmentVariable("DSH_NODE");
        if (!string.IsNullOrEmpty(fromEnv) && File.Exists(fromEnv)) return fromEnv;
        var sysNode = @"C:\Program Files\nodejs\node.exe";
        if (File.Exists(sysNode)) return sysNode;
        // 从 PATH 找 node
        try
        {
            var psi = new ProcessStartInfo("where", "node")
            {
                RedirectStandardOutput = true,
                UseShellExecute = false,
                CreateNoWindow = true
            };
            using var p = Process.Start(psi);
            if (p != null)
            {
                p.WaitForExit(2000);
                var line = p.StandardOutput.ReadLine()?.Trim();
                if (!string.IsNullOrEmpty(line) && File.Exists(line)) return line;
            }
        }
        catch { }
        return "node";
    }

    private string? ResolveDshCli()
    {
        if (!string.IsNullOrEmpty(DshCliPath) && File.Exists(DshCliPath)) return DshCliPath;
        // 相对路径
        var rel = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js");
        if (File.Exists(rel)) return rel;
        // npx 缓存
        var localAppData = Environment.GetEnvironmentVariable("LOCALAPPDATA") ?? "";
        var npxRoot = Path.Combine(localAppData, "npm-cache", "_npx");
        if (Directory.Exists(npxRoot))
        {
            string? best = null;
            foreach (var dir in Directory.GetDirectories(npxRoot))
            {
                var cand = Path.Combine(dir, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js");
                if (File.Exists(cand) && (best == null || File.GetLastWriteTimeUtc(cand) > File.GetLastWriteTimeUtc(best)))
                    best = cand;
            }
            return best;
        }
        return null;
    }

    // ── 端口释放 ──
    public async Task ReleasePort(int port)
    {
        // netstat -ano 找 LISTENING 端口 → PID → tasklist 确认 node.exe → taskkill
        try
        {
            var psi = new ProcessStartInfo("netstat", "-ano")
            {
                RedirectStandardOutput = true,
                UseShellExecute = false,
                CreateNoWindow = true
            };
            using var p = Process.Start(psi);
            if (p == null) return;
            var output = await p.StandardOutput.ReadToEndAsync();
            p.WaitForExit(2000);

            var pids = new HashSet<int>();
            var re = new Regex($"TCP\\s+\\S*:{port}\\s+\\S+\\s+LISTENING\\s+(\\d+)", RegexOptions.IgnoreCase);
            foreach (Match m in re.Matches(output))
                if (int.TryParse(m.Groups[1].Value, out var pid)) pids.Add(pid);

            foreach (var pid in pids)
            {
                var taskPsi = new ProcessStartInfo("tasklist", $"/FI \"PID eq {pid}\" /FO CSV /NH")
                {
                    RedirectStandardOutput = true,
                    UseShellExecute = false,
                    CreateNoWindow = true
                };
                using var tp = Process.Start(taskPsi);
                if (tp == null) continue;
                var out2 = await tp.StandardOutput.ReadToEndAsync();
                tp.WaitForExit(2000);
                if (out2.Contains("node.exe", StringComparison.OrdinalIgnoreCase))
                {
                    Process.Start("taskkill", $"/PID {pid} /T /F")?.WaitForExit(2000);
                }
            }
        }
        catch (Exception e) { Log.Error($"releasePort failed: {e.Message}"); }
    }

    // ── 启动服务 ──
    public async Task StartServer()
    {
        if (Child != null && !Child.HasExited) { Log.Info("server already running"); return; }
        if (CurrentStatus == Status.Starting) return;
        ManualStop = false;
        SetStatus(Status.Starting, "启动 DSH 服务…");

        StdoutTail.Clear();
        StderrTail.Clear();

        var cli = ResolveDshCli();
        var node = ResolveNode();
        if (cli == null)
        {
            SetStatus(Status.Error, "未找到 DSH CLI（@deepseek-ai/dsh），请检查网络后重试");
            return;
        }

        Log.Info($"spawning: {node} {cli} --profile web --host {Host} --port {TargetPort}");
        await ReleasePort(TargetPort);
        await Task.Delay(300);

        var psi = new ProcessStartInfo(node, $"{cli} --profile web --host {Host} --port {TargetPort}")
        {
            WorkingDirectory = Path.GetDirectoryName(cli),
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            Environment = { ["DSH_WORKSPACE_ROOT"] = WorkspaceDir ?? "D:\\deepseek_harness" }
        };

        var child = new Process { StartInfo = psi };
        child.OutputDataReceived += (_, e) =>
        {
            if (e.Data != null)
            {
                Log.Info($"[dsh] {e.Data}");
                StdoutTail.Add(e.Data);
                if (StdoutTail.Count > 200) StdoutTail.RemoveAt(0);
            }
        };
        child.ErrorDataReceived += (_, e) =>
        {
            if (e.Data != null)
            {
                Log.Info($"[dsh:err] {e.Data}");
                StderrTail.Add(e.Data);
                if (StderrTail.Count > 200) StderrTail.RemoveAt(0);
            }
        };
        child.EnableRaisingEvents = true;
        child.Start();
        child.BeginOutputReadLine();
        child.BeginErrorReadLine();

        Child = child;
        StartedByUs = true;

        // 绑定子进程退出事件 → 触发崩溃恢复
        child.Exited += (_, _) =>
        {
            // 退出后清理引用
            var exitCode = child.ExitCode;
            Child = null;
            Log.Info($"dsh exited code={exitCode} signal=null");
            ChildExited?.Invoke(exitCode, null);
        };

        // 就绪探测（90s 超时）
        var deadline = DateTime.UtcNow.AddSeconds(90);
        while (DateTime.UtcNow < deadline)
        {
            if (child.HasExited)
            {
                SetStatus(Status.Error, "dsh 进程提前退出");
                return;
            }
            if (await HttpProbeReady())
            {
                Port = TargetPort;
                ManualStop = false;
                SetStatus(Status.Running, "服务就绪");
                Log.Info($"DSH service ready at http://{Host}:{TargetPort}");
                return;
            }
            await Task.Delay(700);
        }
        SetStatus(Status.Error, $"等待 DSH 服务就绪超时 (http://{Host}:{TargetPort})");
    }

    // ── 停止服务 ──
    public async Task StopServer()
    {
        ManualStop = true;
        var child = Child;
        if (child == null || child.HasExited) { SetStatus(Status.Stopped, "服务已停止"); return; }

        // 优雅终止
        child.Kill(entireProcessTree: true);
        // 等待最多 4s
        var deadline = DateTime.UtcNow.AddSeconds(4);
        while (DateTime.UtcNow < deadline && !child.HasExited)
            await Task.Delay(100);

        if (!child.HasExited)
        {
            try { Process.Start("taskkill", $"/PID {child.Id} /T /F")?.WaitForExit(2000); } catch { }
        }
        // 注意：Windows 上 child.Kill(true) 已杀整树，taskkill 兜底
        Child = null;
        SetStatus(Status.Stopped, "服务已停止");
    }

    // ── 确保服务 ──
    public async Task EnsureServer()
    {
        if (await TcpProbe(TargetPort))
        {
            Port = TargetPort;
            StartedByUs = false;
            SetStatus(Status.Running, "连接已有服务");
            return;
        }
        // 配置是否启动
        // caller 决定是否启动，这里只做连接检测
    }

    // ── 状态设置 ──
    private void SetStatus(Status s, string detail = "")
    {
        CurrentStatus = s;
        StatusChanged?.Invoke(s, detail);
        Log.Info($"server status -> {s}{(detail.Length > 0 ? " (" + detail + ")" : "")}");
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _http.Dispose();
    }
}