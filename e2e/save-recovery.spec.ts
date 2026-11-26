import { expect, test } from "@playwright/test";
import { createTaskFixture, readTask, updateTask } from "./data";
import { signIn } from "./session";

test("gagal simpan mempertahankan isian dan bisa dicoba lagi", async ({ page }) => {
  await signIn(page);
  const task = await createTaskFixture(page);
  await page.goto(`/timesheet/${task.id}/edit`);
  const description = "Isian tetap tersedia setelah jaringan pulih.";
  const field = page.getByLabel("Deskripsi", { exact: true });
  await field.fill(description);

  const taskApi = `**/api/tasks/${task.id}`;
  await page.route(taskApi, async (route) => {
    if (route.request().method() === "PATCH") {
      await route.fulfill({ status: 503, json: { message: "Koneksi sementara terputus" } });
    } else {
      await route.continue();
    }
  });
  await page.getByRole("button", { name: "Simpan perubahan", exact: true }).click();
  await expect(page.getByText("Perubahan belum tersimpan.", { exact: true })).toBeVisible();
  await expect(field).toHaveValue(description);
  expect((await readTask(page, task.id)).description).toBe(task.description);

  await page.unroute(taskApi);
  await page.getByRole("button", { name: "Coba simpan lagi", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Detail Tugas" })).toBeVisible();
  await expect(page.getByText(description, { exact: true })).toBeVisible();
});

test("suntingan bersamaan menawarkan versi terbaru tanpa menimpa data", async ({ page }) => {
  await signIn(page);
  const task = await createTaskFixture(page);
  await page.goto(`/timesheet/${task.id}/edit`);
  await page.getByLabel("Deskripsi", { exact: true }).fill("Isian dari versi lama.");

  const description = "Suntingan terbaru telah tersimpan.";
  await updateTask(page, task, { status: "done", description });
  await page.getByRole("button", { name: "Simpan perubahan", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Tugas sudah diperbarui pengguna lain");
  expect((await readTask(page, task.id)).description).toBe(description);

  await page.getByRole("button", { name: "Tinjau versi terbaru", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Detail Tugas" })).toBeVisible();
  await expect(page.getByText(description, { exact: true })).toBeVisible();
});
