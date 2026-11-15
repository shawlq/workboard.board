from __future__ import annotations

import asyncio
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx

from app.config import AppDef, Settings, load_settings

# Remember last start/stop failure messages for status lamp (error)
_last_errors: dict[str, str] = {}
_action_locks: dict[str, asyncio.Lock] = {}


def _lock_for(app_id: str) -> asyncio.Lock:
    if app_id not in _action_locks:
        _action_locks[app_id] = asyncio.Lock()
    return _action_locks[app_id]


@dataclass
class ScriptResult:
    ok: bool
    exit_code: int
    stdout: str
    stderr: str
    timed_out: bool = False


@dataclass
class AppStatus:
    id: str
    name: str
    icon: str
    port: int
    # running | stopped | error
    state: str
    lamp: str  # green | gray | red
    script_running: bool
    health_ok: bool | None
    message: str
    detail: str = ""
    can_start: bool = True
    can_stop: bool = False


async def _run_script(
    app: AppDef,
    action: str,
    *,
    timeout: float = 90.0,
) -> ScriptResult:
    """Run service.sh action.

    Output goes to temp files (not pipes) so daemonized children that inherit
    fds cannot block asyncio communicate() forever.
    """
    script = app.service_script
    script_path = Path(script)
    if not script_path.is_absolute():
        script_path = (app.cwd / script).resolve()

    cmd = [str(script_path), action]
    out_f = tempfile.NamedTemporaryFile(prefix="wb-out-", suffix=".log", delete=False)
    err_f = tempfile.NamedTemporaryFile(prefix="wb-err-", suffix=".log", delete=False)
    out_path = Path(out_f.name)
    err_path = Path(err_f.name)
    try:
        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                cwd=str(app.cwd),
                stdin=asyncio.subprocess.DEVNULL,
                stdout=out_f,
                stderr=err_f,
                start_new_session=True,
            )
        except FileNotFoundError as e:
            return ScriptResult(
                ok=False,
                exit_code=127,
                stdout="",
                stderr=f"script not found: {script_path} ({e})",
            )
        except OSError as e:
            return ScriptResult(
                ok=False,
                exit_code=126,
                stdout="",
                stderr=f"failed to exec {script_path}: {e}",
            )
        finally:
            out_f.close()
            err_f.close()

        timed_out = False
        try:
            await asyncio.wait_for(proc.wait(), timeout=timeout)
        except asyncio.TimeoutError:
            timed_out = True
            try:
                proc.kill()
            except ProcessLookupError:
                pass
            try:
                await proc.wait()
            except Exception:
                pass

        stdout = out_path.read_text(encoding="utf-8", errors="replace").strip()
        stderr = err_path.read_text(encoding="utf-8", errors="replace").strip()
        code = proc.returncode if proc.returncode is not None else -1
        if timed_out:
            return ScriptResult(
                ok=False,
                exit_code=code if code is not None else -1,
                stdout=stdout,
                stderr=stderr or f"timed out after {timeout}s",
                timed_out=True,
            )
        return ScriptResult(
            ok=(code == 0),
            exit_code=code,
            stdout=stdout,
            stderr=stderr,
        )
    finally:
        out_path.unlink(missing_ok=True)
        err_path.unlink(missing_ok=True)


async def _health_check(app: AppDef, *, timeout: float = 2.5) -> tuple[bool, str]:
    path = app.health_path if app.health_path.startswith("/") else f"/{app.health_path}"
    url = f"http://127.0.0.1:{app.port}{path}"
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=timeout) as client:
            resp = await client.get(url)
        if 200 <= resp.status_code < 400:
            return True, f"HTTP {resp.status_code} {url}"
        return False, f"HTTP {resp.status_code} {url}"
    except Exception as e:
        return False, f"probe failed {url}: {e}"


def _compose_state(
    app: AppDef,
    script: ScriptResult,
    health_ok: bool | None,
    health_msg: str,
) -> AppStatus:
    script_running = script.ok  # status exit 0 means running
    err = _last_errors.get(app.id, "")

    if not script_running:
        state = "stopped"
        lamp = "gray"
        message = script.stdout or script.stderr or f"{app.name}: stopped"
        if err and "start" in err.lower():
            # keep red if last start failed and still stopped
            state = "error"
            lamp = "red"
            message = err
        return AppStatus(
            id=app.id,
            name=app.name,
            icon=app.icon,
            port=app.port,
            state=state,
            lamp=lamp,
            script_running=False,
            health_ok=None,
            message=message,
            detail=_format_detail(script, health_msg, err),
            can_start=True,
            can_stop=False,
        )

    # Script says running
    if health_ok is True:
        # clear transient start error on healthy run
        _last_errors.pop(app.id, None)
        return AppStatus(
            id=app.id,
            name=app.name,
            icon=app.icon,
            port=app.port,
            state="running",
            lamp="green",
            script_running=True,
            health_ok=True,
            message=script.stdout or f"{app.name}: running",
            detail=_format_detail(script, health_msg, ""),
            can_start=False,
            can_stop=True,
        )

    # running but unhealthy, or health unknown failure
    msg = health_msg or script.stderr or f"{app.name}: unhealthy"
    return AppStatus(
        id=app.id,
        name=app.name,
        icon=app.icon,
        port=app.port,
        state="error",
        lamp="red",
        script_running=True,
        health_ok=False,
        message=msg,
        detail=_format_detail(script, health_msg, err),
        can_start=False,
        can_stop=True,
    )


def _format_detail(script: ScriptResult, health_msg: str, err: str) -> str:
    parts: list[str] = []
    if script.stdout:
        parts.append(f"[script stdout]\n{script.stdout}")
    if script.stderr:
        parts.append(f"[script stderr]\n{script.stderr}")
    parts.append(f"[exit] {script.exit_code}" + (" (timeout)" if script.timed_out else ""))
    if health_msg:
        parts.append(f"[health]\n{health_msg}")
    if err:
        parts.append(f"[last error]\n{err}")
    return "\n\n".join(parts)


async def get_app_status(app: AppDef) -> AppStatus:
    script = await _run_script(app, "status", timeout=15.0)
    health_ok: bool | None = None
    health_msg = ""
    if script.ok:
        health_ok, health_msg = await _health_check(app)
    return _compose_state(app, script, health_ok, health_msg)


async def list_apps(settings: Settings | None = None) -> list[dict[str, Any]]:
    cfg = settings or load_settings()
    results: list[dict[str, Any]] = []
    # Probe in parallel
    apps = [cfg.apps_by_id[i] for i in cfg.order if i in cfg.apps_by_id]
    statuses = await asyncio.gather(*(get_app_status(a) for a in apps))
    for st in statuses:
        results.append(
            {
                "id": st.id,
                "name": st.name,
                "icon": st.icon,
                "port": st.port,
                "state": st.state,
                "lamp": st.lamp,
                "message": st.message,
                "can_start": st.can_start,
                "can_stop": st.can_stop,
            }
        )
    return results


async def detailed_status(app_id: str, settings: Settings | None = None) -> dict[str, Any]:
    cfg = settings or load_settings()
    app = cfg.apps_by_id.get(app_id)
    if not app:
        raise KeyError(app_id)
    st = await get_app_status(app)
    return {
        "id": st.id,
        "name": st.name,
        "port": st.port,
        "state": st.state,
        "lamp": st.lamp,
        "message": st.message,
        "detail": st.detail,
        "can_start": st.can_start,
        "can_stop": st.can_stop,
        "script_running": st.script_running,
        "health_ok": st.health_ok,
    }


async def start_app(app_id: str, settings: Settings | None = None) -> dict[str, Any]:
    cfg = settings or load_settings()
    app = cfg.apps_by_id.get(app_id)
    if not app:
        raise KeyError(app_id)

    async with _lock_for(app_id):
        current = await get_app_status(app)
        if current.state == "running":
            return {"ok": True, "already": True, "status": await detailed_status(app_id, cfg)}

        result = await _run_script(app, "start", timeout=120.0)
        if not result.ok:
            msg = result.stderr or result.stdout or f"start failed (exit {result.exit_code})"
            _last_errors[app_id] = f"start failed: {msg}"
        else:
            # Verify after start
            await asyncio.sleep(0.4)
            st = await get_app_status(app)
            if st.lamp == "red":
                _last_errors[app_id] = f"start completed but unhealthy: {st.message}"
            else:
                _last_errors.pop(app_id, None)

        return {
            "ok": result.ok,
            "stdout": result.stdout,
            "stderr": result.stderr,
            "exit_code": result.exit_code,
            "status": await detailed_status(app_id, cfg),
        }


async def stop_app(app_id: str, settings: Settings | None = None) -> dict[str, Any]:
    cfg = settings or load_settings()
    app = cfg.apps_by_id.get(app_id)
    if not app:
        raise KeyError(app_id)

    async with _lock_for(app_id):
        current = await get_app_status(app)
        if current.state == "stopped" and current.lamp == "gray":
            return {"ok": True, "already": True, "status": await detailed_status(app_id, cfg)}

        result = await _run_script(app, "stop", timeout=60.0)
        if not result.ok:
            msg = result.stderr or result.stdout or f"stop failed (exit {result.exit_code})"
            _last_errors[app_id] = f"stop failed: {msg}"
        else:
            _last_errors.pop(app_id, None)

        await asyncio.sleep(0.3)
        return {
            "ok": result.ok,
            "stdout": result.stdout,
            "stderr": result.stderr,
            "exit_code": result.exit_code,
            "status": await detailed_status(app_id, cfg),
        }
