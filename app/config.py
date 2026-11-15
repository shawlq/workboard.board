from __future__ import annotations

import json
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
CONFIG_PATH = ROOT / "config.json"

_lock = threading.Lock()


@dataclass
class AppDef:
    id: str
    name: str
    icon: str
    port: int
    cwd: Path
    service_script: str
    health_path: str = "/"


@dataclass
class Settings:
    host: str
    port: int
    apps: list[AppDef] = field(default_factory=list)
    order: list[str] = field(default_factory=list)
    apps_by_id: dict[str, AppDef] = field(default_factory=dict)


def _resolve(path_str: str, base: Path = ROOT) -> Path:
    p = Path(path_str).expanduser()
    if not p.is_absolute():
        p = base / p
    return p.resolve()


def _parse_apps(raw_apps: list[dict[str, Any]]) -> list[AppDef]:
    apps: list[AppDef] = []
    for item in raw_apps:
        cwd = _resolve(str(item.get("cwd", ".")))
        apps.append(
            AppDef(
                id=str(item["id"]),
                name=str(item.get("name", item["id"])),
                icon=str(item.get("icon", item["id"])),
                port=int(item["port"]),
                cwd=cwd,
                service_script=str(item.get("service_script", "./service.sh")),
                health_path=str(item.get("health_path", "/") or "/"),
            )
        )
    return apps


def _build_settings(raw: dict[str, Any]) -> Settings:
    apps = _parse_apps(list(raw.get("apps") or []))
    by_id = {a.id: a for a in apps}
    order = [x for x in list(raw.get("order") or []) if x in by_id]
    for a in apps:
        if a.id not in order:
            order.append(a.id)
    return Settings(
        host=str(raw.get("host", "0.0.0.0")),
        port=int(raw.get("port", 12000)),
        apps=apps,
        order=order,
        apps_by_id=by_id,
    )


def load_raw() -> dict[str, Any]:
    return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))


def load_settings() -> Settings:
    return _build_settings(load_raw())


def save_order(new_order: list[str]) -> Settings:
    with _lock:
        raw = load_raw()
        apps = _parse_apps(list(raw.get("apps") or []))
        known = {a.id for a in apps}
        cleaned = [x for x in new_order if x in known]
        for a in apps:
            if a.id not in cleaned:
                cleaned.append(a.id)
        raw["order"] = cleaned
        CONFIG_PATH.write_text(
            json.dumps(raw, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        return _build_settings(raw)


settings = load_settings()
