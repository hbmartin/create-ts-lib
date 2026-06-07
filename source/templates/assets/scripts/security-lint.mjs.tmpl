import { spawnSync } from "node:child_process";

const semgrepVersion = "1.165.0";
const semgrepArguments = ["scan", "--config", "semgrep.yml", "--error", "source", "test"];
const forceUvx = process.env.SECURITY_LINT_FORCE_UVX === "1";

const runCommand = (command, arguments_) =>
  spawnSync(command, arguments_, {
    stdio: "inherit",
  });

const exitWithResult = (result) => {
  if (result.error) {
    throw result.error;
  }

  if (result.signal) {
    console.error(`warning: security lint exited after signal ${result.signal}`);
    process.exit(1);
  }

  process.exit(result.status ?? 1);
};

const runSemgrep = () => {
  if (forceUvx) {
    return { error: Object.assign(new Error("Forced uvx Semgrep"), { code: "ENOENT" }) };
  }

  return runCommand("semgrep", semgrepArguments);
};

const runPinnedSemgrep = () =>
  runCommand("uvx", [`semgrep@${semgrepVersion}`, ...semgrepArguments]);

const semgrepResult = runSemgrep();

if (!semgrepResult.error) {
  exitWithResult(semgrepResult);
}

if (semgrepResult.error.code !== "ENOENT") {
  throw semgrepResult.error;
}

const uvxResult = runPinnedSemgrep();

if (uvxResult.error?.code === "ENOENT") {
  console.error(
    `warning: security:lint requires semgrep on PATH or uvx for semgrep@${semgrepVersion}.`,
  );
  console.error("warning: install Semgrep directly or install uv so uvx can run the pinned scan.");
  process.exit(1);
}

exitWithResult(uvxResult);
