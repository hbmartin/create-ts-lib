import { rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";

await rm(new URL("../dist", import.meta.url), {
  force: true,
  recursive: true,
});

await new Promise((resolve, reject) => {
  const tscBinary =
    process.platform === "win32" ? join("node_modules", ".bin", "tsc.cmd") : join("node_modules", ".bin", "tsc");
  const childProcess = spawn(tscBinary, ["-p", "tsconfig.json"], {
    stdio: "inherit",
  });

  childProcess.on("error", reject);
  childProcess.on("close", (code) => {
    if (code === 0) {
      resolve(undefined);
      return;
    }

    reject(new Error(`tsc exited with code ${code ?? "unknown"}`));
  });
});
