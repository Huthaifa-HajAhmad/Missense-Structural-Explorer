import React from "react";
import { CheckCircle2, AlertCircle, AlertTriangle, Info, X } from "lucide-react";

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
      {notifications.map((notif) => {
        const isErr = notif.type === "error";
        const isWarn = notif.type === "warn";
        const isSucc = notif.type === "success";

        return (
          <div
            key={notif.id}
            role={isErr ? "alert" : "status"}
            aria-live={isErr ? "assertive" : "polite"}
            className={`relative overflow-hidden pointer-events-auto p-3 rounded-xl shadow-lg border flex items-start gap-2.5 transition-all duration-200 backdrop-blur-md ${
              isDark
                ? "bg-[#161618]/95 text-slate-100"
                : "bg-white/95 text-slate-800"
            } ${
              isErr
                ? "border-rose-500/30"
                : isWarn
                ? "border-amber-500/30"
                : isSucc
                ? "border-emerald-500/30"
                : "border-slate-200 dark:border-slate-800"
            }`}
          >
            {/* Accent strip */}
            <div className={`absolute left-0 top-0 bottom-0 w-1 rounded-l-xl ${
              isErr ? "bg-rose-500"
              : isWarn ? "bg-amber-500"
              : isSucc ? "bg-emerald-500"
              : "bg-blue-500"
            }`} />

            <div className="pl-1 flex items-start gap-2.5 w-full">
              {isSucc && <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />}
              {isErr && <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />}
              {isWarn && <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />}
              {!isSucc && !isErr && !isWarn && <Info className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />}

              <div className="flex-1 min-w-0">
                <p className="text-[9.5px] leading-none font-mono font-bold tracking-wider uppercase opacity-60 mb-1">
                  {isSucc ? "Complete"
                    : isErr ? "Pipeline Alert"
                    : isWarn ? "Service Notice"
                    : "System"}
                </p>
                <p className="text-[11.5px] leading-snug font-medium break-words text-cs-text-primary">
                  {notif.message}
                </p>
              </div>

              <button
                onClick={() => onRemoveNotification(notif.id)}
                className="text-cs-text-muted hover:text-cs-text-primary p-0.5 rounded transition-colors cursor-pointer"
                aria-label="Close notification"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default React.memo(NotificationToastContainer);

