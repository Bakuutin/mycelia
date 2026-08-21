import { useEffect, useState } from "react";
import { apiClient } from "@/lib/api";

export function AuthenticatedMediaImage({
  path,
  alt,
  className,
}: {
  path?: string;
  alt: string;
  className?: string;
}) {
  const [url, setUrl] = useState<string>();

  useEffect(() => {
    if (!path) return;
    let active = true;
    let objectUrl: string | undefined;
    apiClient.getBlob(path).then((blob) => {
      if (!active) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }).catch(() => setUrl(undefined));
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path]);

  return url
    ? <img src={url} alt={alt} className={className} />
    : <div className={`bg-muted ${className ?? ""}`} aria-label={alt} />;
}
