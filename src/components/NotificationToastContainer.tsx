import React from "react";

interface Notification {
  id: string;
  type: "success" | "error" | "warn" | "info";
  message: string;
}

interface NotificationToastContainerProps {
  notifications: Notification[];
  isDark: boolean;
  onRemoveNotification: (id: string) => void;
}

export function NotificationToastContainer({
  notifications,
  isDark,
  onRemoveNotification
}: NotificationToastContainerProps) {
  if (!notifications || notifications.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none">
      {notifications.map((notif) => (
        <div
          key={notif.id}
          role={notif.type === "error" ? "alert" : "status"}
          aria-live={notif.type === "error" ? "assertive" : "polite"}
          className={`relative overflow-hidden pointer-events-auto p-3.5 rounded-xl shadow-xl border flex items-start gap-3 transition-all duration-300 transform translate-y-0 scale-100 animate-slide-in backdrop-blur-md ${
            isDark
              ? "bg-slate-900/90 text-white"
              : "bg-white/95 text-slate-900"
          } ${
            notif.type === "error"
              ? "border-rose-500/40"
              : notif.type === "warn"
              ? "border-amber-400/40"
              : notif.type === "success"
              ? "border-emerald-500/30"
              : "border-slate-200"
          }`}
        >
          {/* Left accent strip */}
          <div className={`absolute left-0 top-0 bottom-0 w-1 rounded-l-xl ${
            notif.type === "error" ? "bg-rose-500"
            : notif.type === "warn" ? "bg-amber-400"
            : notif.type === "success" ? "bg-emerald-500"
            : "bg-blue-400"
          }`} />
          <div className="pl-1 flex items-start gap-3 w-full">
            {notif.type === "success" && (
              <span className="text-emerald-500 text-sm mt-0.5 font-bold">✓</span>
            )}
            {notif.type === "error" && (
              <span className="text-rose-500 text-sm mt-0.5">⛔</span>
            )}
            {notif.type === "warn" && (
              <span className="text-amber-400 text-sm mt-0.5">⚠️</span>
            )}
            {notif.type === "info" && (
              <span className="text-blue-500 text-sm mt-0.5">ℹ️</span>
            )}
            <div className="flex-1">
              <p className="text-[9px] leading-none font-extrabold tracking-wider uppercase opacity-45 mb-1 font-mono">
                {notif.type === "success" ? "Analysis Ready"
                  : notif.type === "error" ? "Notification Error"
                  : notif.type === "warn" ? "Service Degraded"
                  : "System Update"}
              </p>
              <p className="text-[11px] leading-normal font-medium">{notif.message}</p>
            </div>
            <button
              onClick={() => onRemoveNotification(notif.id)}
              className="text-slate-400 hover:text-slate-200 text-xs px-1 mt-0.5 font-bold transition-colors cursor-pointer"
              aria-label="Close notification"
            >
              ✕
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

export default React.memo(NotificationToastContainer);
