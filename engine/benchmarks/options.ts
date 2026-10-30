import type { BenchmarkSettings } from "./protocol.ts";

export interface Options {
  label: string;
  headed: boolean;
  cpuProfile: boolean;
  compare?: string;
  timeoutMinutes: number;
  settings: BenchmarkSettings;
}

export function parseOptions(args: string[]): Options {
  const options: Options = {
    label: "baseline",
    headed: false,
    cpuProfile: false,
    timeoutMinutes: 30,
    settings: {
      warmup: 5,
      steps: 20,
      profileSteps: 5,
      seed: 0,
    },
  };
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === "--headed") {
      options.headed = true;
      continue;
    }
    if (flag === "--cpu-profile") {
      options.cpuProfile = true;
      continue;
    }
    const value = args[++index];
    if (!value || value.startsWith("--"))
      throw new Error(`Missing value for ${flag}`);
    switch (flag) {
      case "--label":
        if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(value))
          throw new Error(
            "Use a short descriptive label (letters, digits, - or _).",
          );
        options.label = value;
        break;
      case "--compare":
        options.compare = value;
        break;
      case "--warmup":
        options.settings.warmup = positiveInteger(flag, value);
        break;
      case "--steps":
        options.settings.steps = positiveInteger(flag, value);
        break;
      case "--profile-steps":
        options.settings.profileSteps = positiveInteger(flag, value);
        break;
      case "--timeout-minutes":
        options.timeoutMinutes = positiveInteger(flag, value);
        break;
      default:
        throw new Error(`Unknown option ${flag}`);
    }
  }
  return options;
}

function positiveInteger(flag: string, value: string): number {
  const number = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(number) || number < 1) {
    throw new Error(`${flag} needs a positive integer.`);
  }
  return number;
}

export async function withTimeout<T>(
  promise: Promise<T>,
  milliseconds: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(
            `Browser run timed out after ${milliseconds / 60_000} minutes.`,
          ),
        ),
      milliseconds,
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}
