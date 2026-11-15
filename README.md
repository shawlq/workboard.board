# Work Board

工作面板：汇总管理子应用（Notes / TransHub / LocalWebui），支持启动、停止、状态查看与排序。

更完整的说明（含 **如何添加子应用**、`service.sh` 契约、图标与配置字段）见 [docs/README.md](docs/README.md)。

## 快速开始

```bash
cd ~/workdir/workboard/board
chmod +x run.sh service.sh
./service.sh start          # 后台启动，监听 12000
./service.sh status
./service.sh stop
```

前台调试：

```bash
./run.sh
```

浏览器访问：`http://<本机IP>:12000`（局域网 `192.168.x.x` 或 Tailscale `100.x.x.x`）。

## 配置 `config.json`

| 字段 | 说明 |
|------|------|
| `host` / `port` | Work Board 监听地址，默认 `0.0.0.0:12000` |
| `apps[]` | 子应用注册表 |
| `apps[].id` | 唯一 ID |
| `apps[].name` | 显示名 |
| `apps[].icon` | 对应 `static/icons/{icon}.svg` |
| `apps[].port` | 子应用端口（「打开」时拼到当前访问主机名） |
| `apps[].cwd` | 子应用工作目录（相对 board/ 或绝对路径） |
| `apps[].service_script` | 支持 `start\|stop\|status` 的脚本 |
| `apps[].health_path` | HTTP 探活路径，默认 `/` |
| `order` | 图标显示顺序；可在页面「设置」中调整并写回 |

默认已注册：

| 名称 | ID | 端口 | 服务脚本 |
|------|-----|------|----------|
| Notes | `notes_browser` | 8766 | `../notes_browser/service.sh` |
| TransHub | `transfer_hub` | 8765 | `../transfer_hub/service.sh` |
| LocalWebui | `webui` | 13000 | `../webui/service.sh`（Docker） |

## 状态灯

- **绿**：服务脚本报运行中，且本机 HTTP 探活成功
- **灰**：已停止
- **红**：运行中但探活失败，或启动失败等异常

## 依赖

- Python 3.10+
- 子应用各自的 `service.sh`（LocalWebui 需本机 Docker）
