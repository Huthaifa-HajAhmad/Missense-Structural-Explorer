import { describe, expect, it } from "vitest";
import { readSettingsBackup, resetLossNote } from "../settingsBackup";
import { DEFAULT_USER_SETTINGS } from "../defaults";

const file = (settings: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ __type: "missense-settings", version: 1, settings, ...extra });

describe("readSettingsBackup", () => {
  it("keeps values the app offers and skips the rest, one setting at a time", () => {
    const { settings, skipped } = readSettingsBackup(
      file({ energyUnit: "kJ/mol", seqScrollStep: 33, acmgWeighting: "lenient", maxHistoryItems: 20, saveHistory: "yes" })
    );
    expect(settings).toEqual({ energyUnit: "kJ/mol", maxHistoryItems: 20 });
    expect([...skipped].sort()).toEqual(["acmgWeighting", "saveHistory", "seqScrollStep"]);
  });

  it("refuses simulation conditions outside the panel's range", () => {
    expect(readSettingsBackup(file({ biophysicsConditions: { ph: 7, temperature: 37, ionicStrength: 150 } })).settings)
      .toEqual({ biophysicsConditions: { ph: 7, temperature: 37, ionicStrength: 150 } });
    expect(readSettingsBackup(file({ biophysicsConditions: { ph: 20, temperature: 37, ionicStrength: 150 } })).skipped)
      .toEqual(["biophysicsConditions"]);
  });

  it("never takes credentials from a file", () => {
    const { settings } = readSettingsBackup(file({ geminiApiKey: "AIza-x", tamarindApiKey: "t_x", energyUnit: "kJ/mol" }));
    expect(settings).toEqual({ energyUnit: "kJ/mol" });
  });

  it("reads the theme saved beside the settings", () => {
    expect(readSettingsBackup(file({}, { theme: "dark" })).theme).toBe("dark");
    expect(readSettingsBackup(file({}, { theme: "neon" })).theme).toBeNull();
  });

  it("throws on a file that is not JSON", () => {
    expect(() => readSettingsBackup("not json")).toThrow();
  });
});

describe("resetLossNote", () => {
  it("names the keys typed in this tab and saved history, the things reset deletes", () => {
    expect(resetLossNote({ ...DEFAULT_USER_SETTINGS, geminiApiKey: "AIza", biohubApiToken: "bh", saveHistory: true }))
      .toBe("also clears 2 keys in this tab and saved search history");
    expect(resetLossNote({ ...DEFAULT_USER_SETTINGS, tamarindApiKey: "t" })).toBe("also clears 1 key in this tab");
    expect(resetLossNote(DEFAULT_USER_SETTINGS)).toBeNull();
  });
});
