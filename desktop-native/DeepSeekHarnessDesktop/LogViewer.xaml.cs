using System;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Threading;
using DeepSeekHarnessDesktop.Services;

namespace DeepSeekHarnessDesktop;

public partial class LogViewer : Window
{
    private readonly string _logFile;
    private readonly DispatcherTimer _timer = new();
    private long _lastLength;
    private bool _autoScroll = true;

    public LogViewer()
    {
        InitializeComponent();
        _logFile = Log.LogFilePath;
        _timer.Interval = TimeSpan.FromSeconds(2);
        _timer.Tick += OnTimerTick;
        this.Closed += (_, _) => { _timer.Stop(); };
        // 初始加载
        _ = LoadLog();
        _timer.Start();
    }

    private async void OnTimerTick(object? sender, EventArgs e)
    {
        await LoadLog();
    }

    private Task LoadLog()
    {
        try
        {
            if (!File.Exists(_logFile))
            {
                LogContent.Text = "日志文件不存在，等待创建…";
                return Task.CompletedTask;
            }

            var fi = new FileInfo(_logFile);
            if (fi.Length == _lastLength) return Task.CompletedTask; // 没有新内容

            // 限制读取大小，避免卡 UI
            var maxRead = 1024 * 512; // 512KB
            using var fs = new FileStream(_logFile, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
            if (fs.Length > maxRead)
            {
                // 只读尾部
                fs.Seek(-maxRead, SeekOrigin.End);
                // 跳到换行开头
                var pos = fs.Position;
                var reader = new StreamReader(fs);
                reader.ReadLine(); // 跳过可能不完整的行
                var remaining = reader.ReadToEnd();
                var lines = remaining.Split('\n');
                var tail = lines.Length > 5000
                    ? string.Join("\n", lines, lines.Length - 5000, 5000)
                    : remaining;
                LogContent.Text = $"[仅显示尾部 {tail.Length} 字节]\n\n{tail}";
            }
            else
            {
                fs.Seek(0, SeekOrigin.Begin);
                using var reader = new StreamReader(fs);
                LogContent.Text = reader.ReadToEnd();
            }

            _lastLength = fi.Length;
            StatusInfo.Content = $"日志文件：{_logFile}  ({fi.Length / 1024} KB)";

            if (_autoScroll)
            {
                LogContent.ScrollToEnd();
            }
        }
        catch (Exception ex)
        {
            StatusInfo.Content = $"读取日志失败：{ex.Message}";
        }
        return Task.CompletedTask;
    }

    private void OnRefresh(object sender, RoutedEventArgs e)
    {
        _lastLength = 0; // 强制重新读取
        _ = LoadLog();
    }

    private void OnToggleAutoScroll(object sender, RoutedEventArgs e)
    {
        _autoScroll = !_autoScroll;
        BtnAutoScroll.Content = _autoScroll ? "自动滚动" : "手动滚动";
        if (_autoScroll) LogContent.ScrollToEnd();
    }

    protected override void OnClosed(EventArgs e)
    {
        _timer.Stop();
        base.OnClosed(e);
    }
}