from __future__ import annotations

from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from app import services
from app.config import ROOT, load_settings, save_order

STATIC_DIR = ROOT / "static"

app = FastAPI(title="Work Board", version="1.0.0")
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


class OrderIn(BaseModel):
    order: list[str] = Field(..., min_length=1)


@app.get("/", response_class=HTMLResponse)
async def index() -> HTMLResponse:
    index_path = STATIC_DIR / "index.html"
    return HTMLResponse(index_path.read_text(encoding="utf-8"))


@app.get("/api/apps")
async def api_apps() -> dict:
    cfg = load_settings()
    items = await services.list_apps(cfg)
    return {"apps": items, "order": cfg.order}


@app.get("/api/apps/{app_id}/status")
async def api_status(app_id: str) -> dict:
    cfg = load_settings()
    if app_id not in cfg.apps_by_id:
        raise HTTPException(status_code=404, detail=f"unknown app: {app_id}")
    return await services.detailed_status(app_id, cfg)


@app.post("/api/apps/{app_id}/start")
async def api_start(app_id: str) -> dict:
    cfg = load_settings()
    if app_id not in cfg.apps_by_id:
        raise HTTPException(status_code=404, detail=f"unknown app: {app_id}")
    return await services.start_app(app_id, cfg)


@app.post("/api/apps/{app_id}/stop")
async def api_stop(app_id: str) -> dict:
    cfg = load_settings()
    if app_id not in cfg.apps_by_id:
        raise HTTPException(status_code=404, detail=f"unknown app: {app_id}")
    return await services.stop_app(app_id, cfg)


@app.put("/api/order")
async def api_order(body: OrderIn) -> dict:
    cfg = save_order(body.order)
    items = await services.list_apps(cfg)
    return {"ok": True, "order": cfg.order, "apps": items}
