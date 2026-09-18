import { StateCreator } from "zustand";
import type { PerturbationModelId } from "../../shared/perturbationModels";

export interface NotificationItem {
  id: string;
  type: "success" | "info" | "error" | "warn";
  message: string;
}

/**
 * Report body sections the clinician can include or exclude.
 *
 * This lives in the store (rather than in either pane) because the filter control is in the
 * Report inspector and the content it filters is in the main Report view. Previously each
 * side kept private state, so the "Section Filters" toggles filtered nothing at all.
 */
export type ReportSectionKey = "summary" | "acmg" | "structure" | "energetics" | "literature";

export const DEFAULT_REPORT_SECTIONS: Record<ReportSectionKey, boolean> = {
  summary: true,
  acmg: true,
  structure: true,
  energetics: true,
  literature: true,
};

export interface UiState {
  viewMode: "wildtype" | "mutant" | "superimposed";
  isHowToInspectOpen: boolean;
  isLegendOpen: boolean;
  notifications: NotificationItem[];
  reportSections: Record<ReportSectionKey, boolean>;
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
  activePerturbationModel: "saprot",

  setViewMode: (viewMode) => set({ viewMode }),
  setActivePerturbationModel: (activePerturbationModel) => set({ activePerturbationModel }),
  setIsHowToInspectOpen: (isHowToInspectOpen) => set({ isHowToInspectOpen }),
  setIsLegendOpen: (isLegendOpen) => set({ isLegendOpen }),
  toggleReportSection: (key) => set((state) => ({
    reportSections: { ...state.reportSections, [key]: !state.reportSections[key] }
  })),
  setReportSections: (reportSections) => set({ reportSections }),
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
