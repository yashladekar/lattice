import type {
  Attachment,
  Canvas,
  Capture,
  Comment,
  Deck,
  Flashcard,
  KnowledgeEdge,
  KnowledgeNode,
  Notebook,
  ObjectType,
  Page,
  PageDocument,
  PageTag,
  ReviewLog,
  SuggestedEdit,
  SyncEntity,
  Tag,
  Template,
  Workspace,
  WorkspaceMember,
} from "@notes-learning/domain";

export interface LocalPageDocument extends PageDocument {
  localUpdatedAt?: string;
}

export interface OutboxItem {
  id: string;
  workspaceId: string;
  entity: SyncEntity;
  entityId: string;
  op: "UPSERT" | "DELETE";
  payload: Record<string, unknown>;
  baseRev?: number;
  revision: number;
  opId: string | null;
  createdAt: string;
}

export interface LocalConflict {
  id: string;
  workspaceId: string;
  entity: SyncEntity;
  entityId: string;
  baseRev: number;
  remoteRev: number;
  localData: Record<string, unknown>;
  remoteData: Record<string, unknown>;
  createdAt: string;
  resolvedAt?: string | null;
}

export interface MetaRow {
  key: string;
  value: string;
}

export interface StoredSession {
  userId: string;
  name: string;
  email: string;
  image: string | null;
  cachedAt: string;
}

export type LocalWorkspace = Workspace;
export type LocalMember = WorkspaceMember;
export type LocalNotebook = Notebook;
export type LocalPage = Page;
export type LocalCanvas = Canvas;
export type LocalNode = KnowledgeNode;
export type LocalEdge = KnowledgeEdge;
export type LocalTag = Tag;
export type LocalPageTag = PageTag;
export type LocalCapture = Capture;
export type LocalTemplate = Template;
export type LocalDeck = Deck;
export type LocalFlashcard = Flashcard;
export type LocalComment = Comment;
export type LocalSuggestedEdit = SuggestedEdit;
export type LocalObjectType = ObjectType;
export type LocalAttachment = Attachment;
export type LocalReviewLog = ReviewLog;

export interface LocalSnapshotPayload {
  version: number;
  role: string;
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
  attachments: Attachment[];
  suggestedEdits: SuggestedEdit[];
  objectTypes: ObjectType[];
}
