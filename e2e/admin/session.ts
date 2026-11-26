import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { submitLogin } from "../session";

export function adminFixtureName(label: string) {
  return `${label} ${randomUUID().slice(0, 8)}`;
}

export async function signInAdmin(page: Page) {
  const password = process.env.E2E_ADMIN_PASSWORD ?? process.env.SUPERADMIN_PASSWORD ?? process.env.E2E_PASSWORD ?? process.env.SEED_PASSWORD;
  if (!password) throw new Error("Set the local Superadmin fixture password in SEED_PASSWORD.");
  await page.goto("/login");
  await submitLogin(page, process.env.E2E_ADMIN_EMAIL ?? process.env.SUPERADMIN_EMAIL ?? "superadmin@ruangkerja.test", password);
  await expect(page.getByRole("heading", { name: "Dashboard Superadmin" })).toBeVisible();
}

export async function checkViewport(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    await page.evaluate(() => window.innerWidth),
  );
}

export async function captureAdmin(page: Page, name: string) {
  if (process.env.E2E_CAPTURE_ADMIN_SCREENSHOTS === "1") {
    await page.screenshot({ path: test.info().outputPath(`${name}.png`), animations: "disabled" });
  }
}

export async function createDivision(page: Page, name: string) {
  await page.goto("/admin/divisions");
  await expect(page.getByRole("heading", { name: "Daftar Divisi" })).toBeVisible();
  await captureAdmin(page, "08-daftar-divisi");
  await page.getByRole("link", { name: "Tambah divisi", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Tambah Divisi" })).toBeVisible();
  await captureAdmin(page, "09-tambah-divisi");
  await page.getByRole("textbox", { name: "Nama divisi", exact: true }).fill(name);
  await page.getByRole("textbox", { name: "Deskripsi", exact: true }).fill("Divisi untuk uji integrasi Superadmin.");
  await page.getByRole("button", { name: "Simpan divisi", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Detail dan Edit Divisi" })).toBeVisible();
  return new URL(page.url()).pathname;
}
