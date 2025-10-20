export interface LayerComponentProps {
  scale: d3.ScaleTime<number, number>;
  transform: d3.ZoomTransform;
  width: number;
}

export type Layer = {
  enabled?: boolean;
  component: React.ComponentType<LayerComponentProps>;
};

export type Tool = {
  component: React.ComponentType<any>;
};

export type Config = {
  layers: Layer[];
  tools: Tool[];
};
