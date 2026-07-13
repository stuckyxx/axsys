export type ProposalStatus = "draft" | "sent" | "approved" | "rejected"

const PROPOSAL_TRANSITIONS = Object.freeze({
  draft: Object.freeze(["sent"]),
  sent: Object.freeze(["approved", "rejected"]),
  approved: Object.freeze([]),
  rejected: Object.freeze([]),
} satisfies Record<ProposalStatus, readonly ProposalStatus[]>)

export function canTransitionProposal(
  from: ProposalStatus,
  to: ProposalStatus,
): boolean {
  return (PROPOSAL_TRANSITIONS[from] as readonly ProposalStatus[]).includes(to)
}
