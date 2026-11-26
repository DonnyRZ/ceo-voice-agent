import { expect, type Page } from "@playwright/test";

export function credentials(division: "IT" | "Finance" = "IT") {
  const password = process.env.E2E_PASSWORD ?? process.env.SEED_PASSWORD;

  if (!password) {
    throw new Error("Set E2E_PASSWORD or SEED_PASSWORD to the local fixture account password.");
  }

  const email = division === "IT"
    ? process.env.E2E_IT_EMAIL ?? "doni@ruangkerja.test"
    : process.env.E2E_FINANCE_EMAIL ?? "laura@ruangkerja.test";

  return { email, password };
}

export async function submitLogin(page: Page, email: string, password: string) {
  await page.getByLabel("Email perusahaan", { exact: true }).fill(email);
  await page.getByLabel("Kata sandi", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Masuk", exact: true }).click();
}

export async function signIn(page: Page, division: "IT" | "Finance" = "IT") {
  const { email, password } = credentials(division);
  await page.goto("/login");
  await submitLogin(page, email, password);
  await expect(page.getByRole("heading", { name: "Dashboard Divisi" })).toBeVisible();
}

export function navLink(page: Page, name: "Dashboard" | "Timesheet" | "Proyek" | "Akun") {
  return page.getByRole("navigation", { name: "Navigasi Anggota Divisi" })
    .getByRole("link", { name, exact: true });
}
