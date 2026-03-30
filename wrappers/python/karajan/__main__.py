"""Python wrapper for Karajan Code.

Locates and executes the Karajan Code binary (kj), falling back to npx
if a global install is not found but Node.js is available.
"""

import os
import platform
import shutil
import subprocess
import sys


def _find_executable(name: str) -> str | None:
    """Return the full path of *name* if it exists on PATH, else None."""
    return shutil.which(name)


def _exec(cmd: list[str]) -> int:
    """Replace the current process with *cmd* on UNIX, or subprocess on Windows."""
    if platform.system() != "Windows":
        os.execvp(cmd[0], cmd)
        # execvp never returns on success; if we get here something went wrong
        return 1  # pragma: no cover

    # Windows: os.execvp behaves differently, fall back to subprocess
    result = subprocess.run(cmd)
    return result.returncode


def main() -> None:
    args = sys.argv[1:]

    # 1. Try global kj binary
    kj_path = _find_executable("kj")
    if kj_path:
        raise SystemExit(_exec([kj_path, *args]))

    # 2. Try npx (requires Node.js)
    npx_path = _find_executable("npx")
    if npx_path:
        raise SystemExit(_exec([npx_path, "karajan-code", *args]))

    # 3. Nothing available
    print(
        "Error: Karajan Code requires Node.js 18+ or a global install of karajan-code.\n"
        "\n"
        "Install options:\n"
        "  npm install -g karajan-code   # requires Node.js 18+\n"
        "  brew install node             # macOS\n"
        "  https://nodejs.org            # all platforms\n",
        file=sys.stderr,
    )
    raise SystemExit(1)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        raise SystemExit(130)
