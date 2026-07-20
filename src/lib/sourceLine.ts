export const SOURCE_LINE_ATTR = "data-source-line";
export const SOURCE_LINE_SELECTOR = `[${SOURCE_LINE_ATTR}]`;

export interface SourceLineAnchor {
  element: HTMLElement;
  line: number;
}

export function sourceLineProps(
  line: number | undefined,
  lineOffset = 0,
): Record<string, string> | undefined {
  if (!line) {
    return undefined;
  }
  return { [SOURCE_LINE_ATTR]: String(line + lineOffset) };
}

export function getSourceLineAnchors(container: HTMLElement): SourceLineAnchor[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(SOURCE_LINE_SELECTOR),
  )
    .map((element) => ({
      element,
      line: Number(element.getAttribute(SOURCE_LINE_ATTR)),
    }))
    .filter((anchor) => Number.isFinite(anchor.line))
    .sort((left, right) => left.line - right.line);
}

export function findAnchorForLine(
  anchors: SourceLineAnchor[],
  line: number,
): SourceLineAnchor | null {
  if (!anchors.length) {
    return null;
  }

  if (line <= anchors[0].line) {
    return anchors[0];
  }

  let result = anchors[0];
  let low = 0;
  let high = anchors.length - 1;

  while (low <= high) {
    const mid = (low + high) >> 1;
    if (anchors[mid].line <= line) {
      result = anchors[mid];
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return result;
}

export function getOffsetTopWithinScroller(
  element: HTMLElement,
  scroller: HTMLElement,
): number {
  return (
    element.getBoundingClientRect().top -
    scroller.getBoundingClientRect().top +
    scroller.scrollTop
  );
}

export function getLineAtScrollerCenter(scroller: HTMLElement): number | null {
  const centerY = scroller.scrollTop + scroller.clientHeight / 2;
  const anchors = getSourceLineAnchors(scroller);
  if (!anchors.length) {
    return null;
  }

  let best = anchors[0];
  for (const anchor of anchors) {
    const top = getOffsetTopWithinScroller(anchor.element, scroller);
    if (top <= centerY) {
      best = anchor;
      continue;
    }
    break;
  }

  return best.line;
}

export function scrollScrollerToLine(
  scroller: HTMLElement,
  line: number,
  align: "start" | "center" = "center",
) {
  const anchor = findAnchorForLine(getSourceLineAnchors(scroller), line);
  if (!anchor) {
    return;
  }

  const top = getOffsetTopWithinScroller(anchor.element, scroller);
  const offset =
    align === "center" ? top - scroller.clientHeight / 2 : top - 24;
  scroller.scrollTop = Math.max(0, offset);
}
