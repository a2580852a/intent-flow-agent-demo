import { TaskQueue } from "@/components/task-queue";
import { getTasks } from "@/lib/store";

export default async function QueuePage() {
  const tasks = await getTasks();
  return <TaskQueue initialTasks={tasks} />;
}
