(() => {
  const grid = document.getElementById("app-grid");
  const menuModal = document.getElementById("menu-modal");
  const statusModal = document.getElementById("status-modal");
  const settingsModal = document.getElementById("settings-modal");
  const orderList = document.getElementById("order-list");

  let apps = [];
  let selected = null;
  let draftOrder = [];
  let busy = false;

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
      btn.innerHTML = `
        <span class="icon-wrap">
          <img src="${iconUrl(app.icon)}" alt="" />
          <span class="lamp ${app.lamp || "gray"}" title="${escapeAttr(app.state)}"></span>
        </span>
        <span class="app-name">${escapeHtml(app.name)}</span>
      `;
      btn.addEventListener("click", () => openMenu(app.id));
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

  async function refresh() {
    const data = await api("/api/apps");
    apps = data.apps || [];
    renderGrid();
    if (selected) {
      const fresh = apps.find((a) => a.id === selected.id);
      if (fresh) {
        selected = fresh;
        syncMenuButtons();
      }
    }
  }

  function showModal(el) {
    el.hidden = false;
  }

  function hideModal(el) {
    el.hidden = true;
  }

  function openMenu(id) {
    const app = apps.find((a) => a.id === id);
    if (!app) return;
    selected = app;
    document.getElementById("menu-title").textContent = app.name;
    document.getElementById("menu-sub").textContent =
      `端口 ${app.port} · ${stateLabel(app)}`;
    document.getElementById("menu-icon").src = iconUrl(app.icon);
    syncMenuButtons();
    showModal(menuModal);
  }

  function stateLabel(app) {
    if (app.state === "running") return "运行中";
    if (app.state === "error") return "异常";
    return "已停止";
  }

  function syncMenuButtons() {
    if (!selected) return;
    const startBtn = document.getElementById("act-start");
    const stopBtn = document.getElementById("act-stop");
    startBtn.disabled = !selected.can_start || busy;
    stopBtn.disabled = !selected.can_stop || busy;
    menuModal.querySelector(".modal")?.classList.toggle("busy", busy);
  }

  document.getElementById("act-open").addEventListener("click", () => {
    if (!selected) return;
    window.open(openUrlFor(selected), "_blank", "noopener");
  });

  document.getElementById("act-start").addEventListener("click", async () => {
    if (!selected || busy) return;
    busy = true;
    syncMenuButtons();
    try {
      await api(`/api/apps/${selected.id}/start`, { method: "POST" });
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
    busy = true;
    syncMenuButtons();
    try {
      await api(`/api/apps/${selected.id}/stop`, { method: "POST" });
      await refresh();
    } catch (e) {
      alert(`停止失败：${e.message}`);
      await refresh();
    } finally {
      busy = false;
      syncMenuButtons();
    }
  });

  document.getElementById("act-status").addEventListener("click", async () => {
    if (!selected) return;
    document.getElementById("status-title").textContent = `${selected.name} · 状态`;
    document.getElementById("status-body").textContent = "加载中…";
    showModal(statusModal);
    try {
      const st = await api(`/api/apps/${selected.id}/status`);
      const lines = [
        `名称: ${st.name}`,
        `端口: ${st.port}`,
        `状态: ${st.state} (${st.lamp})`,
        `摘要: ${st.message || ""}`,
        "",
        st.detail || "",
      ];
      document.getElementById("status-body").textContent = lines.join("\n");
    } catch (e) {
      document.getElementById("status-body").textContent = `获取失败：${e.message}`;
    }
  });

  document.getElementById("btn-settings").addEventListener("click", () => {
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

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    [statusModal, settingsModal, menuModal].forEach((m) => {
      if (!m.hidden) hideModal(m);
    });
  });

  refresh().catch((e) => {
    grid.innerHTML = `<p class="lead">加载失败：${escapeHtml(e.message)}</p>`;
  });
  setInterval(() => {
    refresh().catch(() => {});
  }, 5000);
})();
