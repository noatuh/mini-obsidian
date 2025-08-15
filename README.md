
# Mini‑Obsidian

A minimalist, fast, and local-first note-taking app inspired by Obsidian, with full-text search, backlinks, tags, and a built-in AI assistant powered by your local Ollama server.

---

## Features
- **Notes, Links, Tags**: Create, edit, and organize notes with [[wikilinks]] and #tags.
- **Backlinks & Graph**: Visualize connections between notes and explore backlinks.
- **Full-text Search**: Lightning-fast search using SQLite FTS.
- **AI Assistant**: Chat with your notes using Ollama (Llama3 or any local model).
- **Dark Gray & Purple Theme**: Modern, beautiful UI.
- **100% Local**: No cloud, no tracking, your data stays on your machine.

---

## Quick Start

### 1. Install dependencies
```bash
npm install
```

### 2. Start the server
```bash
node server.js
```

### 3. Open in browser
Visit: [http://localhost:8080](http://localhost:8080)

---

## AI Integration (Ollama)

1. **Install Ollama** ([ollama.com](https://ollama.com))
2. **Pull a model** (e.g. Llama3)
	```bash
	ollama pull llama3
	ollama serve
	```
3. **Configure (optional)**
	- Set environment variables before starting the app:
	  ```bash
	  export OLLAMA_MODEL=llama3
	  export OLLAMA_URL=http://localhost:11434
	  ```
4. **Chat with your notes**
	- Use the AI Chat panel in the web interface (right side)
	- Ask questions, retrieve context, and get answers with citations

---

## File Structure
```
obsidian/
├── server.js         # Express + SQLite backend
├── public/
│   └── index.html    # React UI (no build step)
├── data/
│   └── notes.db      # Your notes database
├── package.json      # Dependencies
├── schema.sql        # DB schema
├── start.bat         # Windows quickstart
└── .gitignore        # Clean repo
```

---

## Screenshots
> ![Screenshot](https://user-images.githubusercontent.com/your-screenshot.png)

---

## Customization
- **Theme**: Edit CSS in `public/index.html` for colors.
- **Models**: Use any Ollama-supported model (Llama3, Mistral, etc).
- **Data**: Notes stored in `/data/notes.db` (SQLite).

---

## License
MIT

---

## Credits
- [Obsidian](https://obsidian.md) for inspiration
- [Ollama](https://ollama.com) for local AI
- [TailwindCSS](https://tailwindcss.com), [React](https://react.dev), [D3.js](https://d3js.org)

---

## Contributing
Pull requests welcome! Open issues for bugs or feature requests.
