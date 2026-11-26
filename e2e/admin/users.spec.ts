import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { submitLogin } from "../session";
import { invitationLink, requireLocalSmtp } from "./mailpit";
import { adminFixtureName, captureAdmin, checkViewport, createDivision, signInAdmin } from "./session";

async function openUser(page: Page, email: string, label = email) {
  await page.goto("/admin/users");
  await page.getByRole("searchbox", { name: "Cari pengguna", exact: true }).fill(email);
  const user = page.getByRole("link", { name: new RegExp(label.replaceAll(".", "\\."), "i") });
  await user.click();
  await expect(page.getByRole("heading", { name: "Detail Pengguna dan Hak Akses" })).toBeVisible();
}

test("undangan SMTP, aktivasi, pindah divisi, dan cabut akses", async ({ page, browser }) => {
  test.setTimeout(90_000);
  requireLocalSmtp();
  await signInAdmin(page);
  const division = adminFixtureName("Divisi Undangan QA");
  const divisionPath = await createDivision(page, division);
  const email = `anggota-${randomUUID().slice(0, 12)}@ruangkerja.test`;
  const name = adminFixtureName("Anggota Undangan");
  const password = `QA-Aktivasi-${randomUUID()}`;

  await page.goto("/admin/users");
  await expect(page.getByRole("heading", { name: "Daftar Pengguna" })).toBeVisible();
  await captureAdmin(page, "05-daftar-pengguna");
  await page.getByRole("link", { name: "Undang pengguna", exact: true }).click();
  const emailField = page.getByRole("textbox", { name: "Email perusahaan", exact: true });
  await expect(emailField).toBeVisible();
  await captureAdmin(page, "06-undang-pengguna");
  await emailField.fill("format-salah");
  await page.getByRole("combobox", { name: "Peran", exact: true }).selectOption({ label: "Anggota Divisi" });
  await page.getByRole("combobox", { name: "Divisi", exact: true }).selectOption({ label: division });
  const send = page.getByRole("button", { name: "Kirim undangan", exact: true });
  await send.click();
  await expect(page.getByText(/Masukkan email perusahaan yang valid/)).toBeVisible();
  await captureAdmin(page, "15-validasi-form");
  await emailField.fill(email);
  await send.click();
  await expect(page.getByText("Undangan berhasil dikirim", { exact: true })).toBeVisible();
  await checkViewport(page);
  await captureAdmin(page, "17-undangan-berhasil");

  await openUser(page, email);
  await expect(page.getByText("Menunggu aktivasi", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Kirim ulang undangan", exact: true })).toBeVisible();
  await captureAdmin(page, "18-menunggu-aktivasi");

  const activation = await invitationLink(email);
  const memberContext = await browser.newContext({ viewport: page.viewportSize() ?? undefined });
  try {
    const member = await memberContext.newPage();
    await member.goto(activation);
    await member.getByLabel("Nama lengkap", { exact: true }).fill(name);
    await member.getByLabel("Kata sandi", { exact: true }).fill(password);
    await member.getByLabel("Konfirmasi kata sandi", { exact: true }).fill(password);
    await member.getByRole("button", { name: "Aktifkan akun", exact: true }).click();
    await member.getByRole("link", { name: "Masuk", exact: true }).click();
    await submitLogin(member, email, password);
    await expect(member.getByRole("heading", { name: "Dashboard Divisi" })).toBeVisible();

    await page.goto(divisionPath);
    await page.getByRole("button", { name: "Arsipkan divisi", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Arsipkan divisi", exact: true }).click();
    await expect(page.getByText(/masih memiliki anggota aktif/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Arsipkan divisi", exact: true })).toBeDisabled();
    await captureAdmin(page, "23-arsip-terhalang");

    await openUser(page, email, name);
    await expect(page.getByRole("combobox", { name: "Divisi", exact: true })).toBeVisible();
    await captureAdmin(page, "07-detail-hak-akses");
    const userPath = new URL(page.url()).pathname;
    await page.getByRole("combobox", { name: "Divisi", exact: true }).selectOption({ label: "Finance" });
    await page.getByRole("button", { name: "Simpan perubahan", exact: true }).click();
    const change = page.getByRole("dialog");
    await expect(change.getByText("Simpan perubahan akses?", { exact: true })).toBeVisible();
    await captureAdmin(page, "20-konfirmasi-hak-akses");
    const updated = page.waitForResponse((response) => response.request().method() === "PATCH" && response.ok()
      && new URL(response.url()).pathname === `/api${userPath}`);
    await change.getByRole("button", { name: "Konfirmasi perubahan", exact: true }).click();
    await updated;
    await expect(change).toBeHidden();
    await page.reload();
    await expect(page.getByRole("combobox", { name: "Divisi", exact: true }).locator("option:checked")).toHaveText("Finance");

    await memberContext.clearCookies();
    await member.goto(new URL("/login", activation).href);
    await submitLogin(member, email, password);
    await expect(member.getByRole("heading", { name: "Dashboard Divisi" })).toBeVisible();

    await page.getByRole("button", { name: "Cabut akses", exact: true }).click();
    const revoke = page.getByRole("dialog");
    await expect(revoke.getByText(`Cabut akses ${name}?`, { exact: true })).toBeVisible();
    await captureAdmin(page, "21-konfirmasi-cabut-akses");
    await revoke.getByRole("button", { name: "Cabut akses", exact: true }).click();
    await expect(page.getByText("Akses dicabut", { exact: true })).toBeVisible();

    await member.reload();
    await expect(member).toHaveURL(/\/login(?:[/?#]|$)/);
    await checkViewport(page);
  } finally {
    await memberContext.close();
  }
});

test("kondisi undangan gagal menawarkan kirim ulang", async ({ page }) => {
  requireLocalSmtp();
  await signInAdmin(page);
  await page.goto("/admin/users/invite");
  const email = `ulang-${randomUUID().slice(0, 12)}@ruangkerja.test`;
  await page.getByRole("textbox", { name: "Email perusahaan", exact: true }).fill(email);
  await page.getByRole("combobox", { name: "Peran", exact: true }).selectOption({ label: "Anggota Divisi" });
  await page.getByRole("combobox", { name: "Divisi", exact: true }).selectOption({ label: "IT" });

  await page.route("**/api/admin/invitations", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...await response.json(), status: "failed" } });
  });
  await page.getByRole("button", { name: "Kirim undangan", exact: true }).click();
  await expect(page.getByText(/Undangan gagal dikirim/)).toBeVisible();
  await checkViewport(page);
  await captureAdmin(page, "19-undangan-gagal");
  await page.getByRole("button", { name: "Coba kirim lagi", exact: true }).click();
  await expect(page.getByText("Undangan berhasil dikirim", { exact: true })).toBeVisible();
});
