"use client";

import { useState } from "react";
import { updateProfileDetails } from "@/lib/profile/actions";
import { Label, Input } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { useLocale } from "@/lib/i18n/provider";

const STANDARD_GENDERS = ["Woman", "Man", "Non-binary"];

export function ProfileForm({
  initialCompany,
  initialGender,
}: {
  initialCompany: string;
  initialGender: string;
}) {
  const { t } = useLocale();
  const s = t.settings;
  const genderLabels: Record<string, string> = {
    Woman: s.genderWoman,
    Man: s.genderMan,
    "Non-binary": s.genderNonBinary,
  };
  const isStandard = STANDARD_GENDERS.includes(initialGender);
  const isCustom = initialGender !== "" && !isStandard;

  const [genderChoice, setGenderChoice] = useState(
    isCustom ? "self-describe" : initialGender || "",
  );

  return (
    <form action={updateProfileDetails} className="space-y-5">
      <div>
        <Label htmlFor="company">{s.companyLabel}</Label>
        <Input id="company" name="company" defaultValue={initialCompany} placeholder={s.optional} />
      </div>

      <div>
        <Label htmlFor="gender">{s.genderLabel}</Label>
        <select
          id="gender"
          name="gender"
          value={genderChoice}
          onChange={(e) => setGenderChoice(e.target.value)}
          className="w-full rounded-control border border-atelier-rule bg-transparent px-3.5 py-2.5 text-sm text-atelier-ink outline-none transition-colors focus:border-atelier-accent"
        >
          <option value="">{s.preferNotToSay}</option>
          {STANDARD_GENDERS.map((g) => (
            <option key={g} value={g}>
              {genderLabels[g]}
            </option>
          ))}
          <option value="self-describe">{s.selfDescribe}</option>
        </select>
        {genderChoice === "self-describe" && (
          <Input
            name="gender_other"
            defaultValue={isCustom ? initialGender : ""}
            placeholder={s.selfDescribePlaceholder}
            className="mt-2"
          />
        )}
      </div>

      <p className="text-xs text-atelier-muted">
        {s.profileNote}
      </p>

      <SubmitButton>{t.common.save}</SubmitButton>
    </form>
  );
}
