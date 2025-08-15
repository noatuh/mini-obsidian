// server.js
// Minimal Obsidian-like backend: Notes + links + tags + search + graph
// Usage: npm install && node server.js  (then open http://localhost:8080)

const fs = require('fs');
const path = require('path');
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const Database = require('better-sqlite3');

const PORT = process.env.PORT || 8080;
const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'notes.db');
const PUBLIC_DIR = path.join(__dirname, 'public');
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3:latest';

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
if (!fs.existsSync(PUBLIC_DIR)) fs.mkdirSync(PUBLIC_DIR);

// Init DB
const db = new Database(DB_PATH);

db.exec(`
CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY,
  title TEXT UNIQUE NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS links (
  source_id INTEGER NOT NULL,
  target_title TEXT NOT NULL,
  FOREIGN KEY(source_id) REFERENCES notes(id)
);

CREATE TABLE IF NOT EXISTS tags (
  note_id INTEGER NOT NULL,
  tag TEXT NOT NULL,
  FOREIGN KEY(note_id) REFERENCES notes(id)
);

CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(title, content, content='notes', content_rowid='id');
`);

// Triggers to keep FTS in sync
try {
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS notes_ai AFTER INSERT ON notes BEGIN
      INSERT INTO notes_fts(rowid, title, content) VALUES (new.id, new.title, new.content);
    END;
    CREATE TRIGGER IF NOT EXISTS notes_ad AFTER DELETE ON notes BEGIN
      INSERT INTO notes_fts(notes_fts, rowid, title, content) VALUES('delete', old.id, old.title, old.content);
    END;
    CREATE TRIGGER IF NOT EXISTS notes_au AFTER UPDATE ON notes BEGIN
      INSERT INTO notes_fts(notes_fts, rowid, title, content) VALUES('delete', old.id, old.title, old.content);
      INSERT INTO notes_fts(rowid, title, content) VALUES (new.id, new.title, new.content);
    END;
  `);
} catch (e) {
  // Some SQLite builds disallow triggers in bundled environments; safe to ignore if already present
}

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: '2mb' }));
app.use(express.static(PUBLIC_DIR));

// Helpers
const WIKILINK_RE = /\[\[([^\]|#]+)(?:#.*?)?\]\]/g; // [[Title]] or [[Title#heading]]
const TAG_RE = /(^|\s)#([\p{L}0-9_\-\/]+)\b/gu;       // #tag or #path/like/tag

function extractLinks(content) {
  const targets = new Set();
  for (const m of content.matchAll(WIKILINK_RE)) {
    const t = m[1].trim();
    if (t) targets.add(t);
  }
  return [...targets];
}

function extractTags(content) {
  const tags = new Set();
  for (const m of content.matchAll(TAG_RE)) tags.add(m[2]);
  return [...tags];
}

function upsertNote({ id, title, content }) {
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  if (id) {
    const stmt = db.prepare(`UPDATE notes SET title=?, content=?, updated_at=? WHERE id=?`);
    stmt.run(title, content, now, id);
  } else {
    const stmt = db.prepare(`INSERT INTO notes(title, content, updated_at) VALUES (?, ?, ?)`);
    const info = stmt.run(title, content, now);
    id = info.lastInsertRowid;
  }

  // Rebuild links/tags for this note
  db.prepare(`DELETE FROM links WHERE source_id=?`).run(id);
  db.prepare(`DELETE FROM tags WHERE note_id=?`).run(id);

  const targets = extractLinks(content);
  const tags = extractTags(content);

  const insLink = db.prepare(`INSERT INTO links(source_id, target_title) VALUES(?, ?)`);
  const insTag = db.prepare(`INSERT INTO tags(note_id, tag) VALUES(?, ?)`);

  const tx = db.transaction(() => {
    for (const t of targets) insLink.run(id, t);
    for (const t of tags) insTag.run(id, t);
  });
  tx();

  return db.prepare(`SELECT * FROM notes WHERE id=?`).get(id);
}

// Routes
app.get('/api/notes', (req, res) => {
  const rows = db.prepare(`SELECT id, title, substr(content,1,300) as snippet, updated_at FROM notes ORDER BY updated_at DESC`).all();
  res.json(rows);
});

app.post('/api/notes', (req, res) => {
  const { title, content='' } = req.body;
  try {
    const note = upsertNote({ title, content });
    res.status(201).json(note);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/notes/:id', (req, res) => {
  const note = db.prepare(`SELECT * FROM notes WHERE id=?`).get(req.params.id);
  if (!note) return res.status(404).json({ error: 'Not found' });
  res.json(note);
});

app.put('/api/notes/:id', (req, res) => {
  const { title, content } = req.body;
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Bad id' });
  try {
    const note = upsertNote({ id, title, content });
    res.json(note);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/api/notes/:id', (req, res) => {
  const id = Number(req.params.id);
  db.prepare(`DELETE FROM links WHERE source_id=?`).run(id);
  db.prepare(`DELETE FROM tags WHERE note_id=?`).run(id);
  const info = db.prepare(`DELETE FROM notes WHERE id=?`).run(id);
  res.json({ deleted: info.changes });
});

app.get('/api/notes/:id/backlinks', (req, res) => {
  const note = db.prepare(`SELECT * FROM notes WHERE id=?`).get(req.params.id);
  if (!note) return res.status(404).json({ error: 'Not found' });
  const rows = db.prepare(`
    SELECT n.id, n.title FROM links l
    JOIN notes n ON n.id = l.source_id
    WHERE l.target_title = ?
    ORDER BY n.updated_at DESC
  `).all(note.title);
  res.json(rows);
});

app.get('/api/tags', (req, res) => {
  const rows = db.prepare(`SELECT tag, COUNT(*) as count FROM tags GROUP BY tag ORDER BY count DESC, tag ASC`).all();
  res.json(rows);
});

app.get('/api/search', (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json([]);
  const rows = db.prepare(`
    SELECT n.id, n.title, snippet(notes_fts, 1, '<b>', '</b>', '…', 10) as snippet
    FROM notes_fts f
    JOIN notes n ON n.id = f.rowid
    WHERE notes_fts MATCH ?
    ORDER BY rank
    LIMIT 50
  `).all(q);
  res.json(rows);
});

app.get('/api/graph', (req, res) => {
  const nodes = db.prepare(`SELECT id, title FROM notes`).all();
  const edges = db.prepare(`
    SELECT l.source_id as source, n.id as target
    FROM links l JOIN notes n ON n.title = l.target_title
  `).all();
  res.json({ nodes, edges });
});

// --- AI Integration (Ollama) ---
// Simple retrieval-augmented generation using SQLite FTS (notes_fts)
app.post('/api/ai/chat', async (req, res) => {
  try {
    const { prompt, noteId, topK = 5, includeAll = false } = req.body || {};
    if (!prompt || !prompt.trim()) return res.status(400).json({ error: 'Prompt required' });

    let contextNotes = [];
    const usedIds = new Set();

    function pushNote(n){
      if (!n || usedIds.has(n.id)) return; usedIds.add(n.id); contextNotes.push(n);
    }

    if (noteId) {
      const n = db.prepare('SELECT id,title,content FROM notes WHERE id=?').get(noteId);
      pushNote(n);
    }

    if (includeAll) {
      db.prepare('SELECT id,title,content FROM notes ORDER BY updated_at DESC LIMIT 50').all().forEach(pushNote);
    } else {
      // Keyword search via FTS (escape quotes crudely)
      const q = prompt.replace(/"/g, '');
      try {
        db.prepare(`SELECT n.id,n.title,substr(n.content,1,4000) as content
                    FROM notes_fts f JOIN notes n ON n.id=f.rowid
                    WHERE notes_fts MATCH ?
                    LIMIT ?`).all(q, topK).forEach(pushNote);
      } catch (e) {
        // On MATCH syntax error, fall back to simple title LIKE search
        db.prepare(`SELECT id,title,substr(content,1,4000) as content FROM notes WHERE title LIKE ? LIMIT ?`).all('%'+q+'%', topK).forEach(pushNote);
      }
    }

    const systemPreamble = `You are a helpful assistant with access to a personal knowledge base of notes. Use ONLY the provided context when possible. If information is not in context, say you don't see it in the notes.
Return concise answers. If citing notes, reference them as [Note: title].`;

    const contextBlock = contextNotes.map((n,i)=>`[Note ${i+1}: ${n.title}]
${(n.content||'').slice(0,4000)}`).join('\n\n');

    const fullPrompt = `${systemPreamble}\n\nContext:\n${contextBlock || '(no relevant notes)'}\n\nUser question: ${prompt}\n\nAnswer:`;

    // Call Ollama generate API
    let responseText = '';
    try {
      const r = await fetch(OLLAMA_URL.replace(/\/$/,'') + '/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: OLLAMA_MODEL, prompt: fullPrompt, stream: false })
      });
      if (!r.ok) {
        const txt = await r.text();
        return res.status(502).json({ error: `Ollama error ${r.status}`, detail: txt });
      }
      const data = await r.json();
      responseText = data.response || '';
    } catch (e) {
      return res.status(503).json({ error: 'Failed to reach Ollama server', detail: e.message });
    }

    res.json({
      model: OLLAMA_MODEL,
      notes_used: contextNotes.map(n => ({ id: n.id, title: n.title })),
      response: responseText
    });
  } catch (e) {
    res.status(500).json({ error: 'AI route failure', detail: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`Mini-Obsidian server running at http://localhost:${PORT}`);
});