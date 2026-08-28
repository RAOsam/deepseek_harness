using System;
using System.IO;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace DeepSeekHarnessDesktop.Services;

/// <summary>应用设置（settings.json），对应 Electron 版 DEFAULTS/loadSettings/saveSettings。</summary>
public class AppSettings
{
    public string Host { get; set; } = "127.0.0.1";
    public int Port { get; set; } = 3080;
    public bool StartServerOnLaunch { get; set; } = true;
    public bool MinimizeToTray { get; set; } = false;
    public bool KeepServerOnQuit { get; set; } = true;
    public bool AutoStart { get; set; } = false;
    public string NodePath { get; set; } = "";
    public string DshCliPath { get; set; } = "";
    public string WorkspaceDir { get; set; } = "";
    public int DebugPort { get; set; } = 0;

    // 窗口位置记忆
    public double? WindowX { get; set; }
    public double? WindowY { get; set; }
    public double? WindowWidth { get; set; }
    public double? WindowHeight { get; set; }
    public bool WindowMaximized { get; set; }

    [JsonIgnore] public string? SettingsFile { get; private set; }

    public static AppSettings Load(string userDataDir)
    {
        var file = Path.Combine(userDataDir, "settings.json");
        var settings = new AppSettings { SettingsFile = file };
        try
        {
            if (File.Exists(file))
            {
                var raw = JsonSerializer.Deserialize<AppSettings>(File.ReadAllText(file));
                if (raw != null)
                {
                    raw.SettingsFile = file;
                    settings = raw;
                }
            }
        }
        catch (Exception e)
        {
            Log.Error($"load settings failed: {e.Message}");
        }
        return settings;
    }

    public void Save()
    {
        try
        {
            if (SettingsFile != null)
            {
                Directory.CreateDirectory(Path.GetDirectoryName(SettingsFile)!);
                var clone = (AppSettings)MemberwiseClone();
                clone.SettingsFile = null;
                File.WriteAllText(SettingsFile, JsonSerializer.Serialize(clone, new JsonSerializerOptions { WriteIndented = true }));
            }
        }
        catch (Exception e)
        {
            Log.Error($"save settings failed: {e.Message}");
        }
    }
}