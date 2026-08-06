import process from "node:process";
import { createInterface } from "node:readline/promises";
import type { Readable, Writable } from "node:stream";
import type { WarningSink } from "./cli-helpers.js";

type InputValidator = (value: string) => boolean | string | Promise<boolean | string>;

export interface PromptModule {
  checkbox<T>(options: {
    choices: Array<{ checked?: boolean; name: string; value: T }>;
    message: string;
  }): Promise<T[]>;
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
    checkbox: async ({ choices, message }) => {
      const checkedIndexes = choices
        .map((choice, index) => (choice.checked === false ? undefined : index + 1))
        .filter((index) => index !== undefined);
      const choiceSummary = choices
        .map(
          (choice, index) =>
            `${index + 1}. ${choice.name}${choice.checked === false ? "" : " [selected]"}`,
        )
        .join("\n");
      const answer = await ask(
        `${message}\n${choiceSummary}\nEnter numbers separated by spaces or commas, "a" for all, "n" for none (default: selected)\n> `,
      );

      if (answer.length === 0) {
        return checkedIndexes.map((index) => choices[index - 1]?.value).filter(isDefined);
      }

      const normalizedAnswer = answer.toLowerCase();
      if (normalizedAnswer === "a" || normalizedAnswer === "all") {
        return choices.map((choice) => choice.value);
      }

      if (normalizedAnswer === "n" || normalizedAnswer === "none") {
        return [];
      }

      return parseSelectionIndexes(answer, choices.length).map((index) => {
        const choice = choices[index - 1];
        if (choice === undefined) {
          throw new Error(`Invalid selection: ${index}`);
        }

        return choice.value;
      });
    },
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

const isDefined = <T>(value: T | undefined): value is T => value !== undefined;

const selectionSeparatorPattern = /[\s,]+/u;

const parseSelectionIndexes = (answer: string, choiceCount: number): number[] => {
  const indexes = answer
    .split(selectionSeparatorPattern)
    .filter((token) => token.length > 0)
    .map((token) => {
      const index = Number(token);
      if (!Number.isInteger(index) || index < 1 || index > choiceCount) {
        throw new Error(`Invalid selection: ${token}`);
      }

      return index;
    });

  return [...new Set(indexes)];
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
