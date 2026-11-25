// Copyright (c) 2026, Digital Asset (Switzerland) GmbH and/or its affiliates. All rights reserved.
// SPDX-License-Identifier: 0BSD

import type React from 'react';
import { useEffect, useState } from 'react';
import { Button } from '../components/Button';
import LicenseArchiveModal from '../components/LicenseExpireModal.tsx';
import LicenseRenewalRequestModal from '../components/LicenseRenewalRequestModal.tsx';
import { OverdueMark } from '../components/OverdueMark';
import { Page, PageBody } from '../components/Page';
import { Table, Td, Th } from '../components/Table';
import type { License, LicenseRenewRequest } from '../openapi.d.ts';
import { useLicenseStore } from '../stores/licenseStore';
import { useUserStore } from '../stores/userStore';
import { formatDateTime } from '../utils/format';

const LicensesView: React.FC = () => {
  const {
    licenses,
    fetchLicenses,
    initiateLicenseRenewal,
    initiateLicenseExpiration,
    completeLicenseRenewal,
    withdrawLicenseRenewalRequest,
  } = useLicenseStore();

  const { user, fetchUser } = useUserStore();
  const isAdmin = !!user?.isAdmin;
  const userWallet = user?.walletUrl || 'http://wallet.localhost:2000';

  const [selectedLicenseId, setSelectedLicenseId] = useState<string | null>(null);
  const [selectedLicense, setSelectedLicense] = useState<License | null>(null);
  const [showArchiveModal, setShowArchiveModal] = useState(false);
  const [showRenewalModal, setShowRenewalModal] = useState(false);

  useEffect(() => {
    fetchUser();
    fetchLicenses();
    const intervalId = setInterval(() => {
      fetchLicenses();
    }, 5000);
    return () => clearInterval(intervalId);
  }, [fetchUser, fetchLicenses]);

  useEffect(() => {
    if (!selectedLicenseId) {
      setSelectedLicense(null);
      return;
    }
    setSelectedLicense(licenses.find((l) => l.contractId === selectedLicenseId) ?? null);
  }, [licenses, selectedLicenseId]);

  const openArchiveModal = (licenseId: string) => {
    setShowArchiveModal(true);
    setSelectedLicenseId(licenseId);
  };

  const handleArchive = async (description?: string) => {
    if (!selectedLicenseId) return;
    await initiateLicenseExpiration(selectedLicenseId, description ?? '');
    setShowArchiveModal(false);
    setSelectedLicenseId(null);
    await fetchLicenses();
  };

  const closeArchiveModal = () => {
    setShowArchiveModal(false);
    setSelectedLicenseId(null);
  };

  const openRenewalModal = (licenseId: string) => {
    setShowRenewalModal(true);
    setSelectedLicenseId(licenseId);
  };

  const handleCompleteRenewal = async (
    renewalContractId: string,
    renewalRequestContractId: string,
    allocationContractId: string,
  ) => {
    const result = await completeLicenseRenewal(
      renewalContractId,
      renewalRequestContractId,
      allocationContractId,
    );
    if (result?.licenseId) {
      setSelectedLicenseId(result.licenseId);
    }
    await fetchLicenses();
  };

  const handleRenewalWithdraw = async (renewalContractId: string) => {
    if (!selectedLicenseId) return;
    await withdrawLicenseRenewalRequest(renewalContractId);
    await fetchLicenses();
  };

  const closeRenewalsModal = () => {
    setShowRenewalModal(false);
    setSelectedLicenseId(null);
  };

  const handleRenew = async (request: LicenseRenewRequest) => {
    if (!selectedLicenseId || !selectedLicense) return;
    await initiateLicenseRenewal(selectedLicenseId, request);
    await fetchLicenses();
  };

  return (
    <Page
      title="Licenses"
      subtitle="Licensing Demo"
    >
      <PageBody>
        <Table layout="fixed">
          <thead>
            <tr>
              <Th style={{ width: '100px' }}>License Contract ID</Th>
              {user?.isAdmin && <Th style={{ width: '120px' }}>User</Th>}
              <Th style={{ width: '190px' }}>Expires At</Th>
              <Th style={{ width: '70px' }}>License #</Th>
              <Th style={{ width: '80px' }}>Pending Renewals</Th>
              <Th style={{ width: '80px' }}>Accepted Renewals</Th>
              <Th style={{ width: '80px' }}>Status</Th>
              <Th style={{ width: '210px' }}>Actions</Th>
            </tr>
          </thead>
          <tbody>
            {licenses.map((license) => (
              <tr key={license.contractId}>
                <Td overflow="truncate">{license.contractId}</Td>
                {user?.isAdmin && <Td overflow="truncate">{license.user}</Td>}
                <Td overflow="truncate">
                  {formatDateTime(license.expiresAt)}
                  {license.isExpired && <OverdueMark />}
                </Td>
                <Td overflow="truncate">{license.licenseNum}</Td>
                <Td overflow="truncate">
                  {license.renewalRequests?.filter((r) => !r.allocationCid).length || 0}
                </Td>
                <Td overflow="truncate">
                  {license.renewalRequests?.filter((r) => r.allocationCid).length || 0}
                </Td>
                <Td overflow="truncate">{license.isExpired ? 'EXPIRED' : 'ACTIVE'}</Td>
                <Td>
                  <div className="flex items-center gap-2">
                    {(isAdmin || (license.renewalRequests?.length ?? 0) > 0) && (
                      <Button
                        variant="primary"
                        onClick={() => openRenewalModal(license.contractId)}
                      >
                        Renewals
                      </Button>
                    )}
                    {license.expiresAt && license.isExpired && (
                      <Button
                        variant="danger"
                        onClick={() => openArchiveModal(license.contractId)}
                      >
                        Archive
                      </Button>
                    )}
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </PageBody>

      <LicenseRenewalRequestModal
        show={showRenewalModal && !!selectedLicense}
        license={selectedLicense}
        onClose={closeRenewalsModal}
        isAdmin={isAdmin}
        userWallet={userWallet}
        onIssueRenewal={handleRenew}
        onCompleteRenewal={handleCompleteRenewal}
        onWithdraw={handleRenewalWithdraw}
        formatDateTime={formatDateTime}
      />

      <LicenseArchiveModal
        show={showArchiveModal && !!selectedLicense}
        license={selectedLicense}
        onClose={closeArchiveModal}
        onArchive={handleArchive}
      />
    </Page>
  );
};

export default LicensesView;
