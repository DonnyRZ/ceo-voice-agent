import { expect, test } from "@playwright/test";
import { adminFixtureName, captureAdmin, checkViewport, createDivision, signInAdmin } from "./session";

test("kelola divisi, pulihkan simpan yang gagal, dan arsipkan", async ({ page }) => {
  await signInAdmin(page);
  const division = adminFixtureName("Divisi QA");
  const path = await createDivision(page, division);

  const description = "Deskripsi divisi berubah setelah dicoba lagi.";
  const field = page.getByRole("textbox", { name: "Deskripsi", exact: true });
  await expect(field).toBeVisible();
  await captureAdmin(page, "10-detail-edit-divisi");
  await field.fill(description);

  const route = `**/api${path}`;
  await page.route(route, async (request) => {
    if (request.request().method() === "PATCH") {
      await request.fulfill({ status: 503, json: { message: "Layanan sementara tidak tersedia." } });
    } else {
      await request.continue();
    }
  });
  await page.getByRole("button", { name: "Simpan perubahan", exact: true }).click();
  await expect(page.getByText(/Perubahan belum tersimpan/)).toBeVisible();
  await expect(field).toHaveValue(description);
  await captureAdmin(page, "16-gagal-simpan");
  await page.unroute(route);

  const updated = page.waitForResponse((response) => new URL(response.url()).pathname === `/api${path}`
    && response.request().method() === "PATCH" && response.ok());
  await page.getByRole("button", { name: "Coba simpan lagi", exact: true }).click();
  await updated;
  await page.reload();
  await expect(field).toHaveValue(description);
  await checkViewport(page);

  await page.getByRole("button", { name: "Arsipkan divisi", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(`Arsipkan divisi ${division}?`, { exact: true })).toBeVisible();
  await captureAdmin(page, "22-konfirmasi-arsip-divisi");
  const archive = page.waitForResponse((response) => new URL(response.url()).pathname === `/api${path}`
    && response.request().method() === "DELETE" && response.ok());
  await dialog.getByRole("button", { name: "Arsipkan divisi", exact: true }).click();
  await archive;

  await page.goto("/admin/divisions");
  await page.getByRole("button", { name: "Diarsipkan", exact: true }).click();
  await page.getByRole("searchbox", { name: "Cari divisi", exact: true }).fill(division);
  const archived = page.getByRole("link", { name: new RegExp(division, "i") });
  await expect(archived).toBeVisible();
  await archived.click();
  await expect(field).toHaveValue(description);
  await expect(page.getByText("Diarsipkan", { exact: true })).toBeVisible();
});
