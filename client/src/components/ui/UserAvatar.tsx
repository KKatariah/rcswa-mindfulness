import { safeUrl } from "@/lib/safeUrl";

type UserAvatarProps = {
  avatarUrl?: string | null;
  fullName?: string | null;
  size?: number;
  className?: string;
};

export function UserAvatar({
  avatarUrl,
  fullName,
  size = 40,
  className = "",
}: UserAvatarProps) {
  return (
    <img
      src={safeUrl(avatarUrl)}
      alt={fullName ? `${fullName} profile picture` : "Profile picture"}
      className={`rounded-full object-cover ${className}`}
      style={{ width: size, height: size }}
    />
  );
}
