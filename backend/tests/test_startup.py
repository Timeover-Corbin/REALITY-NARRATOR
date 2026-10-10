import importlib.util
import os
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.settings import ROOT, Settings


spec = importlib.util.spec_from_file_location("launcher", ROOT / "scripts/start.py")
launcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(launcher)


@pytest.mark.parametrize("production", [False, True], ids=["development", "production"])
@pytest.mark.parametrize("openai_key,deepseek_key,expect_warning", [
    ("", "", True),
    ("openai-test-key", "", False),
    ("", "deepseek-test-key", False),
    ("openai-test-key", "deepseek-test-key", False),
], ids=["no-keys", "openai-only", "deepseek-only", "both-keys"])
def test_launcher_starts_with_provider_health(monkeypatch, tmp_path, capsys,
                                            production, openai_key, deepseek_key, expect_warning):
    with TestClient(create_app(Settings(openai_api_key=openai_key, deepseek_api_key=deepseek_key))) as client:
        health = client.get("/api/health").json()

    backend = tmp_path / "backend"
    python = backend / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    python.parent.mkdir(parents=True)
    python.touch()
    (backend / ".env").touch()
    monkeypatch.setattr(launcher, "BACKEND", backend)
    monkeypatch.setattr(launcher.shutil, "which", lambda name: "npm")
    arguments = ["start.py", "--skip-install", "--demo"]
    if production:
        arguments.append("--production")
    monkeypatch.setattr(launcher.sys, "argv", arguments)

    process = SimpleNamespace(poll=lambda: None)
    launch = Mock(return_value=process)
    terminate = Mock()
    monkeypatch.setattr(launcher, "launch", launch)
    monkeypatch.setattr(launcher, "terminate", terminate)
    monkeypatch.setattr(launcher, "run", Mock())
    monkeypatch.setattr(launcher, "wait_for_backend", lambda process, port: health)

    def stop_after_startup(seconds):
        raise KeyboardInterrupt

    monkeypatch.setattr(launcher.time, "sleep", stop_after_startup)
    launcher.main()

    output = capsys.readouterr().out
    url = "http://localhost:8000" if production else "http://localhost:5173"
    assert f"Reality Narrator: {url}?mode=demo" in output
    assert "Press Ctrl+C to stop both services." in output
    assert ("No API key configured." in output) == expect_warning
    assert launch.call_count == (1 if production else 2)
    assert terminate.call_count == launch.call_count
