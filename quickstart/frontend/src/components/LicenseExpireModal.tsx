import { useState } from 'react';
import type { License } from '../openapi';
import { FIELD } from './controls';
import Modal from './Modal.tsx';

type Props = {
  show: boolean;
  license: License | null;
  onClose: () => void;
  onArchive: (description: string) => Promise<void> | void;
};

export default function LicenseArchiveModal({ show, license, onClose, onArchive }: Props) {
  const [expireDescription, setExpireDescription] = useState('');

  return (
    <Modal
      show={show}
      title={<div>Archive License</div>}
      onClose={() => {
        setExpireDescription('');
        onClose();
      }}
      onConfirm={async () => {
        if (!expireDescription.trim()) return;
        await onArchive(expireDescription);
        setExpireDescription('');
        onClose();
      }}
      backdrop="static"
      size="lg"
      zIndexBase={1500}
      confirmVariant="danger"
      confirmButtonLabel="Archive"
    >
      <div className="flex flex-col gap-4">
        <div>
          <strong>License Contract ID:</strong> {license?.contractId.substring(0, 24)}...
        </div>
        <div className="flex items-center gap-2">
          <label
            htmlFor="expire-description"
            className="shrink-0 text-sm font-medium text-neutral-700"
          >
            Description:
          </label>
          <input
            id="expire-description"
            className={`${FIELD} input-expire-description min-w-0 flex-1`}
            placeholder=""
            value={expireDescription}
            onChange={(e) => setExpireDescription(e.target.value)}
          />
        </div>
      </div>
    </Modal>
  );
}
