"use client";

import { CheckIcon } from "./icons";

// The door's two small controls, drawn in the Red Carpet literals: a real
// checkbox and a real radio (native inputs, so keyboard and screen readers
// get them for free), painted over. The row that holds one is a <label>
// with a 44 px target; its focus ring is drawn on the row (ROW below).

export const ROW =
  "flex min-h-11 cursor-pointer items-center gap-2.5 rounded-xl px-3 text-[13.5px] text-[#ecedf1] ring-1 ring-inset ring-[rgba(255,255,255,0.14)] has-[:checked]:bg-[rgba(255,255,255,0.05)] has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[#f0cda6] has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60";

export function TickBox({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  /** Only when the row carries no visible words of its own. */
  label?: string;
}) {
  return (
    <span className="relative grid h-[22px] w-[22px] flex-none place-items-center">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-label={label}
        onChange={(e) => onChange(e.target.checked)}
        className="peer absolute inset-0 cursor-pointer appearance-none rounded-md ring-[1.5px] ring-inset ring-[rgba(255,255,255,0.4)] checked:bg-[#f0cda6] checked:ring-[#f0cda6] focus:outline-none disabled:cursor-not-allowed"
      />
      <CheckIcon className="pointer-events-none relative hidden h-3.5 w-3.5 text-[#1a1410] peer-checked:block" />
    </span>
  );
}

export function RadioDot({
  name,
  checked,
  onChange,
  disabled,
}: {
  name: string;
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
}) {
  return (
    <input
      type="radio"
      name={name}
      checked={checked}
      disabled={disabled}
      onChange={onChange}
      className="h-[18px] w-[18px] flex-none cursor-pointer appearance-none rounded-full ring-[1.5px] ring-inset ring-[rgba(255,255,255,0.4)] checked:bg-[#f0cda6] checked:shadow-[inset_0_0_0_3.5px_#1a1410] checked:ring-[#f0cda6] focus:outline-none"
    />
  );
}
