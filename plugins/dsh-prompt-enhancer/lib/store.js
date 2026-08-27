// dsh-prompt-enhancer — store (知识库存储 + BM25 检索).
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { join, basename, extname } from 'node:path';
import { randomUUID } from 'node:crypto';

export function knowledgeDir() {
  const home = process.env.DSH_HOME || join(process.env.USERPROFILE || process.env.HOME || '', '.dsh');
  return join(home, 'knowledge');
}

function tokenize(text) {
  const tokens = [];
  const s = String(text || '').toLowerCase();
  for (const ch of s) {
    if (/[一-鿿぀-ヿ가-힯]/.test(ch)) tokens.push(ch);
  }
  for (const m of s.match(/[a-z0-9_]+/g) || []) {
    if (m.length >= 2) tokens.push(m);
  }
  return tokens;
}

function chunkText(text, maxChunkSize = 600) {
  const paragraphs = text.split(/\n{2,}/).filter(p => p.trim());
  const chunks = [];
  let current = '';
  for (const para of paragraphs) {
    if (current.length + para.length > maxChunkSize && current.length > 100) {
      chunks.push(current.trim());
      current = para;
    } else {
      current += (current ? '\n\n' : '') + para;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.length > 0 ? chunks : [text];
}

function extractTitle(content) {
  const m = content.match(/^#\s+(.+)/m);
  return m ? m[1].trim() : '';
}

function extractTags(content) {
  const tags = [];
  const m = content.match(/tags?:\s*\[?([^\]\n]+)/i);
  if (m) tags.push(...m[1].split(',').map(t => t.trim()).filter(Boolean));
  return [...new Set(tags)];
}

const BM25_K1 = 1.5;
const BM25_B = 0.75;

function bm25Score(queryTokens, docTokens, avgDl, totalDocs, docFreqs) {
  const dl = docTokens.length;
  const tf = {};
  for (const t of docTokens) tf[t] = (tf[t] || 0) + 1;
  let score = 0;
  const seen = new Set();
  for (const qt of queryTokens) {
    if (seen.has(qt)) continue;
    seen.add(qt);
    const f = tf[qt] || 0;
    if (f === 0) continue;
    const df = docFreqs[qt] || 0;
    const idf = Math.log((totalDocs - df + 0.5) / (df + 0.5) + 1);
    const tfNorm = (f * (BM25_K1 + 1)) / (f + BM25_K1 * (1 - BM25_B + BM25_B * dl / avgDl));
    score += idf * tfNorm;
  }
  return score;
}

export function createStore() {
  let documents = [];
  let docFreqs = {};
  let totalDocs = 0;
  let avgChunkLen = 0;

  function load() {
    const dir = knowledgeDir();
    if (!existsSync(dir)) { mkdirSync(dir, { recursive: true }); return; }
    documents = [];
    const files = readdirSync(dir).filter(f => f.endsWith('.md') || f.endsWith('.txt'));
    for (const file of files) {
      const filePath = join(dir, file);
      try {
        const content = readFileSync(filePath, 'utf8');
        const title = extractTitle(content) || basename(file, extname(file));
        const tags = extractTags(content);
        const chunks = chunkText(content);
        const chunkTokens = chunks.map(c => tokenize(c));
        documents.push({ id: randomUUID(), title, content, tags, chunks, chunkTokens, filePath, updatedAt: new Date().toISOString() });
      } catch {}
    }
    buildIndex();
  }

  function buildIndex() {
    docFreqs = {};
    totalDocs = 0;
    let totalLen = 0;
    for (const doc of documents) {
      for (const tokens of doc.chunkTokens) {
        totalDocs++;
        totalLen += tokens.length;
        const seen = new Set(tokens);
        for (const t of seen) docFreqs[t] = (docFreqs[t] || 0) + 1;
      }
    }
    avgChunkLen = totalDocs > 0 ? totalLen / totalDocs : 0;
  }

  function search(query, maxResults = 3, minRelevance = 0) {
    const queryTokens = tokenize(query);
    if (queryTokens.length === 0) return [];
    const results = [];
    for (const doc of documents) {
      for (let i = 0; i < doc.chunks.length; i++) {
        const score = bm25Score(queryTokens, doc.chunkTokens[i], avgChunkLen, totalDocs, docFreqs);
        if (score > minRelevance) {
          results.push({ docId: doc.id, title: doc.title, tags: doc.tags, chunk: doc.chunks[i], chunkIndex: i, score });
        }
      }
    }
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, maxResults);
  }

  function list() {
    return documents.map(d => ({ id: d.id, title: d.title, tags: d.tags, content: d.content, filePath: d.filePath, chunkCount: d.chunks.length, updatedAt: d.updatedAt }));
  }

  function get(id) { return documents.find(d => d.id === id) || null; }

  function create(data) {
    const dir = knowledgeDir();
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const title = data.title || '新文档';
    const content = data.content || '';
    const slug = title.replace(/[^\w\u4e00-\u9fff]+/g, '-').slice(0, 50);
    const filePath = join(dir, slug + '.md');
    const fullContent = '# ' + title + '\n\n' + content;
    writeFileSync(filePath, fullContent, 'utf8');
    const doc = { id: randomUUID(), title, content: fullContent, tags: data.tags || extractTags(content), chunks: chunkText(fullContent), chunkTokens: chunkText(fullContent).map(c => tokenize(c)), filePath, updatedAt: new Date().toISOString() };
    documents.push(doc);
    buildIndex();
    return doc;
  }

  function update(id, data) {
    const doc = documents.find(d => d.id === id);
    if (!doc) return null;
    if (data.title !== undefined) doc.title = data.title;
    if (data.content !== undefined) {
      doc.content = '# ' + doc.title + '\n\n' + data.content;
      doc.chunks = chunkText(doc.content);
      doc.chunkTokens = doc.chunks.map(c => tokenize(c));
    }
    if (data.tags !== undefined) doc.tags = data.tags;
    doc.updatedAt = new Date().toISOString();
    writeFileSync(doc.filePath, doc.content, 'utf8');
    buildIndex();
    return doc;
  }

  function remove(id) {
    const idx = documents.findIndex(d => d.id === id);
    if (idx < 0) return false;
    const doc = documents[idx];
    try { unlinkSync(doc.filePath); } catch {}
    documents.splice(idx, 1);
    buildIndex();
    return true;
  }

  function reload() { load(); }

  load();

  return { list, get, search, create, update, remove, reload, get documents() { return documents; }, get stats() { return { docCount: documents.length, chunkCount: totalDocs, avgChunkLen: Math.round(avgChunkLen) }; } };
}