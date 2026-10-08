import { initials } from "@/lib/utils";
import { cn } from "@/lib/utils";
import type { User } from "@/types/user";

export function UserAvatar({ user, className }: { user: Pick<User, "name" | "avatarUrl">; className?: string }) {
  if (user.avatarUrl) {
    // eslint-disable-next-line @next/next/no-img-element -- remote avatar host is provider-defined
    return <img src={user.avatarUrl} alt="" referrerPolicy="no-referrer" className={cn("size-8 rounded-full object-cover", className)} />;
  }
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-8 items-center justify-center rounded-full bg-gradient-to-br from-blue to-accent text-xs font-semibold text-accent-foreground",
        className,
      )}
    >
      {initials(user.name)}
    </span>
  );
}
