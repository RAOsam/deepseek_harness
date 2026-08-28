using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;

namespace DeepSeekHarnessDesktop.Services;

/// <summary>会话备份（对应 Electron 版 backupSession/restoreSession/rollbackSession/findSessionFile）。</summary>
public class SessionBackup
{
    private readonly string _backupDir;
    private readonly string? _profileDir;

    public SessionBackup(string userDataDir, string? profileDir)
    {
        _backupDir = Path.Combine(userDataDir, "session-backups");
        _profileDir = profileDir;
        Directory.CreateDirectory(_backupDir);
    }

    public string? FindSessionFile()
    {
        if (_profileDir == null) return null;
        var candidates = new[] { "session.jsonl.zstd", "session.jsonl", "session.json" };
        foreach (var c in candidates)
        {
            var f = Path.Combine(_profileDir, c);
            if (File.Exists(f)) return f;
        }
        return null;
    }

    public Task<string> Backup()
    {
        var src = FindSessionFile();
        if (src == null) return Task.FromResult("{\"ok\":false,\"error\":\"无会话文件\"}");
        var ts = DateTime.Now.ToString("yyyyMMdd-HHmmss");
        var dst = Path.Combine(_backupDir, $"session-{ts}.zstd");
        try
        {
            File.Copy(src, dst, overwrite: true);
            var existing = Directory.GetFiles(_backupDir, "session-*.zstd")
                .OrderByDescending(f => f).ToList();
            if (existing.Count > 24)
            {
                foreach (var old in existing.Skip(24))
                {
                    try { File.Delete(old); } catch { }
                }
            }
            return Task.FromResult(JsonSerializer.Serialize(new { ok = true, file = dst, count = existing.Count + 1 }));
        }
        catch (Exception e)
        {
            return Task.FromResult(JsonSerializer.Serialize(new { ok = false, error = e.Message }));
        }
    }

    public Task<string> Restore()
    {
        var backups = Directory.GetFiles(_backupDir, "session-*.zstd")
            .OrderByDescending(f => f).ToList();
        if (backups.Count == 0) return Task.FromResult("{\"ok\":false,\"error\":\"无备份可恢复\"}");
        var src = backups[0];
        var dst = FindSessionFile();
        if (dst == null) return Task.FromResult("{\"ok\":false,\"error\":\"无法定位会话文件\"}");
        try
        {
            var currentBak = dst + ".bak";
            if (File.Exists(dst)) File.Copy(dst, currentBak, overwrite: true);
            File.Copy(src, dst, overwrite: true);
            return Task.FromResult(JsonSerializer.Serialize(new { ok = true, file = src, restored = Path.GetFileName(src) }));
        }
        catch (Exception e)
        {
            return Task.FromResult(JsonSerializer.Serialize(new { ok = false, error = e.Message }));
        }
    }

    public Task<string> Rollback()
    {
        var dst = FindSessionFile();
        if (dst == null) return Task.FromResult("{\"ok\":false,\"error\":\"无会话文件\"}");
        var bak = dst + ".bak";
        if (!File.Exists(bak)) return Task.FromResult("{\"ok\":false,\"error\":\"无回滚备份(.bak)\"}");
        try
        {
            File.Copy(bak, dst, overwrite: true);
            File.Delete(bak);
            return Task.FromResult(JsonSerializer.Serialize(new { ok = true, message = "回滚成功" }));
        }
        catch (Exception e)
        {
            return Task.FromResult(JsonSerializer.Serialize(new { ok = false, error = e.Message }));
        }
    }
}