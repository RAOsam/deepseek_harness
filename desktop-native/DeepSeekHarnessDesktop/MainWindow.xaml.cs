using System;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Input;
using DeepSeekHarnessDesktop.Services;

namespace DeepSeekHarnessDesktop;

public partial class MainWindow : Window
{
    private readonly DshServiceManager _server;
    private readonly CrashRecovery _recovery;
    private bool _navigated;
    /// <summary>设为 true 时关闭窗口将真正退出而不是最小化到托盘。</summary>
    public bool ForceQuit { get; set; }

    // 由 App 在创建后注入
    public MainWindow(DshServiceManager server, CrashRecovery recovery)
    {
        InitializeComponent();
        _server = server;
        _recovery = recovery;
        _server.StatusChanged += OnServerStatus;
        this.Closing += OnClosing;
        this.SourceInitialized += OnSourceInitialized;
    }

    private void OnSourceInitialized(object? sender, EventArgs e)
    {
        // 恢复窗口位置
        var app = (App)Application.Current;
        var s = app.Settings;
        if (s.WindowX.HasValue && s.WindowY.HasValue)
        {
            this.Left = s.WindowX.Value;
            this.Top = s.WindowY.Value;
        }
        if (s.WindowWidth.HasValue && s.WindowHeight.HasValue)
        {
            this.Width = s.WindowWidth.Value;
            this.Height = s.WindowHeight.Value;
        }
        if (s.WindowMaximized)
            this.WindowState = WindowState.Maximized;
    }

    private void SaveWindowPosition()
    {
        var app = (App)Application.Current;
        var s = app.Settings;
        if (this.WindowState == WindowState.Maximized)
        {
            s.WindowMaximized = true;
        }
        else
        {
            s.WindowMaximized = false;
            s.WindowX = this.Left;
            s.WindowY = this.Top;
            s.WindowWidth = this.Width;
            s.WindowHeight = this.Height;
        }
        s.Save();
    }

    private void OnServerStatus(DshServiceManager.Status status, string detail)
    {
        Dispatcher.Invoke(() =>
        {
            switch (status)
            {
                case DshServiceManager.Status.Running:
                    LoadingOverlay.Visibility = Visibility.Collapsed;
                    NavigateToService();
                    break;
                case DshServiceManager.Status.Starting:
                    LoadingOverlay.Visibility = Visibility.Visible;
                    break;
                case DshServiceManager.Status.Error:
                    LoadingOverlay.Visibility = Visibility.Collapsed;
                    MessageBox.Show($"DSH 服务启动失败：{detail}",
                        "启动错误", MessageBoxButton.OK, MessageBoxImage.Error);
                    break;
                case DshServiceManager.Status.Stopped:
                    LoadingOverlay.Visibility = Visibility.Visible;
                    break;
            }
            // 广播服务状态到页面
            BroadcastServerStatus(status, detail);
        });
    }

    /// <summary>向 WebView2 页面广播服务状态变化（对应 Electron 的 dsh:server-status IPC）。</summary>
    private void BroadcastServerStatus(DshServiceManager.Status status, string detail)
    {
        if (Browser.CoreWebView2 == null) return;
        try
        {
            var payload = new
            {
                status = status.ToString().ToLower(),
                detail,
                running = status == DshServiceManager.Status.Running
            };
            var js = $"window.dispatchEvent(new CustomEvent('dsh:server-status', {{ detail: {System.Text.Json.JsonSerializer.Serialize(payload)} }}));";
            _ = Browser.CoreWebView2.ExecuteScriptAsync(js);
        }
        catch { /* best-effort */ }
    }

    private void NavigateToService()
    {
        if (_navigated) return;
        _navigated = true;
        try
        {
            Browser.Source = new Uri($"http://{_server.Host}:{_server.TargetPort}/");
        }
        catch (Exception e)
        {
            Log.Error($"navigate failed: {e.Message}");
        }
    }

    private void OnNavigationStarting(object? sender, Microsoft.Web.WebView2.Core.CoreWebView2NavigationStartingEventArgs e)
    {
        // 允许导航到本地服务、about: 页面和 WebSocket 升级
        if (e.Uri.StartsWith($"http://{_server.Host}:{_server.TargetPort}")
            || e.Uri.StartsWith("about:")
            || e.Uri.StartsWith("ws://")
            || e.Uri.StartsWith("wss:"))
        {
            return;
        }
        e.Cancel = true;
        Log.Info($"[webview] blocked navigation to {e.Uri}");
    }

    private void OnNavigationCompleted(object? sender, Microsoft.Web.WebView2.Core.CoreWebView2NavigationCompletedEventArgs e)
    {
        if (e.IsSuccess)
        {
            LoadingOverlay.Visibility = Visibility.Collapsed;
        }
    }

    private void OnCoreWebView2Init(object? sender, EventArgs e)
    {
        Browser.CoreWebView2.Settings.IsScriptEnabled = true;
        Browser.CoreWebView2.Settings.AreDefaultScriptDialogsEnabled = true;
        Browser.CoreWebView2.Settings.IsWebMessageEnabled = true;
        Browser.CoreWebView2.Settings.AreDevToolsEnabled = true;
        Browser.CoreWebView2.WebMessageReceived += (s, args) =>
        {
            var msg = args.TryGetWebMessageAsString();
            if (!string.IsNullOrEmpty(msg) && msg.Contains("[dsh-diag]"))
            {
                Log.Info(msg);
            }
        };
        // 注入 window.dshDesktop 桥（对应 Electron 版 preload.js）
        InjectDSHBridge();
    }

    /// <summary>注入 window.dshDesktop 桥，使 DSH 页面可以与桌面壳通信。</summary>
    private void InjectDSHBridge()
    {
        var bridgeJs = @"
(function() {
  if (window.__dshBridgeInjected) return;
  window.__dshBridgeInjected = true;
  var BASE = 'http://127.0.0.1:3090';
  var statusListeners = [];
  var skinListeners = [];
  window.dshDesktop = {
    getInfo: function() {
      return fetch(BASE + '/info', { cache: 'no-store' }).then(function(r) { return r.json(); });
    },
    retryStart: function() {
      return fetch(BASE + '/restart', { method: 'POST', cache: 'no-store' }).then(function(r) { return r.json(); });
    },
    restartService: function() {
      return fetch(BASE + '/restart', { cache: 'no-store' }).then(function(r) { return r.json(); });
    },
    logError: function(msg) {
      console.error('[dshDesktop]', msg);
      var img = new Image();
      img.src = BASE + '/dom?q=' + encodeURIComponent('console.error(' + JSON.stringify(String(msg).slice(0,500)) + ')');
    },
    sessionBackup: function() {
      return fetch(BASE + '/backup', { cache: 'no-store' }).then(function(r) { return r.json(); });
    },
    sessionRollback: function() {
      return fetch(BASE + '/rollback', { cache: 'no-store' }).then(function(r) { return r.json(); });
    },
    sessionRestore: function() {
      return fetch(BASE + '/restore', { cache: 'no-store' }).then(function(r) { return r.json(); });
    },
    onServerStatus: function(callback) {
      statusListeners.push(callback);
      return function() {
        var idx = statusListeners.indexOf(callback);
        if (idx >= 0) statusListeners.splice(idx, 1);
      };
    },
    onSkinInfo: function(callback) {
      skinListeners.push(callback);
      // 立即通知当前皮肤
      var el = document.querySelector('[data-active-skin]');
      if (el) callback({ id: el.getAttribute('data-active-skin') });
      return function() {
        var idx = skinListeners.indexOf(callback);
        if (idx >= 0) skinListeners.splice(idx, 1);
      };
    },
    getSkinInfo: function() {
      return Promise.resolve({ id: (document.querySelector('[data-active-skin]') || {}).getAttribute('data-active-skin') || null });
    }
  };
  // 监听 native shell 广播的 CustomEvent
  window.addEventListener('dsh:server-status', function(e) {
    statusListeners.forEach(function(fn) { try { fn(e.detail); } catch(ex) {} });
  });
  window.addEventListener('skin-changed', function(e) {
    skinListeners.forEach(function(fn) { try { fn({ id: e.detail }); } catch(ex) {} });
  });
  // WebSocket 诊断 - 测试 WebView2 能否建立 WebSocket 连接
  setTimeout(function() {
    var wsUrl = 'ws://127.0.0.1:3080/api/events.host';
    var log = function(msg) {
      console.log('[dsh-diag] ' + msg);
      try { window.chrome.webview.postMessage('[dsh-diag] ' + msg); } catch(e) {}
    };
    try {
      var ws = new WebSocket(wsUrl);
      var timeout = setTimeout(function() {
        log('WS TIMEOUT');
        ws.close();
      }, 3000);
      ws.addEventListener('open', function() {
        clearTimeout(timeout);
        log('WS OPEN: ' + wsUrl);
        ws.close();
      });
      ws.addEventListener('message', function(ev) {
        log('WS MSG: ' + String(ev.data).substring(0, 200));
      });
      ws.addEventListener('error', function(ev) {
        clearTimeout(timeout);
        log('WS ERROR');
      });
      ws.addEventListener('close', function(ev) {
        clearTimeout(timeout);
        log('WS CLOSED code=' + ev.code + ' reason=' + ev.reason);
      });
    } catch(err) {
      log('WS EXCEPTION: ' + err.message);
    }
  }, 2000);
})();";
        Browser.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(bridgeJs);
    }

    /// <summary>通过 WebView2 向 DSH 页面广播皮肤变化（触发 custom event 'skin-changed'）。</summary>
    public void BroadcastSkin(string skinId)
    {
        Dispatcher.Invoke(() =>
        {
            if (Browser.CoreWebView2 == null) return;
            try
            {
                var js = $"window.dispatchEvent(new CustomEvent('skin-changed', {{ detail: '{skinId}' }}));";
                _ = Browser.CoreWebView2.ExecuteScriptAsync(js);
                Log.Info($"[skin] broadcast to page: {skinId}");
            }
            catch (Exception e)
            {
                Log.Warn($"[skin] broadcast failed: {e.Message}");
            }
        });
    }

    private void OnClosing(object? sender, System.ComponentModel.CancelEventArgs e)
    {
        var app = (App)Application.Current;
        // 保存窗口位置
        SaveWindowPosition();
        // ForceQuit 由托盘"退出"菜单设置，或按住 Shift 关闭
        if (ForceQuit || (Keyboard.Modifiers & ModifierKeys.Shift) == ModifierKeys.Shift)
        {
            // 真正退出
            if (!app.Settings.KeepServerOnQuit)
            {
                _ = _server.StopServer();
            }
            return;
        }
        // 关闭窗口时始终隐藏到托盘（不退出程序）
        e.Cancel = true;
        this.Hide();
    }

    /// <summary>清理 WebView2 缓存目录。</summary>
    public async Task ClearCache()
    {
        if (Browser.CoreWebView2 == null) return;
        try
        {
            // 清除浏览器内存缓存（DevTools 协议）
            await Browser.CoreWebView2.CallDevToolsProtocolMethodAsync("Network.clearBrowserCache", "{}");
            // 删除缓存目录
            var folder = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            var cacheDir = System.IO.Path.Combine(folder, "DeepSeekHarnessDesktop", "WebView2Cache");
            if (System.IO.Directory.Exists(cacheDir))
            {
                System.IO.Directory.Delete(cacheDir, true);
                Log.Info("[cache] WebView2 cache directory cleared");
            }
            Log.Info("[cache] WebView2 cache cleared");
        }
        catch (Exception e) { Log.Warn($"[cache] clear failed: {e.Message}"); }
    }
}