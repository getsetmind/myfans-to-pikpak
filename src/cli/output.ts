import type { Command } from "commander";
import type { AppError } from "../core/errors.js";
import { redactText, redactValue } from "../core/redaction.js";
import type { JsonEnvelope } from "../core/types.js";
import { knownSensitiveValues, type GlobalOptions } from "./options.js";

export class CliOutput {
  activeCommand = "cli";

  async run<T>(name: string, command: Command, action: () => Promise<T>): Promise<void> {
    this.activeCommand = name;
    const global = command.optsWithGlobals() as GlobalOptions;
    const result = await action();
    this.success(name, result, global.json ?? false, extractWarnings(result));
  }

  error(error: AppError, json: boolean): void {
    const sensitiveValues = knownSensitiveValues();
    if (json) {
      const envelope: JsonEnvelope<never> = {
        schemaVersion: 1,
        command: this.activeCommand,
        ok: false,
        result: null,
        warnings: [],
        error: {
          code: error.code,
          message: redactText(error.message, sensitiveValues),
          details: redactValue(error.details, sensitiveValues),
        },
      };
      process.stdout.write(`${JSON.stringify(envelope)}\n`);
      return;
    }
    process.stderr.write(`Error [${error.code}]: ${redactText(error.message, sensitiveValues)}\n`);
  }

  private success<T>(command: string, result: T, json: boolean, warnings: string[]): void {
    const safeResult = redactValue(result, knownSensitiveValues()) as T;
    if (json) {
      const envelope: JsonEnvelope<T> = {
        schemaVersion: 1,
        command,
        ok: true,
        result: safeResult,
        warnings,
        error: null,
      };
      process.stdout.write(`${JSON.stringify(envelope)}\n`);
      return;
    }
    process.stdout.write(`${JSON.stringify(safeResult, null, 2)}\n`);
  }
}

function extractWarnings(value: unknown): string[] {
  if (value !== null && typeof value === "object" && "warnings" in value) {
    const warnings = (value as { warnings?: unknown }).warnings;
    if (Array.isArray(warnings) && warnings.every((warning) => typeof warning === "string")) {
      return warnings;
    }
  }
  return [];
}
