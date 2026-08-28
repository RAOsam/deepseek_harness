using System;
using System.IO;

namespace DeepSeekHarnessDesktop.Services;

/// <summary>日志：控制台 + userData/logs/main.log（与 Electron 版同格式）。</summary>
public static class Log
{
    private static readonly object Lock = new();
    private static StreamWriter? _stream;
    private static string? _logDir;

    public static void Init(string userDataDir)
    {
        _logDir = Path.Combine(userDataDir, "logs");
        Directory.CreateDirectory(_logDir);
    }

    public static string LogDir => _logDir ?? AppContext.BaseDirectory;

    public static string LogFilePath => Path.Combine(LogDir, "main.log");

    public static void Info(string msg) => Write("", msg);
    public static void Warn(string msg) => Write("WARN", msg);
    public static void Error(string msg) => Write("ERR", msg);

    private static void Write(string level, string msg)
    {
        var line = $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss}] {msg}";
        try
        {
            lock (Lock)
            {
                Console.WriteLine(line);
                if (_stream == null && _logDir != null)
                {
                    _stream = new StreamWriter(LogFilePath, append: true) { AutoFlush = true };
                }
                _stream?.WriteLine(line);
            }
        }
        catch { /* logging must never crash the app */ }
    }
}