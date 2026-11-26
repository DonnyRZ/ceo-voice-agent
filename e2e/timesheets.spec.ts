import { expect, test } from "@playwright/test";
import { createProjectFixture, firstMember, fixtureName, jakartaDate } from "./data";
import { navLink, signIn } from "./session";

test("validasi, tambah, edit, dan filter tugas timesheet", async ({ page }) => {
  await signIn(page);
  const [project, member] = await Promise.all([createProjectFixture(page), firstMember(page)]);
  await page.goto("/timesheet");
  await page.getByRole("link", { name: "Tambah tugas", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Tambah Tugas" })).toBeVisible();

  const title = fixtureName("Tugas E2E");
  await page.getByLabel("Tanggal", { exact: true }).fill(jakartaDate());
  await page.getByLabel("Deskripsi", { exact: true }).fill("Uji alur tugas dari perangkat desktop dan mobile.");
  await page.getByLabel("Proyek", { exact: true }).selectOption(project.id);
  await page.getByLabel("PIC", { exact: true }).selectOption(member.id);
  await page.getByRole("combobox", { name: "Status", exact: true }).selectOption("pending");

  const save = page.getByRole("button", { name: "Simpan tugas", exact: true });
  await save.click();
  await expect(page.getByText("Masukkan judul tugas", { exact: true })).toBeVisible();
  await page.getByLabel("Judul tugas", { exact: true }).fill(title);
  await save.click();

  await expect(page.getByRole("heading", { name: "Detail Tugas" })).toBeVisible();
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Edit Tugas", exact: true }).click();

  const updatedDescription = "Deskripsi tersimpan setelah pembaruan tugas.";
  await page.getByLabel("Deskripsi", { exact: true }).fill(updatedDescription);
  const status = page.getByRole("combobox", { name: "Status", exact: true });
  if (await status.isVisible()) {
    await status.selectOption("on_progress");
  } else {
    await page.getByRole("radio", { name: "On Progress", exact: true }).check();
  }
  await page.getByRole("button", { name: "Simpan perubahan", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Detail Tugas" })).toBeVisible();
  await page.reload();

  await expect(page.getByText(updatedDescription, { exact: true })).toBeVisible();
  const history = page.getByRole("region", { name: "Riwayat Perubahan" });
  await expect(history.getByText("On Progress", { exact: true }).filter({ visible: true })).toBeVisible();

  await page.getByRole("link", { name: project.name, exact: true }).click();
  await expect(page.getByRole("heading", { name: "Detail Proyek" })).toBeVisible();
  await page.getByRole("link", { name: title, exact: true }).click();
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();

  await navLink(page, "Timesheet").click();
  await page.getByRole("combobox", { name: "Proyek", exact: true }).selectOption(project.id);
  await expect(page.getByRole("link", { name: title, exact: true })).toBeVisible();

  await page.getByRole("combobox", { name: "Status", exact: true }).selectOption("done");
  await expect(page.getByText("Tidak ada tugas yang cocok", { exact: true }).filter({ visible: true })).toBeVisible();
  await page.getByRole("button", { name: "Hapus filter", exact: true }).click();
  await expect(page.getByRole("link", { name: title, exact: true })).toBeVisible();
});

test("timesheet kosong menampilkan ajakan menambah tugas", async ({ page }) => {
  await signIn(page);
  await page.route(/\/api\/tasks(?:\?.*)?$/, async (route) => {
    await route.fulfill({ json: [] });
  });

  await page.goto("/timesheet");
  await expect(page.getByText("Belum ada tugas", { exact: true })).toBeVisible();
  const illustration = page.locator('img[src="/images/timesheet-empty.png"]');
  await expect.poll(() => illustration.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0);
  await page.getByRole("link", { name: "Tambah tugas", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Tambah Tugas" })).toBeVisible();
});
