export type DocumentElementFilter =
  | "all"
  | "text"
  | "image"
  | "chart"
  | "link";

export interface DocumentSearchResult {
  nodeId: string;
  tag: string;
  text: string;
  className: string;
}

export interface DocumentOutlineItem {
  nodeId: string;
  level: number;
  text: string;
}

export interface DocumentNavigationResult {
  query: string;
  filter: DocumentElementFilter;
  results: DocumentSearchResult[];
  outline: DocumentOutlineItem[];
  totalIndexed: number;
  truncated: boolean;
}

