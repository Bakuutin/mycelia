import React from "react";

export interface EditableTimelineItemProps {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fill: string;
  label?: string;
  labelWidth?: number;
  onSelect: () => void;
  onEdit: () => void;
  className?: string;
  thin?: boolean;
}

export const EditableTimelineItem: React.FC<EditableTimelineItemProps> = ({
  id,
  x,
  y,
  width,
  height,
  fill,
  label,
  labelWidth,
  onSelect,
  onEdit,
  className = "timeline-item",
  thin = false,
}) => {
  const rectHeight = thin ? 6 : height - 4;
  const rectY = y + (thin ? 4 : 2);

  return (
    <g
      key={id}
      className={className}
      onClick={onSelect}
      onContextMenu={(e) => {
        e.preventDefault();
        onSelect();
        onEdit();
      }}
      style={{ cursor: 'pointer' }}
    >
      <rect
        x={x}
        y={rectY}
        width={Math.max(2, width)}
        height={rectHeight}
        fill={fill}
      />
      {label && (
        <foreignObject
          x={x}
          y={y}
          width={labelWidth ?? width}
          height={height}
          className="text-[10px]"
        >
          {label}
        </foreignObject>
      )}
    </g>
  );
};
