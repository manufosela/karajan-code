# Karajan HU Board

A web dashboard that visualizes all HU (User Story) stories managed by Karajan Code. Reads from `~/.karajan/hu-stories/` and `~/.karajan/sessions/`, groups by project, and provides a read-only kanban board with quality metrics and session timelines.

## Quick Start

### Without Docker

```bash
cd packages/hu-board
npm install
npm start
# Open http://localhost:4000
```

### With Docker

```bash
cd packages/hu-board
docker compose up -d
# Open http://localhost:4000
```

### Development (auto-reload)

```bash
npm run dev
```

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `4000` | Server port (auto-detects next available if busy) |
| `KJ_HOME` | `~/.karajan` | Path to Karajan data directory |

You can also use `--port` flag:

```bash
node src/server.js --port 5000
```

## Architecture

- **Backend**: Node.js + Express serving REST API + static files
- **Frontend**: Vanilla JS single-page app with hash-based routing
- **Database**: SQLite (via `better-sqlite3`) at `$KJ_HOME/hu-board.db`
- **Sync**: Chokidar watches JSON files and syncs to SQLite in real-time

The SQLite database is a read index over the JSON source files. If deleted, it rebuilds automatically on next startup.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/dashboard` | Global statistics |
| GET | `/api/projects` | List all projects with counts |
| GET | `/api/projects/:id` | Project detail |
| GET | `/api/projects/:id/stories` | Stories for a project |
| GET | `/api/stories/:id` | Story detail with quality, AC, context requests |
| GET | `/api/projects/:id/sessions` | Sessions for a project |
| GET | `/api/sessions` | All sessions |
| GET | `/api/sessions/:id` | Session detail with timeline |

## Views

1. **Dashboard** - Global stats cards + project overview grid
2. **Board** - Kanban columns (Pending / Needs Context / Certified / Done)
3. **Sessions** - Timeline of Karajan pipeline sessions with stages and duration
