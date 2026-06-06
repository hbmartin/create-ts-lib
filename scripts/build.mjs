import { spawn } from "node:child_process";
import { cp, rm } from "node:fs/promises";
import { join } from "node:path";

const distDirectory = new URL("../dist/", import.meta.url);

await rm(distDirectory, {
  force: true,
  recursive: true,
});

await new Promise((resolve, reject) => {
  const tscBinary =
    process.platform === "win32"
      ? join("node_modules", ".bin", "tsc.cmd")
      : join("node_modules", ".bin", "tsc");
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

await cp(
  new URL("../source/templates/assets", import.meta.url),
  new URL("./templates/assets", distDirectory),
  {
    recursive: true,
  },
);
