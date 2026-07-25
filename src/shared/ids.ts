import { randomUUID } from "node:crypto";

export type ProjectId = string & { readonly __brand: "ProjectId" };
export type DocumentId = string & { readonly __brand: "DocumentId" };
export type NodeId = string & { readonly __brand: "NodeId" };

export const newProjectId = (): ProjectId => `project_${randomUUID()}` as ProjectId;
export const newDocumentId = (): DocumentId => `document_${randomUUID()}` as DocumentId;
export const newNodeId = (): NodeId => `node_${randomUUID()}` as NodeId;
