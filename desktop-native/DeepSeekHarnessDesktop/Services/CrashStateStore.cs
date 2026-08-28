using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;

namespace DeepSeekHarnessDesktop.Services;

public class CrashRecord
{
    public string At { get; set; } = "";
    public string Cause { get; set; } = "";
    public int Consecutive { get; set; }
}

/// <summary>crash-state.json 持久化（对应 Electron 版 loadCrashState/saveCrashState）。</summary>
public class CrashStateStore
{
    private readonly string _file;

    public CrashStateStore(string dshHome)
    {
        _file = Path.Combine(dshHome, "crash-state.json");
    }

    public List<CrashRecord> Crashes { get; private set; } = new();
    public bool SafeMode { get; set; } = false;

    public void Load()
    {
        try
        {
            if (File.Exists(_file))
            {
                using var doc = JsonDocument.Parse(File.ReadAllText(_file));
                var root = doc.RootElement;
                SafeMode = root.TryGetProperty("safeMode", out var sm) && sm.GetBoolean();
                if (root.TryGetProperty("crashes", out var arr))
                {
                    Crashes = arr.EnumerateArray().Select(e => new CrashRecord
                    {
                        At = e.TryGetProperty("at", out var at) ? at.GetString() ?? "" : "",
                        Cause = e.TryGetProperty("cause", out var c) ? c.GetString() ?? "" : "",
                        Consecutive = e.TryGetProperty("consecutive", out var cc) ? cc.GetInt32() : 0,
                    }).ToList();
                }
            }
        }
        catch (Exception e)
        {
            Log.Error($"load crash-state failed: {e.Message}");
        }
    }

    public void Save(bool safeMode, IEnumerable<CrashRecord> crashes)
    {
        SafeMode = safeMode;
        Crashes = crashes is List<CrashRecord> l ? l : crashes.ToList();
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(_file)!);
            var payload = JsonSerializer.Serialize(new { crashes = Crashes, safeMode });
            File.WriteAllText(_file, payload);
        }
        catch (Exception e)
        {
            Log.Error($"save crash-state failed: {e.Message}");
        }
    }
}