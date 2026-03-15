import Link from "next/link";
import type { Task } from "@/lib/types";

interface TaskQueueProps {
  initialTasks: Task[];
}

function formatDateTime(iso: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(iso));
}

function statusLabel(status: Task["status"]) {
  if (status === "completed") {
    return "已完成";
  }

  if (status === "awaiting_backend") {
    return "待后端校验";
  }

  return "待用户确认";
}

function statusClass(status: Task["status"]) {
  if (status === "completed") {
    return "tone-success";
  }

  if (status === "awaiting_backend") {
    return "tone-info";
  }

  return "tone-warning";
}

export function TaskQueue({ initialTasks }: TaskQueueProps) {
  const completedCount = initialTasks.filter((task) => task.status === "completed").length;
  const pendingCount = initialTasks.length - completedCount;

  return (
    <div className="page-stack">
      <section className="hero hero-workspace">
        <div>
          <span className="eyebrow">Task Queue</span>
          <h1>任务队列</h1>
          <p>集中查看所有任务运行状态，点击任意任务可直接进入任务工作台进行处理与反馈。</p>
        </div>
        <div className="hero-highlight">
          <strong>{initialTasks.length}</strong>
          <span>任务总数</span>
          <strong>{pendingCount}</strong>
          <span>待处理任务</span>
        </div>
      </section>

      <section className="stats-grid">
        <article className="metric-card">
          <span>待处理任务</span>
          <strong>{pendingCount}</strong>
          <p>处于待用户确认或待后端校验阶段的任务。</p>
        </article>
        <article className="metric-card">
          <span>已完成任务</span>
          <strong>{completedCount}</strong>
          <p>完成双层反馈闭环并通过校验的任务。</p>
        </article>
        <article className="metric-card">
          <span>入口导航</span>
          <strong>工作台联动</strong>
          <p>从队列点击任务后，将自动定位到任务工作台中的目标任务。</p>
        </article>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <span className="eyebrow">Runtime</span>
            <h2>全部任务</h2>
          </div>
        </div>
        <div className="task-list">
          {initialTasks.map((task) => (
            <Link className="task-list__item" key={task.id} href={`/workspace?taskId=${task.id}`}>
              <div className="task-list__title">
                <strong>{task.scenarioName}</strong>
                <span className={`status-pill ${statusClass(task.status)}`}>{statusLabel(task.status)}</span>
              </div>
              <p>{task.request}</p>
              <small>
                完整度 {task.extraction.completionRate}% · 更新时间 {formatDateTime(task.updatedAt)}
              </small>
            </Link>
          ))}
          {initialTasks.length === 0 ? <p className="empty-state">暂无任务，请先在任务工作台创建任务。</p> : null}
        </div>
      </section>
    </div>
  );
}
