import { TaskWorkspace } from "@/components/task-workspace";
import { getScenarios, getTasks } from "@/lib/store";

interface WorkspacePageProps {
  searchParams?: Promise<{ taskId?: string }>;
}

export default async function WorkspacePage({ searchParams }: WorkspacePageProps) {
  const [scenarios, tasks] = await Promise.all([getScenarios(), getTasks()]);
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  return <TaskWorkspace initialScenarios={scenarios} initialTasks={tasks} initialActiveTaskId={resolvedSearchParams?.taskId} />;
}
