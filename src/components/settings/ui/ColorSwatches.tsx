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
  /** Show the selected colour's name beside the swatches. */
  showSelectedName?: boolean;
}

/** Circular swatch row; the selected swatch gets an offset ring + check. */
export function ColorSwatches({ colors, value, onChange, ariaLabel, showSelectedName = false }: ColorSwatchesProps) {
  const selectedColor = colors.find((c) => c.hex.toLowerCase() === value?.toLowerCase());
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <div role="group" aria-label={ariaLabel} className="flex flex-wrap items-center gap-2">
        {colors.map((color) => {
          const selected = selectedColor?.hex === color.hex;
          return (
            <button
              key={color.hex}
              type="button"
              title={color.name}
              aria-label={`${color.name}${selected ? " (selected)" : ""}`}
              aria-pressed={selected}
              onClick={() => onChange(color.hex)}
              className={`settings-swatch relative grid place-items-center w-7 h-7 rounded-full cursor-pointer transition-[transform,box-shadow] duration-150 active:scale-90 focus-visible:outline-none ${
                selected ? "is-selected" : "hover:scale-110"
              }`}
              style={{ backgroundColor: color.hex, ["--swatch" as string]: color.hex }}
            >
              {selected && <Check className="w-3.5 h-3.5 text-white drop-shadow" strokeWidth={3} />}
            </button>
          );
        })}
      </div>
      {showSelectedName && selectedColor && (
        <span className="text-[12px] font-medium text-cs-text-secondary whitespace-nowrap" aria-hidden>
          {selectedColor.name}
        </span>
      )}
    </div>
  );
}
