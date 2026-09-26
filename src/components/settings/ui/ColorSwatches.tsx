import React from "react";
import { Check } from "lucide-react";

export interface SwatchColor {
  name: string;
  hex: string;
  id?: string;
}

interface ColorSwatchesProps {
  colors: SwatchColor[];
  value: string;
  onChange: (hex: string) => void;
  ariaLabel: string;
}

/** Compact circular swatch grid; selected swatch gets a clay ring + check. */
export function ColorSwatches({ colors, value, onChange, ariaLabel }: ColorSwatchesProps) {
  return (
    <div role="group" aria-label={ariaLabel} className="flex flex-wrap items-center gap-2">
      {colors.map((color) => {
        const selected = value === color.hex;
        return (
          <button
            key={color.hex}
            type="button"
            title={color.name}
            aria-label={`${color.name}${selected ? " (selected)" : ""}`}
            aria-pressed={selected}
            onClick={() => onChange(color.hex)}
            className={`w-6.5 h-6.5 rounded-full border flex items-center justify-center transition-all duration-150 cursor-pointer active:scale-90 ${
              selected ? "ring-2 ring-offset-1.5 shadow-sm scale-105" : "hover:scale-110 border-transparent opacity-85 hover:opacity-100"
            }`}
            style={{
              backgroundColor: color.hex,
              ...(selected
                ? {
                    borderColor: color.hex,
                    "--tw-ring-color": "var(--cs-accent-clay)",
                    "--tw-ring-offset-color": "var(--cs-surface)"
                  }
                : {})
            }}
          >
            {selected && <Check className="w-3.5 h-3.5 text-white drop-shadow-sm" strokeWidth={3} />}
          </button>
        );
      })}
    </div>
  );
}
