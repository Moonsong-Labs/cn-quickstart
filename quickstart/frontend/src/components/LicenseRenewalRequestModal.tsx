import { useState } from 'react';
import LicenseRenewModal from '../components/LicenseRenewModal.tsx';
import type { License, LicenseRenewalRequest, LicenseRenewRequest } from '../openapi';
import { Button } from './Button';
import Modal from './Modal.tsx';
import { OverdueMark } from './OverdueMark';
import { Table, Td, Th } from './Table';

type Props = {
  show: boolean;
  license: License | null;
  onClose: () => void;
  isAdmin: boolean;
  userWallet: string;
  onIssueRenewal: (request: LicenseRenewRequest) => Promise<void> | void;
  onCompleteRenewal: (
    licenseContractId: string,
    renewalContractId: string,
    allocationCid: string,
  ) => Promise<void> | void;
  onWithdraw: (renewalContractId: string) => Promise<void> | void;
  formatDateTime: (iso?: string) => string;
};

export default function LicenseRenewalRequestModal({
  show,
  license,
  onClose,
  isAdmin,
  userWallet,
  onIssueRenewal,
  onCompleteRenewal,
  onWithdraw,
  formatDateTime,
}: Props) {
  const [showNewModal, setShowNewModal] = useState(false);

  function makeStatus(renewal: LicenseRenewalRequest) {
    if (renewal.settleDeadlinePassed) {
      return (
        <span title="This renewal request has expired and may be withdrawn by the app-provider.">
          EXPIRED
        </span>
      );
    }
    if (!renewal.allocationCid) {
      return (
        <span title="Pending allocation acceptance in the app-user's wallet.">
          AWAITING_ACCEPTANCE
        </span>
      );
    }
    return <span title="Pending completion by the app-provider.">AWAITING_COMPLETION</span>;
  }

  async function handleIssueRenewal(request: LicenseRenewRequest) {
    setShowNewModal(false);
    await onIssueRenewal(request);
  }

  function handleClose() {
    if (showNewModal) {
      setShowNewModal(false);
    } else {
      onClose();
    }
  }

  return (
    <Modal
      show={show}
      title="License Renewal Requests"
      onClose={handleClose}
      size="xl"
    >
      <LicenseRenewModal
        show={showNewModal && isAdmin}
        license={license}
        onIssueRenewal={handleIssueRenewal}
        onClose={handleClose}
      />

      <div className="flex flex-col gap-5">
        <div>
          <strong>License Contract ID:</strong> {license?.contractId.substring(0, 24)}...
        </div>
        {isAdmin && (
          <div>
            <Button
              variant="primary"
              onClick={() => setShowNewModal(true)}
            >
              New
            </Button>
          </div>
        )}
        <Table
          layout="fixed"
          id="renewals-table"
        >
          <thead>
            <tr>
              <Th style={{ width: '90px' }}>Renewal Contract ID</Th>
              <Th style={{ width: '90px' }}>Request Id</Th>
              <Th style={{ width: '100px' }}>Requested At</Th>
              <Th style={{ width: '90px' }}>Extension</Th>
              <Th style={{ width: '60px' }}>Fee</Th>
              <Th style={{ width: '100px' }}>Prepare Until</Th>
              <Th style={{ width: '100px' }}>Settle Before</Th>
              <Th style={{ width: '100px' }}>Description</Th>
              <Th style={{ width: '150px', minWidth: '150px' }}>Status</Th>
              <Th style={{ width: '190px' }}>Actions</Th>
            </tr>
          </thead>
          <tbody>
            {license?.renewalRequests?.map((renewal) => {
              return (
                <tr key={renewal.contractId}>
                  <Td
                    overflow="truncate"
                    data-testid="renewal-contract-id"
                  >
                    {renewal.contractId}
                  </Td>
                  <Td
                    overflow="truncate"
                    data-testid="renewal-request-id"
                  >
                    {renewal.requestId}
                  </Td>
                  <Td overflow="truncate">{formatDateTime(renewal.requestedAt)}</Td>
                  <Td overflow="truncate">{renewal.licenseExtensionDuration}</Td>
                  <Td overflow="truncate">{renewal.licenseFeeAmount}</Td>
                  <Td overflow="truncate">
                    {formatDateTime(renewal.prepareUntil)}
                    {renewal.prepareDeadlinePassed && <OverdueMark />}
                  </Td>
                  <Td overflow="truncate">
                    {formatDateTime(renewal.settleBefore)}
                    {renewal.settleDeadlinePassed && <OverdueMark />}
                    {/* TODO https://github.com/digital-asset/cn-quickstart/issues/239
                         date component and remove server side computation of settleDeadlinePassed */}
                  </Td>
                  <Td overflow="truncate">{renewal.description}</Td>
                  <Td overflow="truncate">{makeStatus(renewal)}</Td>
                  <Td>
                    <div className="flex flex-wrap items-center gap-2">
                      {isAdmin &&
                        !renewal.settleDeadlinePassed &&
                        renewal.allocationCid &&
                        license && (
                          <Button
                            variant="primary"
                            onClick={() => {
                              if (!renewal.allocationCid) return;
                              void onCompleteRenewal(
                                license.contractId,
                                renewal.contractId,
                                renewal.allocationCid,
                              );
                            }}
                          >
                            Complete Renewal
                          </Button>
                        )}
                      {isAdmin && renewal && (
                        <Button
                          variant="danger"
                          onClick={() => {
                            void onWithdraw(renewal.contractId);
                          }}
                        >
                          Withdraw
                        </Button>
                      )}
                    </div>
                    {!isAdmin && !renewal.settleDeadlinePassed && !renewal.allocationCid && (
                      <>
                        Please accept the allocation request in your{' '}
                        <a
                          className="focus-ring font-medium text-primary underline hover:text-primary-hover"
                          href={`${userWallet}/allocations`}
                          target="_blank"
                          rel="noopener"
                        >
                          wallet
                        </a>
                        .
                      </>
                    )}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </div>
    </Modal>
  );
}
