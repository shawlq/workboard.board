# Work Board 文档

本文档说明如何向 Work Board 注册新的子应用，供人工与 AI Agent 快速接入。

相关路径：

| 路径 | 用途 |
|------|------|
| [`../config.json`](../config.json) | 子应用注册表与显示顺序 |
| [`../static/icons/`](../static/icons/) | 子应用 SVG 图标 |
| [`../app/services.py`](../app/services.py) | 调用 `service.sh` 与 HTTP 探活 |
| `~/workdir/workboard/<app>/` | 建议的子应用落盘目录（与 `notes_browser` 等同级） |

Work Board 自身监听 **12000**，不代理子应用流量，只负责管控与跳转。

---

## 如何添加子应用

### 总览（Agent 检查清单）

1. 子应用目录具备可执行的 `service.sh`，支持 `start|stop|status`（建议也支持 `restart`）。
2. 子应用有固定 **HTTP 端口**，本机 `127.0.0.1:<port><health_path>` 可探活。
3. 在 `board/config.json` 的 `apps` 中新增一条注册项，并把 `id` 追加到 `order`。
4. 在 `board/static/icons/` 放置 `{icon}.svg`，与配置里的 `icon` 字段一致。
5. 执行 `chmod +x` 服务脚本；用 `./service.sh status|start|stop` 自测；刷新 Work Board 页面确认状态灯。

**通常不必改** Python / 前端代码：注册表驱动即可。

---

### 1. 子应用依赖要求

Work Board 对子应用的唯一硬约定是：**在指定工作目录执行服务脚本**。

#### 1.1 `service.sh` 契约（必须）

| 要求 | 说明 |
|------|------|
| 位置 | 默认 `./service.sh`（相对 `cwd`）；也可在配置里写其它路径 |
| 可执行 | `chmod +x service.sh` |
| 子命令 | 至少支持 `start`、`stop`、`status` |
| 工作目录 | 脚本内应 `cd "$(dirname "$0")"`，不依赖调用方 cwd 之外的相对路径假设 |
| `status` 退出码 | **运行中 → 0**；**已停止 → 非 0**（通常 1） |
| `start` / `stop` | 成功 → 0；失败 → 非 0；stdout/stderr 打印可读信息 |
| 后台化 | `start` 必须拉起守护进程后**退出**（勿前台挂住），否则面板请求会超时 |
| 幂等 | 已运行再 `start`、已停止再 `stop` 应安全返回成功或明确提示 |

参考实现（进程 + pidfile + 端口探测）：

- [`../../notes_browser/service.sh`](../../notes_browser/service.sh)
- [`../../transfer_hub/service.sh`](../../transfer_hub/service.sh)

Docker 类参考：

- [`../../webui/service.sh`](../../webui/service.sh)

最小行为约定示例：

```bash
./service.sh status   # running → exit 0；stopped → exit 1
./service.sh start    # 后台启动；已在跑则直接成功
./service.sh stop     # 停止；未在跑则直接成功
```

#### 1.2 端口与探活（必须）

| 项 | 说明 |
|----|------|
| 端口 | 子应用对外 HTTP 端口；与 `config.json` 里 `apps[].port` **一致** |
| 探活 | Work Board 在脚本报 running 后请求 `http://127.0.0.1:{port}{health_path}` |
| `health_path` | 默认 `/`；需返回 **2xx/3xx**（跟随重定向） |
| 「打开」 | 前端用当前页面的 `hostname` + 子应用 `port` 拼 `http://{host}:{port}/`（自动适配 Tailscale `100.x` / 内网 `192.168.x`） |

端口冲突请避开现有占用：

| 服务 | 端口 |
|------|------|
| Transfer Hub | 8765 |
| Notes Browser | 8766 |
| Work Board | 12000 |
| LocalWebui | 13000 |

#### 1.3 路径与目录布局（建议）

推荐：

```text
~/workdir/workboard/
├── board/                 # Work Board 本应用
├── notes_browser/         # 子应用示例
├── transfer_hub/
├── webui/                 # 仅 service.sh 封装 Docker 亦可
└── <new_app>/             # 新子应用
    ├── service.sh         # 必须
    ├── config.json        # 建议：内含 port，供 service.sh 读取
    └── ...
```

`board/config.json` 中 `cwd` 推荐写成相对 `board/` 的路径，例如 `"../my_app"`；也支持绝对路径与 `~`。

#### 1.4 其它建议（非必须）

- 本地进程类：提供 `run.sh`（前台）、`service.log`、`.service.pid`，与现有子应用一致。
- Docker 类：`status` 用 `docker ps`；`start` 优先 `docker start`，容器不存在再走创建脚本。
- 鉴权：面板不代管登录；子应用自行处理。
- 不要让 `start` 占用 stdout 管道不退出（需 `nohup`/redirect + 后台 `&`）。

---

### 2. 在 `config.json` 中注册

编辑 [`../config.json`](../config.json)：

```json
{
  "host": "0.0.0.0",
  "port": 12000,
  "apps": [
    {
      "id": "my_app",
      "name": "MyApp",
      "icon": "my_app",
      "port": 8768,
      "cwd": "../my_app",
      "service_script": "./service.sh",
      "health_path": "/"
    }
  ],
  "order": ["notes_browser", "transfer_hub", "webui", "my_app"]
}
```

#### 字段说明

| 字段 | 必填 | 说明 |
|------|------|------|
| `id` | 是 | 唯一 ID，API 路径 `/api/apps/{id}/...` 使用；建议 snake_case |
| `name` | 是 | 面板显示名 |
| `icon` | 是 | 图标名，对应 `static/icons/{icon}.svg`（不含扩展名） |
| `port` | 是 | 子应用 HTTP 端口 |
| `cwd` | 是 | 执行服务脚本前的工作目录（相对 `board/` 或绝对） |
| `service_script` | 是 | 相对 `cwd` 或绝对路径，默认 `./service.sh` |
| `health_path` | 否 | 探活路径，默认 `/` |
| `order` | 是 | 顶层数组：图标从左到右、从上到下的显示顺序；可在 UI「设置」里改并写回 |

修改 `config.json` 后，列表接口会重新加载；若面板进程异常旧缓存，执行 `./service.sh restart`。

---

### 3. 添加图标

1. 新增 SVG 文件：`board/static/icons/{icon}.svg`
2. `icon` 字段与文件名（无 `.svg`）一致，例如 `icon: "my_app"` → `my_app.svg`
3. 建议：
   - `viewBox="0 0 64 64"`
   - 深色底 + 青绿/蓝点缀，与现有 Notes / TransHub / LocalWebui 风格接近
   - 避免依赖外链字体或过大资源

现有图标：`notes.svg`、`transhub.svg`、`webui.svg`。

前端通过 `/static/icons/{icon}.svg` 加载；**无需改 JS**。

---

### 4. 端到端添加步骤（复制即用）

以新应用 `demo`、端口 `8768` 为例：

```bash
# 1) 准备子应用目录与 service.sh（可从 notes_browser 复制后改 NAME/PORT）
mkdir -p ~/workdir/workboard/demo
# ... 实现 service.sh / 业务服务 ...
chmod +x ~/workdir/workboard/demo/service.sh
~/workdir/workboard/demo/service.sh status   # 期望 stopped, exit 1
~/workdir/workboard/demo/service.sh start
~/workdir/workboard/demo/service.sh status   # 期望 running, exit 0
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8768/

# 2) 图标
# 写入 ~/workdir/workboard/board/static/icons/demo.svg

# 3) 注册：编辑 board/config.json，追加 apps[] 项，并把 "demo" 加入 order

# 4) 验证面板 API（Work Board 需在跑）
curl -s http://127.0.0.1:12000/api/apps | python3 -m json.tool
curl -s -X POST http://127.0.0.1:12000/api/apps/demo/start
curl -s http://127.0.0.1:12000/api/apps/demo/status
```

浏览器打开 Work Board → 应出现新图标；点击可「打开 / 启动 / 停止 / 状态」。

---

### 5. 状态灯含义（验收用）

| 灯 | 条件 |
|----|------|
| 绿 | `service.sh status` 退出 0，且本机 HTTP 探活成功 |
| 灰 | 脚本报已停止 |
| 红 | 脚本报运行中但探活失败，或最近一次 start 失败等异常 |

---

### 6. Agent 常见错误

| 错误 | 后果 | 处理 |
|------|------|------|
| `status` 运行中却返回非 0 | 永远灰灯 | 修正退出码约定 |
| `start` 前台不退出 | 面板启动按钮一直转圈/超时 | 后台化 + 日志重定向 |
| `port` 与真实监听不一致 | 绿灯变红或打开错误地址 | 对齐 config 与服务配置 |
| 缺少 `icons/{icon}.svg` | 图标裂图 | 补 SVG 或改 `icon` 名 |
| `id` 重复或未进 `order` | 覆盖/不显示 | 保证唯一并写入 `order` |
| `cwd` 指错目录 | start 失败 | 用相对 `board/` 的 `../xxx` 或绝对路径 |

---

### 7. 现有子应用一览

| name | id | port | cwd | 备注 |
|------|-----|------|-----|------|
| Notes | `notes_browser` | 8766 | `../notes_browser` | FastAPI 本地进程 |
| TransHub | `transfer_hub` | 8765 | `../transfer_hub` | FastAPI 本地进程 |
| LocalWebui | `webui` | 13000 | `../webui` | Docker `open-webui` |
