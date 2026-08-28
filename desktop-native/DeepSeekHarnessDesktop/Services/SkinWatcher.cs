using System;
using System.IO;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;

namespace DeepSeekHarnessDesktop.Services;

/// <summary>皮肤感知轮询（对应 Electron 版 pollSkin/activeSkinFromPatch/broadcastSkin）。</summary>
public class SkinWatcher : IDisposable
{
    private readonly string? _patchFile;
    private CancellationTokenSource? _cts;
    private string _lastSkin = "";
    public string CurrentSkin => _lastSkin;
    public event Action<string>? SkinChanged;
    private bool _disposed;

    public SkinWatcher(string? profileDir)
    {
        _patchFile = profileDir != null ? Path.Combine(profileDir, "cordis.patch.yml") : null;
    }

    public void Start()
    {
        _cts = new CancellationTokenSource();
        var ct = _cts.Token;
        _ = Task.Run(async () =>
        {
            while (!ct.IsCancellationRequested)
            {
                try
                {
                    await Task.Delay(8000, ct);
                    if (ct.IsCancellationRequested) break;
                    var skin = ActiveSkinFromPatch();
                    if (skin != _lastSkin)
                    {
                        _lastSkin = skin;
                        Log.Info($"[skin] detected: {skin}");
                        SkinChanged?.Invoke(skin);
                    }
                }
                catch (TaskCanceledException) { break; }
                catch (Exception e) { Log.Error($"[skin] poll error: {e.Message}"); }
            }
        }, ct);
    }

    /// <summary>从 cordis.patch.yml 中解析激活的皮肤（已启用且非 disabled）。</summary>
    public string ActiveSkinFromPatch()
    {
        if (_patchFile == null || !File.Exists(_patchFile)) return "";
        try
        {
            var content = File.ReadAllText(_patchFile);
            // 找到 ui-skin- 开头的行，且其 insert 块内无 disabled: true
            var lines = content.Split('\n');
            for (var i = 0; i < lines.Length; i++)
            {
                var trimmed = lines[i].Trim();
                if (trimmed == "- insert:")
                {
                    // 收集块内 id 和 disabled
                    string? id = null;
                    var disabled = false;
                    var j = i + 1;
                    while (j < lines.Length && lines[j].StartsWith(" ") && !lines[j].Trim().StartsWith("- insert:"))
                    {
                        var m = Regex.Match(lines[j].Trim(), @"^-\s+id:\s+(.+)$");
                        if (m.Success) id = m.Groups[1].Value.Trim();
                        if (Regex.IsMatch(lines[j].Trim(), @"^disabled:\s*true\s*$")) disabled = true;
                        j++;
                    }
                    if (id != null && id.StartsWith("ui-skin-") && !disabled)
                        return id;
                    i = j - 1;
                }
            }
        }
        catch { }
        return "";
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _cts?.Cancel();
        _cts?.Dispose();
    }
}