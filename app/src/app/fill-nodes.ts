import { createElement, Fragment, type ReactNode } from "react";

/** Split `text` around `{name}` placeholders and insert matching React nodes in order. */
export function fillNodes(text: string, values: Record<string, ReactNode>): ReactNode[] {
  return text.split(/(\{\w+\})/g).map((piece, index) => {
    const key = piece.match(/^\{(\w+)\}$/)?.[1];
    if (key === undefined) return piece;
    return key in values ? createElement(Fragment, { key: index }, values[key]) : piece;
  });
}
