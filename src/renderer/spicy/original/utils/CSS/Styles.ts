export type StyleProperties = Record<string, string>;
export function applyStyles(element: HTMLElement, styles?: StyleProperties) { if (styles) Object.assign(element.style, styles); }
export function removeAllStyles(element?: HTMLElement) { if (element) element.removeAttribute("style"); }
