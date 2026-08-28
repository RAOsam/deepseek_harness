using System;
using System.Collections.Generic;

namespace DeepSeekHarnessDesktop.Services;

/// <summary>熔断器（Hystrix 风格）：CLOSED → OPEN → HALF_OPEN，滑动窗口统计。对应 Electron 版 createCircuitBreaker。</summary>
public class CircuitBreaker
{
    private readonly string _name;
    private readonly double _failThreshold;
    private readonly int _requestThreshold;
    private readonly long _openMs;
    private readonly long _windowMs;
    private readonly List<(long Ts, bool Ok)> _results = new();
    private string _status = "CLOSED";
    private long _openedAt;

    public CircuitBreaker(string name, double failThreshold = 0.5, int requestThreshold = 5, long openMs = 15_000, long windowMs = 60_000)
    {
        _name = name;
        _failThreshold = failThreshold;
        _requestThreshold = requestThreshold;
        _openMs = openMs;
        _windowMs = windowMs;
    }

    public string Status => _status;

    public bool Allow()
    {
        if (_status == "OPEN")
        {
            var now = Now();
            if (now - _openedAt >= _openMs)
            {
                _status = "HALF_OPEN";
                return true;
            }
            return false;
        }
        return true;
    }

    public void Record(bool ok)
    {
        var now = Now();
        if (_status == "HALF_OPEN")
        {
            _status = ok ? "CLOSED" : "OPEN";
            _openedAt = now;
            _results.Clear();
            Log.Info($"[breaker] {_name} {(ok ? "CLOSED" : "OPEN (half-open probe failed)")}");
            return;
        }
        Slide(now);
        _results.Add((now, ok));
        var total = _results.Count;
        if (total >= _requestThreshold)
        {
            var fails = 0;
            foreach (var (_, rOk) in _results) if (!rOk) fails++;
            if ((double)fails / total >= _failThreshold)
            {
                _status = "OPEN";
                _openedAt = now;
                _results.Clear();
                Log.Info($"[breaker] {_name} -> OPEN (fail={fails}/{total})");
            }
        }
    }

    public void Reset() { _status = "CLOSED"; _results.Clear(); }

    private void Slide(long now) => _results.RemoveAll(r => now - r.Ts > _windowMs);

    private static long Now() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
}

/// <summary>滑动窗口限流器（对应 Electron 版 createRateLimiter）。</summary>
public class RateLimiter
{
    private readonly int _maxPerWindow;
    private readonly long _windowMs;
    private readonly List<long> _hits = new();

    public RateLimiter(int maxPerWindow, long windowMs)
    {
        _maxPerWindow = maxPerWindow;
        _windowMs = windowMs;
    }

    public (bool Ok, string? Reason) Allow()
    {
        var now = Now();
        _hits.RemoveAll(h => now - h > _windowMs);
        if (_hits.Count >= _maxPerWindow)
        {
            return (false, "操作过于频繁，请稍后再试");
        }
        _hits.Add(now);
        return (true, null);
    }

    private static long Now() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
}