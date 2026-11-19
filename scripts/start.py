#!/usr/bin/env python3
"""Start Study AI on a Python-only host.

Panels such as Wispbyte pin the Docker image to Python and do not let you switch
it, so Node.js is not installed. This script downloads a pinned Node release into
the server's own directory (no root needed), then runs the app with it.

Node is cached, so it is fetched once per container rather than on every
restart. Point NODE_HOME outside the repo if redeploys wipe the working tree.
"""

import hashlib
import os
import platform
import shutil
import subprocess
import sys
import tarfile
import urllib.request
from pathlib import Path
from typing import Optional

NODE_VERSION = os.environ.get("NODE_VERSION", "24.22.3")
NODE_DIST = os.environ.get("NODE_DIST_URL", "https://nodejs.org/dist").rstrip("/")
APP_DIR = Path(__file__).resolve().parent.parent


def runtime_dir() -> Path:
    base = os.environ.get("NODE_HOME")
    root = Path(base) if base else APP_DIR / ".runtime"
    return root / f"node-v{NODE_VERSION}-linux-{machine()}"


def machine() -> str:
    arch = platform.machine().lower()
    if arch in ("x86_64", "amd64"):
        return "x64"
    if arch in ("aarch64", "arm64"):
        return "arm64"
    sys.exit(f"Unsupported CPU architecture: {arch}. Set NODE_HOME to a Node install.")


def installed(target: Path) -> bool:
    node = target / "bin" / "node"
    if not node.exists():
        return False
    try:
        out = subprocess.run([node, "--version"], capture_output=True, text=True, timeout=30)
    except OSError:
        return False
    return out.returncode == 0 and out.stdout.strip() == f"v{NODE_VERSION}"


def published_sha256(name: str) -> Optional[str]:
    """Digest for `name`, read from the release's SHASUMS256.txt."""
    url = f"{NODE_DIST}/v{NODE_VERSION}/SHASUMS256.txt"
    try:
        with urllib.request.urlopen(url, timeout=60) as response:
            listing = response.read().decode("utf-8", "replace")
    except OSError as error:
        sys.exit(f"Could not read {url}: {error}")

    for line in listing.splitlines():
        parts = line.split()
        if len(parts) == 2 and parts[1] == name:
            return parts[0].lower()
    return None


def download(target: Path) -> None:
    arch = machine()
    name = f"node-v{NODE_VERSION}-linux-{arch}.tar.xz"
    url = f"{NODE_DIST}/v{NODE_VERSION}/{name}"
    archive = target.parent / f"{name}.part"

    print(f"Downloading Node {NODE_VERSION} ({arch}) from {url}", flush=True)
    target.parent.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256()
    with urllib.request.urlopen(url, timeout=180) as response, open(archive, "wb") as out:
        while chunk := response.read(1 << 20):
            digest.update(chunk)
            out.write(chunk)

    # The tarball runs on every start, so a corrupted or tampered download must
    # not be unpacked and executed. Node publishes the digests next to the
    # archive, which keeps NODE_VERSION overrides working.
    expected = published_sha256(name)
    if expected is None:
        archive.unlink(missing_ok=True)
        sys.exit(f"Could not find {name} in SHASUMS256.txt at {NODE_DIST}.")
    if digest.hexdigest() != expected:
        archive.unlink(missing_ok=True)
        sys.exit(f"Checksum mismatch for {name}; refusing to install it.")

    with tarfile.open(archive, "r:xz") as tar:
        # `filter` only exists on Python 3.12+; the older signature is safe here
        # because the archive is checksum-verified and comes from nodejs.org.
        try:
            tar.extractall(target.parent, filter="data")
        except TypeError:
            tar.extractall(target.parent)
    archive.unlink(missing_ok=True)
    prune(target)


def prune(target: Path) -> None:
    """Drop headers and docs: ~70MB of the tarball is build-time only."""
    for relative in ("include", "share/doc", "share/man", "CHANGELOG.md"):
        path = target / relative
        if path.is_dir():
            shutil.rmtree(path, ignore_errors=True)
        elif path.exists():
            path.unlink(missing_ok=True)


def ensure_node() -> Path:
    target = runtime_dir()
    if not installed(target):
        download(target)
        if not installed(target):
            sys.exit(f"Node install at {target} did not produce a working binary.")
    return target / "bin" / "node"


def main() -> None:
    node = ensure_node()
    env = dict(os.environ)
    env["PATH"] = f"{node.parent}{os.pathsep}{env.get('PATH', '')}"
    # Panels allocate a fixed port and expose it as SERVER_PORT; server.js reads
    # either. Keeping the panel's value avoids binding a port nobody can reach.
    env.setdefault("DATA_DIR", str(APP_DIR / "data"))

    npm = node.parent / "npm"
    print(f"Installing dependencies with Node {NODE_VERSION}", flush=True)
    subprocess.run([npm, "ci", "--omit=dev", "--no-audit", "--no-fund"], cwd=APP_DIR, env=env, check=True)

    print("Starting Study AI", flush=True)
    # Matches `npm start`, so a local .env works as well as panel env vars.
    os.execve(
        node,
        [str(node), "--env-file-if-exists=.env", str(APP_DIR / "src" / "server.js")],
        env,
    )


if __name__ == "__main__":
    main()
