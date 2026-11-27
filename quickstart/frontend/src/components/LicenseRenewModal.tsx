import { useCallback, useState } from 'react';
import type { License, LicenseRenewRequest } from '../openapi';
import { toISO_8601 } from '../utils/duration';
import { formatDateTime } from '../utils/format';
import DurationInput from './DurationInput';
import { Input, Label } from './Form';
import Modal from './Modal.tsx';
import { OverdueMark } from './OverdueMark';

type RenewData = {
  extension: string;
  feeAmount: number;
  settleIn: string;
  description: string;
};

const defaultData: RenewData = {
  extension: '30d',
  feeAmount: 100,
  settleIn: '20m',
  description: '',
};

const positiveDuration = /^0*[1-9]\d*[smhd]$/;

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

  const validFee = Number.isFinite(renewData.feeAmount) && renewData.feeAmount > 0;
  const validExtension = positiveDuration.test(renewData.extension);
  const description = renewData.description.trim();
  const canSubmit = validFee && validExtension && !!renewData.settleIn && !!description;

  const handleRenew = async () => {
    if (!canSubmit) return;
    const request: LicenseRenewRequest = {
      licenseExtensionDuration: toISO_8601(renewData.extension),
      licenseFeeCc: renewData.feeAmount,
      settleBeforeDuration: toISO_8601(renewData.settleIn),
      description,
    };
    setRenewData(defaultData);
    await onIssueRenewal(request);
  };

  return (
    <Modal
      show={show}
      title="Renew License"
      confirmButtonLabel="Issue License Renewal Request"
      confirmVariant="primary"
      confirmButtonDisabled={!canSubmit}
      onClose={onClose}
      onConfirm={handleRenew}
      size="xl"
    >
      <div className="flex flex-col gap-6">
        <div>
          <div>
            <strong>License Contract ID:</strong> {license?.contractId.substring(0, 24)}...
          </div>
          <div>
            <strong>Expires at:</strong> {formatDateTime(license?.expiresAt)}
            {license?.isExpired && <OverdueMark />}
          </div>
        </div>
        <div className="grid grid-cols-1 gap-x-3 gap-y-2 sm:grid-cols-[10rem_1fr] sm:items-center">
          <Label htmlFor="renew-extension">Extension:</Label>
          <div>
            <DurationInput
              id="renew-extension"
              units="dhm"
              value={renewData.extension}
              onChange={updateField('extension')}
            />
            {!validExtension && (
              <div className="text-sm text-danger">Enter a positive whole duration.</div>
            )}
          </div>
          <Label htmlFor="renew-fee">Fee:</Label>
          <div className="w-30">
            <Input
              id="renew-fee"
              type="number"
              min={0}
              value={renewData.feeAmount}
              onChange={(e) => updateField('feeAmount')(Number(e.target.value) || 0)}
            />
            {!validFee && <div className="text-sm text-danger">Enter a fee greater than zero.</div>}
          </div>
          <Label htmlFor="renew-settle">Settle in:</Label>
          <DurationInput
            id="renew-settle"
            units="smhd"
            value={renewData.settleIn}
            onChange={updateField('settleIn')}
          />
          <Label htmlFor="renew-description">Description:</Label>
          <Input
            id="renew-description"
            value={renewData.description}
            onChange={(e) => updateField('description')(e.target.value)}
          />
        </div>
      </div>
    </Modal>
  );
}
