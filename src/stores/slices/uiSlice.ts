import { StateCreator } from "zustand";
import type { PerturbationModelId } from "../../shared/perturbationModels";
import { defaultReportSections, sectionsForPreset, type BlockKey, type ReportCitation, type ReportEdit, type ReportPresetId } from "../../shared/reportDocument";
import type { ReportDraft } from "../../shared/reportInput";

export interface NotificationItem {
  id: string;
  type: "success" | "info" | "error" | "warn";
  message: string;
}

/**
 * Report blocks the author can include, exclude and edit.
 *
 * This lives in the store (rather than in either pane) because the controls are in the Report rail and
 * the content they change is in the main Report view. The keys are the document model's
 * (`shared/reportDocument.ts`); `summary` keeps the name the Insights card already uses to switch the
 * written summary back on.
 */
export type ReportSectionKey = BlockKey;

export const DEFAULT_REPORT_SECTIONS: Record<ReportSectionKey, boolean> = defaultReportSections();

export interface ReportMeta { title: string; preparedBy: string; caseRef: string }

export const DEFAULT_REPORT_META: ReportMeta = { title: "", preparedBy: "", caseRef: "" };

export interface UiState {
  viewMode: "wildtype" | "mutant" | "superimposed";
  isHowToInspectOpen: boolean;
  isLegendOpen: boolean;
  notifications: NotificationItem[];
  reportSections: Record<ReportSectionKey, boolean>;
  /** The author's own text per block. Only prose can be edited; scores, facts and the verdict cannot. */
  reportEdits: Partial<Record<ReportSectionKey, ReportEdit>>;
  reportMeta: ReportMeta;
  /** Papers pinned from the Literature tab; the report cites only these. */
  reportCitations: ReportCitation[];
  /**
   * Which protein-language model card is selected on the Structural Perturbation tab.
   *
   * This lives in the store because the selection drives two panes at once: the main
   * column renders the chosen model's metrics, and the Perturbation inspector describes
   * that same model's calibration. Keeping it private to the tab left the inspector
   * unable to say which model its notes referred to.
   */
  activePerturbationModel: PerturbationModelId;
}

export interface UiActions {
  setViewMode: (viewMode: "wildtype" | "mutant" | "superimposed") => void;
  setIsHowToInspectOpen: (isHowToInspectOpen: boolean) => void;
  setIsLegendOpen: (isLegendOpen: boolean) => void;
  setNotifications: (
    notifications: NotificationItem[] | ((prev: NotificationItem[]) => NotificationItem[])
  ) => void;
  addNotification: (type: "success" | "info" | "error" | "warn", message: string, autoShowAlerts?: boolean) => void;
  removeNotification: (id: string) => void;
  toggleReportSection: (key: ReportSectionKey) => void;
  setReportSections: (sections: Record<ReportSectionKey, boolean>) => void;
  applyReportPreset: (preset: ReportPresetId) => void;
  setReportEdit: (key: ReportSectionKey, text: string, base: string) => void;
  clearReportEdit: (key: ReportSectionKey) => void;
  setReportMeta: (patch: Partial<ReportMeta>) => void;
  pinReportCitation: (citation: ReportCitation) => void;
  unpinReportCitation: (id: string) => void;
  /** Replace the whole draft (sections, edits, meta, citations), e.g. when the variant changes. */
  loadReportDraft: (draft: ReportDraft | null) => void;
  setActivePerturbationModel: (model: PerturbationModelId) => void;
}

export type UiSlice = UiState & UiActions;

const notificationTimers = new Map<string, ReturnType<typeof setTimeout>>();

export const createUiSlice: StateCreator<UiSlice, [], [], UiSlice> = (set) => ({
  viewMode: "wildtype",
  isHowToInspectOpen: false,
  isLegendOpen: false,
  notifications: [],
  reportSections: { ...DEFAULT_REPORT_SECTIONS },
  reportEdits: {},
  reportMeta: { ...DEFAULT_REPORT_META },
  reportCitations: [],
  activePerturbationModel: "saprot",

  setViewMode: (viewMode) => set({ viewMode }),
  setActivePerturbationModel: (activePerturbationModel) => set({ activePerturbationModel }),
  setIsHowToInspectOpen: (isHowToInspectOpen) => set({ isHowToInspectOpen }),
  setIsLegendOpen: (isLegendOpen) => set({ isLegendOpen }),
  toggleReportSection: (key) => set((state) => ({
    reportSections: { ...state.reportSections, [key]: !state.reportSections[key] }
  })),
  setReportSections: (reportSections) => set({ reportSections }),
  applyReportPreset: (preset) => set({ reportSections: sectionsForPreset(preset) }),
  setReportEdit: (key, text, base) =>
    set((state) => {
      const next = { ...state.reportEdits };
      // An empty edit is no edit: clearing the text restores the drafted text.
      if (text.trim().length === 0) delete next[key];
      else next[key] = { text, base };
      return { reportEdits: next };
    }),
  clearReportEdit: (key) =>
    set((state) => {
      const next = { ...state.reportEdits };
      delete next[key];
      return { reportEdits: next };
    }),
  setReportMeta: (patch) => set((state) => ({ reportMeta: { ...state.reportMeta, ...patch } })),
  pinReportCitation: (citation) =>
    set((state) =>
      state.reportCitations.some((c) => c.id === citation.id) ? {} : { reportCitations: [...state.reportCitations, citation] }
    ),
  unpinReportCitation: (id) => set((state) => ({ reportCitations: state.reportCitations.filter((c) => c.id !== id) })),
  loadReportDraft: (draft) =>
    set({
      reportSections: draft ? { ...DEFAULT_REPORT_SECTIONS, ...draft.sections } : { ...DEFAULT_REPORT_SECTIONS },
      reportEdits: draft ? { ...draft.edits } : {},
      reportMeta: draft ? { ...DEFAULT_REPORT_META, ...draft.meta } : { ...DEFAULT_REPORT_META },
      reportCitations: draft ? [...draft.citations] : [],
    }),
  setNotifications: (updater) => set((state) => ({
    notifications: typeof updater === "function" ? updater(state.notifications) : updater
  })),

  addNotification: (type, message, autoShowAlerts = true) => {
    try {
      if (type === "error") {
        console.error(`[Notification Error] ${message}`);
      } else if (type === "warn") {
        console.warn(`[Notification Warn] ${message}`);
      } else if (type === "info") {
        console.info(`[Notification] ${message}`);
      } else if (type === "success") {
        console.info(`[Notification Success] ${message}`);
      }
    } catch (_) {}

    if (!autoShowAlerts && (type === "warn" || type === "error")) {
      return;
    }

    const id = Math.random().toString(36).substring(2, 9);
    set((state) => ({
      notifications: [...state.notifications, { id, type, message }]
    }));

    const timer = setTimeout(() => {
      notificationTimers.delete(id);
      set((state) => ({
        notifications: state.notifications.filter((n) => n.id !== id)
      }));
    }, 6000);
    notificationTimers.set(id, timer);
  },

  removeNotification: (id) => {
    const existing = notificationTimers.get(id);
    if (existing) {
      clearTimeout(existing);
      notificationTimers.delete(id);
    }
    set((state) => ({
      notifications: state.notifications.filter((n) => n.id !== id)
    }));
  }
});
