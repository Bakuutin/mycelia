import { Link, useNavigate } from 'react-router-dom';
import type { Conversation } from '@/types/conversations';
import { Card } from '@/components/ui/card';
import { Users, Clock } from 'lucide-react';
import { formatTime, formatTimeRangeDuration } from '@/lib/formatTime';
import { IconDisplay } from '@/components/IconDisplay';
import { PersonChip } from '@/components/PersonChip';

interface ConversationCardProps {
  conversation: Conversation;
}

export const ConversationCard = ({ conversation }: ConversationCardProps) => {
  const navigate = useNavigate();

  const handleParticipantClick = (e: React.MouseEvent, participantId: string) => {
    e.preventDefault();
    e.stopPropagation();
    navigate(`/people/${participantId}`);
  };

  return (
    <Link
      to={`/conversations/${conversation._id.toString()}`}
      className="block"
    >
      <Card className="p-4 hover:bg-accent/50 transition-colors">
        <div className="flex gap-4">
          <IconDisplay icon={conversation.icon} fallback="💬" />
          <div className="flex-1 space-y-2">
            <div className="flex items-start justify-between">
              <h3 className="font-semibold text-lg hover:text-primary transition-colors">
                {conversation.title || 'Untitled Conversation'}
              </h3>
              {conversation.isShared && (
                <span className="text-xs px-2 py-1 rounded-full bg-primary/10 text-primary">
                  Shared
                </span>
              )}
            </div>

            {conversation.summary && (
              <p className="text-sm text-muted-foreground line-clamp-2">
                {conversation.summary}
              </p>
            )}

            <div className="space-y-2">
              {conversation.timeRanges.length > 0 && (
                <div className="flex items-start gap-2">
                  <div className="flex flex-wrap gap-1">
                    {conversation.timeRanges.map((range, index) => (
                      <div
                        key={index}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted text-xs"
                      >
                        <span className="font-medium">{formatTime(range.start)}</span>
                        <span className="text-muted-foreground">·</span>
                        <span>{formatTimeRangeDuration(range.start, range.end)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {conversation.participants && conversation.participants.length > 0 && (
                <div className="flex items-start gap-2">
                  <Users className="w-3 h-3 text-muted-foreground mt-0.5" />
                  <div className="flex flex-wrap gap-1">
                    {conversation.participants.map((participant) => (
                      <PersonChip
                        key={participant.id.toString()}
                        personId={participant.id.toString()}
                        name={participant.name}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </Card>
    </Link>
  );
};
