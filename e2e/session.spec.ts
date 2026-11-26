import { expect, test } from "@playwright/test";
import { createTaskFixture } from "./data";
import { credentials, navLink, signIn, submitLogin } from "./session";

test("masuk dengan email perusahaan, buka akun, dan keluar", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login(?:[/?#]|$)/);
  await expect(page.getByRole("heading", { name: "Masuk ke Ruang Kerja" })).toBeVisible();

  const { email, password } = credentials();
  await submitLogin(page, email, `${password}-invalid`);
  await expect(page.getByRole("alert")).toHaveText("Email atau kata sandi tidak sesuai.");

  await submitLogin(page, email, password);
  await expect(page.getByRole("heading", { name: "Dashboard Divisi" })).toBeVisible();
  await navLink(page, "Akun").click();
  await expect(page.getByText(email, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Keluar", exact: true }).click();

  await expect(page).toHaveURL(/\/login(?:[/?#]|$)/);
  await page.goto("/timesheet");
  await expect(page).toHaveURL(/\/login(?:[/?#]|$)/);
});

test("akun Finance tidak dapat membuka tugas IT", async ({ page, context }) => {
  await signIn(page, "IT");
  const task = await createTaskFixture(page);

  await context.clearCookies();
  await signIn(page, "Finance");
  await page.goto(`/timesheet/${task.id}`);
  await expect(page.getByRole("alert")).toContainText("Tugas tidak ditemukan.");
  await expect(page.getByText(task.title, { exact: true })).toHaveCount(0);

  const denied = await page.request.get(`/api/tasks/${task.id}`);
  expect(denied.status()).toBe(404);
});
