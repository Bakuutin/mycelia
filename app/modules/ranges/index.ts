
import crossfilter from "crossfilter2";
import { useRef } from "react";

export function useData() {
  const cf = useRef<any>(crossfilter([]));
}

