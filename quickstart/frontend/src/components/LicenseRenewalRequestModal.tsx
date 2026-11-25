import { useState } from 'react';
import LicenseRenewModal from '../components/LicenseRenewModal.tsx';
import type { License, LicenseRenewalRequest, LicenseRenewRequest } from '../openapi';
import { buttonClass, DEADLINE_PASSED, TABLE } from './controls';
import Modal from './Modal.tsx';

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
      title={<div>License Renewal Requests</div>}
      onClose={handleClose}
      backdrop="static"
      size="xl"
      zIndexBase={1500}
    >
      <LicenseRenewModal
        show={showNewModal && isAdmin}
        license={license}
        onIssueRenewal={handleIssueRenewal}
        onClose={handleClose}
      />

      <div>
        <strong>License Contract ID:</strong> {license?.contractId.substring(0, 24)}...
      </div>

      <br />
      {isAdmin && (
        <button
          type="button"
          className={`${buttonClass('primary')} btn-issue-renewal`}
          onClick={() => setShowNewModal(true)}
        >
          New
        </button>
      )}

      <div className="renewals mt-5">
        <table
          className={TABLE.table}
          id="renewals-table"
        >
          <thead>
            <tr>
              <th
                className={TABLE.th}
                style={{ width: '110px' }}
              >
                Renewal Contract ID
              </th>
              <th
                className={TABLE.th}
                style={{ width: '110px' }}
              >
                Request Id
              </th>
              <th
                className={TABLE.th}
                style={{ width: '100px' }}
              >
                Requested At
              </th>
              <th
                className={TABLE.th}
                style={{ width: '50px' }}
              >
                Extension
              </th>
              <th
                className={TABLE.th}
                style={{ width: '30px' }}
              >
                Fee
              </th>
              <th
                className={TABLE.th}
                style={{ width: '100px' }}
              >
                Prepare Until
              </th>
              <th
                className={TABLE.th}
                style={{ width: '100px' }}
              >
                Settle Before
              </th>
              <th
                className={TABLE.th}
                style={{ width: '100px' }}
              >
                Description
              </th>
              <th
                className={TABLE.th}
                style={{ width: '150px', minWidth: '150px' }}
              >
                Status
              </th>
              <th
                className={TABLE.th}
                style={{ width: '220px' }}
              >
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {license?.renewalRequests?.map((renewal) => {
              return (
                <tr
                  key={renewal.contractId}
                  className="renewal-row"
                >
                  <td
                    className={`${TABLE.td} truncate renewal-contract-id`}
                    data-testid="renewal-contract-id"
                  >
                    {renewal.contractId}
                  </td>
                  <td
                    className={`${TABLE.td} truncate renewal-request-id`}
                    data-testid="renewal-request-id"
                  >
                    {renewal.requestId}
                  </td>
                  <td className={`${TABLE.td} truncate renewal-requested-at`}>
                    {formatDateTime(renewal.requestedAt)}
                  </td>
                  <td className={`${TABLE.td} truncate`}>{renewal.licenseExtensionDuration}</td>
                  <td className={`${TABLE.td} truncate`}>{renewal.licenseFeeAmount}</td>
                  <td
                    className={`${TABLE.td} truncate ${renewal.prepareDeadlinePassed ? DEADLINE_PASSED : ''}`}
                  >
                    {formatDateTime(renewal.prepareUntil)}
                  </td>
                  <td
                    className={`${TABLE.td} truncate ${renewal.settleDeadlinePassed ? DEADLINE_PASSED : ''}`}
                  >
                    {formatDateTime(renewal.settleBefore)}
                    {/* TODO https://github.com/digital-asset/cn-quickstart/issues/239
                         date component and remove server side computation of settleDeadlinePassed */}
                  </td>
                  <td className={`${TABLE.td} truncate`}>{renewal.description}</td>
                  <td className={`${TABLE.td} truncate`}>{makeStatus(renewal)}</td>
                  <td className={`${TABLE.td} renewals-actions`}>
                    {isAdmin &&
                      !renewal.settleDeadlinePassed &&
                      renewal.allocationCid &&
                      license && (
                        <button
                          type="button"
                          className={`${buttonClass('primary')} btn-complete-renewal mr-2`}
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
                        </button>
                      )}
                    {isAdmin && renewal && (
                      <button
                        type="button"
                        className={`${buttonClass('danger')} btn-withdraw`}
                        onClick={() => {
                          void onWithdraw(renewal.contractId);
                        }}
                      >
                        Withdraw
                      </button>
                    )}
                    {!isAdmin && !renewal.settleDeadlinePassed && !renewal.allocationCid && (
                      <>
                        Please accept the allocation request in your{' '}
                        <a
                          className="font-medium text-brand-700 underline"
                          href={`${userWallet}/allocations`}
                          target="_blank"
                          rel="noopener"
                        >
                          wallet
                        </a>
                        .
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}
