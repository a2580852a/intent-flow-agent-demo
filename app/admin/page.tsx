import { AdminConsole } from "@/components/admin-console";
import { getScenarios, getTasks } from "@/lib/store";

export default async function AdminPage() {
  const [scenarios, tasks] = await Promise.all([getScenarios(), getTasks()]);
  return <AdminConsole initialScenarios={scenarios} initialTasks={tasks} />;
}
