let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;

export function measureTextWidth(text: string, font: string = "12px sans-serif"): number {
  if (typeof window === "undefined") {
    return text.length * 7;
  }

  if (!canvas) {
    canvas = document.createElement("canvas");
    ctx = canvas.getContext("2d");
  }

  if (ctx) {
    ctx.font = font;
    return ctx.measureText(text).width;
  }

  return text.length * 7;
}

export function estimateTitleWidth(title: string, shortTitle?: string): { titleWidth: number; shortTitleWidth: number } {
  const titleWidth = measureTextWidth(title);
  const shortTitleWidth = shortTitle ? measureTextWidth(shortTitle) : titleWidth;
  return { titleWidth, shortTitleWidth };
}
