#!/usr/bin/env python3
"""Cross-platform launcher. Run: python scripts/start.py [--production] [--demo]."""
import argparse
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request
import venv
import webbrowser

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"


def run(command, directory):
    subprocess.run(command, cwd=directory, check=True, shell=os.name == "nt" and str(command[0]).endswith(".cmd"))


def launch(command, directory, environment=None):
    options = {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP} if os.name == "nt" else {"start_new_session": True}
    return subprocess.Popen(command, cwd=directory, env=environment, shell=os.name == "nt" and str(command[0]).endswith(".cmd"), **options)


def terminate(process):
    if process.poll() is not None:
        return
    try:
        if os.name == "nt":
            subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
        else:
            os.killpg(process.pid, signal.SIGTERM)
        process.wait(timeout=5)
    except (ProcessLookupError, subprocess.TimeoutExpired):
        if process.poll() is None:
            if os.name != "nt":
                os.killpg(process.pid, signal.SIGKILL)
            else:
                process.kill()
            process.wait()


def wait_for_backend(process, port):
    # Local health checks intentionally bypass system proxies.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    for _ in range(60):
        if process.poll() is not None:
            raise RuntimeError("Backend exited during startup. Check the log above.")
        try:
            with opener.open(f"http://127.0.0.1:{port}/api/health", timeout=1) as response:
                return json.load(response)
        except (urllib.error.URLError, TimeoutError):
            time.sleep(.2)
    raise RuntimeError("Backend did not become ready. Check whether the port is already in use.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--production", action="store_true", help="Build once and serve frontend + API on port 8000")
    parser.add_argument("--demo", action="store_true", help="Open the explicitly labelled demo mode")
    parser.add_argument("--skip-install", action="store_true", help="Skip dependency installation after the first successful run")
    parser.add_argument("--open", action="store_true", help="Open your default browser")
    parser.add_argument("--port", type=int, default=8000, help="Backend port")
    args = parser.parse_args()
    if sys.version_info < (3, 11):
        raise RuntimeError("Python 3.11 or newer is required. Python 3.12 is recommended.")
    if not 1024 <= args.port <= 65535:
        raise RuntimeError("Port must be between 1024 and 65535.")
    npm = shutil.which("npm")
    if not npm:
        raise RuntimeError("Install Node.js 20+ (including npm), then run this command again.")
    python = BACKEND / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    if not python.exists():
        venv.EnvBuilder(with_pip=True).create(BACKEND / ".venv")
    env_file = BACKEND / ".env"
    if not env_file.exists():
        shutil.copyfile(BACKEND / ".env.example", env_file)
    if not args.skip_install:
        print("Installing backend dependencies...", flush=True)
        requirements = "requirements.lock" if (BACKEND / "requirements.lock").exists() else "requirements.txt"
        run([str(python), "-m", "pip", "install", "-r", requirements], BACKEND)
        print("Installing frontend dependencies...", flush=True)
        run([npm, "ci", "--no-audit", "--no-fund"], FRONTEND)
    if args.production:
        run([npm, "run", "build"], FRONTEND)
    processes = []
    try:
        backend = launch([str(python), "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", str(args.port)], BACKEND)
        processes.append(backend)
        health = wait_for_backend(backend, args.port)
        if args.production:
            url = f"http://localhost:{args.port}"
        else:
            environment = os.environ.copy()
            environment["API_PROXY_TARGET"] = f"http://127.0.0.1:{args.port}"
            processes.append(launch([npm, "run", "dev"], FRONTEND, environment))
            url = "http://localhost:5173"
        if args.demo:
            url += "?mode=demo"
        print(f"\nReality Narrator: {url}\nAPI documentation: http://localhost:{args.port}/docs", flush=True)
        if not any(provider["configured"] for provider in health["providers"].values()):
            print("No API key configured. Use Demo mode, or edit backend/.env and restart.", flush=True)
        print("Press Ctrl+C to stop both services.\n", flush=True)
        if args.open:
            webbrowser.open(url)
        while True:
            if any(process.poll() is not None for process in processes):
                raise RuntimeError("A service exited. Check its log above.")
            time.sleep(.5)
    except KeyboardInterrupt:
        print("\nStopping Reality Narrator...", flush=True)
    finally:
        for process in reversed(processes):
            terminate(process)


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, subprocess.CalledProcessError, OSError) as error:
        print(f"Startup failed: {error}", file=sys.stderr)
        sys.exit(1)
