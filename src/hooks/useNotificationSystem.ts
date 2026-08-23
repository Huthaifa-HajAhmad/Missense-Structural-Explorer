import { useState, useCallback } from "react";

export interface NotificationItem {
  id: string;
  type: "success" | "info" | "error" | "warn";
  message: string;
}

/**
 * @param autoShowAlerts When false, warn/error notifications are logged to the
 * console but not raised as toasts (user opted out of automatic alert banners).
 */
export function useNotificationSystem(autoShowAlerts: boolean = true) {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);

  const addNotification = useCallback((type: "success" | "info" | "error" | "warn", message: string) => {
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
    } catch (e) {
      // Ignore console failures to prevent notification crash
    }
    if (!autoShowAlerts && (type === "warn" || type === "error")) {
      return;
    }
    const id = Math.random().toString(36).substring(2, 9);
    setNotifications(prev => [...prev, { id, type, message }]);
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== id));
    }, 6000);
  }, [autoShowAlerts]);

  const removeNotification = useCallback((id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  }, []);

  return {
    notifications,
    setNotifications,
    addNotification,
    removeNotification
  };
}
