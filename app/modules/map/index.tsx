import React, { useMemo } from "react";
import * as d3 from "d3";
import { type Layer, type LayerComponentProps } from "@/core.ts";

type MapLayerOptions = {
  height?: number;
};


export const MapLayer: (options?: MapLayerOptions) => Layer = (
  options = {},
) => {
  const Component: React.FC<LayerComponentProps> = ({ scale, transform, width }) => {
    return (
      <>
        <h1>Map</h1>
      </>
    );
  };

  return { component: Component } as Layer;
};

export default MapLayer;




