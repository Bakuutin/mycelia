import type { Icon } from '@/types/icon';

interface IconDisplayProps {
  icon?: Icon;
  fallback?: string;
  className?: string;
}

export const IconDisplay = ({ icon, fallback = '📄', className = 'text-2xl' }: IconDisplayProps) => {
  if (!icon) {
    return <span className={className}>{fallback}</span>;
  }

  if ('text' in icon) {
    return <span className={className}>{icon.text}</span>;
  }

  if ('base64' in icon) {
    return (
      <img
        src={`data:image/png;base64,${icon.base64}`}
        alt="icon"
        className={className}
      />
    );
  }

  return <span className={className}>{fallback}</span>;
};
