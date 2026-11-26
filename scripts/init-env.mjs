import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const templateUrl = new URL("../.env.example", import.meta.url);
const envUrl = new URL("../.env", import.meta.url);
const adminPassword = randomBytes(24).toString("hex");
const appPassword = randomBytes(24).toString("hex");
const database = "127.0.0.1:5441/ruang_kerja";
const localVariables = {
  POSTGRES_PASSWORD: adminPassword,
  DATABASE_APP_PASSWORD: appPassword,
  DATABASE_ADMIN_URL: `postgresql://ruang_kerja_admin:${adminPassword}@${database}`,
  DATABASE_URL: `postgresql://ruang_kerja_app:${appPassword}@${database}`,
  BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
  SEED_PASSWORD: randomBytes(24).toString("hex"),
};
const template = await readFile(templateUrl, "utf8");
const env = template.split("\n").map((line) => {
  const key = line.split("=")[0];
  return Object.hasOwn(localVariables, key) ? `${key}=${localVariables[key]}` : line;
}).join("\n");

try {
  await writeFile(envUrl, env, { flag: "wx", mode: 0o600 });
  console.log(".env lokal dibuat.");
} catch (error) {
  if (error.code !== "EEXIST") throw error;
  console.log(".env lokal sudah tersedia.");
}
