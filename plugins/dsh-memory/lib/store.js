// dsh-memory — store (the long-term-memory capability).
// 分离自 host 半边：纯数据层 = 加载/保存 + 语义去重 + 访问追踪
// + token 预算注入 + rank 融合（重要性×近期×频率）。
//
// 设计参考 ALTm (Autonomous-Long-Term-Memory-System)：
//   - semantic_dedup：保存前先找同类高相似度记忆并合并，而非重复堆叠；
//   - 访问追踪 last_accessed_at / access_count（注入与检索时 touch）；
//   - token_budget：按 token 预算注入，而非字符数；
//   - rank_fusion：多信号融合排序。
//
// 数据文件：dsh-memories.json = { memories, categories }（独立于内置系统）。
// 旧条目缺少 accessCount/lastAccessedAt 字段时按 0/null 兜底，不影响加载。
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join, dirname } from 'node:path';

/** 默认分类 → 中文标签。可在 memories.json 的 categories 字段覆盖。 */
export const CATEGORIES = {
  preference: '偏好习惯',
  fact: '个人信息',
  event: '重要事件',
  rule: '行为规则',
  context: '上下文背景',
};

/** harness home：与 host 启动时一致（DSH_HOME || ~/.dsh）。 */
export function memoriesFile() {
  const home = process.env.DSH_HOME
    || join(process.env.USERPROFILE || process.env.HOME || '', '.dsh');
  return join(home, 'dsh-memories.json');
}

// ───────────────────────────────────────────────────────── 文本度量 ──
// token 估算：CJK 每字 ~1 token，ASCII ~4 字符/token。粗估够用，避免引模型。
export function estimateTokens(text) {
  if (!text) return 0;
  let cjk = 0, other = 0;
  for (const ch of String(text)) {
    if (/[一-鿿぀-ヿ가-힯]/.test(ch)) cjk++;
    else if (ch.trim()) other++;
  }
  return cjk + Math.ceil(other / 4);
}

// 分词：CJK 逐字成 token，ASCII 按 \w+ 词。小写化。
function tokenize(text) {
  const tokens = new Set();
  const s = String(text || '').toLowerCase();
  for (const ch of s) {
    if (/[一-鿿぀-ヿ가-힯]/.test(ch)) tokens.add(ch);
  }
  for (const m of s.match(/[a-z0-9_]+/g) || []) {
    if (m.length >= 2) tokens.add(m); // 忽略单字母噪声
  }
  return tokens;
}

// Jaccard 相似度（token 集合交集 / 并集）。0~1。
function similarity(a, b) {
  const sa = String(a || '').toLowerCase();
  const sb = String(b || '').toLowerCase();
  // 子串包含检查：如果一个包含另一个，直接返回高相似度
  if (sa.includes(sb) || sb.includes(sa)) return 0.9;
  const ta = tokenize(a), tb = tokenize(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

// ───────────────────────────────────────────────────────── 工厂 ──
/**
 * @param {object} opts
 * @param {number} [opts.maxInject=20]   注入最多条数
 * @param {number} [opts.maxTokens=800]   注入 token 预算
 * @param {number} [opts.dedupThreshold=0.18] 合并阈值（同类 Jaccard≥此值则合并）
 * @param {number} [opts.weightImportance=0.5] importance 权重
 * @param {number} [opts.weightRecency=0.3]    近期衰减权重
 * @param {number} [opts.weightFrequency=0.2] 频率权重
 * @param {number} [opts.recencyHalfLifeDays=14] 近期衰减半衰期（天）
 */
export function createMemoryStore(opts = {}) {
  const o = {
    maxInject: 20,
    maxTokens: 800,
    dedupThreshold: 0.18,
    weightImportance: 0.5,
    weightRecency: 0.3,
    weightFrequency: 0.2,
    recencyHalfLifeDays: 14,
    ...opts,
  };
  let memories = [];
  let categories = { ...CATEGORIES };

  const normalize = (m) => ({
    ...m,
    importance: m.importance ?? 5,
    accessCount: m.accessCount ?? 0,
    lastAccessedAt: m.lastAccessedAt ?? null,
    tags: m.tags ?? [],
  });

  function load() {
    const file = memoriesFile();
    try {
      if (existsSync(file)) {
        const data = JSON.parse(readFileSync(file, 'utf8'));
        memories = Array.isArray(data.memories) ? data.memories.map(normalize) : [];
        if (data.categories) categories = { ...categories, ...data.categories };
      }
    } catch { /* 损坏文件：空表起步，save 时会覆写修复 */ }
  }

  function save() {
    const file = memoriesFile();
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ memories, categories }, null, 2), 'utf8');
  }

  load();
  // 首次加载若文件不存在则建立空表骨架（与旧版行为一致）。
  if (!existsSync(memoriesFile())) save();

  const generateId = () => 'm-' + randomUUID();

  // ── rank 融合：importance × wI + 近期衰减 × wR + 频率 × wF ──
  function rank(m, now = Date.now()) {
    const importance = Number(m.importance) || 5;
    const ageDays = m.lastAccessedAt
      ? (now - new Date(m.lastAccessedAt).getTime()) / 86400000
      : (m.createdAt ? (now - new Date(m.createdAt).getTime()) / 86400000 : 0);
    const recency = 1 / (1 + ageDays / (o.recencyHalfLifeDays || 14));
    const freq = Math.log(1 + (Number(m.accessCount) || 0));
    const maxF = Math.log(1 + Math.max(1, ...memories.map(x => Number(x.accessCount) || 0))) || 1;
    return o.weightImportance * (importance / 10)
      + o.weightRecency * recency
      + o.weightFrequency * (maxF ? freq / maxF : 0);
  }

  // ── 同类最高相似度匹配（去重用）──
  function findSimilar(content, category) {
    let best = null, bestSim = 0;
    for (const m of memories) {
      if (category && m.category !== category) continue;
      const s = similarity(content, m.content);
      if (s > bestSim) { bestSim = s; best = m; }
    }
    return bestSim >= o.dedupThreshold ? { memory: best, score: bestSim } : null;
  }

  // ── 合并：把 incoming 并入 target（追加新内容、并集标签、提升重要性）──
  function mergeInto(target, incoming) {
    const t = normalize(target);
    const inc = String(incoming.content || '');
    if (inc && inc.includes(t.content) && inc.length >= t.content.length) {
      // 新内容是旧内容的超集：用更完整的那条替换。
      t.content = inc;
    } else if (inc && !t.content.includes(inc) && inc.length > t.content.length) {
      // 非超集/子集但新内容更长：去重即统一为更完整的那条（绝不拼接冗余）。
      t.content = inc;
    }
    // 其余（旧内容更长或已包含新内容）：保留旧内容，content 不动。
    t.tags = Array.from(new Set([...(t.tags || []), ...(incoming.tags || [])]));
    t.importance = Math.min(10, Math.max(Number(t.importance) || 5, Number(incoming.importance) || 5) + 1);
    t.updatedAt = new Date().toISOString();
    t.mergedAt = t.updatedAt;
    return t;
  }

  // ── 保存（去重优先）：返回 { memory, action } ──
  function saveMemory(input) {
    const content = String(input.content || '').trim();
    if (!content) return { memory: null, action: 'empty' };
    const category = input.category || 'fact';
    const importance = Math.max(1, Math.min(10, Number(input.importance) || 5));
    const tags = Array.isArray(input.tags) ? input.tags : [];
    const source = input.source || 'ai';
    const similar = findSimilar(content, category);
    if (similar) {
      const merged = mergeInto(similar.memory, { content, importance, tags });
      // 替换原条目（保持位置）
      const idx = memories.findIndex(m => m.id === merged.id);
      if (idx >= 0) memories[idx] = merged;
      save();
      return { memory: merged, action: 'merged', similarity: similar.score };
    }
    const memory = normalize({
      id: generateId(),
      content,
      category,
      importance,
      tags,
      source,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    memories.push(memory);
    save();
    return { memory, action: 'created' };
  }

  // ── 注入文本（token 预算 + rank + touch）──
  function buildInjectText(now = Date.now()) {
    const ranked = memories
      .map(m => ({ m, r: rank(m, now) }))
      .sort((a, b) => b.r - a.r);
    const lines = [];
    let total = 0;
    const touched = [];
    for (const { m } of ranked) {
      const line = '- [' + (categories[m.category] || m.category) + '] ' + m.content;
      const t = estimateTokens(line);
      if (total + t > o.maxTokens) continue;
      if (lines.length >= o.maxInject) break;
      lines.push(line);
      total += t;
      touched.push(m.id);
    }
    if (lines.length === 0) return '';
    // touch 访问统计（被注入视为一次访问）
    const nowIso = new Date(now).toISOString();
    for (const m of memories) {
      if (touched.includes(m.id)) {
        m.accessCount = (Number(m.accessCount) || 0) + 1;
        m.lastAccessedAt = nowIso;
      }
    }
    save();
    return '以下是关于用户的长期记忆，请在回答时参考：\n' + lines.join('\n');
  }

  // ── 检索（过滤 + rank + touch 前若干条）──
  function search(query, category = '', limit = 10) {
    const q = String(query || '').toLowerCase();
    const qTokens = tokenize(query);
    let results = memories
      .filter(m => (!category || m.category === category))
      .filter(m => {
        if (!q) return true;
        const inContent = m.content.toLowerCase().includes(q);
        const inTags = (m.tags || []).some(t => String(t).toLowerCase().includes(q));
        const tokenMatch = qTokens.size > 0 && similarity(query, m.content) > 0;
        return inContent || inTags || tokenMatch;
      })
      .map(m => ({ m, r: rank(m) }))
      .sort((a, b) => b.r - a.r)
      .slice(0, limit);
    // touch
    const nowIso = new Date().toISOString();
    for (const { m } of results) {
      m.accessCount = (Number(m.accessCount) || 0) + 1;
      m.lastAccessedAt = nowIso;
    }
    save();
    return results.map(({ m }) => m);
  }

  // ── 整理：合并同类近重复，删除冗余 ──
  function consolidate() {
    const before = memories.length;
    const merged = [];
    const keep = [];
    // 按分类分组后两两比对
    const byCat = {};
    for (const m of memories) (byCat[m.category] = byCat[m.category] || []).push(m);
    for (const cat of Object.keys(byCat)) {
      const group = byCat[cat];
      const reps = []; // 代表项
      for (const m of group) {
        let host = null, bestSim = 0;
        for (const r of reps) {
          const s = similarity(m.content, r.content);
          if (s > bestSim) { bestSim = s; host = r; }
        }
        if (host && bestSim >= o.dedupThreshold) {
          mergeInto(host, m); // 把 m 并入 host
          merged.push(m.id);
        } else {
          reps.push(m);
        }
      }
      keep.push(...reps);
    }
    memories = keep;
    save();
    return { before, after: memories.length, merged: merged.length, removed: merged.length };
  }


  function consolidatePreview() {
    const byCat = {};
    for (const m of memories) (byCat[m.category] = byCat[m.category] || []).push(m);
    const candidates = [];
    for (const cat of Object.keys(byCat)) {
      const group = byCat[cat];
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const s = similarity(group[i].content, group[j].content);
          if (s >= o.dedupThreshold) {
            candidates.push({ keepId: group[i].id, mergeId: group[j].id, keepPreview: group[i].content.slice(0,80), mergePreview: group[j].content.slice(0,80), score: s });
          }
        }
      }
    }
    candidates.sort((a,b) => b.score - a.score);
    return candidates;
  }

  function consolidateApply() {
    const before = memories.length;
    const merged = [];
    const keep = [];
    const byCat = {};
    for (const m of memories) (byCat[m.category] = byCat[m.category] || []).push(m);
    for (const cat of Object.keys(byCat)) {
      const group = byCat[cat];
      const reps = [];
      for (const m of group) {
        let host = null, bestSim = 0;
        for (const r of reps) { const s = similarity(m.content, r.content); if (s > bestSim) { bestSim = s; host = r; } }
        if (host && bestSim >= o.dedupThreshold) { mergeInto(host, m); merged.push(m.id); } else { reps.push(m); }
      }
      keep.push(...reps);
    }
    memories = keep;
    save();
    return { before, after: memories.length, merged: merged.length, removed: merged.length };
  }

  function consolidatePreview() {
    const byCat = {};
    for (const m of memories) (byCat[m.category] = byCat[m.category] || []).push(m);
    const candidates = [];
    for (const cat of Object.keys(byCat)) {
      const group = byCat[cat];
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const s = similarity(group[i].content, group[j].content);
          if (s >= o.dedupThreshold) candidates.push({ keepId: group[i].id, mergeId: group[j].id, keepPreview: group[i].content.slice(0,80), mergePreview: group[j].content.slice(0,80), score: s });
        }
      }
    }
    candidates.sort((a,b) => b.score - a.score);
    return candidates;
  }

  function consolidateApply() {
    const before = memories.length;
    const merged = [];
    const keep = [];
    const byCat = {};
    for (const m of memories) (byCat[m.category] = byCat[m.category] || []).push(m);
    for (const cat of Object.keys(byCat)) {
      const group = byCat[cat];
      const reps = [];
      for (const m of group) {
        let host = null, bestSim = 0;
        for (const r of reps) { const s = similarity(m.content, r.content); if (s > bestSim) { bestSim = s; host = r; } }
        if (host && bestSim >= o.dedupThreshold) { mergeInto(host, m); merged.push(m.id); } else { reps.push(m); }
      }
      keep.push(...reps);
    }
    memories = keep;
    save();
    return { before, after: memories.length, merged: merged.length, removed: merged.length };
  }

  function get(id) { return memories.find(m => m.id === id) || null; }
  function list() { return memories; }
  function update(id, patch) {
    const m = get(id);
    if (!m) return null;
    if (patch.content !== undefined) m.content = String(patch.content);
    if (patch.category !== undefined) m.category = patch.category;
    if (patch.importance !== undefined) m.importance = Math.max(1, Math.min(10, Number(patch.importance)));
    if (patch.tags !== undefined) m.tags = Array.isArray(patch.tags) ? patch.tags : m.tags;
    m.updatedAt = new Date().toISOString();
    save();
    return m;
  }
  function remove(id) {
    const idx = memories.findIndex(m => m.id === id);
    if (idx < 0) return false;
    memories.splice(idx, 1);
    save();
    return true;
  }

  return {
    get memories() { return memories; },
    get categories() { return categories; },
    get options() { return o; },
    load, save, generateId,
    estimateTokens, similarity, rank,
    findSimilar, saveMemory, buildInjectText, search, consolidate,
    get, list, update, remove, consolidatePreview, consolidateApply,
  };
}
