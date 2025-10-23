import { Badge } from "@/components/ui/badge";
import { getObjectTypes } from "@/types/activitypub";
import type { APObject } from "@/types/activitypub";

interface TypeBadgesProps {
  object: APObject;
  className?: string;
}

const TYPE_COLORS: Record<string, string> = {
  Person: "bg-blue-100 text-blue-800 border-blue-200",
  Note: "bg-yellow-100 text-yellow-800 border-yellow-200",
  Audio: "bg-pink-100 text-pink-800 border-pink-200",
  Event: "bg-red-100 text-red-800 border-red-200",
  Place: "bg-teal-100 text-teal-800 border-teal-200",
  Edge: "bg-cyan-100 text-cyan-800 border-cyan-200",
};

const TYPE_ICONS: Record<string, string> = {
  Person: "👤",
  Note: "📝",
  Audio: "🎵",
  Event: "📅",
  Place: "📍",
  Edge: "🔗",
};

export function TypeBadges({ object, className }: TypeBadgesProps) {
  const types = getObjectTypes(object);
  const uniqueTypes = [...new Set(types)];
  
  return (
    <div className={`flex flex-wrap gap-2 ${className || ''}`}>
      {uniqueTypes.map((type, index) => {
        const colorClass = TYPE_COLORS[type] || "bg-gray-100 text-gray-800 border-gray-200";
        const icon = TYPE_ICONS[type];
        
        return (
          <Badge
            key={index}
            variant="outline"
            className={colorClass}
          >
            {icon && <span className="mr-1">{icon}</span>}
            {type}
          </Badge>
        );
      })}
    </div>
  );
}

