
export const CursorLine = ({
  position,
  height,
}: {
  position: number;
  height: number;
}) => {
  return (
    <line
      x1={position}
      y1={0}
      x2={position}
      y2={height}
      stroke="red"
      strokeWidth={1}
      pointerEvents="none" // Ensures the line doesn't interfere with click events
    />
  );
};
