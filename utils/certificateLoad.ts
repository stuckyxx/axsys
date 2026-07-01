import type { Certificate } from '../types';

interface ResolveCertificatesForLoadArgs {
    localCertificates: Certificate[];
    preferRemote?: boolean;
    recoverRemote: () => Promise<Certificate[]>;
}

export const resolveCertificatesForLoad = async ({
    localCertificates,
    preferRemote = false,
    recoverRemote,
}: ResolveCertificatesForLoadArgs): Promise<Certificate[]> => {
    if (preferRemote) {
        const remoteCertificates = await recoverRemote();
        return remoteCertificates.length > 0 ? remoteCertificates : localCertificates;
    }

    if (localCertificates.length > 0) {
        return localCertificates;
    }

    const remoteCertificates = await recoverRemote();
    return remoteCertificates.length > 0 ? remoteCertificates : localCertificates;
};
