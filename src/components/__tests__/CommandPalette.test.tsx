// @vitest-environment jsdom
import React from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/* The palette touches two providers. Both are mocked so the assertions are about the
   palette's own behaviour — which fields it writes and which callbacks it fires — rather than
   about the pipeline behind them. */
const mocks = vi.hoisted(() => ({
  actions: {
    setCustomGene: vi.fn(),
    setCustomVariant: vi.fn(),
    setCustomGenomic: vi.fn(),
    setCustomUniprot: vi.fn(),
    clearHistory: vi.fn(),
  },
  history: [] as { gene: string; variant: string; uniprotId: string }[],
  /**
   * The loading flags the palette reads to mirror the Search form's in-flight guard. They live
   * here rather than being hard-coded in the mock so a test can put the pipeline into a running
   * state; `resetPipelineActivity` returns them to idle between tests.
   */
  pipeline: {
    isRunning: false,
  },
  settings: {
    settings: { defaultStructureModel: "alphafold" },
    isDark: false,
    toggleTheme: vi.fn(),
    setIsSettingsOpen: vi.fn(),
    openSettingsTab: vi.fn(),
    hasConfiguredGeminiKey: true,
  },
}));

/**
 * A store shaped like the real one for every field the palette selects. A partial literal would
 * silently return `undefined` for anything added later, which is how a mock drifts from its
 * subject without a single test going red.
 */
const storeState = () => ({
  history: mocks.history,
  analysisState: { isLoading: mocks.pipeline.isRunning, result: null, error: null },
  isBiophysicalLoading: false,
  isStructuralLoading: false,
  isClinicalLoading: false,
  isNarrativeLoading: false,
});

vi.mock("../../context/VariantAnalysisContext", () => ({
  useVariantAnalysisActions: () => mocks.actions,
  useVariantAnalysisStore: (selector: (state: ReturnType<typeof storeState>) => unknown) =>
    selector(storeState()),
}));

vi.mock("../../context/SettingsContext", () => ({
  useSettings: () => mocks.settings,
}));

import CommandPalette, { armSyntheticSubmit } from "../CommandPalette";

type Props = React.ComponentProps<typeof CommandPalette>;

const setup = (overrides: Partial<Props> = {}): Props => ({
  open: true,
  onOpenChange: vi.fn(),
  onViewChange: vi.fn(),
  onEvidenceTabChange: vi.fn(),
  onSelectHistory: vi.fn(),
  onRunQuery: vi.fn(),
  ...overrides,
});

const typeLine = (line: string) => {
  fireEvent.change(screen.getByPlaceholderText(/search views/i), { target: { value: line } });
};

const originalToggleTheme = mocks.settings.toggleTheme;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.history = [];
  mocks.pipeline.isRunning = false;
  mocks.settings.hasConfiguredGeminiKey = true;
  mocks.settings.isDark = false;
  /* `clearAllMocks` wipes call history but cannot undo a reassignment, and the theme test
     replaces `toggleTheme`. Restoring the original here keeps that test's leak from reaching
     whatever runs after it. */
  mocks.settings.toggleTheme = originalToggleTheme;
});

afterEach(() => cleanup());

describe("CommandPalette — mount and hotkey", () => {
  it("renders nothing while closed", () => {
    render(<CommandPalette {...setup({ open: false })} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("announces itself as a modal dialog when open", () => {
    render(<CommandPalette {...setup()} />);
    expect(screen.getByRole("dialog", { name: /command palette/i })).toBeInTheDocument();
  });

  /* The chord used to be registered only while the palette was open, so it could close a
     palette that was already up and could never raise one. */
  it("raises the palette with Ctrl+K while it is closed", () => {
    const onOpenChange = vi.fn();
    render(<CommandPalette {...setup({ open: false, onOpenChange })} />);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  it("lowers the palette with Cmd+K while it is open", () => {
    const onOpenChange = vi.fn();
    render(<CommandPalette {...setup({ onOpenChange })} />);
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("leaves an unrelated Ctrl+A alone", () => {
    const onOpenChange = vi.fn();
    render(<CommandPalette {...setup({ open: false, onOpenChange })} />);
    fireEvent.keyDown(window, { key: "a", ctrlKey: true });
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("leaves a text field's own Ctrl+K alone", () => {
    const onOpenChange = vi.fn();
    render(
      <>
        <CommandPalette {...setup({ open: false, onOpenChange })} />
        <input aria-label="gene field" />
      </>,
    );
    /* The search panel, the settings search box and the dev console all have a field like
       this. The palette is a launcher, not a takeover: taking the chord mid-word ate the
       keystroke and the caret with it. */
    fireEvent.keyDown(screen.getByLabelText("gene field"), { key: "k", ctrlKey: true });
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("still lowers itself from its own input", () => {
    const onOpenChange = vi.fn();
    render(<CommandPalette {...setup({ onOpenChange })} />);
    /* The palette's own field is the one exception — the chord has to keep working while the
       user is typing in it, or the hotkey could open the palette but never close it. */
    fireEvent.keyDown(screen.getByPlaceholderText(/search views/i), { key: "k", ctrlKey: true });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("ignores Shift and Alt chords", () => {
    const onOpenChange = vi.fn();
    render(<CommandPalette {...setup({ open: false, onOpenChange })} />);
    /* AltGr on a European layout reports ctrl+alt; neither is this hotkey. */
    fireEvent.keyDown(window, { key: "k", ctrlKey: true, shiftKey: true });
    fireEvent.keyDown(window, { key: "k", ctrlKey: true, altKey: true });
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("removes its window listener on unmount", () => {
    const onOpenChange = vi.fn();
    const { unmount } = render(<CommandPalette {...setup({ open: false, onOpenChange })} />);
    unmount();
    /* A leaked listener means a second mount double-toggles: the chord opens the palette and
       closes it again in the same keypress, so the feature looks simply dead. */
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("closes on Escape", () => {
    const onOpenChange = vi.fn();
    render(<CommandPalette {...setup({ onOpenChange })} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("closes when the backdrop is clicked but not when the panel is", () => {
    const onOpenChange = vi.fn();
    render(<CommandPalette {...setup({ onOpenChange })} />);
    const input = screen.getByPlaceholderText(/search views/i);
    const overlay = input.closest(".cs-palette-overlay") as HTMLElement;
    fireEvent.mouseDown(input);
    expect(onOpenChange).not.toHaveBeenCalled();
    fireEvent.mouseDown(overlay);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe("CommandPalette — browse mode", () => {
  it("lists views and recents without any typing", () => {
    mocks.history = [{ gene: "TP53", variant: "R175H", uniprotId: "P04637" }];
    render(<CommandPalette {...setup()} />);
    expect(screen.getByText("Views")).toBeInTheDocument();
    expect(screen.getByText("Recent analyses")).toBeInTheDocument();
    expect(screen.getByText("TP53 · R175H")).toBeInTheDocument();
    /* Tab and system rows stay hidden until there is something to match against. */
    expect(screen.queryByText("Evidence tabs")).not.toBeInTheDocument();
    expect(screen.queryByText("System")).not.toBeInTheDocument();
  });

  it("badges the row for the view already on screen", () => {
    render(<CommandPalette {...setup({ activeView: "evidence" })} />);
    expect(screen.getByText("current")).toBeInTheDocument();
  });

  it("badges the merged structure row while an ESMFold tab is showing", () => {
    render(<CommandPalette {...setup({ activeView: "structure_esmfold" })} />);
    expect(screen.getByText("current")).toBeInTheDocument();
  });

  it("reveals evidence tabs and system actions once the reader types", () => {
    render(<CommandPalette {...setup()} />);
    typeLine("con");
    expect(screen.getByText("Evidence tabs")).toBeInTheDocument();
    expect(screen.getByText("System")).toBeInTheDocument();
  });

  it("jumps to a view and closes", () => {
    const onViewChange = vi.fn();
    const onOpenChange = vi.fn();
    render(<CommandPalette {...setup({ onViewChange, onOpenChange })} />);
    fireEvent.click(screen.getAllByText("Energetics")[0]);
    expect(onViewChange).toHaveBeenCalledWith("energetics");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("replays a recent analysis", () => {
    mocks.history = [{ gene: "BRCA2", variant: "R1567A", uniprotId: "P51587" }];
    const onSelectHistory = vi.fn();
    render(<CommandPalette {...setup({ onSelectHistory })} />);
    fireEvent.click(screen.getByText("BRCA2 · R1567A"));
    expect(onSelectHistory).toHaveBeenCalledWith({
      gene: "BRCA2",
      variant: "R1567A",
      uniprotId: "P51587",
    });
  });

  /* App keeps the palette MOUNTED for the life of the shell and flips `open`, so the real
     scenario is one instance going closed and reopening. The previous version unmounted and
     remounted a fresh tree, which passes whether or not the component clears its line on
     reopen — a remount resets state by construction, so the assertion was unfalsifiable. */
  it("starts each visit from a clean line without remounting", () => {
    const props = setup();
    const { rerender } = render(<CommandPalette {...props} />);
    typeLine("BRCA1 R175H");
    expect(screen.getByPlaceholderText(/search views/i)).toHaveValue("BRCA1 R175H");

    rerender(<CommandPalette {...props} open={false} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    rerender(<CommandPalette {...props} open={true} />);
    expect(screen.getByPlaceholderText(/search views/i)).toHaveValue("");
  });
});

describe("CommandPalette — Run group", () => {
  it("runs a parsed gene + substitution", () => {
    const onRunQuery = vi.fn();
    const onViewChange = vi.fn();
    const onOpenChange = vi.fn();
    render(<CommandPalette {...setup({ onRunQuery, onViewChange, onOpenChange })} />);
    typeLine("BRCA1 R175H");
    fireEvent.click(screen.getByText("BRCA1 · R175H"));
    expect(mocks.actions.setCustomGene).toHaveBeenCalledWith("BRCA1");
    expect(mocks.actions.setCustomVariant).toHaveBeenCalledWith("R175H");
    expect(mocks.actions.setCustomGenomic).toHaveBeenCalledWith("");
    expect(onRunQuery).toHaveBeenCalledTimes(1);
    expect(onViewChange).toHaveBeenCalledWith("search");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("labels a coordinate line as needing VEP resolution", () => {
    render(<CommandPalette {...setup()} />);
    typeLine("20-23365054-G-A");
    expect(screen.getByText("VEP resolve")).toBeInTheDocument();
  });

  it("fills the fields without running for a gene on its own", () => {
    const onRunQuery = vi.fn();
    const onViewChange = vi.fn();
    render(<CommandPalette {...setup({ onRunQuery, onViewChange })} />);
    typeLine("BRCA1");
    fireEvent.click(screen.getByText(/Open in Search · BRCA1/));
    expect(mocks.actions.setCustomGene).toHaveBeenCalledWith("BRCA1");
    expect(onRunQuery).not.toHaveBeenCalled();
    expect(onViewChange).toHaveBeenCalledWith("search");
  });

  /* Writing only the slots the query filled left the previous run's variant sitting in the
     form, so `Open in Search · BRCA1` would stack BRCA1 on top of a stale R175H. The label
     promises what the form will hold, so the fields have to agree with it. */
  it("clears the slots a partial query says nothing about", () => {
    render(<CommandPalette {...setup()} />);
    typeLine("BRCA1");
    fireEvent.click(screen.getByText(/Open in Search · BRCA1/));
    expect(mocks.actions.setCustomVariant).toHaveBeenCalledWith("");
    expect(mocks.actions.setCustomGenomic).toHaveBeenCalledWith("");
    expect(mocks.actions.setCustomUniprot).toHaveBeenCalledWith("");
  });

  /* The palette hands the pipeline a synthetic event carrying only `preventDefault`. If
     `handleSearchSubmit` ever grows a read of another member, the object names the offender
     instead of handing back `undefined` — which would fail silently, as a run against the
     previous variant. */
  it("names the event member a changed submit handler would reach for", () => {
    const event = armSyntheticSubmit({ preventDefault: () => {} } as unknown as React.FormEvent);
    for (const member of ["currentTarget", "target", "nativeEvent", "bubbles", "defaultPrevented"]) {
      expect(() => (event as unknown as Record<string, unknown>)[member]).toThrow(
        new RegExp(`handleSearchSubmit read \`event\\.${member}\``),
      );
    }
    /* The one member that is real still works, or the guard would break the run itself. */
    expect(() => event.preventDefault()).not.toThrow();
  });

  it("marks the app behind the palette inert so aria-modal is honest", () => {
    const shell = document.createElement("div");
    shell.className = "app-shell";
    document.body.appendChild(shell);
    try {
      const { rerender } = render(<CommandPalette {...setup()} />);
      /* Tab is trapped and the backdrop eats clicks, but neither takes the background out of
         the accessibility tree — `aria-modal` claims it has been. */
      expect(shell.hasAttribute("inert")).toBe(true);

      rerender(<CommandPalette {...setup()} open={false} />);
      expect(shell.hasAttribute("inert")).toBe(false);
    } finally {
      shell.remove();
    }
  });

  /* Every action test in this file used `fireEvent.click`, which routes through cmdk's item
     click handling. The path a keyboard user actually takes is cmdk's root keydown handler
     dispatching `cmdk-item-select` on the active row, and it had no coverage at all: a
     regression where Enter stopped launching runs would have shipped green. */
  it("runs the top row on Enter", () => {
    const onRunQuery = vi.fn();
    render(<CommandPalette {...setup({ onRunQuery })} />);
    typeLine("BRCA1 R175H");
    fireEvent.keyDown(screen.getByPlaceholderText(/search views/i), { key: "Enter" });
    expect(onRunQuery).toHaveBeenCalledTimes(1);
  });

  /* Arrow navigation, asserted where more than one row is actually reachable. Typing a full
     query leaves the Run row as the only match, so there is nothing to move to — which is the
     intended behaviour, and is why this runs in browse mode instead. */
  it("moves the selection with the arrow keys", () => {
    const onViewChange = vi.fn();
    render(<CommandPalette {...setup({ onViewChange })} />);
    const input = screen.getByPlaceholderText(/search views/i);

    fireEvent.keyDown(input, { key: "Enter" });
    const first = onViewChange.mock.calls[0][0];
    expect(first).toBeDefined();

    onViewChange.mockClear();
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onViewChange).toHaveBeenCalled();
    expect(onViewChange.mock.calls[0][0]).not.toBe(first);
  });

  it("wraps the selection with loop", () => {
    const onViewChange = vi.fn();
    render(<CommandPalette {...setup({ onViewChange })} />);
    const input = screen.getByPlaceholderText(/search views/i);

    fireEvent.keyDown(input, { key: "Enter" });
    const first = onViewChange.mock.calls[0][0];

    /* Up from the first row wraps to the last, and back again to the first. */
    onViewChange.mockClear();
    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "Enter" });
    const last = onViewChange.mock.calls[0][0];
    expect(last).not.toBe(first);

    onViewChange.mockClear();
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onViewChange.mock.calls[0][0]).toBe(first);
  });

  /* The palette writes four fields and then hands over to the pipeline, which reads them back
     through `getState()`. If those two ever swap places the run analyses the PREVIOUS variant
     and nothing here would notice — which is exactly the bug this refactor set out to remove. */
  it("writes every field before it asks for the run", () => {
    const onRunQuery = vi.fn();
    render(<CommandPalette {...setup({ onRunQuery })} />);
    typeLine("BRCA1 R175H");
    fireEvent.click(screen.getByText("BRCA1 · R175H"));

    const lastWrite = Math.max(
      mocks.actions.setCustomGene.mock.invocationCallOrder[0],
      mocks.actions.setCustomVariant.mock.invocationCallOrder[0],
      mocks.actions.setCustomGenomic.mock.invocationCallOrder[0],
      mocks.actions.setCustomUniprot.mock.invocationCallOrder[0],
    );
    expect(onRunQuery.mock.invocationCallOrder[0]).toBeGreaterThan(lastWrite);
  });

  /* The palette's Escape listener is on `document` in the capture phase, so it runs before
     every bubble-phase handler. The settings drawer and the narrow-viewport nav both close on
     Escape from one of those, and a single keypress used to tear down both layers. */
  it("does not let Escape reach the layer behind it", () => {
    const onOpenChange = vi.fn();
    const behind = vi.fn();
    document.addEventListener("keydown", behind);
    try {
      render(<CommandPalette {...setup({ onOpenChange })} />);
      fireEvent.keyDown(document, { key: "Escape" });
      expect(onOpenChange).toHaveBeenCalledWith(false);
      expect(behind).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener("keydown", behind);
    }
  });

  it("keeps ArrowDown and Enter working despite that guard", () => {
    const onViewChange = vi.fn();
    render(<CommandPalette {...setup({ onViewChange })} />);
    const input = screen.getByPlaceholderText(/search views/i);
    /* A blanket `stopPropagation` would have taken cmdk's key handling with it. */
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onViewChange).toHaveBeenCalled();
  });

  it("routes to the API key tab when no key is configured", () => {
    mocks.settings.hasConfiguredGeminiKey = false;
    const onRunQuery = vi.fn();
    render(<CommandPalette {...setup({ onRunQuery })} />);
    typeLine("BRCA1 R175H");
    fireEvent.click(screen.getByText(/API key required/));
    expect(onRunQuery).not.toHaveBeenCalled();
    expect(mocks.settings.openSettingsTab).toHaveBeenCalledWith("api");
  });

  it("hides the Run group for text that is not a query", () => {
    render(<CommandPalette {...setup()} />);
    typeLine("settings");
    expect(screen.queryByText("Run")).not.toBeInTheDocument();
  });

  /* The Search form disables its submit while a stage is live, and a run launched from here
     would abort that run mid-flight instead — silently, with the stages just going quiet. */
  it("will not start a second run while one is in flight", () => {
    mocks.pipeline.isRunning = true;
    const onRunQuery = vi.fn();
    const onViewChange = vi.fn();
    render(<CommandPalette {...setup({ onRunQuery, onViewChange })} />);
    typeLine("BRCA1 R175H");

    expect(screen.getByText(/analysis already running/)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/analysis already running/));
    expect(onRunQuery).not.toHaveBeenCalled();
    /* It still takes the reader to the run that IS going, which is the useful thing to do. */
    expect(onViewChange).toHaveBeenCalledWith("search");
  });
});

describe("CommandPalette — system actions", () => {
  it("clears recents", () => {
    mocks.history = [{ gene: "TP53", variant: "R175H", uniprotId: "P04637" }];
    render(<CommandPalette {...setup()} />);
    typeLine("clear");
    fireEvent.click(screen.getByText("Clear recent analyses"));
    expect(mocks.actions.clearHistory).toHaveBeenCalled();
  });

  it("toggles the theme", () => {
    const toggleTheme = vi.fn();
    mocks.settings.toggleTheme = toggleTheme;
    mocks.settings.isDark = true;
    render(<CommandPalette {...setup()} />);
    typeLine("theme");
    fireEvent.click(screen.getByText("Switch to light mode"));
    expect(toggleTheme).toHaveBeenCalledTimes(1);
  });

  it("opens an evidence tab without changing the view itself", () => {
    const onEvidenceTabChange = vi.fn();
    render(<CommandPalette {...setup({ onEvidenceTabChange })} />);
    typeLine("predictors");
    fireEvent.click(screen.getByText("In-Silico Predictors"));
    expect(onEvidenceTabChange).toHaveBeenCalled();
  });

  it("launches the onboarding workspace tour", () => {
    const onOpenOnboarding = vi.fn();
    render(<CommandPalette {...setup({ onOpenOnboarding })} />);
    typeLine("tour");
    fireEvent.click(screen.getByText("Workspace guide & API keys tour"));
    expect(onOpenOnboarding).toHaveBeenCalledTimes(1);
  });
});

