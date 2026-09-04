import { z } from "zod";
import { ChartPatchSchema } from "../charts/chart-types";
import { WatermarkSettingsSchema } from "../watermarks/watermark-model";

export const StyleDeclarationSchema = z.object({
  property: z.string().min(1),
  value: z.string(),
  priority: z.enum(["", "important"]),
  existed: z.boolean()
});

export type StyleDeclaration = z.infer<typeof StyleDeclarationSchema>;

const NodeStyleChangeSchema = z.object({
  nodeId: z.string().min(1),
  before: z.array(StyleDeclarationSchema),
  after: z.array(StyleDeclarationSchema)
});

const SetStylesPayloadSchema = z.object({
  type: z.literal("styles.set"),
  nodes: z.array(NodeStyleChangeSchema).min(1)
});

const SetTextPayloadSchema = z.object({
  type: z.literal("text.set"),
  nodeId: z.string().min(1),
  before: z.string(),
  after: z.string()
});

const SetAttributePayloadSchema = z.object({
  type: z.literal("attribute.set"),
  nodeId: z.string().min(1),
  name: z.string().regex(/^[A-Za-z_:][A-Za-z0-9_.:-]*$/),
  before: z.string().nullable(),
  after: z.string().nullable()
});

const NodeSnapshotSchema = z.object({
  id: z.string().min(1),
  tagName: z.string().regex(/^[A-Za-z][A-Za-z0-9-]*$/),
  attributes: z.record(z.string(), z.string()),
  /**
   * Command version 1 originally named this field `text`, but the editor
   * runtime has always populated it with element.innerHTML. Keep the field
   * name for replay compatibility and consistently treat it as HTML.
   */
  text: z.string().default("")
});

const InsertNodePayloadSchema = z.object({
  type: z.literal("node.insert"),
  parentId: z.string().min(1),
  index: z.number().int().nonnegative(),
  node: NodeSnapshotSchema
});

const DeleteNodePayloadSchema = z.object({
  type: z.literal("node.delete"),
  nodeId: z.string().min(1),
  parentId: z.string().min(1),
  index: z.number().int().nonnegative(),
  node: NodeSnapshotSchema
});

const MoveNodePayloadSchema = z.object({
  type: z.literal("node.move"),
  nodeId: z.string().min(1),
  parentId: z.string().min(1),
  beforeIndex: z.number().int().nonnegative(),
  afterIndex: z.number().int().nonnegative()
});

const PatchChartPayloadSchema = z.object({
  type: z.literal("chart.patch"),
  chartKey: z.string().min(1),
  before: ChartPatchSchema,
  after: ChartPatchSchema
});

const PatchTextStylePayloadSchema = z.object({
  type: z.literal("text.patchStyle"),
  nodeId: z.string().min(1),
  before: z.string(),
  after: z.string()
});

const AttributeChangeSchema = z.object({
  nodeId: z.string().min(1),
  name: z.string().regex(/^[A-Za-z_:][A-Za-z0-9_.:-]*$/),
  before: z.string().nullable(),
  after: z.string().nullable()
});

const ManagedStyleChangeSchema = z.object({
  styleId: z.string().regex(/^[a-z][a-z0-9_-]*$/i),
  before: z.string().nullable(),
  after: z.string().nullable()
});

/**
 * Atomic project-document patch.
 *
 * Responsive rules need to add an export-stable class and update the managed
 * stylesheet as one undoable action. Theme changes only update a managed
 * stylesheet. Keeping both operations in one command prevents half-applied
 * undo/redo states and leaves room for future component/data metadata.
 */
const DocumentPatchPayloadSchema = z.object({
  type: z.literal("document.patch"),
  attributes: z.array(AttributeChangeSchema),
  managedStyles: z.array(ManagedStyleChangeSchema)
});

const ComponentContentChangeSchema = z.object({
  nodeId: z.string().min(1),
  before: z.string(),
  after: z.string()
});

/**
 * A component field update can touch the master and many instances. It is a
 * single command so one undo restores content, styles, override metadata and
 * component versions together.
 */
const ComponentUpdatePayloadSchema = z.object({
  type: z.literal("component.update"),
  texts: z.array(ComponentContentChangeSchema),
  html: z.array(ComponentContentChangeSchema),
  styles: z.array(NodeStyleChangeSchema),
  attributes: z.array(AttributeChangeSchema)
});

const SetWatermarksPayloadSchema = z.object({
  type: z.literal("watermarks.set"),
  before: WatermarkSettingsSchema,
  after: WatermarkSettingsSchema
});

export const CommandPayloadSchema = z.discriminatedUnion("type", [
  SetStylesPayloadSchema,
  SetTextPayloadSchema,
  SetAttributePayloadSchema,
  InsertNodePayloadSchema,
  DeleteNodePayloadSchema,
  MoveNodePayloadSchema,
  PatchChartPayloadSchema,
  PatchTextStylePayloadSchema,
  DocumentPatchPayloadSchema,
  ComponentUpdatePayloadSchema,
  SetWatermarksPayloadSchema
]);

export type CommandPayload = z.infer<typeof CommandPayloadSchema>;

export const CommandEnvelopeSchema = z.object({
  commandId: z.string().uuid(),
  commandVersion: z.literal(1),
  documentId: z.string().min(1),
  baseRevision: z.number().int().nonnegative(),
  resultingRevision: z.number().int().positive(),
  payload: CommandPayloadSchema
}).superRefine((command, context) => {
  if (command.resultingRevision !== command.baseRevision + 1) {
    context.addIssue({
      code: "custom",
      message: "resultingRevision must equal baseRevision + 1"
    });
  }
});

export type CommandEnvelope = z.infer<typeof CommandEnvelopeSchema>;

export function invertPayload(payload: CommandPayload): CommandPayload {
  switch (payload.type) {
    case "styles.set":
      return {
        ...payload,
        nodes: payload.nodes.map((node) => ({
          ...node,
          before: node.after,
          after: node.before
        }))
      };
    case "text.set":
      return { ...payload, before: payload.after, after: payload.before };
    case "attribute.set":
      return { ...payload, before: payload.after, after: payload.before };
    case "node.insert":
      return {
        type: "node.delete",
        nodeId: payload.node.id,
        parentId: payload.parentId,
        index: payload.index,
        node: payload.node
      };
    case "node.delete":
      return {
        type: "node.insert",
        parentId: payload.parentId,
        index: payload.index,
        node: payload.node
      };
    case "node.move":
      return {
        ...payload,
        beforeIndex: payload.afterIndex,
        afterIndex: payload.beforeIndex
      };
    case "chart.patch":
      return {
        ...payload,
        before: payload.after,
        after: payload.before
      };
    case "text.patchStyle":
      return {
        ...payload,
        before: payload.after,
        after: payload.before
      };
    case "document.patch":
      return {
        ...payload,
        attributes: payload.attributes.map((change) => ({
          ...change,
          before: change.after,
          after: change.before
        })),
        managedStyles: payload.managedStyles.map((change) => ({
          ...change,
          before: change.after,
          after: change.before
        }))
      };
    case "component.update":
      return {
        ...payload,
        texts: payload.texts.map((change) => ({
          ...change,
          before: change.after,
          after: change.before
        })),
        html: payload.html.map((change) => ({
          ...change,
          before: change.after,
          after: change.before
        })),
        styles: payload.styles.map((change) => ({
          ...change,
          before: change.after,
          after: change.before
        })),
        attributes: payload.attributes.map((change) => ({
          ...change,
          before: change.after,
          after: change.before
        }))
      };
    case "watermarks.set":
      return { ...payload, before: payload.after, after: payload.before };
  }
}
