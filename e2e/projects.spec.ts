import { expect, test } from "@playwright/test";
import { fixtureName } from "./data";
import { navLink, signIn } from "./session";

test("tambah, buka, edit, dan cari proyek", async ({ page }) => {
  await signIn(page);
  await navLink(page, "Proyek").click();
  await expect(page.getByRole("heading", { name: "Daftar Proyek Divisi" })).toBeVisible();
  await page.getByRole("link", { name: "Tambah proyek", exact: true }).click();

  const name = fixtureName("Proyek E2E");
  await page.getByLabel("Nama resmi", { exact: true }).fill(name);
  await page.getByLabel("Deskripsi", { exact: true }).fill("Deskripsi proyek awal untuk pengujian.");
  await page.getByRole("button", { name: "Simpan proyek", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Detail Proyek" })).toBeVisible();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();

  await page.getByRole("link", { name: "Edit proyek", exact: true }).click();
  const updatedName = `${name} revisi`;
  const updatedDescription = "Deskripsi proyek sudah diperbarui.";
  await page.getByRole("textbox", { name: /^(Nama Proyek|Nama resmi)$/i }).fill(updatedName);
  await page.getByLabel("Deskripsi", { exact: true }).fill(updatedDescription);
  await page.getByRole("button", { name: "Simpan perubahan", exact: true }).click();

  await expect(page.getByRole("heading", { name: "Detail Proyek" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: updatedName, exact: true })).toBeVisible();
  await expect(page.getByText(updatedDescription, { exact: true }).filter({ visible: true })).toBeVisible();

  await navLink(page, "Proyek").click();
  const search = page.getByRole("searchbox", { name: "Cari proyek", exact: true });
  await search.fill(fixtureName("Proyek tidak ada"));
  await expect(page.getByText("Proyek tidak ditemukan", { exact: true })).toBeVisible();
  await search.fill(updatedName);
  await page.getByRole("link", { name: updatedName, exact: true }).click();
  await expect(page.getByRole("heading", { name: "Detail Proyek" })).toBeVisible();
  await expect(page.getByRole("heading", { name: updatedName, exact: true })).toBeVisible();
});
