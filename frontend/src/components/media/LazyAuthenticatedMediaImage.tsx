import { useEffect, useRef, useState } from "react";
import { AuthenticatedMediaImage } from "./AuthenticatedMediaImage";

export function LazyAuthenticatedMediaImage({
  path,
  alt,
  className,
  containerClassName,
}: {
  path?: string;
  alt: string;
  className?: string;
  containerClassName?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(
    () => typeof globalThis.IntersectionObserver === "undefined",
  );

  useEffect(() => {
    if (visible || !containerRef.current) return;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      setVisible(true);
      observer.disconnect();
    }, { rootMargin: "320px" });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [visible]);

  return (
    <div ref={containerRef} className={containerClassName}>
      {visible
        ? (
          <AuthenticatedMediaImage
            path={path}
            alt={alt}
            className={className}
          />
        )
        : (
          <div
            className={`animate-pulse bg-muted ${className ?? ""}`}
            aria-label={`Loading ${alt}`}
          />
        )}
    </div>
  );
}
