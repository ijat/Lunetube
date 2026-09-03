import type { ChannelRef } from './channel.js';
import type { TextTimestamp } from '../format.js';
import type { Paged } from './common.js';

export type CommentSort = 'top' | 'newest';

export interface Comment {
  id: string;
  author: ChannelRef;
  authorIsUploader: boolean;
  authorIsVerified: boolean;
  text: string;
  textTimestamps: TextTimestamp[];
  likeCount: number | null;
  publishedText: string | null;
  isHearted: boolean;
  isPinned: boolean;
  replyCount: number;
}

export interface CommentThread {
  comment: Comment;
  /** Present when the thread has replies; `items` may be lazily loaded via `repliesContinuation`. */
  replies: Paged<Comment> | null;
}

export interface CommentPage {
  header: { totalText: string | null };
  threads: CommentThread[];
  continuation?: string;
}
