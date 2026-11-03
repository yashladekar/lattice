export const WORKSPACE_TYPES = ["PERSONAL", "ORGANIZATION"] as const;
export type WorkspaceType = (typeof WORKSPACE_TYPES)[number];

export const ROLES = ["OWNER", "ADMIN", "MEMBER", "EDITOR", "VIEWER", "GUEST"] as const;
export type Role = (typeof ROLES)[number];

export const MEMBER_STATUSES = ["ACTIVE", "INVITED", "SUSPENDED"] as const;
export type MemberStatus = (typeof MEMBER_STATUSES)[number];

export const VISIBILITIES = ["PRIVATE", "SHARED", "WORKSPACE", "PUBLIC"] as const;
export type Visibility = (typeof VISIBILITIES)[number];

export const NOTEBOOK_KINDS = ["NOTEBOOK", "FOLDER", "COLLECTION"] as const;
export type NotebookKind = (typeof NOTEBOOK_KINDS)[number];

export const PAGE_TYPES = ["DOCUMENT", "CANVAS", "DATABASE"] as const;
export type PageType = (typeof PAGE_TYPES)[number];

export const NODE_KINDS = [
  "PAGE",
  "CANVAS",
  "TOPIC",
  "CONCEPT",
  "PROJECT",
  "PERSON",
  "RESOURCE",
  "FLASHCARD",
] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

export const RELATION_TYPES = [
  "RELATED_TO",
  "DEPENDS_ON",
  "PART_OF",
  "EXPLAINS",
  "EXAMPLE_OF",
  "CONTRADICTS",
  "PREREQUISITE_OF",
  "REFERENCES",
  "CREATED_FROM",
  "CONNECTED_THROUGH",
] as const;
export type RelationType = (typeof RELATION_TYPES)[number];

export const EDGE_ORIGINS = ["MANUAL", "PAGE_LINK", "CANVAS_LINK", "AI"] as const;
export type EdgeOrigin = (typeof EDGE_ORIGINS)[number];

export const CAPTURE_TYPES = [
  "NOTE",
  "BOOKMARK",
  "CLIP",
  "PDF",
  "IMAGE",
  "AUDIO",
  "VIDEO",
  "YOUTUBE",
  "TEXT",
  "EMAIL",
  "FILE",
] as const;
export type CaptureType = (typeof CAPTURE_TYPES)[number];

export const CAPTURE_STATUSES = ["INBOX", "ORGANIZED", "ARCHIVED"] as const;
export type CaptureStatus = (typeof CAPTURE_STATUSES)[number];

export const FLASHCARD_SOURCES = ["MANUAL", "NOTE", "AI"] as const;
export type FlashcardSource = (typeof FLASHCARD_SOURCES)[number];

export const SHARE_RESOURCE_TYPES = ["PAGE", "CANVAS", "NOTEBOOK", "GRAPH"] as const;
export type ShareResourceType = (typeof SHARE_RESOURCE_TYPES)[number];

export const SHARE_PERMISSIONS = ["VIEW", "COMMENT", "EDIT"] as const;
export type SharePermission = (typeof SHARE_PERMISSIONS)[number];

export const AI_ROLES = ["user", "assistant", "system"] as const;
export type AiRole = (typeof AI_ROLES)[number];

export type IsoDate = string;

export interface BaseEntity {
  id: string;
  createdAt: IsoDate;
  updatedAt: IsoDate;
  deletedAt?: IsoDate | null;
}

export interface Workspace extends BaseEntity {
  name: string;
  slug: string;
  type: WorkspaceType;
  description: string | null;
  icon: string | null;
  accent: string | null;
  ownerId: string;
  syncVersion: number;
}

export interface WorkspaceMember extends BaseEntity {
  workspaceId: string;
  userId: string;
  role: Role;
  status: MemberStatus;
}

export interface WorkspaceMemberSummary extends WorkspaceMember {
  user: {
    id: string;
    name: string;
    email: string;
    image: string | null;
  };
}

export interface WorkspaceInvite extends BaseEntity {
  workspaceId: string;
  email: string;
  role: Role;
  invitedById: string;
  expiresAt: IsoDate;
  acceptedAt: IsoDate | null;
}

export interface Team extends BaseEntity {
  workspaceId: string;
  name: string;
  description: string | null;
  color: string;
}

export interface Notebook extends BaseEntity {
  workspaceId: string;
  parentId: string | null;
  kind: NotebookKind;
  name: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  visibility: Visibility;
  sortOrder: number;
  createdById: string;
}

export interface Page extends BaseEntity {
  workspaceId: string;
  notebookId: string | null;
  parentId: string | null;
  type: PageType;
  title: string;
  icon: string | null;
  coverUrl: string | null;
  properties: Record<string, unknown>;
  visibility: Visibility;
  sortOrder: number;
  createdById: string;
  updatedById: string | null;
  publishedAt: IsoDate | null;
}

export interface PageDocument {
  pageId: string;
  workspaceId: string;
  content: TipTapDoc;
  plainText: string;
  schemaVersion: number;
  rev: number;
  updatedAt: IsoDate;
}

export interface PageSummary extends Page {
  plainText?: string;
  backlinkCount?: number;
  tags?: string[];
}

export interface PageVersion extends BaseEntity {
  pageId: string;
  workspaceId: string;
  version: number;
  title: string;
  content: TipTapDoc;
  note: string | null;
  createdById: string | null;
}

export interface CanvasDocument {
  version: 1;
  elements: CanvasElement[];
  background?: "dots" | "grid" | "plain";
}

export interface Canvas extends BaseEntity {
  workspaceId: string;
  notebookId: string | null;
  title: string;
  icon: string | null;
  data: CanvasDocument;
  schemaVersion: number;
  rev: number;
  thumbnail: string | null;
  createdById: string;
  updatedById: string | null;
}

export type CanvasElement =
  | CanvasNoteElement
  | CanvasShapeElement
  | CanvasTextElement
  | CanvasFreehandElement
  | CanvasConnectorElement
  | CanvasImageElement
  | CanvasPageElement
  | CanvasCanvasElement
  | CanvasFrameElement;

interface CanvasElementBase {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  z?: number;
  locked?: boolean;
  groupId?: string | null;
}

export interface CanvasNoteElement extends CanvasElementBase {
  type: "note";
  text: string;
  color: StickyColor;
}

export interface CanvasShapeElement extends CanvasElementBase {
  type: "shape";
  shape: "rectangle" | "ellipse" | "diamond" | "parallelogram" | "cylinder" | "hexagon";
  text: string;
  color: StickyColor;
  stroke?: string;
  textSize?: "sm" | "md" | "lg";
}

export interface CanvasTextElement extends CanvasElementBase {
  type: "text";
  text: string;
  fontSize: number;
  color: string;
  align?: "left" | "center" | "right";
}

export interface CanvasFreehandElement extends CanvasElementBase {
  type: "freehand";
  points: Array<[number, number]>;
  color: string;
  strokeWidth: number;
}

export interface CanvasConnectorElement {
  id: string;
  type: "connector";
  from: CanvasEndpoint;
  to: CanvasEndpoint;
  arrowStart?: boolean;
  arrowEnd?: boolean;
  style?: "solid" | "dashed" | "dotted";
  color?: string;
  label?: string;
  z?: number;
}

export interface CanvasEndpoint {
  elementId?: string;
  x?: number;
  y?: number;
  anchor?: "top" | "right" | "bottom" | "left" | "center";
}

export interface CanvasImageElement extends CanvasElementBase {
  type: "image";
  src: string;
  alt?: string;
}

export interface CanvasPageElement extends CanvasElementBase {
  type: "page";
  pageId: string;
  variant: "card" | "preview" | "link";
  color?: StickyColor;
}

export interface CanvasCanvasElement extends CanvasElementBase {
  type: "canvas";
  canvasId: string;
  color?: StickyColor;
}

export interface CanvasFrameElement extends CanvasElementBase {
  type: "frame";
  title: string;
  color?: StickyColor;
}

export type StickyColor = "saffron" | "moss" | "sky" | "lilac" | "rose" | "slate" | "paper";

export interface KnowledgeNode extends BaseEntity {
  workspaceId: string;
  kind: NodeKind;
  title: string;
  description: string | null;
  pageId: string | null;
  canvasId: string | null;
  color: string | null;
  x: number | null;
  y: number | null;
  aiGenerated: boolean;
  metadata: Record<string, unknown>;
  createdById: string | null;
}

export interface KnowledgeEdge extends BaseEntity {
  workspaceId: string;
  sourceNodeId: string;
  targetNodeId: string;
  relationType: RelationType;
  label: string | null;
  weight: number;
  origin: EdgeOrigin;
  aiGenerated: boolean;
  createdById: string | null;
}

export interface Tag extends BaseEntity {
  workspaceId: string;
  name: string;
  color: string;
}

export interface PageTag {
  id: string;
  pageId: string;
  tagId: string;
  source: "USER" | "AI";
  createdAt: IsoDate;
}

export interface Capture extends BaseEntity {
  workspaceId: string;
  type: CaptureType;
  title: string;
  content: string | null;
  url: string | null;
  source: string | null;
  status: CaptureStatus;
  metadata: Record<string, unknown>;
  createdById: string;
}

export interface Template extends BaseEntity {
  workspaceId: string;
  name: string;
  description: string | null;
  icon: string | null;
  category: string;
  content: TipTapDoc;
  properties: Record<string, unknown>;
  createdById: string;
}

export interface Attachment extends BaseEntity {
  workspaceId: string;
  pageId: string | null;
  uploaderId: string;
  name: string;
  mime: string;
  size: number;
  url: string;
}

export interface Deck extends BaseEntity {
  workspaceId: string;
  notebookId: string | null;
  name: string;
  description: string | null;
  color: string;
}

export interface Flashcard extends BaseEntity {
  workspaceId: string;
  deckId: string;
  pageId: string | null;
  blockId: string | null;
  front: string;
  back: string;
  hint: string | null;
  source: FlashcardSource;
  dueAt: IsoDate;
  interval: number;
  ease: number;
  reps: number;
  lapses: number;
  lastReviewedAt: IsoDate | null;
}

export interface ReviewLog {
  id: string;
  workspaceId: string;
  flashcardId: string;
  userId: string;
  rating: number;
  reviewedAt: IsoDate;
  previousDueAt: IsoDate;
  nextDueAt: IsoDate;
  interval: number;
}

export interface Comment extends BaseEntity {
  workspaceId: string;
  pageId: string;
  blockId: string | null;
  parentId: string | null;
  authorId: string;
  body: string;
  resolvedAt: IsoDate | null;
}

export interface CommentThread extends Comment {
  author: {
    id: string;
    name: string;
    image: string | null;
  };
  replies: CommentThread[];
}

export interface ShareLink {
  id: string;
  workspaceId: string;
  resourceType: ShareResourceType;
  resourceId: string;
  permission: SharePermission;
  token?: string;
  expiresAt: IsoDate | null;
  revokedAt: IsoDate | null;
  createdById: string;
  createdAt: IsoDate;
}

export interface AuditLog {
  id: string;
  workspaceId: string;
  actorId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  metadata: Record<string, unknown>;
  createdAt: IsoDate;
}

export interface Notification {
  id: string;
  userId: string;
  workspaceId: string | null;
  type: string;
  title: string;
  body: string | null;
  href: string | null;
  readAt: IsoDate | null;
  createdAt: IsoDate;
}

export interface AiCitation {
  pageId: string;
  title: string;
  excerpt: string;
}

export interface AiThread {
  id: string;
  workspaceId: string;
  userId: string;
  title: string;
  createdAt: IsoDate;
  updatedAt: IsoDate;
}

export interface AiMessage {
  id: string;
  threadId: string;
  role: AiRole;
  content: string;
  citations: AiCitation[];
  provider: string | null;
  createdAt: IsoDate;
}

export interface UserSummary {
  id: string;
  name: string;
  email: string;
  image: string | null;
}

export interface PageLinkInfo {
  pageId: string;
  label: string;
}

export interface OutlineItem {
  id: string;
  level: number;
  text: string;
  pos: number;
}

export interface SearchResult {
  type: "page" | "canvas" | "capture" | "flashcard";
  id: string;
  workspaceId: string;
  title: string;
  snippet: string;
  score: number;
  icon?: string | null;
  updatedAt: IsoDate;
}

export interface PresencePeer {
  userId: string;
  name: string;
  image: string | null;
  pageId: string;
  lastSeenAt: number;
}

export interface TipTapNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TipTapNode[];
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  text?: string;
}

export interface TipTapDoc {
  type: "doc";
  content: TipTapNode[];
}

export interface SyncChange {
  id: string;
  workspaceId: string;
  version: number;
  entity: SyncEntity;
  entityId: string;
  op: "UPSERT" | "DELETE";
  data: Record<string, unknown>;
  actorId: string | null;
  createdAt: IsoDate;
}

export const SYNC_ENTITIES = [
  "workspace",
  "member",
  "notebook",
  "page",
  "pageDocument",
  "canvas",
  "node",
  "edge",
  "tag",
  "pageTag",
  "capture",
  "template",
  "deck",
  "flashcard",
  "comment",
  "attachment",
] as const;
export type SyncEntity = (typeof SYNC_ENTITIES)[number];

export interface SyncOpInput {
  opId: string;
  entity: SyncEntity;
  entityId: string;
  op: "UPSERT" | "DELETE";
  baseRev?: number;
  payload: Record<string, unknown>;
}

export interface SyncCursor {
  version: number;
  id: string;
}

export interface SyncPushResult {
  accepted: Array<{ entity: SyncEntity; entityId: string; rev?: number; updatedAt: IsoDate }>;
  conflicts: SyncConflictPayload[];
  version: number;
}

export interface SyncConflictPayload {
  id: string;
  entity: SyncEntity;
  entityId: string;
  baseRev: number;
  remoteRev: number;
  localData: Record<string, unknown>;
  remoteData: Record<string, unknown>;
  createdAt: IsoDate;
}

export interface SyncPullResult {
  changes: SyncChange[];
  cursor: SyncCursor | null;
  hasMore: boolean;
}

export interface SyncSnapshot {
  version: number;
  workspace: Workspace;
  members: WorkspaceMember[];
  notebooks: Notebook[];
  pages: Page[];
  pageDocuments: PageDocument[];
  canvases: Canvas[];
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
  tags: Tag[];
  pageTags: PageTag[];
  captures: Capture[];
  templates: Template[];
  decks: Deck[];
  flashcards: Flashcard[];
  comments: Comment[];
}

export interface WorkspaceBootstrap {
  workspace: Workspace;
  role: Role;
  memberships: Array<{ workspace: Workspace; role: Role }>;
  notebooks: Notebook[];
  pages: Page[];
}
