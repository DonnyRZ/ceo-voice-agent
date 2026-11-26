import { expect, test } from "@playwright/test";
import { navLink, signIn } from "./session";

const pages = [
  { link: "Dashboard", heading: "Dashboard Divisi" },
  { link: "Timesheet", heading: "Timesheet Divisi" },
  { link: "Proyek", heading: "Daftar Proyek Divisi" },
  { link: "Akun", heading: "Akun" },
] as const;

test("navigasi divisi berfungsi dan halaman muat dalam viewport", async ({ page }) => {
  await signIn(page);
  await page.getByLabel("Periode dashboard").fill("2099-02");
  await expect(page.locator('[aria-label="Status tugas"]').getByText("0", { exact: true })).toHaveCount(3);

  for (const { link, heading } of pages) {
    await navLink(page, link).click();
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => (
      document.documentElement.scrollWidth <= window.innerWidth
    ))).toBe(true);
  }
});
