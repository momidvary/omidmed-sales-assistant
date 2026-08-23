export const CONTENT_STATUSES = [
  "draft",
  "pending_review",
  "approved",
  "published",
  "rejected",
] as const;

export type ContentWorkflowStatus = (typeof CONTENT_STATUSES)[number];

const allowedTransitions: Record<ContentWorkflowStatus, readonly ContentWorkflowStatus[]> = {
  draft: ["pending_review"],
  pending_review: ["approved", "rejected", "draft"],
  approved: ["published", "rejected", "draft"],
  published: ["draft"],
  rejected: ["draft", "pending_review"],
};

export function isContentWorkflowStatus(value: string): value is ContentWorkflowStatus {
  return CONTENT_STATUSES.includes(value as ContentWorkflowStatus);
}

export function canTransitionContentStatus(
  from: ContentWorkflowStatus,
  to: ContentWorkflowStatus,
) {
  return allowedTransitions[from].includes(to);
}

export function nextContentStatusActions(status: ContentWorkflowStatus) {
  return allowedTransitions[status];
}
