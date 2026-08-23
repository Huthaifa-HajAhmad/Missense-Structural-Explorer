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
            className={`w-6 h-6 rounded-full border flex items-center justify-center transition-all cursor-pointer ${
              selected ? "ring-2 ring-offset-1" : "hover:scale-110 border-transparent"
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
