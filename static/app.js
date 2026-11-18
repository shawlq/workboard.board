(() => {
  const grid = document.getElementById("app-grid");
  const dropdown = document.getElementById("app-dropdown");
  const statusModal = document.getElementById("status-modal");
  const settingsModal = document.getElementById("settings-modal");
  const orderList = document.getElementById("order-list");

  let apps = [];
  let selected = null;
  let dropdownOpen = false;
  let draftOrder = [];
  let busy = false;
  let statusAppId = null;
  let statusPollTimer = null;

  const iconUrl = (icon) => `/static/icons/${icon}.svg`;

  function openUrlFor(app) {
    const host = window.location.hostname;
    return `http://${host}:${app.port}/`;
  }

  async function api(path, opts = {}) {
    const res = await fetch(path, {
      headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
      ...opts,
    });
    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    if (!res.ok) {
      const detail = (data && (data.detail || data.message)) || res.statusText;
      throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
    }
    return data;
  }

  function renderGrid() {
    grid.innerHTML = "";
    for (const app of apps) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "app-tile";
      btn.setAttribute("role", "listitem");
      btn.dataset.id = app.id;
      if (dropdownOpen && selected && selected.id === app.id) {
        btn.classList.add("menu-open");
      }
      btn.innerHTML = `
        <span class="icon-wrap">
          <img src="${iconUrl(app.icon)}" alt="" />
          <span class="lamp ${app.lamp || "gray"}" title="${escapeAttr(app.state)}"></span>
        </span>
        <span class="app-name">${escapeHtml(app.name)}</span>
      `;
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleDropdown(btn, app.id);
      });
      grid.appendChild(btn);
    }
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function escapeAttr(s) {
    return escapeHtml(s).replace(/'/g, "&#39;");
  }

  function tileFor(id) {
    return grid.querySelector(`.app-tile[data-id="${CSS.escape(id)}"]`);
  }

  function positionDropdown(tile) {
    const rect = tile.getBoundingClientRect();
    dropdown.hidden = false;
    const ddRect = dropdown.getBoundingClientRect();
    const gap = 6;
    let left = rect.left + (rect.width - ddRect.width) / 2;
    let top = rect.bottom + gap;
    const pad = 8;
    left = Math.max(pad, Math.min(left, window.innerWidth - ddRect.width - pad));
    if (top + ddRect.height > window.innerHeight - pad) {
      top = Math.max(pad, rect.top - ddRect.height - gap);
    }
    dropdown.style.left = `${Math.round(left)}px`;
    dropdown.style.top = `${Math.round(top)}px`;
  }

  function hideDropdown() {
    if (!dropdownOpen) return;
    dropdownOpen = false;
    dropdown.hidden = true;
    grid.querySelectorAll(".app-tile.menu-open").forEach((el) => {
      el.classList.remove("menu-open");
    });
  }

  function showDropdown(tile, id) {
    const app = apps.find((a) => a.id === id);
    if (!app || !tile) return;
    selected = app;
    dropdownOpen = true;
    grid.querySelectorAll(".app-tile.menu-open").forEach((el) => {
      el.classList.remove("menu-open");
    });
    tile.classList.add("menu-open");
    syncMenuButtons();
    positionDropdown(tile);
  }

  function toggleDropdown(tile, id) {
    if (dropdownOpen && selected && selected.id === id) {
      hideDropdown();
      return;
    }
    showDropdown(tile, id);
  }

  function reanchorDropdown() {
    if (!dropdownOpen || !selected) return;
    const tile = tileFor(selected.id);
    if (!tile) {
      hideDropdown();
      return;
    }
    tile.classList.add("menu-open");
    positionDropdown(tile);
  }

  async function refresh() {
    const data = await api("/api/apps");
    apps = data.apps || [];
    renderGrid();
    if (selected) {
      const fresh = apps.find((a) => a.id === selected.id);
      if (fresh) {
        selected = fresh;
        syncMenuButtons();
      } else {
        hideDropdown();
        selected = null;
      }
    }
    reanchorDropdown();
  }

  function showModal(el) {
    el.hidden = false;
  }

  function hideModal(el) {
    el.hidden = true;
    if (el === statusModal) stopStatusPoll();
  }

  function syncMenuButtons() {
    if (!selected) return;
    const startBtn = document.getElementById("act-start");
    const stopBtn = document.getElementById("act-stop");
    startBtn.disabled = !selected.can_start || busy;
    stopBtn.disabled = !selected.can_stop || busy;
    dropdown.classList.toggle("busy", busy);
  }

  dropdown.addEventListener("click", (e) => {
    e.stopPropagation();
  });

  document.getElementById("act-open").addEventListener("click", () => {
    if (!selected) return;
    window.open(openUrlFor(selected), "_blank", "noopener");
    hideDropdown();
  });

  document.getElementById("act-start").addEventListener("click", async () => {
    if (!selected || busy) return;
    const id = selected.id;
    busy = true;
    syncMenuButtons();
    hideDropdown();
    try {
      await api(`/api/apps/${id}/start`, { method: "POST" });
      await refresh();
    } catch (e) {
      alert(`启动失败：${e.message}`);
      await refresh();
    } finally {
      busy = false;
      syncMenuButtons();
    }
  });

  document.getElementById("act-stop").addEventListener("click", async () => {
    if (!selected || busy) return;
    const app = selected;
    const ok = window.confirm(`确定要停止「${app.name}」吗？`);
    if (!ok) return;
    busy = true;
    syncMenuButtons();
    hideDropdown();
    try {
      await api(`/api/apps/${app.id}/stop`, { method: "POST" });
      await refresh();
    } catch (e) {
      alert(`停止失败：${e.message}`);
      await refresh();
    } finally {
      busy = false;
      syncMenuButtons();
    }
  });

  function applyStatusToApps(st) {
    const i = apps.findIndex((a) => a.id === st.id);
    if (i < 0) return;
    apps[i] = {
      ...apps[i],
      state: st.state,
      lamp: st.lamp,
      message: st.message,
      can_start: st.can_start,
      can_stop: st.can_stop,
    };
    if (selected && selected.id === st.id) selected = apps[i];
    renderGrid();
  }

  function formatStatusBody(st) {
    const now = new Date();
    const stamp = now.toLocaleTimeString("zh-CN", { hour12: false });
    return [
      `名称: ${st.name}`,
      `端口: ${st.port}`,
      `状态: ${st.state} (${st.lamp})`,
      `摘要: ${st.message || ""}`,
      `查询时间: ${stamp}`,
      "",
      st.detail || "",
    ].join("\n");
  }

  function stopStatusPoll() {
    if (statusPollTimer != null) {
      clearInterval(statusPollTimer);
      statusPollTimer = null;
    }
    statusAppId = null;
  }

  async function loadStatusDetail(appId, { silent = false } = {}) {
    if (!silent) {
      document.getElementById("status-body").textContent = "实时查询中…";
    }
    try {
      const st = await api(`/api/apps/${appId}/status`);
      if (statusAppId !== appId) return null;
      applyStatusToApps(st);
      document.getElementById("status-body").textContent = formatStatusBody(st);
      return st;
    } catch (e) {
      if (statusAppId !== appId) return null;
      document.getElementById("status-body").textContent = `获取失败：${e.message}`;
      return null;
    }
  }

  function startStatusPoll(appId) {
    stopStatusPoll();
    statusAppId = appId;
    statusPollTimer = setInterval(() => {
      if (statusModal.hidden || statusAppId !== appId) {
        stopStatusPoll();
        return;
      }
      loadStatusDetail(appId, { silent: true }).catch(() => {});
    }, 3000);
  }

  document.getElementById("act-status").addEventListener("click", async () => {
    if (!selected) return;
    const app = selected;
    hideDropdown();
    document.getElementById("status-title").textContent = `${app.name} · 状态`;
    showModal(statusModal);
    startStatusPoll(app.id);
    await loadStatusDetail(app.id);
  });

  document.getElementById("btn-settings").addEventListener("click", () => {
    hideDropdown();
    draftOrder = apps.map((a) => a.id);
    renderOrderList();
    showModal(settingsModal);
  });

  function renderOrderList() {
    orderList.innerHTML = "";
    draftOrder.forEach((id, idx) => {
      const app = apps.find((a) => a.id === id) || { id, name: id, icon: id };
      const li = document.createElement("li");
      li.className = "order-item";
      li.innerHTML = `
        <img src="${iconUrl(app.icon)}" alt="" />
        <span class="label">${escapeHtml(app.name)}</span>
        <span class="movers">
          <button type="button" data-move="-1" ${idx === 0 ? "disabled" : ""} aria-label="上移">↑</button>
          <button type="button" data-move="1" ${idx === draftOrder.length - 1 ? "disabled" : ""} aria-label="下移">↓</button>
        </span>
      `;
      li.querySelectorAll("[data-move]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const delta = Number(btn.dataset.move);
          const j = idx + delta;
          if (j < 0 || j >= draftOrder.length) return;
          const tmp = draftOrder[idx];
          draftOrder[idx] = draftOrder[j];
          draftOrder[j] = tmp;
          renderOrderList();
        });
      });
      orderList.appendChild(li);
    });
  }

  document.getElementById("btn-save-order").addEventListener("click", async () => {
    try {
      const data = await api("/api/order", {
        method: "PUT",
        body: JSON.stringify({ order: draftOrder }),
      });
      apps = data.apps || apps;
      renderGrid();
      hideModal(settingsModal);
    } catch (e) {
      alert(`保存失败：${e.message}`);
    }
  });

  document.querySelectorAll("[data-close]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-close");
      const el = document.getElementById(id);
      if (el) hideModal(el);
    });
  });

  document.querySelectorAll(".modal-backdrop").forEach((backdrop) => {
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) hideModal(backdrop);
    });
  });

  document.addEventListener("click", () => {
    hideDropdown();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    hideDropdown();
    [statusModal, settingsModal].forEach((m) => {
      if (!m.hidden) hideModal(m);
    });
  });

  window.addEventListener("resize", () => {
    reanchorDropdown();
  });

  refresh().catch((e) => {
    grid.innerHTML = `<p class="lead">加载失败：${escapeHtml(e.message)}</p>`;
  });
  setInterval(() => {
    refresh().catch(() => {});
  }, 5000);
})();
