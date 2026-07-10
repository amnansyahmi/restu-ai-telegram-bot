export type Task = {
  id: string;
  title: string;
  category: string;
  completed: boolean;
};

const starterTasks: Omit<Task, "completed">[] = [
  { id: "budget", title: "Set wedding budget", category: "Planning" },
  { id: "date", title: "Confirm wedding date", category: "Planning" },
  { id: "venue", title: "Shortlist wedding venues", category: "Venue" },
  { id: "photo", title: "Book photographer", category: "Vendors" },
  { id: "guest", title: "Prepare guest list", category: "Guests" }
];

// MVP-only storage. Replace with Restu.ai's database repository later.
const users = new Map<number, Task[]>();

export function tasksFor(userId: number): Task[] {
  if (!users.has(userId)) {
    users.set(userId, starterTasks.map((task) => ({ ...task, completed: false })));
  }
  return users.get(userId)!;
}

export function toggleTask(userId: number, taskId: string): Task | undefined {
  const task = tasksFor(userId).find((item) => item.id === taskId);
  if (task) task.completed = !task.completed;
  return task;
}

export function progress(userId: number) {
  const tasks = tasksFor(userId);
  const completed = tasks.filter((task) => task.completed).length;
  return { completed, total: tasks.length, percent: Math.round((completed / tasks.length) * 100) };
}
