import { randomUUID } from "node:crypto";
import { expect, type APIResponse, type Page } from "@playwright/test";

type ProjectRecord = { id: string; name: string };
type MemberRecord = { id: string; name: string };
type TaskStatus = "pending" | "on_progress" | "done";
type TaskDraft = {
  date: string;
  title: string;
  description: string;
  projectId: string;
  picId: string;
  status: TaskStatus;
};
type TaskRecord = TaskDraft & { id: string; version: number };

export function fixtureName(prefix: string) {
  return `${prefix} ${randomUUID().slice(0, 8)}`;
}

export function jakartaDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

async function json<T>(response: APIResponse): Promise<T> {
  expect(response.ok(), `HTTP ${response.status()} untuk ${new URL(response.url()).pathname}`).toBe(true);
  return response.json() as Promise<T>;
}

export async function createProjectFixture(page: Page) {
  return json<ProjectRecord>(await page.request.post("/api/projects", {
    data: {
      name: fixtureName("Proyek E2E"),
      description: "Data uji proyek Anggota Divisi.",
      status: "pending",
    },
  }));
}

export async function firstMember(page: Page) {
  const members = await json<MemberRecord[]>(await page.request.get("/api/members"));
  expect(members.length).toBeGreaterThan(0);
  return members[0];
}

export async function createTaskFixture(page: Page) {
  const [project, member] = await Promise.all([createProjectFixture(page), firstMember(page)]);
  const data: TaskDraft = {
    date: jakartaDate(),
    title: fixtureName("Tugas E2E"),
    description: "Data uji tugas Anggota Divisi.",
    projectId: project.id,
    picId: member.id,
    status: "pending",
  };
  return json<TaskRecord>(await page.request.post("/api/tasks", { data }));
}

export async function readTask(page: Page, id: string) {
  return json<TaskRecord>(await page.request.get(`/api/tasks/${id}`));
}

export async function updateTask(page: Page, task: TaskRecord, patch: Partial<TaskDraft>) {
  const { id, date, title, description, projectId, picId, status, version } = task;
  return json<TaskRecord>(await page.request.patch(`/api/tasks/${id}`, {
    data: { date, title, description, projectId, picId, status, version, ...patch },
  }));
}
