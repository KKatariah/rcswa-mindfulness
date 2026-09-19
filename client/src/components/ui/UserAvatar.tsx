import { useEffect, useState } from "react";

export function getInitials(name?: string | null) {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return "U";

  const parts = trimmed.split(/\s+/).filter(Boolean).slice(0, 2);
  const initials = parts.map((part) => part[0]?.toUpperCase() ?? "").join("");

  return initials || "U";
}

async function hashMd5(input: string) {
  const bytes = new TextEncoder().encode(input);
  const digest = await globalThis.crypto.subtle.digest("MD5", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function useGravatarUrl(email?: string | null, size = 128) {
  const [gravatarUrl, setGravatarUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function resolve() {
      if (!email || typeof window === "undefined" || !globalThis.crypto?.subtle) {
        if (!cancelled) setGravatarUrl(null);
        return;
      }

      try {
        const normalized = email.trim().toLowerCase();
        const hash = await hashMd5(normalized);

        if (!cancelled) {
          setGravatarUrl(`https://www.gravatar.com/avatar/${hash}?s=${size}&d=404&r=g`);
        }
      } catch {
        if (!cancelled) setGravatarUrl(null);
      }
    }

    resolve();

    return () => {
      cancelled = true;
    };
  }, [email, size]);

  return gravatarUrl;
}

type UserAvatarProps = {
  email?: string | null;
  fullName?: string | null;
  size?: number;
  className?: string;
};

export function UserAvatar({
  email,
  fullName,
  size = 40,
  className = "",
}: UserAvatarProps) {
  const gravatarUrl = useGravatarUrl(email, size);

  // Remember which URL failed to load instead of a boolean flag that has to be
  // reset in an effect. If gravatarUrl changes, failedUrl no longer matches,
  // so hasError is automatically false again.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const hasError = failedUrl === gravatarUrl;

  const fallbackInitials = getInitials(fullName);

  if (gravatarUrl && !hasError) {
    return (
      <img
        src={gravatarUrl}
        alt={fullName ? `${fullName} profile picture` : "Profile picture"}
        onError={() => setFailedUrl(gravatarUrl)}
        className={`rounded-full object-cover ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <div
      className={`flex items-center justify-center rounded-full bg-[#E5E7EB] font-bold text-[#6B7280] ${className}`}
      style={{ width: size, height: size, fontSize: Math.max(10, size * 0.4) }}
      aria-label={fullName ? `${fullName} profile picture` : "Profile picture"}
    >
      {fallbackInitials}
    </div>
  );
}
