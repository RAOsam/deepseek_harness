using System;
using System.Diagnostics;
using System.IO;
using System.Threading;
using System.Windows;
using DeepSeekHarnessDesktop.Services;
using Hardcodet.Wpf.TaskbarNotification;

namespace DeepSeekHarnessDesktop;

public partial class App : Application
{
    private Mutex? _singleInstanceMutex;
    public AppSettings Settings { get; private set; } = null!;
    public DshServiceManager Server { get; private set; } = null!;
    public CrashRecovery Recovery { get; private set; } = null!;
    public SessionToolsServer ToolsServer { get; private set; } = null!;
    public SessionBackup Backup { get; private set; } = null!;
    public SkinWatcher SkinWatcher { get; private set; } = null!;
    private TaskbarIcon? _trayIcon;
    private MainWindow? _mainWindow;
    private System.Windows.Controls.MenuItem? _crashStatusItem;

    // 用户数据目录
    private static readonly string UserDataDir = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        "DeepSeek Harness Desktop");

    // profile 目录
    private static readonly string DshHome = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
        ".dsh");

    private static readonly string ProfileDir = Path.Combine(DshHome, "profiles", "web");

    protected override void OnStartup(StartupEventArgs e)
    {
        // 单实例检查
        _singleInstanceMutex = new Mutex(true, "DeepSeekHarnessDesktop-SingleInstance", out var createdNew);
        if (!createdNew)
        {
            // 已有一个实例，激活它
            MessageBox.Show("DeepSeek Harness Desktop 已在运行中。", "提示", MessageBoxButton.OK, MessageBoxImage.Information);
            Shutdown();
            return;
        }

        // 初始化日志
        Log.Init(UserDataDir);
        Log.Info("=== DeepSeek Harness Desktop (native) starting ===");

        // 加载设置
        Settings = AppSettings.Load(UserDataDir);
        Log.Info($"settings loaded: host={Settings.Host} port={Settings.Port}");

        // 初始化服务管理器
        Server = new DshServiceManager
        {
            Host = Settings.Host,
            TargetPort = Settings.Port,
            NodePath = Settings.NodePath,
            DshCliPath = Settings.DshCliPath,
            WorkspaceDir = Settings.WorkspaceDir
        };

        // 初始化崩溃状态存储
        var stateStore = new CrashStateStore(DshHome);
        stateStore.Load();

        // 初始化崩溃恢复
        Recovery = new CrashRecovery(Server, stateStore, ProfileDir);
        if (stateStore.SafeMode)
        {
            Log.Info("上一次安全模式仍激活，恢复。");
        }

        // 接通子进程退出 → 崩溃恢复链路
        Server.ChildExited += (exitCode, signal) =>
        {
            // 异步处理，不阻塞事件
            _ = Recovery.HandleCrash(exitCode, signal, Server.ManualStop);
        };

        // 服务状态变化 → 托盘通知
        Server.StatusChanged += (status, detail) =>
        {
            Dispatcher.Invoke(() =>
            {
                if (_trayIcon == null) return;
                switch (status)
                {
                    case DshServiceManager.Status.Running:
                        _trayIcon.ToolTipText = $"DeepSeek Harness Desktop — 运行中 ({Settings.Host}:{Settings.Port})";
                        _trayIcon.ShowBalloonTip("DSH 服务", "服务已就绪", Hardcodet.Wpf.TaskbarNotification.BalloonIcon.Info);
                        break;
                    case DshServiceManager.Status.Error:
                        _trayIcon.ToolTipText = $"DeepSeek Harness Desktop — 错误: {detail}";
                        _trayIcon.ShowBalloonTip("DSH 服务", $"启动失败：{detail}", Hardcodet.Wpf.TaskbarNotification.BalloonIcon.Error);
                        break;
                    case DshServiceManager.Status.Stopped:
                        _trayIcon.ToolTipText = "DeepSeek Harness Desktop — 已停止";
                        _trayIcon.ShowBalloonTip("DSH 服务", "服务已停止", Hardcodet.Wpf.TaskbarNotification.BalloonIcon.Info);
                        break;
                    case DshServiceManager.Status.Starting:
                        _trayIcon.ToolTipText = "DeepSeek Harness Desktop — 启动中...";
                        break;
                }
                UpdateCrashStatus();
            });
        };

        // 初始化会话备份
        Backup = new SessionBackup(UserDataDir, ProfileDir);
        Recovery.SetBackup(Backup);

        // 初始化皮肤感知
        SkinWatcher = new SkinWatcher(ProfileDir);

        // 初始化 3090 桥
        ToolsServer = new SessionToolsServer(Server, Recovery, Backup, Settings, 3090);

        // 创建主窗口
        _mainWindow = new MainWindow(Server, Recovery);

        // 挂接 DOM 执行器（供 3090 桥的 /dom 端点使用，需通过 Dispatcher 切换到 UI 线程）
        ToolsServer.DomExecutor = async js =>
        {
            var result = await _mainWindow!.Dispatcher.Invoke(async () =>
            {
                if (_mainWindow?.Browser?.CoreWebView2 == null)
                    return "{\"error\":\"no webview\"}";
                return await _mainWindow.Browser.CoreWebView2.ExecuteScriptAsync(js) ?? "null";
            });
            return result;
        };

        // 会话恢复/回滚后 → 刷新页面（对应 Electron 的 restoreSession 中 reload）
        ToolsServer.OnSessionRestored = () =>
        {
            _mainWindow?.Dispatcher.Invoke(() =>
            {
                try { _mainWindow?.Browser?.Reload(); } catch { }
            });
        };

        // 皮肤变化 → 广播到 WebView2
        SkinWatcher.SkinChanged += skinId =>
        {
            _mainWindow?.BroadcastSkin(skinId ?? "");
        };

        // 设置托盘图标
        SetupTray();

        // 显示主窗口（根据设置）
        if (!Settings.MinimizeToTray)
        {
            _mainWindow.Show();
        }

        // 启动 3090 桥
        ToolsServer.Start();

        // 启动皮肤监控
        SkinWatcher.Start();

        // 启动服务（如配置允许）
        if (Settings.StartServerOnLaunch)
        {
            _ = Task.Run(async () =>
            {
                try
                {
                    await Server.EnsureServer();
                    if (Server.CurrentStatus == DshServiceManager.Status.Running && !Recovery.SafeModeActive)
                    {
                        Recovery.StartWatchdog();
                    }
                }
                catch (Exception ex)
                {
                    Log.Error($"EnsureServer 异常: {ex.Message}");
                }
            });
        }

        base.OnStartup(e);
    }

    private void SetupTray()
    {
        _trayIcon = new TaskbarIcon
        {
            Icon = System.Drawing.Icon.ExtractAssociatedIcon(Process.GetCurrentProcess().MainModule?.FileName ?? ""),
            ToolTipText = "DeepSeek Harness Desktop",
            Visibility = Visibility.Visible
        };

        // 托盘菜单（WPF ContextMenu，注册 Click 事件）
        var menu = new System.Windows.Controls.ContextMenu();

        System.Windows.Controls.MenuItem AddItem(string header, Action action)
        {
            var item = new System.Windows.Controls.MenuItem { Header = header };
            item.Click += (_, _) => action();
            menu.Items.Add(item);
            return item;
        }
        void AddSeparator()
        {
            menu.Items.Add(new System.Windows.Controls.Separator());
        }

        AddItem("显示主窗口", () => ShowWindow());
        AddItem("在浏览器中打开", () =>
        {
            try { Process.Start(new ProcessStartInfo($"http://{Settings.Host}:{Settings.Port}") { UseShellExecute = true }); }
            catch { }
        });
        AddSeparator();
        AddItem("重启 DSH 服务", () =>
        {
            _ = Task.Run(async () =>
            {
                _trayIcon?.Dispatcher.Invoke(() =>
                    _trayIcon.ShowBalloonTip("DSH 服务", "正在重启...", Hardcodet.Wpf.TaskbarNotification.BalloonIcon.Info));
                await Server.StopServer();
                await Task.Delay(500);
                Server.ManualStop = false;
                await Server.StartServer();
                await Task.Delay(1000);
                var status = Server.CurrentStatus;
                _trayIcon?.Dispatcher.Invoke(() =>
                    _trayIcon.ShowBalloonTip("DSH 服务",
                        status == DshServiceManager.Status.Running ? "服务就绪" : $"重启失败: {status}",
                        status == DshServiceManager.Status.Running
                            ? Hardcodet.Wpf.TaskbarNotification.BalloonIcon.Info
                            : Hardcodet.Wpf.TaskbarNotification.BalloonIcon.Error));
            });
        });
        System.Windows.Controls.MenuItem autoStartItem = null!;
        autoStartItem = AddItem("开机自启", () =>
        {
            Settings.AutoStart = !Settings.AutoStart;
            Settings.Save();
            SetAutoStart(Settings.AutoStart);
            autoStartItem.IsChecked = Settings.AutoStart;
            _trayIcon.ShowBalloonTip("开机自启", Settings.AutoStart ? "已启用" : "已禁用", Hardcodet.Wpf.TaskbarNotification.BalloonIcon.Info);
        });
        autoStartItem.IsChecked = Settings.AutoStart;
        AddSeparator();
        AddItem("启动安全模式", () => _ = Recovery.EnterSafeMode());
        AddItem("恢复正常模式", () => Recovery.ClearSafeMode());
        AddSeparator();
        var crashStatusItem = new System.Windows.Controls.MenuItem
        {
            Header = "防护状态: 正常",
            IsEnabled = false
        };
        menu.Items.Add(crashStatusItem);
        _crashStatusItem = crashStatusItem;
        AddItem("查看崩溃详情", () =>
        {
            var detail = $"连续崩溃: {Recovery.Consecutive} 次\n" +
                         $"近60秒: {Recovery.Recent60} 次\n" +
                         $"最近原因: {Recovery.LastCause ?? "无"}\n" +
                         $"熔断器: {(Recovery.BreakerOpen ? "已断开" : "正常")}\n" +
                         $"安全模式: {(Recovery.SafeModeActive ? "已激活" : "未激活")}";
            _trayIcon?.ShowBalloonTip("DSH 防护状态", detail, Hardcodet.Wpf.TaskbarNotification.BalloonIcon.Info);
        });
        AddSeparator();
        AddItem("清理 WebView2 缓存", () =>
        {
            _ = _mainWindow?.ClearCache();
            _trayIcon?.ShowBalloonTip("缓存", "WebView2 缓存已清理", Hardcodet.Wpf.TaskbarNotification.BalloonIcon.Info);
        });
        AddItem("查看日志", () =>
        {
            var viewer = new LogViewer();
            viewer.Show();
        });
        AddSeparator();
        AddItem("退出", () =>
        {
            if (_mainWindow != null) _mainWindow.ForceQuit = true;
            if (!Settings.KeepServerOnQuit) _ = Server.StopServer();
            _trayIcon?.Dispose();
            Shutdown();
        });

        _trayIcon.ContextMenu = menu;

        // 双击托盘显示窗口
        _trayIcon.DoubleClickCommand = new RelayCommand(() => ShowWindow());
    }

    private void UpdateCrashStatus()
    {
        if (_crashStatusItem == null) return;
        var parts = new List<string>();
        if (Recovery.SafeModeActive) parts.Add("安全模式");
        else if (Recovery.BreakerOpen) parts.Add("熔断已断开");
        else if (Recovery.Consecutive > 0) parts.Add($"崩溃 {Recovery.Consecutive} 次");
        else parts.Add("正常");
        _crashStatusItem.Header = $"防护状态: {string.Join(" / ", parts)}";
    }

    private void ShowWindow()
    {
        if (_mainWindow == null) return;
        _mainWindow.Show();
        _mainWindow.WindowState = WindowState.Normal;
        _mainWindow.Activate();
    }

    private void SetAutoStart(bool enable)
    {
        try
        {
            using var key = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run", true);
            if (key == null) return;
            if (enable)
            {
                var exe = Process.GetCurrentProcess().MainModule?.FileName;
                if (exe != null) key.SetValue("DeepSeekHarnessDesktop", $"\"{exe}\"");
            }
            else
            {
                key.DeleteValue("DeepSeekHarnessDesktop", false);
            }
        }
        catch (Exception e) { Log.Error($"auto-start failed: {e.Message}"); }
    }

    private void OnExit(object? sender, ExitEventArgs e)
    {
        Log.Info("=== DeepSeek Harness Desktop (native) shutting down ===");
        ToolsServer?.Dispose();
        SkinWatcher?.Dispose();
        Recovery?.Dispose();
        Server?.Dispose();
        _trayIcon?.Dispose();
        _singleInstanceMutex?.ReleaseMutex();
        _singleInstanceMutex?.Dispose();
    }
}

/// <summary>简单的 WPF 命令实现（用于托盘双击）。</summary>
public class RelayCommand : System.Windows.Input.ICommand
{
    private readonly Action _execute;
    public event EventHandler? CanExecuteChanged { add { } remove { } }
    public RelayCommand(Action execute) => _execute = execute;
    public bool CanExecute(object? parameter) => true;
    public void Execute(object? parameter) => _execute();
}