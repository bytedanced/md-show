import type { Element, Root } from "hast";
import type { Plugin } from "unified";
import { visit } from "unist-util-visit";

interface RehypeSourceLineOptions {
  lineOffset?: number;
}

export const rehypeSourceLine: Plugin<[RehypeSourceLineOptions?], Root> = (
  options = {},
) => {
  const lineOffset = options.lineOffset ?? 0;

  return (tree) => {
    visit(tree, "element", (node: Element) => {
      const line = node.position?.start?.line;
      if (!line) {
        return;
      }

      node.properties = {
        ...node.properties,
        dataSourceLine: String(line + lineOffset),
      };
    });
  };
};
