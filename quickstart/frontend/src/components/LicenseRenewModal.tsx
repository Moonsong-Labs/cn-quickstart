import { useCallback, useState } from 'react';
import type { License, LicenseRenewRequest } from '../openapi';
import { toISO_8601 } from '../utils/duration';
import { formatDateTime } from '../utils/format';
import DurationInput from './DurationInput';
import Modal from './Modal.tsx';

type RenewData = {
  extension: string;
  feeAmount: number;
  prepareIn: string;
  settleIn: string;
  description: string;
};

const defaultData: RenewData = {
  extension: '30d',
  feeAmount: 100,
  prepareIn: '10m',
  settleIn: '20m',
  description: '',
};

type Props = {
  show: boolean;
  license: License | null;
  onClose: () => void;
  onIssueRenewal: (request: LicenseRenewRequest) => Promise<void> | void;
};

export default function LicenseRenewModal({ show, license, onClose, onIssueRenewal }: Props) {
  const [renewData, setRenewData] = useState(defaultData);
  const updateField = useCallback(
    <K extends keyof RenewData>(field: K) =>
      (value: RenewData[K]) =>
        setRenewData((prev) => ({ ...prev, [field]: value })),
    [],
  );

  const handleRenew = async () => {
    if (
      !renewData.description.trim() &&
      !renewData.prepareIn.trim() &&
      !renewData.settleIn.trim() &&
      !renewData.extension
    )
      return;
    const request: LicenseRenewRequest = {
      licenseExtensionDuration: toISO_8601(renewData.extension),
      licenseFeeCc: renewData.feeAmount,
      prepareUntilDuration: toISO_8601(renewData.prepareIn),
      settleBeforeDuration: toISO_8601(renewData.settleIn),
      description: renewData.description.trim(),
    };
    setRenewData(defaultData);
    await onIssueRenewal(request);
  };

  return (
    <Modal
      show={show}
      title="Renew License"
      confirmButtonLabel="Issue License Renewal Request"
      confirmButtonClassName="btn-success"
      confirmButtonDisabled={!renewData.description.trim()}
      onClose={onClose}
      onConfirm={handleRenew}
      backdrop="static"
      size="xl"
      zIndexBase={2000}
    >
      <div>
        <strong>License Contract ID:</strong> {license?.contractId.substring(0, 24)}...
      </div>
      <div className={`${license?.isExpired && 'deadline-passed'}`}>
        <strong>Expires at:</strong> {formatDateTime(license?.expiresAt)}
      </div>

      <br />

      <div className="mb-4">
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '160px 1fr',
            columnGap: '12px',
            rowGap: '8px',
            alignItems: 'center',
          }}
        >
          <label
            className="text-end pe-2 mb-0"
            htmlFor="renew-extension"
          >
            Extension:
          </label>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <DurationInput
              id="renew-extension"
              units="dhm"
              value={renewData.extension}
              onChange={updateField('extension')}
            />
          </div>

          <label
            className="text-end pe-2 mb-0"
            htmlFor="renew-fee"
          >
            Fee:
          </label>
          <div>
            <input
              id="renew-fee"
              type="number"
              min={0}
              className="form-control"
              value={renewData.feeAmount}
              onChange={(e) => updateField('feeAmount')(Number(e.target.value) || 0)}
              style={{ width: '120px' }}
            />
          </div>

          <label
            className="text-end pe-2 mb-0"
            htmlFor="renew-prepare"
          >
            Prepare in:
          </label>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <DurationInput
              id="renew-prepare"
              units="smhd"
              value={renewData.prepareIn}
              onChange={updateField('prepareIn')}
            />
          </div>

          <label
            className="text-end pe-2 mb-0"
            htmlFor="renew-settle"
          >
            Settle in:
          </label>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <DurationInput
              id="renew-settle"
              units="smhd"
              value={renewData.settleIn}
              onChange={updateField('settleIn')}
            />
          </div>

          <label
            className="text-end pe-2 mb-0"
            htmlFor="renew-description"
          >
            Description:
          </label>
          <div>
            <input
              id="renew-description"
              className="form-control mb-2 input-renew-description"
              placeholder=""
              value={renewData.description}
              onChange={(e) => updateField('description')(e.target.value)}
            />
          </div>
        </div>
      </div>
    </Modal>
  );
}
