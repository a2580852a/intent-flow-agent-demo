# Intent-Flow Agent Demo
![架构草图](/draft.png)
一个围绕 `RAG + 多级反馈闭环` 方案实现的全栈 Web 平台原型，包含：

- 前台任务工作台：意图识别、场景路由、Schema 抽取、用户修订、后端校验
- 后台管理界面：场景注册表、Schema 编辑、知识引用、后端规则配置、任务监控
- 本地数据层：使用 `data/*.json` 作为可读写配置与运行态存储

## 技术栈

- Next.js App Router
- TypeScript
- 原生 CSS
- Node 文件系统作为轻量 mock repository

## 页面

- `/` 产品概览
- `/workspace` 任务工作台
- `/admin` 后台管理

## 运行

```bash
npm install
npm run dev
```

如果你要接入真实大模型，在项目根目录新增 `.env.local`：

```bash
MOONSHOT_API_KEY=你的密钥
MOONSHOT_BASE_URL=https://api.moonshot.cn/v1
MOONSHOT_MODEL=kimi-k2-turbo-preview
```

平台会自动采用 `OpenAI-compatible SDK -> Moonshot/Kimi` 的方式执行：

- 任务创建时的场景路由与 Schema 抽取
- 用户修订时的字段补丁提取

如果没有配置密钥，系统会自动回退到本地启发式规则，仍然可以完整演示整条业务链路。

默认会读取并写入：

- `data/scenarios.json`
- `data/tasks.json`

## 核心实现

- `lib/agent.ts`
  - 场景路由
  - Schema 自动抽取
  - 用户反馈合并
  - 后端校验模拟
- `lib/llm.ts`
  - Moonshot / Kimi 的 OpenAI 兼容调用封装
  - 任务规划与字段修订的 JSON 输出解析
- `lib/store.ts`
  - 场景与任务的读写仓储
  - 仪表盘统计
- `components/task-workspace.tsx`
  - 前台任务工作台
- `components/admin-console.tsx`
  - 后台配置台

## 后续可演进方向

- 接入真实 LLM Function Calling
- 将 RAG 检索替换为向量数据库
- 将本地 JSON 仓储升级为 PostgreSQL / Redis / 对象存储
- 引入 RBAC、审计日志、多租户和工作流审批节点
