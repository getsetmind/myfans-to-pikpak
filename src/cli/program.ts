import { Command, CommanderError } from "commander";
import { cleanup } from "../commands/cleanup.js";
import { doctor } from "../commands/doctor.js";
import { plan as createSyncPlan } from "../commands/plan.js";
import { plans } from "../commands/plans.js";
import { rollback } from "../commands/rollback.js";
import { status } from "../commands/status.js";
import { sync } from "../commands/sync.js";
import { verify } from "../commands/verify.js";
import { AppError, asAppError } from "../core/errors.js";
import { parseJobs, type GlobalOptions } from "./options.js";
import { CliOutput } from "./output.js";

export const CLI_VERSION = "1.0.0";

export function createProgram(output = new CliOutput()): Command {
  const program = new Command();

  program
    .name("myfans-to-pikpak")
    .description("Safely synchronize authorized MyFans videos to an rclone PikPak target.")
    .version(CLI_VERSION)
    .option("--json", "write a stable JSON envelope to stdout")
    .option("--state-dir <path>", "override the application state directory")
    .option("--work-dir <path>", "override the local media work directory")
    .option("--cdp-url <url>", "Chromium remote-debugging endpoint", "http://127.0.0.1:9222")
    .showHelpAfterError()
    .exitOverride();

  program
    .command("doctor")
    .description("Check runtime dependencies, authentication, and an optional rclone target.")
    .option("--to <target>", "rclone target to check")
    .action(async (options, command) =>
      output.run("doctor", command, () => doctor(options, globals(command))),
    );

  program
    .command("plans")
    .description("List the signed-in account's active MyFans subscriptions without changing state.")
    .action(async (_options, command) =>
      output.run("plans", command, () => plans(globals(command))),
    );

  program
    .command("plan")
    .description("Create a read-only synchronization plan and confirmation digest.")
    .requiredOption("--plan-id <id-or-url>", "MyFans plan ID or plan URL")
    .requiredOption("--to <target>", "rclone target, for example pikpak:MyFans/archive")
    .requiredOption("--out <file>", "output plan JSON file")
    .action(async (options, command) =>
      output.run("plan", command, () => createSyncPlan(options, globals(command))),
    );

  program
    .command("sync")
    .description("Execute exactly one confirmed, current synchronization plan.")
    .requiredOption("--plan <file>", "synchronization plan JSON")
    .requiredOption("--confirm <digest>", "exact digest printed by plan")
    .option("--jobs <count>", "parallel download/probe jobs", parseJobs, 2)
    .action(async (options, command) =>
      output.run("sync", command, () => sync(options, globals(command))),
    );

  program
    .command("status")
    .description("Show the durable ledger for one plan and target.")
    .requiredOption("--plan-id <id-or-url>", "MyFans plan ID or URL")
    .requiredOption("--to <target>", "rclone target")
    .action(async (options, command) =>
      output.run("status", command, () => status(options, globals(command))),
    );

  program
    .command("verify")
    .description("Verify planned remote names and known sizes without changing remote state.")
    .requiredOption("--plan <file>", "synchronization plan JSON")
    .action(async (options, command) =>
      output.run("verify", command, () => verify(options, globals(command))),
    );

  program
    .command("cleanup")
    .description("Prepare or execute a separately confirmed local cleanup plan.")
    .option("--source-plan <file>", "confirmed sync plan used to prepare cleanup")
    .option("--out <file>", "output cleanup plan JSON")
    .option("--plan <file>", "cleanup plan JSON to execute")
    .option("--confirm <digest>", "exact cleanup-plan digest")
    .action(async (options, command) =>
      output.run("cleanup", command, () => cleanup(options, globals(command))),
    );

  program
    .command("rollback")
    .description(
      "Reverse only rename operations from a confirmed sync plan; uploads are never deleted.",
    )
    .requiredOption("--plan <file>", "synchronization plan JSON")
    .requiredOption("--confirm <digest>", "exact digest printed by plan")
    .action(async (options, command) =>
      output.run("rollback", command, () => rollback(options, globals(command))),
    );

  return program;
}

export async function runCli(argv = process.argv): Promise<number> {
  const output = new CliOutput();
  const program = createProgram(output);
  try {
    await program.parseAsync(argv);
    return 0;
  } catch (error) {
    if (
      error instanceof CommanderError &&
      ["commander.helpDisplayed", "commander.version"].includes(error.code)
    ) {
      return 0;
    }
    const appError =
      error instanceof CommanderError
        ? new AppError("USAGE_ERROR", error.message)
        : asAppError(error);
    output.error(appError, argv.includes("--json"));
    return appError.exitCode;
  }
}

function globals(command: Command): GlobalOptions {
  return command.optsWithGlobals() as GlobalOptions;
}
