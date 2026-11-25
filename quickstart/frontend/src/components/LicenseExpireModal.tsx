import { useState } from 'react';
import type { License } from '../openapi';
import { Input, Label } from './Form';
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
      title="Archive License"
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
      size="lg"
      confirmVariant="danger"
      confirmButtonLabel="Archive"
    >
      <div className="flex flex-col gap-4">
        <div>
          <strong>License Contract ID:</strong> {license?.contractId.substring(0, 24)}...
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="expire-description">Description:</Label>
          <div className="min-w-0 flex-1">
            <Input
              id="expire-description"
              value={expireDescription}
              onChange={(e) => setExpireDescription(e.target.value)}
            />
          </div>
        </div>
      </div>
    </Modal>
  );
}
