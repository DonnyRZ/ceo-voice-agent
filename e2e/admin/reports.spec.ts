import { expect, test, type Page } from "@playwright/test";
import { captureAdmin, checkViewport, signInAdmin } from "./session";

function adminLink(page: Page, name: string) {
  return page.getByRole("navigation", { name: "Navigasi Superadmin" }).getByRole("link", { name, exact: true });
}

async function chooseFilter(page: Page, name: string, parameter: string, label: string) {
  const [value] = await page.getByRole("combobox", { name, exact: true }).selectOption({ label });
  await expect.poll(() => new URL(page.url()).searchParams.get(parameter)).toBe(value);
}

test("baca dashboard, filter timesheet, dan buka riwayat tugas lintas divisi", async ({ page }) => {
  await signInAdmin(page);
  await page.getByLabel("Periode dashboard", { exact: true }).fill("2026-11");
  await expect(page.getByRole("heading", { name: "Pembaruan terbaru" })).toBeVisible();
  await checkViewport(page);
  await captureAdmin(page, "01-dashboard");

  await adminLink(page, "Timesheet").click();
  await expect(page.getByRole("heading", { name: "Timesheet Semua Divisi" })).toBeVisible();
  await page.getByRole("link", { name: /^IT\b/ }).waitFor();
  await captureAdmin(page, "02-timesheet-semua-divisi");
  await chooseFilter(page, "Divisi", "divisionId", "IT");
  await chooseFilter(page, "Periode", "period", "November 2026");
  await chooseFilter(page, "Status", "status", "On Progress");
  await page.getByRole("link", { name: /^IT\b/ }).click();
  await expect(page.getByRole("heading", { name: "Detail Timesheet Divisi" })).toBeVisible();
  await checkViewport(page);
  await page.getByRole("link", { name: /Validasi alur login/ }).waitFor();
  await captureAdmin(page, "03-detail-timesheet-divisi");

  await page.getByRole("link", { name: /Validasi alur login/ }).click();
  await expect(page.getByRole("heading", { name: "Detail Tugas" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Riwayat status/i })).toBeVisible();
  await expect(page.getByText("Uji akses dan pesan gagal.", { exact: true }).filter({ visible: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Edit Tugas", exact: true })).toHaveCount(0);
  await checkViewport(page);
  await captureAdmin(page, "04-detail-tugas");
});

test("laporan timesheet tanpa tugas menampilkan kondisi kosong", async ({ page }) => {
  await signInAdmin(page);
  await page.route(/\/api\/admin\/tasks(?:\?.*)?$/, async (route) => {
    await route.fulfill({ json: [] });
  });
  await adminLink(page, "Timesheet").click();
  await expect(page.getByText("Belum ada timesheet", { exact: true }).filter({ visible: true })).toBeVisible();
  await checkViewport(page);
  await captureAdmin(page, "13-data-kosong");
});

test("audit log menampilkan hasil kosong dan detail perubahan sebelum dan sesudah", async ({ page }) => {
  await signInAdmin(page);
  await adminLink(page, "Audit Log").click();
  await expect(page.getByRole("heading", { name: "Audit Log" })).toBeVisible();
  await page.getByRole("link", { name: /Status tugas diubah/ }).first().waitFor();
  await captureAdmin(page, "11-audit-log");
  await chooseFilter(page, "Pengguna", "actor", "Doni");
  await chooseFilter(page, "Divisi", "divisionId", "Finance");
  await expect(page.getByText("Tidak ada hasil", { exact: true }).filter({ visible: true })).toBeVisible();
  await captureAdmin(page, "14-filter-tanpa-hasil");
  await page.getByRole("button", { name: "Hapus filter", exact: true }).click();
  await expect.poll(() => new URL(page.url()).search).toBe("");
  await expect(page.getByRole("combobox", { name: "Divisi", exact: true })).toHaveValue("");
  await expect(page.getByRole("combobox", { name: "Pengguna", exact: true })).toHaveValue("");
  await expect(page.getByRole("link", { name: /Status tugas diubah/ }).first()).toBeVisible();

  await chooseFilter(page, "Pengguna", "actor", "Doni");
  await chooseFilter(page, "Jenis tindakan", "action", "Perubahan");
  const matches = await page.request.get("/api/admin/tasks?search=Validasi%20alur%20login");
  expect(matches.ok()).toBe(true);
  const [task] = await matches.json() as { id: string }[];
  const events = await page.request.get("/api/admin/audit?actor=Doni&action=UPDATE&entity=task");
  expect(events.ok()).toBe(true);
  const event = (await events.json() as { id: string; recordId: string }[]).find(({ recordId }) => recordId === task.id);
  expect(event).toBeDefined();
  const detailPath = `/admin/audit/${event!.id}`;
  const link = page.locator(`a[href="${detailPath}"], a[href^="${detailPath}?"]`).filter({ visible: true });
  await expect(link).toContainText("Status tugas diubah");
  await link.click();

  await expect(page.getByRole("heading", { name: "Detail Perubahan Audit" })).toBeVisible();
  await expect(page.getByText("Sebelum", { exact: true }).filter({ visible: true })).toBeVisible();
  await expect(page.getByText("Sesudah", { exact: true }).filter({ visible: true })).toBeVisible();
  await expect(page.getByText("Pending", { exact: true }).filter({ visible: true })).toBeVisible();
  await expect(page.getByText("On Progress", { exact: true }).filter({ visible: true })).toBeVisible();
  await checkViewport(page);
  await captureAdmin(page, "12-detail-audit");
});
