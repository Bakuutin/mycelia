import { TimelineItem, OptimizedTimelineItem } from './types';

export function optimizeTimelineLayout(items: TimelineItem[], epsilon: number): OptimizedTimelineItem[] {
    const sortedItems = [...items].sort((a, b) => a.start.getTime() - b.start.getTime());
    const layers: OptimizedTimelineItem[][] = [];
    const result: OptimizedTimelineItem[] = [];

    for (const item of sortedItems) {
        let layerIndex = 0;
        while (layerIndex < layers.length) {
            const layer = layers[layerIndex];
            const lastItem = layer[layer.length - 1];
            if (lastItem.end.getTime() + epsilon < item.start.getTime()) {
                break;
            }
            layerIndex++;
        }

        if (layerIndex === layers.length) {
            layers.push([]);
        }

        const optimizedItem: OptimizedTimelineItem = {
            start: item.start,
            end: item.end,
            layer: layerIndex,
            duration: item.end.getTime() - item.start.getTime(),
            original: item,
        };

        layers[layerIndex].push(optimizedItem);
        result.push(optimizedItem);
    }

    return result;
} 