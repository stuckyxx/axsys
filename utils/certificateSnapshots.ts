import type { Certificate } from '../types';

interface CertificateSnapshot {
    key: string;
    updatedAt: string;
    certificates: Certificate[];
}

interface SelectCertificateSnapshotArgs {
    scopedKey: string;
    globalScopedKey: string;
    snapshots: CertificateSnapshot[];
}

export const selectCertificateSnapshot = ({
    scopedKey,
    globalScopedKey,
    snapshots,
}: SelectCertificateSnapshotArgs): CertificateSnapshot | null => {
    const scopedSnapshot = snapshots.find((snapshot) => snapshot.key === scopedKey && snapshot.certificates.length > 0);
    if (scopedSnapshot) {
        return scopedSnapshot;
    }

    const globalScopedSnapshot = snapshots.find((snapshot) => snapshot.key === globalScopedKey && snapshot.certificates.length > 0);
    if (globalScopedSnapshot) {
        return globalScopedSnapshot;
    }

    return snapshots.find((snapshot) => snapshot.certificates.length > 0) ?? null;
};
