"use client";

import { useFormStatus } from "react-dom";
import { cn } from "@/lib/cn";

/**
 * A select that saves the moment a new option is picked (Admin → Models,
 * the draft's behaviour: no separate Switch button). Lives inside a server
 * <form action>; picking submits that form.
 */
export function ApplyOnChangeSelect({
  id,
  name,
  label,
  defaultValue,
  options,
}: {
  id: string;
  name: string;
  label: string;
  defaultValue: string;
  options: { id: string; label: string }[];
}) {
  const { pending } = useFormStatus();
  return (
    <>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <select
        id={id}
        name={name}
        defaultValue={defaultValue}
        disabled={pending}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className={cn(
          "w-full max-w-full rounded-[9px] border border-atelier-rule bg-atelier-paper px-2 py-1.5 text-[12.5px] text-atelier-ink",
          pending && "opacity-60",
        )}
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </>
  );
}
