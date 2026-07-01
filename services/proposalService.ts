import type { Proposal, User } from '../types.ts';
import { readCompanyScopedValue, writeCompanyScopedValue } from './storageScope.ts';

const PROPOSALS_DB_KEY = 'axsys_proposals_db_v2';

export const getProposals = (
  user?: Pick<User, 'companyId'> | null,
): Proposal[] => {
  return readCompanyScopedValue<Proposal[]>(PROPOSALS_DB_KEY, [], user);
};

export const saveProposal = (
  proposal: Proposal,
  user?: Pick<User, 'companyId'> | null,
) => {
  const proposals = getProposals(user);
  const existingIndex = proposals.findIndex((item) => item.id === proposal.id);

  if (existingIndex >= 0) {
    proposals[existingIndex] = proposal;
  } else {
    proposals.unshift(proposal);
  }

  writeCompanyScopedValue(PROPOSALS_DB_KEY, proposals, user);
};

export const saveProposals = (
  proposals: Proposal[],
  user?: Pick<User, 'companyId'> | null,
) => {
  writeCompanyScopedValue(PROPOSALS_DB_KEY, proposals, user);
};

export const deleteProposal = (
  proposalId: string,
  user?: Pick<User, 'companyId'> | null,
) => {
  const proposals = getProposals(user).filter((proposal) => proposal.id !== proposalId);
  writeCompanyScopedValue(PROPOSALS_DB_KEY, proposals, user);
};
