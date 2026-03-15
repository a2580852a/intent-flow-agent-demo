import Link from "next/link";
import { getDashboardSnapshot, getScenarios, getTasks } from "@/lib/store";

function statusLabel(input: string) {
  if (input === "completed") {
    return "已完成";
  }

  if (input === "awaiting_backend") {
    return "待后端校验";
  }

  return "待用户确认";
}

export default async function HomePage() {
  const [dashboard, scenarios, tasks] = await Promise.all([
    getDashboardSnapshot(),
    getScenarios(),
    getTasks()
  ]);

  const latestTasks = tasks.slice(0, 3);

  return (
    <div className="page-stack">
      <section className="hero hero-home">
        <div>
          <span className="eyebrow">Platform Overview</span>
          <h1>把你的 Intent-Flow Agent 方案直接做成可运营的 Web 平台</h1>
          <p>
            平台将意图识别、RAG Schema 检索、自动抽取、用户反馈和后端校验串成一个完整闭环，同时提供后台管理界面用于场景扩展与规则治理。
          </p>
          <div className="hero-actions">
            <Link className="button-primary" href="/workspace">
              进入任务工作台
            </Link>
            <Link className="button-secondary" href="/admin">
              打开后台管理
            </Link>
          </div>
        </div>
        <div className="overview-card">
          <div className="overview-card__row">
            <span>已接入场景</span>
            <strong>{dashboard.scenarioCount}</strong>
          </div>
          <div className="overview-card__row">
            <span>任务总量</span>
            <strong>{dashboard.taskCount}</strong>
          </div>
          <div className="overview-card__row">
            <span>闭环完成</span>
            <strong>{dashboard.completedTasks}</strong>
          </div>
          <div className="overview-card__row">
            <span>抽取完整度</span>
            <strong>{dashboard.averageCompletion}%</strong>
          </div>
        </div>
      </section>

      <section className="stats-grid">
        <article className="metric-card">
          <span>Planning & Routing</span>
          <strong>LLM + 场景库</strong>
          <p>自动把自然语言诉求导航到业务域，并支持人工兜底选择。</p>
        </article>
        <article className="metric-card">
          <span>RAG & Schema</span>
          <strong>Schema-as-Knowledge</strong>
          <p>按场景索引 Schema、知识片段与校验策略，统一前后端契约。</p>
        </article>
        <article className="metric-card">
          <span>Feedback Loops</span>
          <strong>User + Backend</strong>
          <p>用户修订与系统校验共同推动 schema_final 持续收敛。</p>
        </article>
      </section>

      <section className="landing-grid">
        <article className="panel">
          <div className="panel-header">
            <div>
              <span className="eyebrow">Scenario Registry</span>
              <h2>当前接入场景</h2>
            </div>
          </div>
          <div className="scenario-gallery">
            {scenarios.map((scenario) => (
              <article className="scenario-card" key={scenario.id}>
                <div className="task-list__title">
                  <strong>{scenario.name}</strong>
                  <span className="status-pill tone-info">{scenario.category}</span>
                </div>
                <p>{scenario.description}</p>
                <small>{scenario.schema.length} 个字段 · {scenario.backendChecks.length} 条后端校验</small>
              </article>
            ))}
          </div>
        </article>

        <article className="panel">
          <div className="panel-header">
            <div>
              <span className="eyebrow">Runtime</span>
              <h2>最近任务</h2>
            </div>
          </div>
          <div className="task-list">
            {latestTasks.map((task) => (
              <div className="task-list__item task-list__item--static" key={task.id}>
                <div className="task-list__title">
                  <strong>{task.scenarioName}</strong>
                  <span className="status-pill tone-warning">{statusLabel(task.status)}</span>
                </div>
                <p>{task.request}</p>
                <small>完整度 {task.extraction.completionRate}%</small>
              </div>
            ))}
          </div>
        </article>
      </section>
    </div>
  );
}
