import { StateCreator } from "zustand";

export interface NotificationItem {
  id: string;
  type: "success" | "info" | "error" | "warn";
  message: string;
}

export interface UiState {
  viewMode: "wildtype" | "mutant";
  isHowToInspectOpen: boolean;
  isLegendOpen: boolean;
  notifications: NotificationItem[];
}

export interface UiActions {
  setViewMode: (viewMode: "wildtype" | "mutant") => void;
  setIsHowToInspectOpen: (isHowToInspectOpen: boolean) => void;
  setIsLegendOpen: (isLegendOpen: boolean) => void;
  setNotifications: (
    notifications: NotificationItem[] | ((prev: NotificationItem[]) => NotificationItem[])
  ) => void;
  addNotification: (type: "success" | "info" | "error" | "warn", message: string, autoShowAlerts?: boolean) => void;
  removeNotification: (id: string) => void;
}

export type UiSlice = UiState & UiActions;

export const createUiSlice: StateCreator<UiSlice, [], [], UiSlice> = (set) => ({
  viewMode: "wildtype",
  isHowToInspectOpen: false,
  isLegendOpen: false,
  notifications: [],

  setViewMode: (viewMode) => set({ viewMode }),
  setIsHowToInspectOpen: (isHowToInspectOpen) => set({ isHowToInspectOpen }),
  setIsLegendOpen: (isLegendOpen) => set({ isLegendOpen }),
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

    setTimeout(() => {
      set((state) => ({
        notifications: state.notifications.filter((n) => n.id !== id)
      }));
    }, 6000);
  },

  removeNotification: (id) => set((state) => ({
    notifications: state.notifications.filter((n) => n.id !== id)
  }))
});
