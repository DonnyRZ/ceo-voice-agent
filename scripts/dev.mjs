import { spawn } from "node:child_process";

const children = [
  spawn(process.execPath, ["--watch", "--import", "tsx", "backend/server.ts"], { stdio: "inherit" }),
  spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "0.0.0.0"], { stdio: "inherit" }),
];

function stop(exitCode) {
  process.exitCode = exitCode;
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
  }
}

for (const child of children) {
  child.on("error", (error) => {
    console.error(error.message);
    stop(1);
  });
  child.on("exit", (code) => stop(process.exitCode ?? code ?? 0));
}
process.on("SIGINT", () => stop(130));
process.on("SIGTERM", () => stop(0));
