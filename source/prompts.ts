import process from "node:process";
import { createInterface } from "node:readline/promises";
import type { Readable, Writable } from "node:stream";
import type { WarningSink } from "./cli-helpers.js";

type InputValidator = (value: string) => boolean | string | Promise<boolean | string>;

export interface PromptModule {
  confirm(options: { default?: boolean; message: string }): Promise<boolean>;
  input(options: { default?: string; message: string; validate?: InputValidator }): Promise<string>;
  select<T extends string>(options: {
    choices: Array<{ name: string; value: T }>;
    default?: T;
    message: string;
  }): Promise<T>;
}

export const loadPromptModule = async (warn: WarningSink): Promise<PromptModule> => {
  try {
    return await import("@inquirer/prompts");
  } catch {
    warn("Could not load @inquirer/prompts; falling back to basic readline prompts.");
    return createFallbackPrompts();
  }
};

export const createFallbackPrompts = (
  input: Readable = process.stdin,
  output: Writable = process.stdout,
): PromptModule => {
  const createPromptSession = () => {
    const rl = createInterface({
      input,
      output,
    });
    const lines = rl[Symbol.asyncIterator]();

    return {
      ask: async (message: string): Promise<string> => {
        output.write(message);
        const line = await lines.next();
        if (line.done) {
          throw new Error("Input stream closed");
        }

        return line.value.trim();
      },
      close: () => rl.close(),
    };
  };

  const ask = async (message: string): Promise<string> => {
    const session = createPromptSession();
    try {
      return await session.ask(message);
    } finally {
      session.close();
    }
  };

  return {
    confirm: async ({ default: defaultValue = false, message }) => {
      const suffix = defaultValue ? "Y/n" : "y/N";
      const answer = await ask(`${message} (${suffix}) `);
      if (answer.length === 0) {
        return defaultValue;
      }

      return ["y", "yes"].includes(answer.toLowerCase());
    },
    input: async ({ default: defaultValue = "", message, validate }) => {
      const session = createPromptSession();
      try {
        for (;;) {
          const answer = await session.ask(
            defaultValue.length > 0 ? `${message} (${defaultValue}) ` : `${message} `,
          );
          const value = answer.length > 0 ? answer : defaultValue;
          const validationMessage = await getValidationMessage(validate, value);

          if (!validationMessage) {
            return value;
          }

          output.write(`${validationMessage}\n`);
        }
      } finally {
        session.close();
      }
    },
    select: async ({ choices, default: defaultValue, message }) => {
      const choiceSummary = choices
        .map(
          (choice, index) =>
            `${index + 1}. ${choice.name}${choice.value === defaultValue ? " [default]" : ""}`,
        )
        .join("\n");
      const answer = await ask(`${message}\n${choiceSummary}\n> `);
      if (answer.length === 0) {
        return defaultValue ?? choices[0]?.value ?? failEmptyChoices();
      }

      const numericIndex = Number(answer);
      if (Number.isInteger(numericIndex) && numericIndex >= 1 && numericIndex <= choices.length) {
        return choices[numericIndex - 1]?.value ?? failEmptyChoices();
      }

      const matchingChoice = choices.find(
        (choice) => choice.value === answer || choice.name.toLowerCase() === answer.toLowerCase(),
      );

      if (matchingChoice) {
        return matchingChoice.value;
      }

      throw new Error(`Invalid selection: ${answer}`);
    },
  };
};

const getValidationMessage = async (
  validate: InputValidator | undefined,
  value: string,
): Promise<string | undefined> => {
  if (!validate) {
    return undefined;
  }

  const validationResult = await validate(value);
  if (validationResult === true) {
    return undefined;
  }

  if (validationResult === false) {
    return "Invalid input.";
  }

  return validationResult;
};

const failEmptyChoices = (): never => {
  throw new Error("At least one choice is required.");
};
