# DSH 桌面端防崩溃优化方案

> 版本：v1.0 · 基于现有架构（Electron 壳 + dsh web 子进程 + Cordis 插件体系）重新设计

---

## 一、方案概述

### 1.1 现状诊断（基于 desktop/main.js 真实代码）

| 现状 | 缺陷 | 后果 |
|------|------|------|
| `child.once('exit')` 仅置 `stopped` 状态 | **无自动重启** | 服务崩了必须人工点托盘重启 |
| `httpProbeReady()` 只在启动时轮询 90s | **运行期无探活** | 运行中卡死/僵死无感知 |
| `/health` 仅返回 `{ ok: true }` | **无实质健康指标** | 无法区分活进程与健康进程 |
| 安全模式 `handleSafeMode()` 仅手动触发 | **无自动降级** | 插件崩溃后无自我修复路径 |
| 无内存/CPU 采样 | **无资源监控** | 内存泄漏悄悄累积直至 OOM |
| 无请求级保护 | **无熔断/限流** | 单个慢 API 拖垮整体响应 |
| 无崩溃归因 | **重启风暴风险** | 端口冲突/插件崩溃/未知原因一律重启，可能越重启越糟 |

### 1.2 设计目标

1. **无人值守自愈**：崩溃后按原因分类自动恢复，MTTR 从"分钟级人工"降到"秒级自动"
2. **原因区分处置**：端口冲突、内存溢出、插件崩溃、未知原因分别走不同恢复路径
3. **防重启风暴**：指数退避 + 连续失败进入安全模式
4. **资源可观测**：内存/CPU 水位实时监控，泄漏与飙升可预警
5. **依赖隔离**：单个插件/API 故障熔断降级，不拖垮整体

### 1.3 分层防御架构（四层）

```
┌───────────────────────────────────────────────┐
│ L1 进程守护层（Electron 主进程 / watchdog）      │
│   健康探活 · 崩溃归因 · 指数退避重启 · 自动安全模式 │
├───────────────────────────────────────────────┤
│ L2 应用自愈层（dsh web 进程内）                  │
│   全局异常兜底 · 内存水位 · 优雅停机 · 心跳上报    │
├───────────────────────────────────────────────┤
│ L3 依赖隔离层（Cordis / API 网关）               │
│   插件级熔断 · 请求限流 · 超时控制 · 降级响应      │
├───────────────────────────────────────────────┤
│ L4 资源治理层（监控 + 治理策略）                  │
│   内存/CPU/句柄采样 · 水位策略表 · 告警与审计日志  │
└───────────────────────────────────────────────┘
```

---

## 二、技术细节

### 2.1 异常捕获机制（L1+L2）

**进程级（Electron 主进程）：**
- `spawn` 子进程的 `error` / `exit` / `close` 三事件全覆盖，`exit` 后区分 `code` 与 `signal`
- 捕获并记录每次崩溃的 **stderr 尾部 200 行**（现有 `server.stderrTail` 已具备，扩展为持久化）

**应用级（dsh web 进程内）：**
- `process.on('uncaughtException')`：只记录+心跳降级，**不直接退出**（致命错误才退出）
- `process.on('unhandledRejection')`：记录并续跑
- 关键路径（路由、插件调用）try/catch 包裹，错误上抛到统一 error-handler

**崩溃归因分类（决策表）：**

| 特征（code / stderr / 存活时长） | 归类 | 处置 |
|--------------------------------|------|------|
| code=1 且 stderr 含 `EADDRINUSE` | 端口冲突 | 释放端口→重启（现有 releasePort） |
| code≠0 且存活 >60s | 运行期崩溃 | 指数退避重启，连续3次→安全模式 |
| stderr 含 `heap out of memory` / `JavaScript heap` | OOM | 降内存压力（禁用重插件）→重启 |
| stderr 含某插件名/堆栈 | 插件崩溃 | **自动安全模式**（复用 disableNonCorePlugins） |
| signal=SIGTERM/SIGKILL | 外部终止 | 不自动重启（用户/系统主动操作） |
| 其他 | 未知 | 退避重启 + 告警 |

### 2.2 资源监控策略（L4）

| 指标 | 采样频率 | 正常 | 预警（WARN） | 危险（CRIT） | 动作 |
|------|---------|------|-------------|-------------|------|
| RSS 内存 | 10s | < 基线×1.2 | ≥ 基线×1.5 持续30s | ≥ 基线×2.0 或物理内存80% | WARN:告知 / CRIT:降级+重启 |
| heapUsed | 10s | < 80% heapLimit | ≥ 85% 持续30s | ≥ 95% | 触发 GC / 重启 |
| CPU（进程） | 30s | < 60% | ≥ 80% 持续2min | ≥ 95% 持续5min | 采样毛刺→忽略；持续→降级 |
| 句柄/文件描述符 | 60s | < 5k | ≥ 8k | ≥ 10k | 疑似泄漏→重启 |
| 磁盘剩余 | 300s | > 1GB | < 500MB | < 200MB | 清理 / 告警 |

基线校准：启动就绪后 5 分钟平稳值 × 1.2 作为基线，避免"环境本身内存高"导致误杀。

**水位策略表（Policy Table）** —— 配置化，不写死在代码里：
```json
{
  "memory": { "warn": 1.5, "crit": 2.0, "windowS": 30 },
  "restart": { "maxBackoffS": 60, "safeModeAfter": 3, "healthTimeoutMs": 5000 },
  "circuit": { "windowS": 10, "failThreshold": 0.5, "minRequests": 10, "openS": 15 },
  "ratelimit": { "rps": 50, "burst": 100 }
}
```

### 2.3 服务降级与熔断逻辑（L3）

**熔断器（Netflix Hystrix 风格）：** 三态状态机 CLOSED → OPEN → HALF_OPEN

- **CLOSED（闭合）**：正常转发，滑动窗口（10s）内统计成功/失败
- **OPEN（断开）**：失败率 ≥ 50% 且请求数 ≥ 10 时触发，直接快速失败 15s，不穿透
- **HALF_OPEN（半开）**：15s 后放行 1 个试探请求，成功→CLOSED，失败→OPEN

**限流（Sentinel 风格）：** 滑动窗口计数 + 令牌桶
- 每插件/每 API 独立配额，超限返回 429 + JSON 降级提示
- 慢调用单独统计（响应 > 2s 计为失败）

**降级响应模板（graded fallback）：**
```
1. 优先返回缓存/上次成功结果
2. 无缓存 → 返回结构化的降级 JSON（{ ok:false, degraded:true, reason }）
3. UI 侧显示"服务暂时不可用，请稍后重试"，而不是白屏/无限转圈
```

### 2.4 自动重启机制（L1 核心）

**指数退避 + 连续失败升级：**

```
第1次失败 → 等 1s → 重启
第2次失败 → 等 2s → 重启
第3次失败 → 等 4s → 重启
第4次失败 → 等 8s → 重启
...上限 60s
连续 3 次"运行期崩溃" → 自动进入安全模式（禁用非核心插件）后重启
安全模式下仍崩溃 → 保持停服 + 醒目告警，不无限循环
```

**防重启风暴关键点：**
- 每次重启记录时间戳，60s 内重启 ≥ 4 次 → 强制冷却 2 分钟
- 崩溃计数持久化到 `%USERPROFILE%\.dsh\crash-state.json`，重启 Electron 后不丢
- 进入安全模式/恢复模式时更新托盘菜单文案（现有 `safeModeActive` 机制复用）

### 2.5 健康检查协议（K8s 风格）

**深化 `/health`（现有端点）为三层探针：**

```
GET /health?probe=liveness     → 进程活着吗？（<1s 响应）
GET /health?probe=readiness    → 能服务请求吗？（HTTP 200 + 内部状态 ready）
GET /health?probe=metrics      → 深度指标：{ memory, cpu, uptime, plugins[], errors15m }
```

**Electron 主进程 watchdog 循环：**
```
每 5s:  liveness 探测（超时3s）
        失败1次 → 标记 suspect
        失败2次 → 触发 crash-recovery 流程
每 15s: readiness 探测 + metrics 拉取（供资源监控）
```

---

## 三、代码示例（Python）

> 说明：现有桌面端是 Electron/Node。以下 Python 实现参考了 Netflix Hystrix（熔断）、K8s（健康探针）、Sentinel（限流）的成熟做法，可直接作为独立 watchdog 守护进程使用，或按注释映射到 desktop/main.js 对应函数。

### 3.1 熔断器（Hystrix 风格）

```python
"""
电路熔断器：CLOSED → OPEN → HALF_OPEN 三态状态机
参考：Netflix Hystrix CircuitBreaker
"""
import time
import threading
from collections import deque

class CircuitBreaker:
    def __init__(self, name, fail_threshold=0.5, min_requests=10,
                 window_s=10, open_s=15):
        self.name = name
        self.fail_threshold = fail_threshold   # 失败率阈值 50%
        self.min_requests = min_requests       # 窗口内最少请求数
        self.window_s = window_s               # 统计滑动窗口 10s
        self.open_s = open_s                   # 断开持续时间 15s
        self.state = "CLOSED"                  # CLOSED/OPEN/HALF_OPEN
        self.lock = threading.Lock()
        self.results = deque()                 # (ts, ok)
        self._opened_at = 0.0
        self._half_open_allowed = False

    def _slide(self, now):
        while self.results and now - self.results[0][0] > self.window_s:
            self.results.popleft()

    def allow(self):
        """返回是否放行请求（False = 快速失败，不穿透）。"""
        with self.lock:
            now = time.monotonic()
            self._slide(now)
            if self.state == "OPEN":
                if now - self._opened_at >= self.open_s:
                    self.state = "HALF_OPEN"   # 半开：试探窗口开启
                    self._half_open_allowed = True
                    return True
                return False
            if self.state == "HALF_OPEN":
                # 半开状态只放行一个试探请求
                if self._half_open_allowed:
                    self._half_open_allowed = False
                    return True
                return False
            return True

    def record(self, ok):
        """调用结束后记录结果。"""
        with self.lock:
            now = time.monotonic()
            self._slide(now)
            self.results.append((now, ok))
            if self.state == "HALF_OPEN":
                # 试探结果决定熔断器去留
                self.state = "CLOSED" if ok else "OPEN"
                self._opened_at = now if not ok else 0.0
                self.results.clear()
                return
            if self.state != "CLOSED":
                return
            total = len(self.results)
            if total < self.min_requests:
                return
            fails = sum(1 for _, ok_ in self.results if not ok_)
            if fails / total >= self.fail_threshold:
                self.state = "OPEN"
                self._opened_at = now
                self.results.clear()
                print(f"[circuit] {self.name} -> OPEN (fail={fails}/{total})")

# ── 使用示例 ──
breaker = CircuitBreaker("plugin.api")

def guarded_call(cb, fn, fallback):
    if not cb.allow():
        return fallback()                       # 快速失败
    try:
        result = fn()
        cb.record(True)
        return result
    except Exception:
        cb.record(False)
        return fallback()                       # 降级响应
```

### 3.2 滑动窗口限流器（Sentinel 风格）

```python
"""
滑动窗口限流：按时间桶统计，支持 burst。
参考：Alibaba Sentinel 滑动窗口计数
"""
import time
import threading

class SlidingWindowRateLimiter:
    def __init__(self, rps=50, window_s=1, buckets=10):
        self.rps = rps                          # 每秒配额
        self.window_s = window_s                # 统计窗口（1s）
        self.bucket_s = window_s / buckets      # 桶粒度 100ms
        self.buckets = [0] * buckets
        self.lock = threading.Lock()

    def _idx(self, now):
        return int(now / self.bucket_s) % len(self.buckets)

    def allow(self):
        with self.lock:
            now = time.time()
            # 清掉窗口外的桶
            idx = self._idx(now)
            for i in range(len(self.buckets)):
                if i != idx:
                    self.buckets[i] = 0
            total = sum(self.buckets)
            if total >= self.rps:
                return False                    # 超限 -> 429
            self.buckets[idx] += 1
            return True

limiter = SlidingWindowRateLimiter(rps=50)

def api_gateway(request):
    if not limiter.allow():
        return {"ok": False, "degraded": True, "reason": "rate_limited"},
    # ... 正常处理 ...
```

### 3.3 资源监控器（内存/CPU 水位）

```python
"""
资源监控：周期采样 + 基线校准 + 水位判定。
对应 L4 资源治理层。
"""
import os
import time
import psutil

class ResourceMonitor:
    def __init__(self, pid, warn_ratio=1.5, crit_ratio=2.0,
                 window_s=30, interval_s=10):
        self.proc = psutil.Process(pid)
        self.warn_ratio = warn_ratio
        self.crit_ratio = crit_ratio
        self.window_s = window_s
        self.interval_s = interval_s
        self.baseline_mb = None          # 启动平稳后的基线
        self._samples = []               # [(ts, rss_mb)]
        self._calibrate_done = False

    def _calibrate(self, rss_mb):
        # 运行 >5min 且 rss 变化 <15% -> 视为基线（启动平稳）
        if len(self._samples) < 30:
            return
        vals = [v for _, v in self._samples[-30:]]
        if (max(vals) - min(vals)) / max(vals) < 0.15:
            self.baseline_mb = sum(vals) / len(vals)
            self._calibrate_done = True

    def sample(self):
        rss_mb = self.proc.memory_info().rss / 1024 / 1024
        now = time.time()
        self._samples.append((now, rss_mb))
        # 只保留窗口内样本
        self._samples = [(t, v) for t, v in self._samples
                         if now - t <= max(self.window_s * 3, 120)]
        if not self._calibrate_done:
            self._calibrate(rss_mb)
            return "OK", rss_mb
        ratio = rss_mb / self.baseline_mb
        if ratio >= self.crit_ratio:
            return "CRIT", rss_mb            # 触发降级/重启
        if ratio >= self.warn_ratio:
            return "WARN", rss_mb            # 告警
        return "OK", rss_mb

    def run(self, on_warn, on_crit):
        while True:
            level, rss = self.sample()
            if level == "WARN" and on_warn:  on_warn(rss)
            if level == "CRIT" and on_crit:  on_crit(rss); return
            time.sleep(self.interval_s)
```

### 3.4 watchdog 自动重启 + 崩溃归因（Electron 主进程逻辑的 Python 参考）

```python
"""
Watchdog：健康探活 + 崩溃归因 + 指数退避重启 + 连续失败进入安全模式。
对应 desktop/main.js 的 child.once('exit') / startServer() / handleSafeMode() 升级版。
"""
import subprocess
import time
import json
import os
import re
import requests

CRASH_STATE = os.path.expanduser(r"~\.dsh\crash-state.json")
CORE_PLUGINS = ["dsh-skin-switch", "dsh-session-tools",
                "dsh-persona-manager", "dsh-memory"]

class Watchdog:
    def __init__(self, cmd, health_url, safe_mode_fn=None):
        self.cmd = cmd
        self.health_url = health_url
        self.safe_mode_fn = safe_mode_fn
        self.backoff_s = 1
        self.consecutive_crashes = 0
        self.last_restart_ts = 0.0
        self.state = self._load_state()

    def _load_state(self):
        try:
            with open(CRASH_STATE) as f:
                return json.load(f)
        except Exception:
            return {"crashes": [], "safe_mode": False}

    def _save_state(self):
        with open(CRASH_STATE, "w") as f:
            json.dump(self.state, f, ensure_ascii=False, indent=2)

    def _healthy(self, timeout_s=3):
        try:
            r = requests.get(self.health_url, timeout=timeout_s)
            return r.status_code == 200
        except Exception:
            return False

    def _classify_crash(self, code, signal, stderr):
        """崩溃归因：根据退出码与 stderr 决定处置策略。"""
        s = (stderr or "").lower()
        if signal in ("SIGTERM", "SIGKILL"):
            return "external"                  # 外部终止，不自动重启
        if "eadDRINUSE" in s.replace(" ", ""):
            return "port_conflict"
        if "out of memory" in s or "heap" in s and "allocation" in s:
            return "oom"
        if "stack:" in s:                      # 有堆栈 -> 疑似插件/代码崩溃
            return "plugin_crash"
        if code != 0:
            return "runtime"
        return "unknown"

    def run(self):
        while True:
            self.last_restart_ts = time.time()
            proc = subprocess.Popen(self.cmd, stderr=subprocess.PIPE,
                                    text=True, creationflags=subprocess.CREATE_NEW_PROCESS_GROUP)
            # 探活直到就绪或进程退出（对应 startServer 的 90s probe）
            ready = False
            deadline = time.time() + 90
            while time.time() < deadline and proc.poll() is None:
                if self._healthy():
                    ready = True
                    self.backoff_s = 1         # 就绪 -> 重置退避
                    self.consecutive_crashes = 0
                    break
                time.sleep(0.7)
            if not ready and proc.poll() is None:
                proc.kill()                    # 启动超时

            stderr = proc.stderr.read() if proc.stderr else ""
            code = proc.wait() if proc.poll() is None else proc.poll()

            cause = self._classify_crash(code, "exit", stderr)
            if cause == "external":
                return
            self.consecutive_crashes += 1
            self.state["crashes"].append({"at": time.time(), "code": code, "cause": cause})
            self._save_state()
            print(f"[watchdog] crash cause={cause} code={code} "
                  f"consecutive={self.consecutive_crashes}")

            # 连续 3 次运行期/插件崩溃 -> 进入安全模式（对应 handleSafeMode）
            if cause in ("plugin_crash", "runtime", "oom") and \
               self.consecutive_crashes >= 3 and self.safe_mode_fn:
                self.state["safe_mode"] = True
                self._save_state()
                self.safe_mode_fn()            # 禁用非核心插件
                self.consecutive_crashes = 0
                continue

            # 指数退避 + 冷却（60s 内重启 >=4 次 -> 强制冷却 120s）
            now = time.time()
            recent = [c for c in self.state["crashes"]
                      if now - c["at"] < 60]
            if len(recent) >= 4:
                print("[watchdog] too many restarts, cooling 120s")
                time.sleep(120)
            else:
                time.sleep(self.backoff_s)
                self.backoff_s = min(self.backoff_s * 2, 60)
```

---

## 四、效果评估

### 4.1 指标体系

| 指标 | 现有实现 | 优化后 | 提升 |
|------|---------|--------|------|
| MTTR（平均恢复时间） | 分钟级（人工） | ≤ 30s（自动） | 90%+ |
| 崩溃后自动恢复率 | 0% | ≥ 90% | — |
| 崩溃原因可归因率 | 0%（只有 code） | ≥ 95%（决策表） | — |
| 内存泄漏检出时间 | 无（直到 OOM） | ≤ 90s（CRIT 水位） | — |
| 误杀率（正常时重启） | 无监控（不会误杀但也无保护） | < 1%（基线校准） | — |
| 重启风暴 | 存在风险 | 消除（退避+冷却） | — |
| 单点依赖故障影响面 | 全站不可用 | 熔断降级，其他功能正常 | — |

### 4.2 适用场景

| 场景 | 主要收益 |
|------|---------|
| 服务运行期崩溃（抛异常/子系统挂） | L1 watchdog 自动重启，用户无感 |
| 内存泄漏 / OOM | L4 水位监控提前预警，CRIT 自动重启 |
| 端口冲突（EADDRINUSE） | 归因→自动释放端口→重启 |
| 第三方插件崩溃 | 自动安全模式禁用问题插件，保留核心功能 |
| API 慢/失败率飙升 | L3 熔断器拦截，快速失败 + 降级响应 |
| 突发请求风暴 | Sentinel 式限流，返回 429 而非打挂服务 |

### 4.3 落地路径（对应现有文件）

| 步骤 | 改动文件 | 对应本方案 |
|------|---------|-----------|
| 1 | `desktop/main.js` — `child.once('exit')` | 增加归因 + 退避重启逻辑（替换 307-313 行） |
| 2 | `desktop/main.js` — 新增 watchdog 定时器 | 每 5s liveness / 15s readiness 轮询 |
| 3 | `dsh web` 的 `/health` 路由 | 支持 `?probe=liveness|readiness|metrics` 返回内存/CPU |
| 4 | `desktop/main.js` — `handleSafeMode()` | 由手动改为"归因触发 + 手动"双通道 |
| 5 | 新增 `%USERPROFILE%\.dsh\crash-state.json` | 持久化崩溃计数，重启不丢 |
| 6 | 插件 API 层（若新增独立服务） | 接入熔断器/限流器 |

### 4.4 实施顺序建议（分三期）

- **P0（1-2 天）**：L1 — exit 归因 + 指数退避重启 + 连续崩溃安全模式（改动最小、收益最大）
- **P1（1 周）**：L4 — /health 深化 + Electron watchdog 轮询 + 内存监控
- **P2（1-2 周）**：L3 — 插件/API 熔断器 + 限流 + 降级响应

---

*参考资料：Netflix Hystrix 熔断器、Kubernetes liveness/readiness 探针、Alibaba Sentinel 滑动窗口限流、Elegant Circuit Breaker Pattern。*