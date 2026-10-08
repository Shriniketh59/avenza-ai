import { Check, Circle } from "lucide-react";
import { passwordRules } from "@/lib/validations";
import { cn } from "@/lib/utils";

export function PasswordChecklist({ value }: { value: string }) {
  return (
    <ul className="grid grid-cols-2 gap-x-3 gap-y-1 pt-1" aria-label="Password requirements">
      {passwordRules.map((rule) => {
        const ok = rule.test(value);
        return (
          <li key={rule.id} className={cn("flex items-center gap-1.5 text-xs", ok ? "text-accent" : "text-muted")}>
            {ok ? <Check className="size-3.5" aria-hidden /> : <Circle className="size-3" aria-hidden />}
            {rule.label}
            <span className="sr-only">{ok ? "(met)" : "(not met)"}</span>
          </li>
        );
      })}
    </ul>
  );
}
