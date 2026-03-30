# karajan-code (Python wrapper)

Python wrapper for [Karajan Code](https://karajancode.com) -- local multi-agent
coding orchestrator. This package is **not** a reimplementation; it locates and
delegates to the real Karajan Code binary.

## Requirements

- Python 3.9+
- **Node.js 18+** (or a global `npm install -g karajan-code`)

## Install

```bash
pip install karajan-code
```

## Usage

```bash
kj run --task "KJC-TSK-0042"
kj doctor
```

## How it works

1. If `kj` is already on your PATH (global npm install), it runs that directly.
2. Otherwise, if `npx` is available, it runs `npx karajan-code` transparently.
3. If neither Node.js nor a global install is found, it prints install instructions.

## License

AGPL-3.0
