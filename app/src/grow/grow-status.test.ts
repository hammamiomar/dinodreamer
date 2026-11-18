import { describe, expect, it } from "vitest";
import { NO_RECORD, recordEvent } from "./grow-view";
import { startupLine } from "./grow-status";

describe("the model's download while a run starts", () => {
  const startup = { file: 3, files: 14, receivedBytes: 66_800_000, totalBytes: 340_200_000 };

  it("is in the record from the worker's report until the run trains", () => {
    let record = recordEvent({ ...NO_RECORD, active: true }, { type: "startup", startup });
    expect(record.startup).toEqual(startup);
    record = recordEvent(record, { type: "run", run: 1, runs: 1, seed: 1, method: "token-distribution" });
    expect(record.startup).toBeNull();
  });

  it("names the file and the megabytes received, and gives way once every file is in", () => {
    const record = { ...NO_RECORD, active: true, startup };
    expect(startupLine(record)).toBe("Downloading the model · file 3 of 14 · 66.8 of 340.2 MB");
    expect(startupLine({ ...record, startup: { ...startup, file: 14, receivedBytes: startup.totalBytes } })).toBeNull();
    expect(startupLine(NO_RECORD)).toBeNull();
  });
});
