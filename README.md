# 运动会人员考勤系统

> 一套基于网页的人员考勤系统：支持从后端创建初始员工与管理员账号，用于记录出勤。

一套**零第三方依赖**的运动会（或任何多时段活动）人员考勤系统：Node.js 原生 HTTP 服务 +
SQLite（`node:sqlite`）+ 原生前端，支持多组多人协同填报、权限隔离、Excel 导出、Android App。

> 本仓库是**脱敏的通用版本**：人员名单、账号、域名、机构名全部为占位数据。
> 它可以直接运行，也适合作为你自建考勤系统的起点。

## 一、它解决什么问题

一场大型活动通常有几十名工作人员、分成若干小组、跨多个半天、每个半天又分成若干时段。
需要回答三个问题：**谁在岗、谁迟到、谁请假**，并且要能按组导出成表格交上去。

- **多人协同**：每组一个（或几个）组长账号，只能改自己组的人，互不干扰。
- **一人多组**：同一个人兼任两个组时只建一条记录，任一组长填报，其他组自动可见。
- **按格填报**：行是人、列是日期×时段，点格子选状态（在岗 / 迟到 / 请假 / 未到 …）。
- **一键导出**：按日期、时段、组别任意组合导出 xlsx，自动统计工作小时。
- **开箱即用**：无 npm 依赖，`node src/server.js` 即可，一台最小规格云主机绰绰有余。

## 二、三步跑起来

```bash
# 1. 启动（首次会自动建库，并写入示例名单、分组、账号）
node src/server.js

# 2. 浏览器打开
#    http://服务器IP:3000

# 3. 用 admin / testpass0001 登录（系统会强制你先改密码）
```

要求 **Node.js ≥ 22.5**（需要内置的 `node:sqlite`）：

```bash
node -v          # v22.5.0 以上
```

自定义端口与初始密码：

```bash
PORT=8080 KAOQIN_DEFAULT_PASSWORD='你的初始密码' node src/server.js
```

## 三、账号与权限

| 角色 | 能做什么 |
| --- | --- |
| 管理员 | 查看全部人员、修改设置、管理账号、重置密码、导出 Excel |
| 组长 | 只能查看和填报自己负责的组；导出中只含自己的组 |

- 名单、分组、账号都在 `src/data/roster.example.js` 里定义（见下方"改成你自己的名单"）。
- 初始密码对所有人统一，**首次登录强制修改**，未改密码前不能填报。
- 管理员可在"账号管理"里重置某人的密码（重置回初始密码）。

## 四、怎么填

1. 顶栏选**日期**，再点状态按钮（在岗 / 迟到 / 请假 / 未到 / 未标记）。
2. 点格子即应用当前选中的状态 —— **先选标记，再点格子**。
3. 需要批量处理时用工具栏的批量按钮（全部在岗 / 全部清空等）。
4. 状态格子自带颜色，一眼能看出异常；"只看异常"可过滤出迟到与请假。
5. 人员行末尾有**备注**列，可写"兼任摄影组""临时调岗"等说明。

## 五、导出 Excel

管理员点击顶栏的导出按钮，会弹出范围对话框：

- **日期**：多选，含"全部"
- **时段**：多选，含"全部"
- **组别**：多选，含"全部"

导出文件名形如 `考勤表-日期-时段-组别-导出时间-账号.xlsx`，内含按组拆分的工作表、
每人每天的在岗/迟到/请假统计与**工作小时**（在岗 + 迟到按每格 0.5 小时折算）。

## 六、部署到云服务器

### 方式 A：systemd（推荐）

```ini
# /etc/systemd/system/kaoqin.service
[Unit]
Description=Attendance System
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/kaoqin
ExecStart=/usr/bin/node src/server.js
Environment=PORT=3000
Restart=always
RestartSec=3
User=www-data

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload && systemctl enable --now kaoqin
```

### 方式 B：nginx 反向代理 + HTTPS

```nginx
server {
    listen 443 ssl http2;
    server_name your-domain.example.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

> 用 1Panel / 宝塔等面板时，选"网站 → 反向代理"，代理地址填 `http://127.0.0.1:3000`。
> 若应用跑在容器里，填**容器 IP**（如 `http://127.0.0.1:3000`），或把容器 3000 端口映射到宿主机。

### 方式 C：pm2

```bash
pm2 start src/server.js --name kaoqin
pm2 save && pm2 startup
```

### 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | 监听端口 |
| `HOST` | `0.0.0.0` | 监听地址 |
| `KAOQIN_DATA_DIR` | `./data` | 数据库目录 |
| `KAOQIN_DEFAULT_PASSWORD` | `testpass0001` | 初始密码 / 重置密码时的目标密码 |
| `KAOQIN_DB` | `$KAOQIN_DATA_DIR/kaoqin.db` | 数据库文件路径 |
| `KAOQIN_EXPORT_DIR` | 系统临时目录 | 导出文件暂存目录（10 分钟后自动清理） |

### 数据备份

```bash
# 每天 22:00 备份
0 22 * * * cp /opt/kaoqin/data/kaoqin.db /backup/kaoqin-$(date +\%F).db
```

## 七、本地自测

```bash
npm test              # 端到端：登录、权限、填报、统计、导出、页面
npm run test:frontend # 只跑前端静态自检
```

测试会在临时目录里新建一个独立数据库，不影响 `data/` 里的正式数据。

## 八、目录结构

```
src/
  server.js         HTTP 路由与静态文件服务
  db.js             SQLite 建表、播种、会话、账号
  permissions.js    权限判定（管理员 / 组长 / 可编辑组）
  attendance.js     填报变更的落库与越权校验
  xlsx.js           Excel（xlsx / xls）生成
  zip.js            最小 ZIP 写入器（无第三方依赖）
  data/
    roster.example.js   名单、分组、账号（改成你自己的）
public/
  index.html app.js styles.css   原生前端（无框架、无构建）
test/
  smoke.js run-all.js frontend.js
deploy/
  start.sh watchdog.sh backup.sh 部署与看护脚本
  android/                       WebView 壳 App 的构建脚本与源码
  docs/                          使用手册生成脚本
tools/
  reset-password.js              命令行重置密码
  publish/                       本项目的脱敏发布工具
docs/
  manual.md                      使用手册
```

## 九、改成你自己的名单

编辑 `src/data/roster.example.js`（或复制成 `src/data/roster.js` 并改 `src/db.js` 里的
`require` 路径）：

```js
const GROUPS = [
  { key: 'group_a', name: '甲组', sort: 1 },
];

const MEMBERS = [
  { name: '张三', cls: '一班', primary: 'group_a', role: '组长', extra: [], note: '' },
  { name: '李四', cls: '二班', primary: 'group_a', role: '组员', extra: [], note: '' },
];

const ACCOUNTS = [
  { username: 'admin', display: '系统管理员', admin: true, groups: [] },
  { username: 'leader1', display: '张三（甲组组长）', admin: false, groups: ['group_a'] },
];

const DEFAULT_DATES = ['2026-09-01'];
const TITLE = '某活动人员考勤表';
```

改完删掉旧数据库重新播种（**会清空已有填报数据**）：

```bash
rm -f data/kaoqin.db* && node src/server.js
```

也可以直接在网页"设置"里改标题、机构名、活动日期，无需改代码。

## 十、安全说明

- 密码以 **scrypt** 加盐哈希存储，数据库里没有明文；任何人（包括管理员）都无法读回旧密码。
- 会话为 `HttpOnly` Cookie，有效期 180 天；管理员重置密码后建议让对方重新登录。
- 服务本身不做 HTTPS，请务必放在 nginx / Caddy / 面板之后，或只在内网使用。
- 数据库文件（`data/*.db`）、备份、安卓签名私钥都应**排除在版本控制之外**。

## 十一、如何同步到自己的 Git 仓库
本项目的发布工具用"**白名单 + 内容脱敏 + 发布前扫描**"三道关卡，保证人员名单、账号、
数据库、签名私钥、真实域名不会被误传到公开仓库。

```bash
# 1. 干跑：生成发布树并扫描，不推送
node tools/publish/publish.js

# 2. 确认文件清单无误后推送
tools/auto-push.sh git@github.com:you/your-repo.git

# 3. 自测整条链路（建一个本地裸仓库当远端，不联网）
tools/auto-push.sh --self-test
```

- `.publishignore` 是**白名单**（默认拒绝，逐条放行），漏写只会少传文件，不会多传。
- `.gitignore` 也是白名单写法：`*` 忽略全部，再 `!` 逐条放行。
- 每次发布会自动：替换真实姓名/账号/域名/口令 → 校验关键文件齐全 → 全文扫描 → 核对 git 索引 → 推送。
- 定时上传：环境有 cron 就用 cron，没有就拉起内置守护进程。

```bash
# cron：每小时一次
0 * * * * cd /opt/kaoqin && GIT_TOKEN=xxx tools/auto-push.sh >> .tmp/auto-push.log 2>&1

# 无 cron 的容器环境：常驻守护
INTERVAL_MIN=60 nohup tools/auto-push-daemon.sh >> .tmp/auto-push.log 2>&1 &
```

HTTPS 方式用 Personal Access Token 认证，token 只存在于当次进程变量中，**不会写进任何文件**。

## 十二、许可

仅供内部使用与学习参考。

