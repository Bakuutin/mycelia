import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ObjectId } from 'bson';
import { IconDisplay } from '@/components/IconDisplay';
import { callResource } from '@/lib/api';
import type { Icon } from '@/types/icon';

interface PersonChipProps {
  personId: string;
  name: string;
}

async function fetchPersonIcon(personId: string): Promise<Icon | undefined> {
  // Fetch a single person to get its icon. Backend collection: "people"
  const result = await callResource("tech.mycelia.mongo", {
    action: "findOne",
    collection: "people",
    query: { _id: new ObjectId(personId) },
  });
  return result?.icon as Icon | undefined;
}

export function PersonChip({ personId, name }: PersonChipProps) {
  const navigate = useNavigate();

  const { data: icon } = useQuery({
    queryKey: ["person", personId, "icon"],
    queryFn: () => fetchPersonIcon(personId),
    staleTime: 30 * 1000 // 30 sec
  });

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    navigate(`/people/${personId}`);
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted text-xs hover:bg-accent transition-colors cursor-pointer"
    >
      <IconDisplay icon={icon} className="text-sm" fallback="👤" />
      {name}
    </button>
  );
}


