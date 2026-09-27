import React from "react";
import { Check } from "lucide-react";
import type { ThemeMode } from "../../../context/SettingsContext";

const OPTIONS: { value: ThemeMode; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" }
];

/** Miniature workspace mock-up drawn in the given palette. */
function Preview({ mode }: { mode: "light" | "dark" }) {
  return (
    <div className={`settings-theme-preview settings-theme-preview--${mode}`} aria-hidden>
      <div className="stp-rail" />
      <div className="stp-main">
        <div className="stp-bar stp-bar--title" />
        <div className="stp-card">
          <div className="stp-bar" />
          <div className="stp-bar stp-bar--short" />
          <div className="stp-dot" />
        </div>
      </div>
    </div>
  );
}

/** Visual light / dark / system picker with radio semantics. */
export function ThemePicker({ value, onChange }: { value: ThemeMode; onChange: (mode: ThemeMode) => void }) {
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const idx = OPTIONS.findIndex((o) => o.value === value);
    let next = -1;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (idx + 1) % OPTIONS.length;
    if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (idx - 1 + OPTIONS.length) % OPTIONS.length;
    if (next < 0) return;
    e.preventDefault();
    e.stopPropagation();
    onChange(OPTIONS[next].value);
    const buttons = e.currentTarget.querySelectorAll<HTMLButtonElement>("[role=radio]");
    buttons[next]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label="Color scheme"
      onKeyDown={handleKeyDown}
      className="grid grid-cols-3 gap-2.5 sm:gap-3"
    >
      {OPTIONS.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option.value)}
            className={`settings-theme-option group text-left cursor-pointer ${selected ? "is-selected" : ""}`}
          >
            <div className="settings-theme-frame">
              {option.value === "system" ? (
                <div className="grid grid-cols-2 h-full">
                  <div className="overflow-hidden">
                    <Preview mode="light" />
                  </div>
                  <div className="overflow-hidden">
                    <Preview mode="dark" />
                  </div>
                </div>
              ) : (
                <Preview mode={option.value} />
              )}
            </div>
            <div className="mt-2 flex items-center gap-1.5 px-0.5">
              <span
                className={`grid place-items-center w-3.5 h-3.5 rounded-full border transition-colors ${
                  selected ? "border-transparent bg-cs-accent-clay text-white" : "border-cs-border"
                }`}
                aria-hidden
              >
                {selected && <Check className="w-2.5 h-2.5" strokeWidth={3.5} />}
              </span>
              <span
                className={`text-[12.5px] ${selected ? "font-semibold text-cs-text-primary" : "font-medium text-cs-text-secondary group-hover:text-cs-text-primary"}`}
              >
                {option.label}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
